"""Unit tests for the fail-closed set_temperature guard.

Loaded by file path so the climate_scheduler package (which imports
Home Assistant) does not have to be installed.
"""
import importlib.util
from pathlib import Path

import pytest

_MODULE_PATH = (
    Path(__file__).resolve().parents[1]
    / "custom_components"
    / "climate_scheduler"
    / "mode_guard.py"
)
_spec = importlib.util.spec_from_file_location("mode_guard", _MODULE_PATH)
mode_guard = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(mode_guard)

decide_set_temperature = mode_guard.decide_set_temperature
is_single_temp_node = mode_guard.is_single_temp_node
resolve_apply_modes = mode_guard.resolve_apply_modes
should_record_applied_node = mode_guard.should_record_applied_node

ENTITY = "climate.main_level"
SINGLE_TEMP = {"time": "06:00", "temp": 68}


def decision(state, node=None, apply_modes=None, entity_id=ENTITY):
    if node is None:
        node = dict(SINGLE_TEMP)
    return decide_set_temperature(entity_id, state, node, apply_modes)


def test_default_apply_modes_is_heat_for_single_temp_node_without_hvac_mode():
    node = dict(SINGLE_TEMP)
    assert "hvac_mode" not in node
    assert is_single_temp_node(node) is True
    assert resolve_apply_modes() == ["heat"]
    assert resolve_apply_modes({}, {}) == ["heat"]
    result = decision("heat", node)
    assert result.allow is True
    assert result.message == (
        "Applying set_temperature for climate.main_level: "
        "entity mode heat is in apply_modes ['heat']"
    )


def test_off_is_skipped_when_node_omits_hvac_mode():
    result = decision("off")
    assert result.allow is False
    assert result.message == (
        "Skipping set_temperature for climate.main_level: entity is off"
    )


def test_off_is_skipped_when_apply_modes_lists_off_but_node_omits_hvac_mode():
    result = decision("off", apply_modes=["off", "heat"])
    assert result.allow is False
    assert result.message.endswith("entity is off")


def test_cool_is_skipped_under_heat_default():
    result = decision("cool")
    assert result.allow is False
    assert result.message == (
        "Skipping set_temperature for climate.main_level: "
        "entity mode cool not in apply_modes ['heat']"
    )


def test_heat_cool_without_hvac_mode_is_skipped_under_heat_default():
    node = {"time": "06:00", "temp": 68}
    assert is_single_temp_node(node) is True
    result = decision("heat_cool", node)
    assert result.allow is False
    assert "entity mode heat_cool not in apply_modes ['heat']" in result.message


def test_unavailable_unknown_and_missing_are_fail_closed():
    unavailable = decision("unavailable")
    unknown = decision("unknown")
    missing = decision(None)
    blank = decision("  ")
    assert unavailable.allow is False
    assert unknown.allow is False
    assert missing.allow is False
    assert blank.allow is False
    assert unavailable.message.endswith("entity is unavailable")
    assert unknown.message.endswith("entity is unknown")
    assert missing.message.endswith("entity state is missing")
    assert blank.message.endswith("entity state is missing")


def test_unavailable_unknown_and_missing_are_skipped_even_when_node_names_a_mode():
    node = {"time": "06:00", "temp": 68, "hvac_mode": "heat"}
    for state, suffix in (
        ("unavailable", "entity is unavailable"),
        ("unknown", "entity is unknown"),
        (None, "entity state is missing"),
        ("  ", "entity state is missing"),
    ):
        result = decision(state, node)
        assert result.allow is False, state
        assert result.message.endswith(suffix), state


def test_apply_modes_cool_allows_cool():
    result = decision("cool", apply_modes=["cool"])
    assert result.allow is True
    assert result.message == (
        "Applying set_temperature for climate.main_level: "
        "entity mode cool is in apply_modes ['cool']"
    )


def test_schedule_apply_modes_override_group_and_group_is_used_when_schedule_omits_them():
    group = {"apply_modes": ["heat"]}
    schedule = {"nodes": [], "apply_modes": ["cool"]}
    assert resolve_apply_modes(group, schedule) == ["cool"]
    assert resolve_apply_modes(group, {"nodes": []}) == ["heat"]
    result = decide_set_temperature(
        ENTITY,
        "cool",
        dict(SINGLE_TEMP),
        resolve_apply_modes(group, schedule),
    )
    assert result.allow is True


def test_explicit_empty_apply_modes_allow_nothing():
    assert resolve_apply_modes({"apply_modes": []}, None) == []
    result = decision("heat", apply_modes=[])
    assert result.allow is False
    assert "not in apply_modes []" in result.message


def test_unavailable_wins_over_apply_modes_that_name_it():
    result = decision("unavailable", apply_modes=["unavailable", "heat"])
    assert result.allow is False
    assert result.message.endswith("entity is unavailable")


def test_node_hvac_mode_none_or_blank_is_not_a_named_mode():
    assert mode_guard.node_has_hvac_mode({"temp": 68, "hvac_mode": None}) is False
    assert mode_guard.node_has_hvac_mode({"temp": 68, "hvac_mode": "  "}) is False
    assert mode_guard.node_has_hvac_mode({"temp": 68}) is False
    skipped = decision("cool", {"temp": 68, "hvac_mode": None})
    assert skipped.allow is False
    assert "apply_modes ['heat']" in skipped.message


def test_named_hvac_mode_still_allows_a_different_current_mode():
    node = {"temp": 70, "hvac_mode": "heat"}
    result = decision("cool", node)
    assert result.allow is True
    assert result.message == (
        "Applying set_temperature for climate.main_level: "
        "node hvac_mode heat (entity mode cool)"
    )


def test_node_off_with_setpoint_is_allowed_when_entity_is_off_or_heat():
    node = {"time": "08:00", "temp": 16, "hvac_mode": "off"}
    for state in ("off", "heat"):
        result = decision(state, node)
        assert result.allow is True, state
        assert result.message == (
            "Applying set_temperature for climate.main_level: "
            "node hvac_mode off (entity mode %s)" % state
        )


def test_named_heat_node_allows_setpoint_when_entity_is_off():
    node = {"time": "06:00", "temp": 68, "hvac_mode": "heat"}
    result = decision("off", node)
    assert result.allow is True
    assert result.message == (
        "Applying set_temperature for climate.main_level: "
        "node hvac_mode heat (entity mode off)"
    )


def test_nochange_is_not_a_single_temp_node():
    node = {"temp": 68, "noChange": True}
    assert is_single_temp_node(node) is False
    assert is_single_temp_node({"noChange": False, "temp": 66}) is True
    assert is_single_temp_node({"time": "00:00"}) is False


def test_whitespace_state_is_normalized():
    result = decision(" heat ")
    assert result.allow is True
    assert "entity mode heat is in apply_modes ['heat']" in result.message


def test_last_node_states_not_recorded_when_guard_skips():
    """Coordinator retry: a skipped temperature must not mark the node applied."""
    last_node_states = {}
    last_node_times = {}
    node = dict(SINGLE_TEMP)
    result = decision("off", node)
    assert result.allow is False
    intended = True
    if should_record_applied_node(
        intended_set_temperature=intended, decision=result
    ):
        last_node_states[ENTITY] = {"temp": 68}
        last_node_times[ENTITY] = "06:00"
    assert last_node_states == {}
    assert last_node_times == {}
    # Next cycle treats this as a first run and retries.
    assert last_node_states.get(ENTITY) is None


def test_last_node_states_recorded_when_guard_allows():
    last_node_states = {}
    result = decision("heat", dict(SINGLE_TEMP))
    assert result.allow is True
    if should_record_applied_node(
        intended_set_temperature=True, decision=result
    ):
        last_node_states[ENTITY] = {"temp": 68}
    assert last_node_states[ENTITY] == {"temp": 68}


def test_should_record_when_temperature_was_not_intended():
    assert (
        should_record_applied_node(
            intended_set_temperature=False, decision=None
        )
        is True
    )


def test_should_not_record_unavailable_even_when_node_names_a_mode():
    node = {"temp": 68, "hvac_mode": "heat"}
    result = decision("unavailable", node)
    assert result.allow is False
    assert (
        should_record_applied_node(
            intended_set_temperature=True, decision=result
        )
        is False
    )


if __name__ == "__main__":
    raise SystemExit(pytest.main([__file__, "-v"]))
