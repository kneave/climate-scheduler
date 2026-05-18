"""Tests for _project_group_runtime_view, _get_nodes_for_day, _sync_group_profile_views,
_resolve_group_active_global_profile, and async_schedule enable/disable routing.

These are pure-logic and lightweight-storage tests — no full HA instance needed.
"""
import copy
import pytest
from unittest.mock import MagicMock
from custom_components.climate_scheduler.storage import ScheduleStorage
from custom_components.climate_scheduler.const import DOMAIN


# ---------------------------------------------------------------------------
# Reusable helpers
# ---------------------------------------------------------------------------

class FakeStore:
    async def async_save(self, d):
        pass
    async def async_load(self):
        return None


def _make_storage(hass_mock, data):
    """Create a ScheduleStorage pre-loaded with *data*."""
    s = ScheduleStorage.__new__(ScheduleStorage)
    s.hass = hass_mock
    s._data = copy.deepcopy(data)
    s._store = FakeStore()
    return s


def _hass():
    from custom_components.climate_scheduler.const import DOMAIN as _D
    hass = MagicMock()
    hass.data = {_D: {}}
    state = MagicMock()
    state.attributes.get = lambda k, d=None: "Test Entity" if k == "friendly_name" else d
    hass.states.get = lambda eid: state
    return hass


SAMPLE_NODES = [
    {"time": "06:00", "temp": 18},
    {"time": "08:00", "temp": 21},
    {"time": "17:00", "temp": 22},
    {"time": "22:00", "temp": 17},
]


# ---------------------------------------------------------------------------
# _get_nodes_for_day
# ---------------------------------------------------------------------------

class TestGetNodesForDay:
    """Day-to-schedule resolution: all_days, 5/2, and individual modes."""

    def test_all_days_returns_single_schedule(self):
        s = _make_storage(_hass(), {"groups": {}, "settings": {}})
        data = {"schedule_mode": "all_days", "schedules": {"all_days": SAMPLE_NODES}}
        result = s._get_nodes_for_day(data, "mon")
        assert result == SAMPLE_NODES

    def test_all_days_any_day_same_result(self):
        s = _make_storage(_hass(), {"groups": {}, "settings": {}})
        data = {"schedule_mode": "all_days", "schedules": {"all_days": SAMPLE_NODES}}
        for day in ["mon", "tue", "wed", "sat", "sun"]:
            assert s._get_nodes_for_day(data, day) == SAMPLE_NODES

    def test_5_2_weekday_direct(self):
        s = _make_storage(_hass(), {"groups": {}, "settings": {}})
        weekday_nodes = [{"time": "06:00", "temp": 21}]
        weekend_nodes = [{"time": "08:00", "temp": 18}]
        data = {
            "schedule_mode": "5/2",
            "schedules": {"weekday": weekday_nodes, "weekend": weekend_nodes},
        }
        assert s._get_nodes_for_day(data, "weekday") == weekday_nodes
        assert s._get_nodes_for_day(data, "weekend") == weekend_nodes

    def test_5_2_mon_through_fri_map_to_weekday(self):
        s = _make_storage(_hass(), {"groups": {}, "settings": {}})
        weekday_nodes = [{"time": "06:00", "temp": 21}]
        weekend_nodes = [{"time": "08:00", "temp": 18}]
        data = {
            "schedule_mode": "5/2",
            "schedules": {"weekday": weekday_nodes, "weekend": weekend_nodes},
        }
        for day in ["mon", "tue", "wed", "thu", "fri"]:
            assert s._get_nodes_for_day(data, day) == weekday_nodes

    def test_5_2_sat_sun_map_to_weekend(self):
        s = _make_storage(_hass(), {"groups": {}, "settings": {}})
        weekday_nodes = [{"time": "06:00", "temp": 21}]
        weekend_nodes = [{"time": "08:00", "temp": 18}]
        data = {
            "schedule_mode": "5/2",
            "schedules": {"weekday": weekday_nodes, "weekend": weekend_nodes},
        }
        for day in ["sat", "sun"]:
            assert s._get_nodes_for_day(data, day) == weekend_nodes

    def test_individual_per_day(self):
        s = _make_storage(_hass(), {"groups": {}, "settings": {}})
        mon_nodes = [{"time": "06:00", "temp": 21}]
        sat_nodes = [{"time": "09:00", "temp": 18}]
        data = {
            "schedule_mode": "individual",
            "schedules": {"mon": mon_nodes, "sat": sat_nodes},
        }
        assert s._get_nodes_for_day(data, "mon") == mon_nodes
        assert s._get_nodes_for_day(data, "sat") == sat_nodes

    def test_individual_missing_day_returns_empty(self):
        s = _make_storage(_hass(), {"groups": {}, "settings": {}})
        data = {
            "schedule_mode": "individual",
            "schedules": {"mon": SAMPLE_NODES},
        }
        result = s._get_nodes_for_day(data, "wed")
        assert result == []

    def test_unknown_mode_returns_empty(self):
        s = _make_storage(_hass(), {"groups": {}, "settings": {}})
        data = {"schedule_mode": "unknown_mode", "schedules": {}}
        result = s._get_nodes_for_day(data, "mon")
        assert result == []

    def test_defaults_to_all_days_when_no_mode(self):
        s = _make_storage(_hass(), {"groups": {}, "settings": {}})
        data = {"schedules": {"all_days": SAMPLE_NODES}}
        # Missing schedule_mode defaults to "all_days"
        result = s._get_nodes_for_day(data, "any_day")
        assert result == SAMPLE_NODES


# ---------------------------------------------------------------------------
# _project_group_runtime_view
# ---------------------------------------------------------------------------

class TestProjectGroupRuntimeView:
    """Deep-copies group data and overlays global profiles + active profile."""

    def test_exposes_global_profiles(self):
        global_profiles = {
            "Default": {"schedule_mode": "all_days", "schedules": {"all_days": SAMPLE_NODES}},
            "Away": {"schedule_mode": "all_days", "schedules": {"all_days": [{"time": "08:00", "temp": 15}]}},
        }
        group_data = {
            "entities": ["climate.bedroom"],
            "schedule_mode": "all_days",
            "schedules": {"all_days": []},
            "active_profile": "Default",
        }
        s = _make_storage(_hass(), {
            "groups": {"Bedroom": group_data},
            "profiles": copy.deepcopy(global_profiles),
            "settings": {},
        })
        result = s._project_group_runtime_view(group_data)
        # Should have global profiles (deep-copied)
        assert "Default" in result["profiles"]
        assert "Away" in result["profiles"]
        assert result["profiles"] is not global_profiles  # deep copy, not reference

    def test_active_profile_global_set(self):
        s = _make_storage(_hass(), {
            "groups": {
                "Bedroom": {
                    "entities": ["climate.bedroom"],
                    "schedule_mode": "all_days",
                    "schedules": {"all_days": SAMPLE_NODES},
                    "active_profile": "Default",
                }
            },
            "profiles": {
                "Default": {"schedule_mode": "all_days", "schedules": {"all_days": SAMPLE_NODES}},
            },
            "settings": {},
        })
        group_data = s._data["groups"]["Bedroom"]
        result = s._project_group_runtime_view(group_data)
        assert result["active_profile_global"] == "Default"

    def test_does_not_mutate_original(self):
        original_schedules = {"all_days": [{"time": "06:00", "temp": 18}]}
        group_data = {
            "entities": ["climate.bedroom"],
            "schedule_mode": "all_days",
            "schedules": copy.deepcopy(original_schedules),
            "active_profile": "Default",
        }
        s = _make_storage(_hass(), {
            "groups": {"Bedroom": group_data},
            "profiles": {"Default": {"schedule_mode": "all_days", "schedules": original_schedules}},
            "settings": {},
        })
        original_group_schedules_id = id(group_data["schedules"])
        result = s._project_group_runtime_view(group_data)
        assert id(result["schedules"]) != original_group_schedules_id


# ---------------------------------------------------------------------------
# _resolve_group_active_global_profile
# ---------------------------------------------------------------------------

class TestResolveGroupActiveGlobalProfile:
    """Resolves which global profile is active for a group."""

    def test_prefers_active_profile_global(self):
        s = _make_storage(_hass(), {"groups": {}, "settings": {}})
        group_data = {"active_profile_global": "Away", "active_profile": "Default"}
        profiles = {"Default": {}, "Away": {}}
        result = s._resolve_group_active_global_profile(group_data, profiles)
        assert result == "Away"

    def test_falls_back_to_active_profile(self):
        s = _make_storage(_hass(), {"groups": {}, "settings": {}})
        group_data = {"active_profile": "Comfort"}
        profiles = {"Default": {}, "Comfort": {}}
        result = s._resolve_group_active_global_profile(group_data, profiles)
        assert result == "Comfort"

    def test_defaults_to_default(self):
        s = _make_storage(_hass(), {"groups": {}, "settings": {}})
        group_data = {}
        profiles = {"Default": {}}
        result = s._resolve_group_active_global_profile(group_data, profiles)
        assert result == "Default"

    def test_falls_back_to_first_profile_if_no_default(self):
        s = _make_storage(_hass(), {"groups": {}, "settings": {}})
        group_data = {}
        profiles = {"Comfort": {}}
        result = s._resolve_group_active_global_profile(group_data, profiles)
        assert result == "Comfort"

    def test_empty_profiles_returns_none(self):
        s = _make_storage(_hass(), {"groups": {}, "settings": {}})
        group_data = {}
        result = s._resolve_group_active_global_profile(group_data, {})
        assert result is None


# ---------------------------------------------------------------------------
# _sync_group_profile_views
# ---------------------------------------------------------------------------

class TestSyncGroupProfileViews:
    """Ensures group runtime fields stay aligned with active global profile."""

    @pytest.mark.asyncio
    async def test_syncs_schedule_mode_and_schedules(self):
        data = {
            "groups": {
                "Bedroom": {
                    "entities": ["climate.bedroom"],
                    "schedule_mode": "all_days",
                    "schedules": {"all_days": []},
                    "active_profile": "Away",
                }
            },
            "profiles": {
                "Away": {
                    "schedule_mode": "5/2",
                    "schedules": {"weekday": [{"time": "06:00", "temp": 18}], "weekend": [{"time": "08:00", "temp": 15}]},
                }
            },
            "settings": {},
        }
        s = _make_storage(_hass(), data)
        s._sync_group_profile_views()
        grp = s._data["groups"]["Bedroom"]
        assert grp["schedule_mode"] == "5/2"
        assert "weekday" in grp["schedules"]

    @pytest.mark.asyncio
    async def test_initializes_global_profiles_if_missing(self):
        data = {
            "groups": {
                "Bedroom": {
                    "entities": ["climate.bedroom"],
                    "schedule_mode": "all_days",
                    "schedules": {"all_days": SAMPLE_NODES},
                }
            },
            "settings": {},
        }
        s = _make_storage(_hass(), data)
        s._sync_group_profile_views()
        # Should have created global profiles with at least a Default
        assert "profiles" in s._data
        assert "Default" in s._data["profiles"]


# ---------------------------------------------------------------------------
# async_enable_schedule / async_disable_schedule routing
# ---------------------------------------------------------------------------

class TestScheduleEnableDisableRouting:
    """Enable/disable by group name or entity_id lookup."""

    @pytest.mark.asyncio
    async def test_enable_by_group_name(self):
        data = {
            "groups": {
                "Bedroom": {
                    "entities": ["climate.bedroom"],
                    "enabled": False,
                    "schedule_mode": "all_days",
                    "schedules": {"all_days": []},
                }
            },
            "profiles": {"Default": {"schedule_mode": "all_days", "schedules": {"all_days": []}}},
            "settings": {},
        }
        s = _make_storage(_hass(), data)
        await s.async_enable_schedule("Bedroom")
        assert s._data["groups"]["Bedroom"]["enabled"] is True

    @pytest.mark.asyncio
    async def test_disable_by_group_name(self):
        data = {
            "groups": {
                "Bedroom": {
                    "entities": ["climate.bedroom"],
                    "enabled": True,
                    "schedule_mode": "all_days",
                    "schedules": {"all_days": []},
                }
            },
            "profiles": {"Default": {"schedule_mode": "all_days", "schedules": {"all_days": []}}},
            "settings": {},
        }
        s = _make_storage(_hass(), data)
        await s.async_disable_schedule("Bedroom")
        assert s._data["groups"]["Bedroom"]["enabled"] is False

    @pytest.mark.asyncio
    async def test_enable_by_entity_id_finds_group(self):
        data = {
            "groups": {
                "Bedroom": {
                    "entities": ["climate.bedroom"],
                    "enabled": False,
                    "schedule_mode": "all_days",
                    "schedules": {"all_days": []},
                }
            },
            "profiles": {"Default": {"schedule_mode": "all_days", "schedules": {"all_days": []}}},
            "settings": {},
        }
        s = _make_storage(_hass(), data)
        await s.async_enable_schedule("climate.bedroom")
        assert s._data["groups"]["Bedroom"]["enabled"] is True

    @pytest.mark.asyncio
    async def test_enable_nonexistent_raises(self):
        data = {"groups": {}, "profiles": {}, "settings": {}}
        s = _make_storage(_hass(), data)
        with pytest.raises(ValueError, match="not found"):
            await s.async_enable_schedule("nonexistent")

    @pytest.mark.asyncio
    async def test_disable_nonexistent_raises(self):
        data = {"groups": {}, "profiles": {}, "settings": {}}
        s = _make_storage(_hass(), data)
        with pytest.raises(ValueError, match="not found"):
            await s.async_disable_schedule("nonexistent")


# ---------------------------------------------------------------------------
# _find_single_entity_group
# ---------------------------------------------------------------------------

class TestFindSingleEntityGroup:
    """Lookup of single-entity groups by both old __entity_ format and friendly name."""

    def test_old_format_lookup(self):
        data = {
            "groups": {
                "__entity_climate.bedroom": {
                    "entities": ["climate.bedroom"],
                    "_is_single_entity_group": True,
                    "schedule_mode": "all_days",
                    "schedules": {"all_days": []},
                }
            },
            "settings": {},
        }
        s = _make_storage(_hass(), data)
        assert s._find_single_entity_group("climate.bedroom") == "__entity_climate.bedroom"

    def test_friendly_name_lookup(self):
        data = {
            "groups": {
                "Bedroom": {
                    "entities": ["climate.bedroom"],
                    "_is_single_entity_group": True,
                    "schedule_mode": "all_days",
                    "schedules": {"all_days": []},
                }
            },
            "settings": {},
        }
        s = _make_storage(_hass(), data)
        assert s._find_single_entity_group("climate.bedroom") == "Bedroom"

    def test_multi_entity_group_not_returned(self):
        data = {
            "groups": {
                "All Rooms": {
                    "entities": ["climate.bedroom", "climate.kitchen"],
                    "schedule_mode": "all_days",
                    "schedules": {"all_days": []},
                }
            },
            "settings": {},
        }
        s = _make_storage(_hass(), data)
        assert s._find_single_entity_group("climate.bedroom") is None

    def test_not_found_returns_none(self):
        data = {"groups": {}, "settings": {}}
        s = _make_storage(_hass(), data)
        assert s._find_single_entity_group("climate.unknown") is None


# ---------------------------------------------------------------------------
# async_set_group_schedule (complex profile routing)
# ---------------------------------------------------------------------------

class TestSetGroupSchedule:
    """Set schedule on a group — applies to active profile or explicit profile."""

    @pytest.mark.asyncio
    async def test_set_schedule_active_profile_all_days(self):
        data = {
            "groups": {
                "Bedroom": {
                    "entities": ["climate.bedroom"],
                    "enabled": True,
                    "schedule_mode": "all_days",
                    "schedules": {"all_days": []},
                    "active_profile": "Default",
                }
            },
            "profiles": {
                "Default": {"schedule_mode": "all_days", "schedules": {"all_days": []}},
            },
            "settings": {},
        }
        s = _make_storage(_hass(), data)
        nodes = [{"time": "07:00", "temp": 20}, {"time": "22:00", "temp": 17}]
        await s.async_set_group_schedule("Bedroom", nodes)
        grp = s._data["groups"]["Bedroom"]
        assert len(grp["schedules"]["all_days"]) == 2

    @pytest.mark.asyncio
    async def test_set_schedule_explicit_profile(self):
        data = {
            "groups": {
                "Bedroom": {
                    "entities": ["climate.bedroom"],
                    "enabled": True,
                    "schedule_mode": "all_days",
                    "schedules": {"all_days": []},
                    "active_profile": "Default",
                }
            },
            "profiles": {
                "Default": {"schedule_mode": "all_days", "schedules": {"all_days": []}},
                "Away": {"schedule_mode": "all_days", "schedules": {"all_days": []}},
            },
            "settings": {},
        }
        s = _make_storage(_hass(), data)
        away_nodes = [{"time": "08:00", "temp": 15}]
        await s.async_set_group_schedule("Bedroom", away_nodes, profile_name="Away")
        # Away profile should have the nodes, but active profile schedule stays unchanged
        assert len(s._data["profiles"]["Away"]["schedules"]["all_days"]) == 1
        assert s._data["profiles"]["Away"]["schedules"]["all_days"][0]["temp"] == 15

    @pytest.mark.asyncio
    async def test_set_schedule_nonexistent_group_raises(self):
        data = {"groups": {}, "profiles": {}, "settings": {}}
        s = _make_storage(_hass(), data)
        with pytest.raises(ValueError, match="does not exist"):
            await s.async_set_group_schedule("Nonexistent", [])

    @pytest.mark.asyncio
    async def test_set_schedule_nonexistent_profile_raises(self):
        data = {
            "groups": {
                "Bedroom": {
                    "entities": ["climate.bedroom"],
                    "schedule_mode": "all_days",
                    "schedules": {"all_days": []},
                }
            },
            "profiles": {"Default": {"schedule_mode": "all_days", "schedules": {"all_days": []}}},
            "settings": {},
        }
        s = _make_storage(_hass(), data)
        with pytest.raises(ValueError, match="does not exist"):
            await s.async_set_group_schedule("Bedroom", [], profile_name="Nonexistent")

    @pytest.mark.asyncio
    async def test_set_schedule_5_2_day_specific(self):
        data = {
            "groups": {
                "Bedroom": {
                    "entities": ["climate.bedroom"],
                    "enabled": True,
                    "schedule_mode": "5/2",
                    "schedules": {"weekday": [], "weekend": []},
                    "active_profile": "Default",
                }
            },
            "profiles": {
                "Default": {"schedule_mode": "5/2", "schedules": {"weekday": [], "weekend": []}},
            },
            "settings": {},
        }
        s = _make_storage(_hass(), data)
        weekday_nodes = [{"time": "06:00", "temp": 21}]
        await s.async_set_group_schedule("Bedroom", weekday_nodes, day="weekday")
        assert len(s._data["groups"]["Bedroom"]["schedules"]["weekday"]) == 1

    @pytest.mark.asyncio
    async def test_set_schedule_5_2_mon_aliased_to_weekday(self):
        """Setting schedule for 'mon' in 5/2 mode should update 'weekday'."""
        data = {
            "groups": {
                "Bedroom": {
                    "entities": ["climate.bedroom"],
                    "enabled": True,
                    "schedule_mode": "5/2",
                    "schedules": {"weekday": [], "weekend": []},
                    "active_profile": "Default",
                }
            },
            "profiles": {
                "Default": {"schedule_mode": "5/2", "schedules": {"weekday": [], "weekend": []}},
            },
            "settings": {},
        }
        s = _make_storage(_hass(), data)
        nodes = [{"time": "06:00", "temp": 21}]
        await s.async_set_group_schedule("Bedroom", nodes, day="mon")
        assert len(s._data["groups"]["Bedroom"]["schedules"]["weekday"]) == 1