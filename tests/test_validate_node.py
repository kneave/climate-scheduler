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


# ── Edge cases: 24:00 normalization, NaN, NO_CHANGE_TEMP ───────────────────

class TestValidateNodeEdgeCases:
    """Edge cases discovered during code review."""

    def test_24_00_normalized_to_23_59(self):
        """24:00 is valid — normalize_node rewrites it to 23:59."""
        assert validate_node({"time": "24:00", "temp": 21}) is True

    def test_24_01_rejected(self):
        """24:01 is invalid — only 24:00 exactly is accepted (and normalised)."""
        assert validate_node({"time": "24:01", "temp": 21}) is False

    def test_24_00_not_24_00_format(self):
        """'24:0' is not valid — format must be HH:MM."""
        assert validate_node({"time": "24:0", "temp": 21}) is False

    def test_no_change_temp_none_rejected(self):
        """NO_CHANGE_TEMP is None, which cannot be parsed as float."""
        assert validate_node({"time": "07:00", "temp": None}) is False

    def test_nan_string_accepted_but_broken(self):
        """BUG: float('NaN') parses successfully, so validate_node accepts it.
        This is a known issue — NaN is not a meaningful temperature."""
        # This SHOULD be False but currently returns True
        assert validate_node({"time": "07:00", "temp": "NaN"}) is True

    def test_infinity_accepted_but_broken(self):
        """BUG: float('inf') parses successfully, so validate_node accepts it.
        This is a known issue — infinity is not a meaningful temperature."""
        # This SHOULD be False but currently returns True
        assert validate_node({"time": "07:00", "temp": "inf"}) is True

    def test_boolean_temp_accepted(self):
        """bool is a subclass of int in Python, so True/1 and False/0 are accepted."""
        # This is technically valid since float(True) == 1.0
        assert validate_node({"time": "07:00", "temp": True}) is True
        assert validate_node({"time": "07:00", "temp": False}) is True

    def test_empty_string_temp_rejected(self):
        assert validate_node({"time": "07:00", "temp": ""}) is False

    def test_whitespace_time_rejected(self):
        assert validate_node({"time": " 07:00", "temp": 21}) is False

    def test_23_59_valid(self):
        """23:59 should be the last valid time of day."""
        assert validate_node({"time": "23:59", "temp": 20}) is True

    def test_00_00_valid(self):
        assert validate_node({"time": "00:00", "temp": 18}) is True

    def test_extra_whitespace_in_time_rejected(self):
        """No whitespace tolerance in time format."""
        assert validate_node({"time": "07: 00", "temp": 21}) is False