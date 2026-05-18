"""Tests for storage.validate_node – pure function, no HA dependency.

This is the most isolated function in the codebase and the best place
to start building confidence before moving to coordinator logic.
"""
import pytest
from custom_components.climate_scheduler.storage import validate_node


# ── Valid nodes ──────────────────────────────────────────────────────────

class TestValidateNodeValid:
    """validate_node should accept well-formed nodes."""

    def test_basic_valid_node(self):
        assert validate_node({"time": "07:00", "temp": 21}) is True

    def test_midnight(self):
        assert validate_node({"time": "00:00", "temp": 18}) is True

    def test_end_of_day(self):
        assert validate_node({"time": "23:59", "temp": 15}) is True

    def test_float_temperature(self):
        assert validate_node({"time": "14:30", "temp": 21.5}) is True

    def test_zero_temperature(self):
        assert validate_node({"time": "08:00", "temp": 0}) is True

    def test_negative_temperature(self):
        # Negative temps are valid — some systems go below zero
        assert validate_node({"time": "08:00", "temp": -5}) is True

    def test_string_temperature(self):
        # String numerics should be accepted (parseFloat in original)
        assert validate_node({"time": "08:00", "temp": "21.5"}) is True

    def test_node_with_extra_fields(self):
        # Extra fields (hvac_mode, fan_mode, etc.) should not break validation
        assert validate_node({
            "time": "09:00",
            "temp": 22,
            "hvac_mode": "heat",
            "fan_mode": "auto",
        }) is True


# ── Invalid nodes – missing fields ────────────────────────────────────────

class TestValidateNodeMissingFields:
    """validate_node should reject nodes missing required fields."""

    def test_missing_time(self):
        assert validate_node({"temp": 21}) is False

    def test_missing_temp(self):
        assert validate_node({"time": "07:00"}) is False

    def test_empty_dict(self):
        assert validate_node({}) is False

    def test_not_a_dict(self):
        assert validate_node("not a dict") is False

    def test_not_a_dict_list(self):
        assert validate_node([{"time": "07:00", "temp": 21}]) is False

    def test_none(self):
        assert validate_node(None) is False


# ── Invalid time formats ─────────────────────────────────────────────────

class TestValidateNodeInvalidTime:
    """validate_node should reject nodes with invalid time strings."""

    def test_time_no_colon(self):
        assert validate_node({"time": "0700", "temp": 21}) is False

    def test_time_wrong_format(self):
        assert validate_node({"time": "7:00", "temp": 21}) is False

    def test_time_hours_out_of_range(self):
        assert validate_node({"time": "25:00", "temp": 21}) is False

    def test_time_minutes_out_of_range(self):
        assert validate_node({"time": "07:60", "temp": 21}) is False

    def test_time_non_numeric(self):
        assert validate_node({"time": "ab:cd", "temp": 21}) is False

    def test_time_empty_string(self):
        assert validate_node({"time": "", "temp": 21}) is False

    def test_time_wrong_type_int(self):
        assert validate_node({"time": 700, "temp": 21}) is False


# ── Invalid temperature values ────────────────────────────────────────────

class TestValidateNodeInvalidTemp:
    """validate_node should reject nodes with invalid temperatures."""

    def test_temp_string_non_numeric(self):
        assert validate_node({"time": "07:00", "temp": "hot"}) is False

    def test_temp_none(self):
        assert validate_node({"time": "07:00", "temp": None}) is False

    def test_temp_list(self):
        assert validate_node({"time": "07:00", "temp": [21]}) is False