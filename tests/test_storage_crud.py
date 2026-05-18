"""Tests for ScheduleStorage CRUD operations – schedules, groups, settings.

Uses lightweight mocking via conftest FakeStore instead of full HA.
"""
import pytest
from custom_components.climate_scheduler.const import DOMAIN, MIN_TEMP, MAX_TEMP
from unittest.mock import MagicMock


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _mock_state(friendly_name=None):
    """Return a mock HA state object with a friendly_name attribute."""
    state = MagicMock()
    state.attributes.get = lambda key, default=None: friendly_name if key == "friendly_name" else default
    return state


# ---------------------------------------------------------------------------
# Schedule CRUD
# ---------------------------------------------------------------------------

class TestScheduleCRUD:
    """Set, get, enable/disable schedules via storage API."""

    @pytest.mark.asyncio
    async def test_add_entity_creates_single_entity_group(self, storage):
        """Adding an entity creates a single-entity group keyed by friendly_name."""
        # Mock hass.states.get to return a friendly name
        storage.hass.states.get = lambda eid: _mock_state("Living Room")
        await storage.async_add_entity("climate.living_room")
        # Should be keyed by friendly name, not entity ID
        assert "Living Room" in storage._data["groups"]
        group = storage._data["groups"]["Living Room"]
        assert group["_is_single_entity_group"] is True
        assert "climate.living_room" in group["entities"]

    @pytest.mark.asyncio
    async def test_add_entity_without_friendly_name_uses_entity_id(self, storage):
        """If HA state is missing, fallback to entity_id as group name."""
        storage.hass.states.get = lambda eid: None
        await storage.async_add_entity("climate.living_room")
        assert "climate.living_room" in storage._data["groups"]

    @pytest.mark.asyncio
    async def test_set_and_get_schedule_all_days(self, storage):
        """Set a schedule, then retrieve it. async_get_schedule returns full structure."""
        storage.hass.states.get = lambda eid: _mock_state("Living Room")
        await storage.async_add_entity("climate.living_room")
        nodes = [{"time": "07:00", "temp": 21}, {"time": "23:00", "temp": 16}]
        await storage.async_set_schedule("climate.living_room", nodes)

        result = await storage.async_get_schedule("climate.living_room")
        assert result is not None
        # async_get_schedule without day returns the full group structure
        all_days = result.get("schedules", {}).get("all_days", [])
        assert len(all_days) == 2
        assert all_days[0]["time"] == "07:00"

    @pytest.mark.asyncio
    async def test_set_schedule_for_specific_day(self, storage):
        """Set schedule for a specific day (individual mode)."""
        storage.hass.states.get = lambda eid: _mock_state("Bedroom")
        await storage.async_add_entity("climate.bedroom")
        nodes = [{"time": "06:00", "temp": 19}]
        await storage.async_set_schedule(
            "climate.bedroom", nodes, day="mon", schedule_mode="individual"
        )
        result = await storage.async_get_schedule("climate.bedroom", day="mon")
        assert result is not None
        assert result["nodes"] == nodes

    @pytest.mark.asyncio
    async def test_set_ignored(self, storage):
        """Setting ignored flag should persist."""
        storage.hass.states.get = lambda eid: _mock_state("Hallway")
        await storage.async_add_entity("climate.hallway")
        await storage.async_set_ignored("climate.hallway", True)
        assert await storage.async_is_ignored("climate.hallway") is True

        await storage.async_set_ignored("climate.hallway", False)
        assert await storage.async_is_ignored("climate.hallway") is False

    @pytest.mark.asyncio
    async def test_enable_disable_schedule(self, storage):
        """Enable/disable should toggle the enabled flag."""
        storage.hass.states.get = lambda eid: _mock_state("Living Room")
        await storage.async_add_entity("climate.living_room")
        await storage.async_enable_schedule("climate.living_room")
        assert await storage.async_is_enabled("climate.living_room") is True

        await storage.async_disable_schedule("climate.living_room")
        assert await storage.async_is_enabled("climate.living_room") is False

    @pytest.mark.asyncio
    async def test_remove_entity(self, storage):
        """Removing an entity should delete its group data."""
        storage.hass.states.get = lambda eid: _mock_state("Living Room")
        await storage.async_add_entity("climate.living_room")
        await storage.async_remove_entity("climate.living_room")
        result = await storage.async_get_schedule("climate.living_room")
        assert result is None

    @pytest.mark.asyncio
    async def test_get_nonexistent_schedule(self, storage):
        """Getting a schedule for a non-existent entity returns None."""
        result = await storage.async_get_schedule("climate.ghost")
        assert result is None

    @pytest.mark.asyncio
    async def test_clear_schedule_sets_empty(self, storage):
        """clear_schedule service sets nodes to empty list.

        NOTE: async_clear_schedule is called in services.py but NOT defined 
        in storage.py — this is a bug in the codebase. The service handler
        will fail at runtime. We test the expected behavior (setting nodes
        to empty) via async_set_schedule with empty nodes instead.
        """
        storage.hass.states.get = lambda eid: _mock_state("Living Room")
        await storage.async_add_entity("climate.living_room")
        nodes = [{"time": "07:00", "temp": 21}]
        await storage.async_set_schedule("climate.living_room", nodes)
        # Clear by setting empty schedule
        await storage.async_set_schedule("climate.living_room", [])
        result = await storage.async_get_schedule("climate.living_room")
        all_days = result.get("schedules", {}).get("all_days", [])
        assert all_days == []


# ---------------------------------------------------------------------------
# Group management
# ---------------------------------------------------------------------------

class TestGroupManagement:
    """Create, delete, rename groups; add/remove entities."""

    @pytest.mark.asyncio
    async def test_create_group(self, storage):
        """Creating a group should set up default structure."""
        await storage.async_create_group("Downstairs")
        group = await storage.async_get_group("Downstairs")
        assert group is not None
        assert group["entities"] == []
        assert group["enabled"] is True
        assert group["active_profile"] == "Default"

    @pytest.mark.asyncio
    async def test_create_duplicate_group_raises(self, storage):
        """Creating a group that already exists should raise ValueError."""
        await storage.async_create_group("Upstairs")
        with pytest.raises(ValueError, match="already exists"):
            await storage.async_create_group("Upstairs")

    @pytest.mark.asyncio
    async def test_delete_group(self, storage):
        """Deleting a group should remove it from storage."""
        await storage.async_create_group("Basement")
        await storage.async_delete_group("Basement")
        group = await storage.async_get_group("Basement")
        assert group is None

    @pytest.mark.asyncio
    async def test_delete_nonexistent_group_no_error(self, storage):
        """Deleting a non-existent group should not raise."""
        await storage.async_delete_group("Ghost")  # Should not raise

    @pytest.mark.asyncio
    async def test_rename_group(self, storage):
        """Renaming should move data to new key."""
        await storage.async_create_group("Loft")
        await storage.async_rename_group("Loft", "Attic")
        assert await storage.async_get_group("Loft") is None
        assert await storage.async_get_group("Attic") is not None

    @pytest.mark.asyncio
    async def test_rename_to_existing_raises(self, storage):
        """Renaming to an existing group name should raise."""
        await storage.async_create_group("A")
        await storage.async_create_group("B")
        with pytest.raises(ValueError, match="already exists"):
            await storage.async_rename_group("A", "B")

    @pytest.mark.asyncio
    async def test_rename_nonexistent_raises(self, storage):
        with pytest.raises(ValueError, match="does not exist"):
            await storage.async_rename_group("Ghost", "Phantom")

    @pytest.mark.asyncio
    async def test_add_entity_to_group(self, storage):
        await storage.async_create_group("Downstairs")
        await storage.async_add_entity_to_group("Downstairs", "climate.living_room")
        group = await storage.async_get_group("Downstairs")
        assert "climate.living_room" in group["entities"]

    @pytest.mark.asyncio
    async def test_add_duplicate_entity_ignored(self, storage):
        """Adding an entity that's already in the group should not duplicate."""
        await storage.async_create_group("Downstairs")
        await storage.async_add_entity_to_group("Downstairs", "climate.living_room")
        await storage.async_add_entity_to_group("Downstairs", "climate.living_room")
        group = await storage.async_get_group("Downstairs")
        assert group["entities"].count("climate.living_room") == 1

    @pytest.mark.asyncio
    async def test_remove_entity_from_group(self, storage):
        await storage.async_create_group("Downstairs")
        await storage.async_add_entity_to_group("Downstairs", "climate.living_room")
        await storage.async_remove_entity_from_group("Downstairs", "climate.living_room")
        group = await storage.async_get_group("Downstairs")
        assert "climate.living_room" not in group["entities"]

    @pytest.mark.asyncio
    async def test_get_groups(self, storage):
        await storage.async_create_group("A")
        await storage.async_create_group("B")
        groups = await storage.async_get_groups()
        assert "A" in groups
        assert "B" in groups

    @pytest.mark.asyncio
    async def test_get_entity_group(self, storage):
        await storage.async_create_group("Downstairs")
        await storage.async_add_entity_to_group("Downstairs", "climate.living_room")
        result = await storage.async_get_entity_group("climate.living_room")
        assert result == "Downstairs"

    @pytest.mark.asyncio
    async def test_get_entity_group_not_found(self, storage):
        result = await storage.async_get_entity_group("climate.ghost")
        assert result is None

    @pytest.mark.asyncio
    async def test_enable_disable_group(self, storage):
        await storage.async_create_group("Downstairs")
        await storage.async_enable_group("Downstairs")
        group = await storage.async_get_group("Downstairs")
        assert group["enabled"] is True

        await storage.async_disable_group("Downstairs")
        group = await storage.async_get_group("Downstairs")
        assert group["enabled"] is False

    @pytest.mark.asyncio
    async def test_set_group_schedule(self, storage):
        """Set schedule on a group and verify it propagates."""
        await storage.async_create_group("Downstairs")
        await storage.async_add_entity_to_group("Downstairs", "climate.living_room")
        nodes = [{"time": "06:00", "temp": 18}, {"time": "22:00", "temp": 16}]
        await storage.async_set_group_schedule("Downstairs", nodes)
        schedule = await storage.async_get_group_schedule("Downstairs")
        assert schedule is not None
        assert len(schedule["nodes"]) == 2

    @pytest.mark.asyncio
    async def test_set_group_schedule_individual_day(self, storage):
        """Set schedule for a specific day on a group."""
        await storage.async_create_group("Downstairs")
        nodes = [{"time": "07:00", "temp": 21}]
        await storage.async_set_group_schedule(
            "Downstairs", nodes, day="mon", schedule_mode="individual"
        )
        schedule = await storage.async_get_group_schedule("Downstairs", day="mon")
        assert schedule is not None
        assert schedule["nodes"] == nodes


# ---------------------------------------------------------------------------
# Profile management
# ---------------------------------------------------------------------------

class TestProfileManagement:
    """Create, delete, rename, set active profiles."""

    @pytest.mark.asyncio
    async def test_create_profile(self, storage):
        await storage.async_create_group("Downstairs")
        await storage.async_create_profile("Downstairs", "Eco")
        group = await storage.async_get_group("Downstairs")
        assert "Eco" in group["profiles"]

    @pytest.mark.asyncio
    async def test_delete_profile(self, storage):
        await storage.async_create_group("Downstairs")
        await storage.async_create_profile("Downstairs", "Eco")
        await storage.async_delete_profile("Downstairs", "Eco")
        group = await storage.async_get_group("Downstairs")
        assert "Eco" not in group["profiles"]

    @pytest.mark.asyncio
    async def test_rename_profile(self, storage):
        await storage.async_create_group("Downstairs")
        await storage.async_create_profile("Downstairs", "Eco")
        await storage.async_rename_profile("Downstairs", "Eco", "Green")
        group = await storage.async_get_group("Downstairs")
        assert "Green" in group["profiles"]
        assert "Eco" not in group["profiles"]

    @pytest.mark.asyncio
    async def test_set_active_profile(self, storage):
        await storage.async_create_group("Downstairs")
        await storage.async_create_profile("Downstairs", "Comfort")
        await storage.async_set_active_profile("Downstairs", "Comfort")
        group = await storage.async_get_group("Downstairs")
        assert group["active_profile"] == "Comfort"

    @pytest.mark.asyncio
    async def test_cannot_delete_active_profile(self, storage):
        """Deleting the active profile should raise an error or be handled."""
        await storage.async_create_group("Downstairs")
        # Default profile is active
        with pytest.raises(ValueError):
            await storage.async_delete_profile("Downstairs", "Default")

    @pytest.mark.asyncio
    async def test_create_profile_on_single_entity_group(self, storage):
        """Profiles should also work on single-entity groups (not just named groups)."""
        storage.hass.states.get = lambda eid: _mock_state("Bedroom")
        await storage.async_add_entity("climate.bedroom")
        await storage.async_create_profile("Bedroom", "Night")
        group = await storage.async_get_group("Bedroom")
        assert "Night" in group["profiles"]


# ---------------------------------------------------------------------------
# Settings
# ---------------------------------------------------------------------------

class TestSettings:
    """Get and save settings."""

    @pytest.mark.asyncio
    async def test_get_default_settings(self, storage):
        settings = await storage.async_get_settings()
        assert isinstance(settings, dict)

    @pytest.mark.asyncio
    async def test_save_and_retrieve_settings(self, storage):
        await storage.async_save_settings({"workday_integration": True, "workdays": ["mon", "tue"]})
        settings = await storage.async_get_settings()
        assert settings["workday_integration"] is True
        assert "mon" in settings["workdays"]


# ---------------------------------------------------------------------------
# Advance history
# ---------------------------------------------------------------------------

class TestAdvanceHistory:
    """Save and retrieve advance override history."""

    @pytest.mark.asyncio
    async def test_save_and_get_history(self, storage):
        history = {
            "climate.living_room": [
                {"activated_at": "2026-01-01T08:00:00", "target_time": "17:00", "cancelled_at": None}
            ]
        }
        await storage.async_save_advance_history(history)
        result = await storage.async_get_advance_history()
        assert "climate.living_room" in result

    @pytest.mark.asyncio
    async def test_empty_history_on_fresh_storage(self, storage):
        result = await storage.async_get_advance_history()
        assert isinstance(result, dict)


# ---------------------------------------------------------------------------
# Factory reset
# ---------------------------------------------------------------------------

class TestFactoryReset:
    """Factory reset should clear all data."""

    @pytest.mark.asyncio
    async def test_factory_reset_clears_data(self, storage):
        await storage.async_create_group("A")
        await storage.async_create_group("B")
        await storage.async_factory_reset()
        groups = await storage.async_get_groups()
        assert len(groups) == 0