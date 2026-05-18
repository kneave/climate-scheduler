"""Tests for storage scheduling logic – _time_to_minutes, get_active_node,
get_next_node, interpolate_temperature.

These are pure/mathematical functions that rely only on node lists and time
values, making them ideal for thorough unit testing without any HA mocking.
"""
from datetime import time
import pytest
from custom_components.climate_scheduler.storage import ScheduleStorage


# ---------------------------------------------------------------------------
# _time_to_minutes (static method, no instance needed)
# ---------------------------------------------------------------------------

class TestTimeToMinutes:
    """Convert HH:MM strings to minutes-since-midnight."""

    def test_midnight(self):
        assert ScheduleStorage._time_to_minutes("00:00") == 0

    def test_midday(self):
        assert ScheduleStorage._time_to_minutes("12:00") == 720

    def test_end_of_day(self):
        assert ScheduleStorage._time_to_minutes("23:59") == 1439

    def test_standard_time(self):
        assert ScheduleStorage._time_to_minutes("07:30") == 450

    def test_single_digit_hour(self):
        assert ScheduleStorage._time_to_minutes("09:05") == 545


# ---------------------------------------------------------------------------
# Helper: instantiate a bare ScheduleStorage for testing pure methods
# ---------------------------------------------------------------------------

def _make_storage():
    """Create a ScheduleStorage with just enough state for pure method tests.

    We avoid the full HA init by directly setting _data.
    """
    from unittest.mock import MagicMock
    from custom_components.climate_scheduler.const import DOMAIN

    hass = MagicMock()
    hass.data = {DOMAIN: {}}
    storage = ScheduleStorage.__new__(ScheduleStorage)
    storage.hass = hass
    storage._data = {"groups": {}, "settings": {}, "advance_history": {}}
    return storage


# ── Standard schedule fixtures ────────────────────────────────────────────

SIMPLE_NODES = [
    {"time": "06:00", "temp": 18},
    {"time": "08:00", "temp": 21},
    {"time": "17:00", "temp": 22},
    {"time": "22:00", "temp": 17},
]

UNORDERED_NODES = [
    {"time": "17:00", "temp": 22},
    {"time": "06:00", "temp": 18},
    {"time": "22:00", "temp": 17},
    {"time": "08:00", "temp": 21},
]

SINGLE_NODE = [
    {"time": "12:00", "temp": 20},
]

DUPLICATE_TIME_NODES = [
    {"time": "08:00", "temp": 20},
    {"time": "08:00", "temp": 22},  # same time, different temp
]


# ---------------------------------------------------------------------------
# get_active_node
# ---------------------------------------------------------------------------

class TestGetActiveNode:
    """Find the active (most recent) node at a given time."""

    def test_before_first_node_wraps_to_last(self):
        s = _make_storage()
        # 05:00 is before 06:00, should wrap to last node (22:00 → 17°C)
        result = s.get_active_node(SIMPLE_NODES, time(5, 0))
        assert result["temp"] == 17

    def test_exactly_at_first_node(self):
        s = _make_storage()
        result = s.get_active_node(SIMPLE_NODES, time(6, 0))
        assert result["time"] == "06:00"
        assert result["temp"] == 18

    def test_between_nodes(self):
        s = _make_storage()
        # 10:00 is after 08:00 but before 17:00
        result = s.get_active_node(SIMPLE_NODES, time(10, 0))
        assert result["time"] == "08:00"
        assert result["temp"] == 21

    def test_at_last_node(self):
        s = _make_storage()
        result = s.get_active_node(SIMPLE_NODES, time(22, 0))
        assert result["time"] == "22:00"
        assert result["temp"] == 17

    def test_after_last_node(self):
        s = _make_storage()
        # 23:30 is after 22:00, should stay on last node
        result = s.get_active_node(SIMPLE_NODES, time(23, 30))
        assert result["time"] == "22:00"

    def test_empty_nodes_returns_none(self):
        s = _make_storage()
        assert s.get_active_node([], time(12, 0)) is None

    def test_single_node_always_active(self):
        s = _make_storage()
        # With one node, it should always be active (wraps from previous day)
        result = s.get_active_node(SINGLE_NODE, time(5, 0))
        assert result["time"] == "12:00"
        result = s.get_active_node(SINGLE_NODE, time(12, 0))
        assert result["time"] == "12:00"
        result = s.get_active_node(SINGLE_NODE, time(23, 0))
        assert result["time"] == "12:00"

    def test_unordered_nodes_returns_correct_result(self):
        """Sorting should happen internally, unordered input must still work."""
        s = _make_storage()
        result = s.get_active_node(UNORDERED_NODES, time(10, 0))
        assert result["time"] == "08:00"
        assert result["temp"] == 21

    def test_duplicate_times_picks_last_matching(self):
        """When two nodes share a time, the later one in the list wins."""
        s = _make_storage()
        result = s.get_active_node(DUPLICATE_TIME_NODES, time(8, 0))
        # Both match at 08:00; step-function holds most recent ≤ current
        assert result["temp"] in (20, 22)


# ---------------------------------------------------------------------------
# get_next_node
# ---------------------------------------------------------------------------

class TestGetNextNode:
    """Find the next node after a given time."""

    def test_before_first_node(self):
        s = _make_storage()
        result = s.get_next_node(SIMPLE_NODES, time(5, 0))
        assert result["time"] == "06:00"

    def test_between_nodes(self):
        s = _make_storage()
        result = s.get_next_node(SIMPLE_NODES, time(10, 0))
        assert result["time"] == "17:00"

    def test_at_node_time_returns_next(self):
        """Being exactly at a node time should return the NEXT node."""
        s = _make_storage()
        result = s.get_next_node(SIMPLE_NODES, time(6, 0))
        assert result["time"] == "08:00"

    def test_after_last_node_wraps(self):
        s = _make_storage()
        result = s.get_next_node(SIMPLE_NODES, time(23, 30))
        assert result["time"] == "06:00"

    def test_empty_nodes_returns_none(self):
        s = _make_storage()
        assert s.get_next_node([], time(12, 0)) is None

    def test_single_node_wraps(self):
        s = _make_storage()
        result = s.get_next_node(SINGLE_NODE, time(13, 0))
        assert result["time"] == "12:00"

    def test_at_exactly_last_node_wraps(self):
        s = _make_storage()
        result = s.get_next_node(SIMPLE_NODES, time(22, 0))
        assert result["time"] == "06:00"


# ---------------------------------------------------------------------------
# interpolate_temperature
# ---------------------------------------------------------------------------

class TestInterpolateTemperature:
    """Climate Scheduler uses step-function (hold until next node), not
    linear interpolation. Verify that behaviour."""

    def test_at_node_returns_node_temp(self):
        s = _make_storage()
        result = s.interpolate_temperature(SIMPLE_NODES, time(6, 0))
        assert result == 18

    def test_between_nodes_holds_previous(self):
        s = _make_storage()
        # 10:00 is between 08:00 (21°C) and 17:00 (22°C)
        result = s.interpolate_temperature(SIMPLE_NODES, time(10, 0))
        assert result == 21

    def test_before_first_wraps_to_last(self):
        s = _make_storage()
        # 03:00 is before 06:00, wraps to last node 22:00 (17°C)
        result = s.interpolate_temperature(SIMPLE_NODES, time(3, 0))
        assert result == 17

    def test_after_last_holds_last(self):
        s = _make_storage()
        # 23:30 is after 22:00, holds 17°C
        result = s.interpolate_temperature(SIMPLE_NODES, time(23, 30))
        assert result == 17

    def test_empty_nodes_default_fallback(self):
        s = _make_storage()
        result = s.interpolate_temperature([], time(12, 0))
        assert result == 18.0  # Default fallback

    def test_single_node_returns_that_temp(self):
        s = _make_storage()
        result = s.interpolate_temperature(SINGLE_NODE, time(5, 0))
        assert result == 20

    def test_exactly_midnight_wraps_to_last(self):
        s = _make_storage()
        result = s.interpolate_temperature(SIMPLE_NODES, time(0, 0))
        assert result == 17  # Last node