"""Tests for coordinator.py — advance logic, override lifecycle, day boundaries.

Uses FakeHass mock instead of real HomeAssistant installation.
Coordinator methods depend on hass.services.async_call and hass.states.get,
so the mock provides:
- states.get() → returns entity state with attributes
- services.async_call() → records calls for assertion
- bus.async_fire() → records events for assertion
- storage → FakeStore from conftest

IMPORTANT: The coordinator extends DataUpdateCoordinator from HA. The conftest
stubs replace that with MagicMock, making the class unusable. We must import
the real coordinator module BEFORE the conftest stubs take effect, by ensuring
a concrete base class exists for DataUpdateCoordinator.
"""
import pytest
from datetime import datetime, timedelta, time
from unittest.mock import AsyncMock, MagicMock, patch
import sys
import os

# Add project root to path
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

# DataUpdateCoordinator and dt_util stubs are in conftest.py
from tests.conftest import FakeStore


class FakeState:
    """Minimal HA State mock."""
    def __init__(self, entity_id, state="auto", attributes=None):
        self.entity_id = entity_id
        self.state = state
        self.attributes = attributes or {}


class FakeBus:
    """Minimal HA bus mock that records fired events."""
    def __init__(self):
        self.events = []

    def async_fire(self, event_type, data=None):
        self.events.append({"event_type": event_type, "data": data or {}})


class FakeServices:
    """Minimal HA services mock that records service calls."""
    def __init__(self):
        self.calls = []

    async def async_call(self, domain, service, data=None, blocking=False):
        self.calls.append({
            "domain": domain,
            "service": service,
            "data": data or {},
            "blocking": blocking,
        })


class FakeHass:
    """Minimal HomeAssistant mock for coordinator testing."""
    def __init__(self, entities=None):
        self.states = MagicMock()
        self.services = FakeServices()
        self.bus = FakeBus()
        self._entities = entities or {}

        # Wire up states.get to return configured entities
        self.states.get = self._get_state

    def _get_state(self, entity_id):
        if entity_id in self._entities:
            return self._entities[entity_id]
        return None

    def add_entity(self, entity_id, state="auto", attributes=None):
        self._entities[entity_id] = FakeState(entity_id, state, attributes)


class FakeCoordinator:
    """Lightweight coordinator test double.

    Instead of inheriting from DataUpdateCoordinator (which requires a real hass
    with event loop, config entries, etc.), we instantiate only the methods
    we want to test and wire them to FakeHass + FakeStore.

    This approach tests the LOGIC of advance/cancel/override without needing
    the full HA framework.
    """

    def __init__(self, hass, storage):
        self.hass = hass
        self.storage = storage
        self.last_node_states = {}
        self.last_node_times = {}
        self.override_until = {}
        self.advance_history = {}
        self._workday_available = None

    # Delegate to real coordinator methods by importing and calling them
    # We'll use the real HeatingSchedulerCoordinator logic but with our fakes


async def _make_coordinator(entities=None, groups=None, schedules=None, settings=None):
    """Create a test coordinator with full wiring.

    Returns (coordinator, hass, storage) so tests can assert on all three.
    """
    # Must import AFTER the DataUpdateCoordinator stub is registered
    from custom_components.climate_scheduler.coordinator import HeatingSchedulerCoordinator

    hass = FakeHass(entities)

    # Build storage data
    storage_data = {
        "groups": groups or {},
        "settings": settings or {"min_temp": 5.0, "max_temp": 30.0},
        "advance_history": {},
    }

    # Inject schedule data into group structure
    if schedules:
        for group_name, group_schedules in schedules.items():
            if group_name not in storage_data["groups"]:
                storage_data["groups"][group_name] = {"entities": [], "enabled": True}
            storage_data["groups"][group_name]["schedules"] = group_schedules

    # Create a mock storage that returns real data from storage_data
    storage = MagicMock()
    storage._data = storage_data

    async def _get_settings():
        return storage_data["settings"]

    async def _get_groups():
        return storage_data["groups"]

    async def _get_group(group_name):
        return storage_data["groups"].get(group_name)

    async def _get_group_schedule(group_name, day):
        group = storage_data["groups"].get(group_name, {})
        group_schedules = group.get("schedules", {})
        return group_schedules.get(day)

    async def _get_advance_history():
        return storage_data["advance_history"]

    async def _save_advance_history(history):
        storage_data["advance_history"] = history

    async def _save():
        pass

    storage.async_get_settings = _get_settings
    storage.async_get_groups = _get_groups
    storage.async_get_group = _get_group
    storage.async_get_group_schedule = _get_group_schedule
    storage.async_get_advance_history = _get_advance_history
    storage.async_save_advance_history = _save_advance_history
    storage.async_save = _save

    # Create coordinator — use real __init__ with our stubbed base class
    coord = HeatingSchedulerCoordinator(hass, storage, timedelta(minutes=5))
    coord.advance_history = {}

    return coord, hass, storage


# ── Advance logic tests ──────────────────────────────────────────────────

class TestAdvanceLogic:
    """Test advance_to_next_node — node selection, temperature clamping, override setting."""

    @pytest.mark.asyncio
    async def test_advance_selects_next_later_node(self):
        """At 10:00, advance should pick the next node after 10:00."""
        coord, hass, storage = await _make_coordinator(
            entities={
                "climate.living_room": FakeState(
                    "climate.living_room", "auto",
                    {"hvac_modes": ["auto", "off"], "current_temperature": 20}
                )
            },
            groups={
                "Living Room": {
                    "entities": ["climate.living_room"],
                    "enabled": True,
                    "schedules": {
                        "mon": {
                            "schedule_mode": "all_days",
                            "nodes": [
                                {"time": "06:00", "temp": 18},
                                {"time": "08:00", "temp": 21},
                                {"time": "17:00", "temp": 22},
                                {"time": "22:00", "temp": 16},
                            ]
                        }
                    }
                }
            },
        )

        # Mock dt_util.now() to return 10:00 on Monday
        fake_now = datetime(2026, 5, 18, 10, 0, 0)  # Monday
        with patch("custom_components.climate_scheduler.coordinator.dt_util") as mock_dt:
            mock_dt.now.return_value = fake_now
            mock_dt.strftime = lambda dt, fmt: dt.strftime(fmt)

            result = await coord.advance_to_next_node("climate.living_room")

        assert result["success"] is True
        assert result["next_node"]["time"] == "17:00"
        assert result["next_node"]["temp"] == 22
        assert result["applied_temp"] == 22

    @pytest.mark.asyncio
    async def test_advance_wraps_to_first_node_when_none_later(self):
        """At 23:00, advance should wrap to tomorrow's first node."""
        coord, hass, storage = await _make_coordinator(
            entities={
                "climate.bedroom": FakeState(
                    "climate.bedroom", "auto",
                    {"hvac_modes": ["auto", "off"], "current_temperature": 18}
                )
            },
            groups={
                "Bedroom": {
                    "entities": ["climate.bedroom"],
                    "enabled": True,
                    "schedules": {
                        "mon": {
                            "schedule_mode": "all_days",
                            "nodes": [
                                {"time": "06:00", "temp": 18},
                                {"time": "22:00", "temp": 16},
                            ]
                        }
                    }
                }
            },
        )

        fake_now = datetime(2026, 5, 18, 23, 30, 0)  # Monday 23:30
        with patch("custom_components.climate_scheduler.coordinator.dt_util") as mock_dt:
            mock_dt.now.return_value = fake_now
            result = await coord.advance_to_next_node("climate.bedroom")

        assert result["success"] is True
        # Should wrap to first node (06:00)
        assert result["next_node"]["time"] == "06:00"

    @pytest.mark.asyncio
    async def test_advance_clamps_to_max_temp(self):
        """Node temp above MAX_TEMP should be clamped."""
        coord, hass, storage = await _make_coordinator(
            entities={
                "climate.living_room": FakeState(
                    "climate.living_room", "auto",
                    {"hvac_modes": ["auto", "off"], "current_temperature": 20}
                )
            },
            groups={
                "Living Room": {
                    "entities": ["climate.living_room"],
                    "enabled": True,
                    "schedules": {
                        "mon": {
                            "schedule_mode": "all_days",
                            "nodes": [
                                {"time": "06:00", "temp": 18},
                                {"time": "12:00", "temp": 50},  # Way above max
                            ]
                        }
                    }
                }
            },
            settings={"min_temp": 5.0, "max_temp": 30.0},
        )

        fake_now = datetime(2026, 5, 18, 10, 0, 0)
        with patch("custom_components.climate_scheduler.coordinator.dt_util") as mock_dt:
            mock_dt.now.return_value = fake_now
            result = await coord.advance_to_next_node("climate.living_room")

        assert result["success"] is True
        assert result["applied_temp"] == 30.0  # Clamped to max_temp

    @pytest.mark.asyncio
    async def test_advance_clamps_to_min_temp(self):
        """Node temp below MIN_TEMP should be clamped."""
        coord, hass, storage = await _make_coordinator(
            entities={
                "climate.living_room": FakeState(
                    "climate.living_room", "auto",
                    {"hvac_modes": ["auto", "off"], "current_temperature": 20}
                )
            },
            groups={
                "Living Room": {
                    "entities": ["climate.living_room"],
                    "enabled": True,
                    "schedules": {
                        "mon": {
                            "schedule_mode": "all_days",
                            "nodes": [
                                {"time": "12:00", "temp": 21},
                                {"time": "18:00", "temp": 1},  # Below min, next later node
                            ]
                        }
                    }
                }
            },
            settings={"min_temp": 5.0, "max_temp": 30.0},
        )

        fake_now = datetime(2026, 5, 18, 13, 0, 0)  # After 12:00, so next node is 18:00
        with patch("custom_components.climate_scheduler.coordinator.dt_util") as mock_dt:
            mock_dt.now.return_value = fake_now
            result = await coord.advance_to_next_node("climate.living_room")

        assert result["success"] is True
        assert result["applied_temp"] == 5.0  # Clamped to min_temp

    @pytest.mark.asyncio
    async def test_advance_no_change_node_skips_temp(self):
        """Node with noChange=True should skip temperature change."""
        coord, hass, storage = await _make_coordinator(
            entities={
                "climate.living_room": FakeState(
                    "climate.living_room", "auto",
                    {"hvac_modes": ["auto", "off"], "current_temperature": 20}
                )
            },
            groups={
                "Living Room": {
                    "entities": ["climate.living_room"],
                    "enabled": True,
                    "schedules": {
                        "mon": {
                            "schedule_mode": "all_days",
                            "nodes": [
                                {"time": "06:00", "temp": 18},
                                {"time": "12:00", "temp": 21, "noChange": True},
                            ]
                        }
                    }
                }
            },
        )

        fake_now = datetime(2026, 5, 18, 10, 0, 0)
        with patch("custom_components.climate_scheduler.coordinator.dt_util") as mock_dt:
            mock_dt.now.return_value = fake_now
            result = await coord.advance_to_next_node("climate.living_room")

        assert result["success"] is True
        assert result["applied_temp"] is None  # No temp change
        # Should NOT have called set_temperature
        temp_calls = [c for c in hass.services.calls if c["service"] == "set_temperature"]
        assert len(temp_calls) == 0


# ── Override lifecycle tests ──────────────────────────────────────────────

class TestOverrideLifecycle:
    """Test advance override — set, expire, cancel."""

    @pytest.mark.asyncio
    async def test_advance_sets_override_until(self):
        """Advancing should set override_until to the next node's time."""
        coord, hass, storage = await _make_coordinator(
            entities={
                "climate.living_room": FakeState(
                    "climate.living_room", "auto",
                    {"hvac_modes": ["auto", "off"], "current_temperature": 20}
                )
            },
            groups={
                "Living Room": {
                    "entities": ["climate.living_room"],
                    "enabled": True,
                    "schedules": {
                        "mon": {
                            "schedule_mode": "all_days",
                            "nodes": [
                                {"time": "06:00", "temp": 18},
                                {"time": "17:00", "temp": 22},
                            ]
                        }
                    }
                }
            },
        )

        fake_now = datetime(2026, 5, 18, 10, 0, 0)
        with patch("custom_components.climate_scheduler.coordinator.dt_util") as mock_dt:
            mock_dt.now.return_value = fake_now
            await coord.advance_to_next_node("climate.living_room")

        assert "climate.living_room" in coord.override_until
        # Override should be set to next node time (17:00)
        override_time = coord.override_until["climate.living_room"]
        assert override_time.hour == 17
        assert override_time.minute == 0

    @pytest.mark.asyncio
    async def test_advance_records_history(self):
        """Advancing should record event in advance_history."""
        coord, hass, storage = await _make_coordinator(
            entities={
                "climate.living_room": FakeState(
                    "climate.living_room", "auto",
                    {"hvac_modes": ["auto", "off"], "current_temperature": 20}
                )
            },
            groups={
                "Living Room": {
                    "entities": ["climate.living_room"],
                    "enabled": True,
                    "schedules": {
                        "mon": {
                            "schedule_mode": "all_days",
                            "nodes": [
                                {"time": "06:00", "temp": 18},
                                {"time": "17:00", "temp": 22},
                            ]
                        }
                    }
                }
            },
        )

        fake_now = datetime(2026, 5, 18, 10, 0, 0)
        with patch("custom_components.climate_scheduler.coordinator.dt_util") as mock_dt:
            mock_dt.now.return_value = fake_now
            await coord.advance_to_next_node("climate.living_room")

        assert "climate.living_room" in coord.advance_history
        assert len(coord.advance_history["climate.living_room"]) == 1
        event = coord.advance_history["climate.living_room"][0]
        assert event["target_time"] == "17:00"
        assert event["cancelled_at"] is None

    @pytest.mark.asyncio
    async def test_cancel_advance_removes_override(self):
        """Cancelling should remove the override and clear last_node_state."""
        coord, hass, storage = await _make_coordinator(
            entities={
                "climate.living_room": FakeState(
                    "climate.living_room", "auto",
                    {"hvac_modes": ["auto", "off"], "current_temperature": 20}
                )
            },
            groups={
                "Living Room": {
                    "entities": ["climate.living_room"],
                    "enabled": True,
                    "schedules": {
                        "mon": {
                            "schedule_mode": "all_days",
                            "nodes": [
                                {"time": "06:00", "temp": 18},
                                {"time": "17:00", "temp": 22},
                            ]
                        }
                    }
                }
            },
        )

        fake_now = datetime(2026, 5, 18, 10, 0, 0)
        with patch("custom_components.climate_scheduler.coordinator.dt_util") as mock_dt:
            mock_dt.now.return_value = fake_now
            # Advance first
            await coord.advance_to_next_node("climate.living_room")
            assert "climate.living_room" in coord.override_until

            # Now cancel
            result = await coord.cancel_advance("climate.living_room")

        assert result["success"] is True
        assert "climate.living_room" not in coord.override_until
        # History should mark cancellation
        latest = coord.advance_history["climate.living_room"][-1]
        assert latest["cancelled_at"] is not None

    @pytest.mark.asyncio
    async def test_advance_history_tracks_multiple_advances(self):
        """Multiple advances should append to history."""
        coord, hass, storage = await _make_coordinator(
            entities={
                "climate.living_room": FakeState(
                    "climate.living_room", "auto",
                    {"hvac_modes": ["auto", "off"], "current_temperature": 20}
                )
            },
            groups={
                "Living Room": {
                    "entities": ["climate.living_room"],
                    "enabled": True,
                    "schedules": {
                        "mon": {
                            "schedule_mode": "all_days",
                            "nodes": [
                                {"time": "06:00", "temp": 18},
                                {"time": "12:00", "temp": 21},
                                {"time": "17:00", "temp": 22},
                                {"time": "22:00", "temp": 16},
                            ]
                        }
                    }
                }
            },
        )

        fake_now = datetime(2026, 5, 18, 10, 0, 0)
        with patch("custom_components.climate_scheduler.coordinator.dt_util") as mock_dt:
            mock_dt.now.return_value = fake_now
            await coord.advance_to_next_node("climate.living_room")  # → 12:00

            fake_now = datetime(2026, 5, 18, 12, 30, 0)
            mock_dt.now.return_value = fake_now
            await coord.advance_to_next_node("climate.living_room")  # → 17:00

        assert len(coord.advance_history["climate.living_room"]) == 2


# ── Day boundary tests ───────────────────────────────────────────────────

class TestDayBoundaries:
    """Test advance across day boundaries for different schedule modes."""

    @pytest.mark.asyncio
    async def test_advance_all_days_wraps_to_first_node(self):
        """In all_days mode, wrapping picks today's first node."""
        coord, hass, storage = await _make_coordinator(
            entities={
                "climate.bedroom": FakeState(
                    "climate.bedroom", "auto",
                    {"hvac_modes": ["auto", "off"], "current_temperature": 18}
                )
            },
            groups={
                "Bedroom": {
                    "entities": ["climate.bedroom"],
                    "enabled": True,
                    "schedules": {
                        "mon": {
                            "schedule_mode": "all_days",
                            "nodes": [
                                {"time": "06:00", "temp": 18},
                                {"time": "22:00", "temp": 15},
                            ]
                        }
                    }
                }
            },
        )

        fake_now = datetime(2026, 5, 18, 23, 0, 0)
        with patch("custom_components.climate_scheduler.coordinator.dt_util") as mock_dt:
            mock_dt.now.return_value = fake_now
            result = await coord.advance_to_next_node("climate.bedroom")

        assert result["success"] is True
        # Should wrap to next day's first node
        assert result["next_node"]["time"] == "06:00"

    @pytest.mark.asyncio
    async def test_advance_individual_mode_wraps_to_tomorrow_schedule(self):
        """In individual mode, wrapping should check tomorrow's schedule."""
        coord, hass, storage = await _make_coordinator(
            entities={
                "climate.office": FakeState(
                    "climate.office", "auto",
                    {"hvac_modes": ["auto", "off"], "current_temperature": 20}
                )
            },
            groups={
                "Office": {
                    "entities": ["climate.office"],
                    "enabled": True,
                    "schedules": {
                        "mon": {
                            "schedule_mode": "individual",
                            "nodes": [
                                {"time": "09:00", "temp": 21},
                                {"time": "18:00", "temp": 16},
                            ]
                        },
                        "tue": {
                            "schedule_mode": "individual",
                            "nodes": [
                                {"time": "08:00", "temp": 20},
                                {"time": "17:00", "temp": 15},
                            ]
                        }
                    }
                }
            },
        )

        # Monday 23:30 — should wrap to Tuesday's first node
        fake_now = datetime(2026, 5, 18, 23, 30, 0)
        with patch("custom_components.climate_scheduler.coordinator.dt_util") as mock_dt:
            mock_dt.now.return_value = fake_now
            result = await coord.advance_to_next_node("climate.office")

        assert result["success"] is True
        # Should pick Tuesday's first node (08:00)
        assert result["next_node"]["time"] == "08:00"
        assert result["next_node"]["temp"] == 20

    @pytest.mark.asyncio
    async def test_advance_5_2_mode_wraps_to_tomorrow(self):
        """In 5/2 mode, wrapping should respect weekday/weekend schedule."""
        coord, hass, storage = await _make_coordinator(
            entities={
                "climate.office": FakeState(
                    "climate.office", "auto",
                    {"hvac_modes": ["auto", "off"], "current_temperature": 20}
                )
            },
            groups={
                "Office": {
                    "entities": ["climate.office"],
                    "enabled": True,
                    "schedules": {
                        "fri": {
                            "schedule_mode": "5/2",
                            "nodes": [
                                {"time": "09:00", "temp": 21},
                                {"time": "18:00", "temp": 16},
                            ]
                        },
                        "sat": {
                            "schedule_mode": "5/2",
                            "nodes": [
                                {"time": "10:00", "temp": 19},
                                {"time": "16:00", "temp": 15},
                            ]
                        }
                    }
                }
            },
        )

        # Friday 23:30 — should wrap to Saturday's first node
        fake_now = datetime(2026, 5, 22, 23, 30, 0)
        with patch("custom_components.climate_scheduler.coordinator.dt_util") as mock_dt:
            mock_dt.now.return_value = fake_now
            result = await coord.advance_to_next_node("climate.office")

        assert result["success"] is True
        assert result["next_node"]["time"] == "10:00"  # Saturday schedule

    @pytest.mark.asyncio
    async def test_advance_entity_not_in_any_group(self):
        """Entity not in any group should return error."""
        coord, hass, storage = await _make_coordinator(
            entities={
                "climate.orphan": FakeState(
                    "climate.orphan", "auto",
                    {"hvac_modes": ["auto", "off"], "current_temperature": 20}
                )
            },
            groups={},
        )

        fake_now = datetime(2026, 5, 18, 10, 0, 0)
        with patch("custom_components.climate_scheduler.coordinator.dt_util") as mock_dt:
            mock_dt.now.return_value = fake_now
            result = await coord.advance_to_next_node("climate.orphan")

        assert result["success"] is False
        assert "not found" in result["error"].lower() or "disabled" in result["error"].lower()

    @pytest.mark.asyncio
    async def test_advance_disabled_group_returns_error(self):
        """Disabled group should not be advanced."""
        coord, hass, storage = await _make_coordinator(
            entities={
                "climate.off_room": FakeState(
                    "climate.off_room", "auto",
                    {"hvac_modes": ["auto", "off"], "current_temperature": 20}
                )
            },
            groups={
                "Off Room": {
                    "entities": ["climate.off_room"],
                    "enabled": False,
                    "schedules": {
                        "mon": {
                            "schedule_mode": "all_days",
                            "nodes": [{"time": "08:00", "temp": 21}]
                        }
                    }
                }
            },
        )

        fake_now = datetime(2026, 5, 18, 7, 0, 0)
        with patch("custom_components.climate_scheduler.coordinator.dt_util") as mock_dt:
            mock_dt.now.return_value = fake_now
            result = await coord.advance_to_next_node("climate.off_room")

        assert result["success"] is False


# ── HVAC mode application tests ──────────────────────────────────────────

class TestHVACModeApplication:
    """Test that advance correctly applies HVAC modes."""

    @pytest.mark.asyncio
    async def test_advance_turns_off_hvac(self):
        """Node with hvac_mode=off should turn off the entity."""
        coord, hass, storage = await _make_coordinator(
            entities={
                "climate.living_room": FakeState(
                    "climate.living_room", "auto",
                    {"hvac_modes": ["auto", "off"], "current_temperature": 20}
                )
            },
            groups={
                "Living Room": {
                    "entities": ["climate.living_room"],
                    "enabled": True,
                    "schedules": {
                        "mon": {
                            "schedule_mode": "all_days",
                            "nodes": [
                                {"time": "06:00", "temp": 18},
                                {"time": "23:00", "temp": 16, "hvac_mode": "off"},
                            ]
                        }
                    }
                }
            },
        )

        fake_now = datetime(2026, 5, 18, 22, 0, 0)
        with patch("custom_components.climate_scheduler.coordinator.dt_util") as mock_dt:
            mock_dt.now.return_value = fake_now
            result = await coord.advance_to_next_node("climate.living_room")

        assert result["success"] is True
        off_calls = [c for c in hass.services.calls if c["service"] in ("turn_off", "set_hvac_mode")
                     and c["data"].get("hvac_mode") == "off" or c["service"] == "turn_off"]
        assert len(off_calls) >= 1

    @pytest.mark.asyncio
    async def test_advance_entity_not_found_returns_error(self):
        """Entity not in hass.states should return error."""
        coord, hass, storage = await _make_coordinator(
            entities={},  # No entities registered
            groups={
                "Ghost": {
                    "entities": ["climate.ghost"],
                    "enabled": True,
                    "schedules": {
                        "mon": {
                            "schedule_mode": "all_days",
                            "nodes": [{"time": "08:00", "temp": 21}]
                        }
                    }
                }
            },
        )

        fake_now = datetime(2026, 5, 18, 7, 0, 0)
        with patch("custom_components.climate_scheduler.coordinator.dt_util") as mock_dt:
            mock_dt.now.return_value = fake_now
            result = await coord.advance_to_next_node("climate.ghost")

        assert result["success"] is False
        assert "not found" in result["error"].lower()

    @pytest.mark.asyncio
    async def test_advance_fires_node_activated_event(self):
        """Advance should fire a node_activated event."""
        coord, hass, storage = await _make_coordinator(
            entities={
                "climate.living_room": FakeState(
                    "climate.living_room", "auto",
                    {"hvac_modes": ["auto", "off"], "current_temperature": 20}
                )
            },
            groups={
                "Living Room": {
                    "entities": ["climate.living_room"],
                    "enabled": True,
                    "schedules": {
                        "mon": {
                            "schedule_mode": "all_days",
                            "nodes": [
                                {"time": "06:00", "temp": 18},
                                {"time": "17:00", "temp": 22},
                            ]
                        }
                    }
                }
            },
        )

        fake_now = datetime(2026, 5, 18, 10, 0, 0)
        with patch("custom_components.climate_scheduler.coordinator.dt_util") as mock_dt:
            mock_dt.now.return_value = fake_now
            await coord.advance_to_next_node("climate.living_room")

        events = [e for e in hass.bus.events if e["event_type"] == "climate_scheduler_node_activated"]
        assert len(events) == 1
        assert events[0]["data"]["trigger_type"] == "manual_advance"
        assert events[0]["data"]["entity_id"] == "climate.living_room"


# ── Fan/Swing/Preset application tests ────────────────────────────────────

class TestFanSwingPresetApplication:
    """Test that fan/swing/preset are always applied (bug #3 fix verification)."""

    @pytest.mark.asyncio
    async def test_fan_mode_applied_with_temperature(self):
        """Fan mode should be applied even when temperature IS set (was a bug)."""
        coord, hass, storage = await _make_coordinator(
            entities={
                "climate.living_room": FakeState(
                    "climate.living_room", "auto",
                    {"hvac_modes": ["auto"], "fan_modes": ["auto", "low", "high"], "current_temperature": 20}
                )
            },
            groups={
                "Living Room": {
                    "entities": ["climate.living_room"],
                    "enabled": True,
                    "schedules": {
                        "mon": {
                            "schedule_mode": "all_days",
                            "nodes": [
                                {"time": "06:00", "temp": 18},
                                {"time": "12:00", "temp": 22, "fan_mode": "low"},
                            ]
                        }
                    }
                }
            },
        )

        fake_now = datetime(2026, 5, 18, 10, 0, 0)
        with patch("custom_components.climate_scheduler.coordinator.dt_util") as mock_dt:
            mock_dt.now.return_value = fake_now
            result = await coord.advance_to_next_node("climate.living_room")

        assert result["success"] is True
        # Both set_temperature AND set_fan_mode should have been called
        fan_calls = [c for c in hass.services.calls if c["service"] == "set_fan_mode"]
        temp_calls = [c for c in hass.services.calls if c["service"] == "set_temperature"]
        assert len(fan_calls) == 1
        assert len(temp_calls) == 1
        assert fan_calls[0]["data"]["fan_mode"] == "low"

    @pytest.mark.asyncio
    async def test_preset_mode_applied_with_temperature(self):
        """Preset mode should be applied even when temperature IS set (was a bug)."""
        coord, hass, storage = await _make_coordinator(
            entities={
                "climate.living_room": FakeState(
                    "climate.living_room", "auto",
                    {"hvac_modes": ["auto"], "preset_modes": ["comfort", "eco"], "current_temperature": 20}
                )
            },
            groups={
                "Living Room": {
                    "entities": ["climate.living_room"],
                    "enabled": True,
                    "schedules": {
                        "mon": {
                            "schedule_mode": "all_days",
                            "nodes": [
                                {"time": "06:00", "temp": 18},
                                {"time": "12:00", "temp": 21, "preset_mode": "eco"},
                            ]
                        }
                    }
                }
            },
        )

        fake_now = datetime(2026, 5, 18, 10, 0, 0)
        with patch("custom_components.climate_scheduler.coordinator.dt_util") as mock_dt:
            mock_dt.now.return_value = fake_now
            result = await coord.advance_to_next_node("climate.living_room")

        assert result["success"] is True
        preset_calls = [c for c in hass.services.calls if c["service"] == "set_preset_mode"]
        assert len(preset_calls) == 1
        assert preset_calls[0]["data"]["preset_mode"] == "eco"

    @pytest.mark.asyncio
    async def test_swing_mode_applied_with_temperature(self):
        """Swing mode should be applied even when temperature IS set (was a bug)."""
        coord, hass, storage = await _make_coordinator(
            entities={
                "climate.living_room": FakeState(
                    "climate.living_room", "auto",
                    {"hvac_modes": ["auto"], "swing_modes": ["auto", "on", "off"], "current_temperature": 20}
                )
            },
            groups={
                "Living Room": {
                    "entities": ["climate.living_room"],
                    "enabled": True,
                    "schedules": {
                        "mon": {
                            "schedule_mode": "all_days",
                            "nodes": [
                                {"time": "06:00", "temp": 18},
                                {"time": "12:00", "temp": 22, "swing_mode": "on"},
                            ]
                        }
                    }
                }
            },
        )

        fake_now = datetime(2026, 5, 18, 10, 0, 0)
        with patch("custom_components.climate_scheduler.coordinator.dt_util") as mock_dt:
            mock_dt.now.return_value = fake_now
            result = await coord.advance_to_next_node("climate.living_room")

        assert result["success"] is True
        swing_calls = [c for c in hass.services.calls if c["service"] == "set_swing_mode"]
        assert len(swing_calls) == 1
        assert swing_calls[0]["data"]["swing_mode"] == "on"

    @pytest.mark.asyncio
    async def test_unsupported_fan_mode_skipped(self):
        """Fan mode not in entity's fan_modes should be silently skipped."""
        coord, hass, storage = await _make_coordinator(
            entities={
                "climate.simple": FakeState(
                    "climate.simple", "auto",
                    {"hvac_modes": ["auto"], "fan_modes": ["auto"], "current_temperature": 20}
                )
            },
            groups={
                "Simple Room": {
                    "entities": ["climate.simple"],
                    "enabled": True,
                    "schedules": {
                        "mon": {
                            "schedule_mode": "all_days",
                            "nodes": [
                                {"time": "06:00", "temp": 18},
                                {"time": "12:00", "temp": 22, "fan_mode": "turbo"},
                            ]
                        }
                    }
                }
            },
        )

        fake_now = datetime(2026, 5, 18, 10, 0, 0)
        with patch("custom_components.climate_scheduler.coordinator.dt_util") as mock_dt:
            mock_dt.now.return_value = fake_now
            result = await coord.advance_to_next_node("climate.simple")

        assert result["success"] is True
        fan_calls = [c for c in hass.services.calls if c["service"] == "set_fan_mode"]
        assert len(fan_calls) == 0  # "turbo" not in ["auto"]


# ── Schedule lookup edge cases ───────────────────────────────────────────

class TestScheduleLookupEdgeCases:
    """Test edge cases in schedule lookup during advance."""

    @pytest.mark.asyncio
    async def test_advance_empty_nodes_returns_error(self):
        """Schedule with empty nodes list should return error."""
        coord, hass, storage = await _make_coordinator(
            entities={
                "climate.empty": FakeState(
                    "climate.empty", "auto",
                    {"hvac_modes": ["auto", "off"], "current_temperature": 20}
                )
            },
            groups={
                "Empty Room": {
                    "entities": ["climate.empty"],
                    "enabled": True,
                    "schedules": {
                        "mon": {
                            "schedule_mode": "all_days",
                            "nodes": []
                        }
                    }
                }
            },
        )

        fake_now = datetime(2026, 5, 18, 10, 0, 0)
        with patch("custom_components.climate_scheduler.coordinator.dt_util") as mock_dt:
            mock_dt.now.return_value = fake_now
            result = await coord.advance_to_next_node("climate.empty")

        assert result["success"] is False
        assert "no nodes" in result["error"].lower()

    @pytest.mark.asyncio
    async def test_advance_no_schedule_for_today(self):
        """Entity in group with no schedule for today's day should return error."""
        coord, hass, storage = await _make_coordinator(
            entities={
                "climate.living_room": FakeState(
                    "climate.living_room", "auto",
                    {"hvac_modes": ["auto", "off"], "current_temperature": 20}
                )
            },
            groups={
                "Living Room": {
                    "entities": ["climate.living_room"],
                    "enabled": True,
                    "schedules": {
                        # Only a weekday schedule, no Sunday
                        "mon": {
                            "schedule_mode": "all_days",
                            "nodes": [{"time": "08:00", "temp": 21}]
                        }
                    }
                }
            },
        )

        # Sunday
        fake_now = datetime(2026, 5, 24, 10, 0, 0)
        with patch("custom_components.climate_scheduler.coordinator.dt_util") as mock_dt:
            mock_dt.now.return_value = fake_now
            result = await coord.advance_to_next_node("climate.living_room")

        assert result["success"] is False

    @pytest.mark.asyncio
    async def test_advance_preset_only_entity_skips_temp(self):
        """Entity with no current_temperature should skip temp change."""
        coord, hass, storage = await _make_coordinator(
            entities={
                "climate.preset_only": FakeState(
                    "climate.preset_only", "auto",
                    {"hvac_modes": ["auto"], "preset_modes": ["comfort", "eco"], "current_temperature": None}
                )
            },
            groups={
                "Preset Room": {
                    "entities": ["climate.preset_only"],
                    "enabled": True,
                    "schedules": {
                        "mon": {
                            "schedule_mode": "all_days",
                            "nodes": [
                                {"time": "06:00", "temp": 18, "preset_mode": "comfort"},
                                {"time": "12:00", "temp": 21, "preset_mode": "eco"},
                            ]
                        }
                    }
                }
            },
        )

        fake_now = datetime(2026, 5, 18, 10, 0, 0)
        with patch("custom_components.climate_scheduler.coordinator.dt_util") as mock_dt:
            mock_dt.now.return_value = fake_now
            result = await coord.advance_to_next_node("climate.preset_only")

        assert result["success"] is True
        # Should apply preset mode
        preset_calls = [c for c in hass.services.calls if c["service"] == "set_preset_mode"]
        assert len(preset_calls) == 1
        assert preset_calls[0]["data"]["preset_mode"] == "eco"
        # Should NOT set temperature
        temp_calls = [c for c in hass.services.calls if c["service"] == "set_temperature"]
        assert len(temp_calls) == 0