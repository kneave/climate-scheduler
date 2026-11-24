"""Fail-closed guard for climate.set_temperature.

A node that does not name an HVAC mode may set a temperature only when the
thermostat is already in an intended apply mode. The default apply mode for a
single-temperature node is heat. This module does not turn a thermostat on
or change its mode.
"""
from __future__ import annotations

from typing import Any, Mapping, Optional, Sequence

DEFAULT_APPLY_MODES = ("heat",)
_UNAVAILABLE_STATES = frozenset({"unavailable", "unknown"})


class SetTemperatureDecision:
    """Whether set_temperature may run, plus the info log line."""

    def __init__(self, allow: bool, message: str) -> None:
        self.allow = allow
        self.message = message

    def __repr__(self) -> str:
        return "SetTemperatureDecision(allow=%s, message=%r)" % (self.allow, self.message)


def _mode_list(value: Any) -> Optional[list]:
    """Return a mode list, or None when the value is not a mode list."""
    if isinstance(value, str):
        text = value.strip()
        return [text] if text else []
    if isinstance(value, (list, tuple)):
        modes = []
        for item in value:
            if isinstance(item, str) and item.strip():
                modes.append(item.strip())
            elif item is not None and not isinstance(item, str):
                return None
        return modes
    return None


def resolve_apply_modes(
    group_data: Optional[Mapping[str, Any]] = None,
    schedule_data: Optional[Mapping[str, Any]] = None,
) -> list:
    """Return apply_modes from the schedule, else the group, else ['heat'].

    An explicit empty list is honored and allows no mode. A missing option
    uses the single-temperature default of heat.
    """
    for source in (schedule_data, group_data):
        if not isinstance(source, Mapping) or "apply_modes" not in source:
            continue
        modes = _mode_list(source.get("apply_modes"))
        if modes is not None:
            return modes
    return list(DEFAULT_APPLY_MODES)


def node_has_hvac_mode(node: Optional[Mapping[str, Any]]) -> bool:
    """True when the node names an HVAC mode."""
    if not isinstance(node, Mapping) or "hvac_mode" not in node:
        return False
    mode = node.get("hvac_mode")
    return isinstance(mode, str) and bool(mode.strip())


def is_single_temp_node(node: Optional[Mapping[str, Any]]) -> bool:
    """True when the node sets one temperature and is not marked noChange."""
    if not isinstance(node, Mapping):
        return False
    if node.get("noChange"):
        return False
    return node.get("temp") is not None


def should_record_applied_node(
    *,
    intended_set_temperature: bool,
    decision: Optional[SetTemperatureDecision],
) -> bool:
    """Return False when a temperature apply was intended but the guard skipped it.

    Callers must not write last_node_states in that case, so the next cycle
    can retry once the thermostat is available or in an allowed mode.
    """
    if intended_set_temperature and decision is not None and not decision.allow:
        return False
    return True


def decide_set_temperature(
    entity_id: str,
    entity_state: Optional[str],
    node: Optional[Mapping[str, Any]] = None,
    apply_modes: Optional[Sequence[str]] = None,
) -> SetTemperatureDecision:
    """Decide whether climate.set_temperature is allowed.

    Missing, unavailable, or unknown entity states always skip, even if the
    node names an HVAC mode. If the node names an HVAC mode (including off),
    the call is allowed so a scheduled turn-on can set the new setpoint and
    an off node can still write its target temperature. If the node does not
    name an HVAC mode, allow the call only when the current entity mode is in
    apply_modes (default heat); off is never an apply mode. Callers should
    pass resolve_apply_modes(); None uses heat.
    """
    state = entity_state.strip() if isinstance(entity_state, str) else ""
    if not state:
        return SetTemperatureDecision(
            False,
            "Skipping set_temperature for %s: entity state is missing" % entity_id,
        )
    if state in _UNAVAILABLE_STATES:
        return SetTemperatureDecision(
            False,
            "Skipping set_temperature for %s: entity is %s" % (entity_id, state),
        )

    if apply_modes is None:
        modes = list(DEFAULT_APPLY_MODES)
    else:
        parsed = _mode_list(list(apply_modes))
        modes = parsed if parsed is not None else list(DEFAULT_APPLY_MODES)

    if isinstance(node, Mapping) and node_has_hvac_mode(node):
        return SetTemperatureDecision(
            True,
            "Applying set_temperature for %s: node hvac_mode %s (entity mode %s)"
            % (entity_id, node.get("hvac_mode"), state),
        )

    if state == "off":
        return SetTemperatureDecision(
            False,
            "Skipping set_temperature for %s: entity is off" % entity_id,
        )

    if state not in modes:
        return SetTemperatureDecision(
            False,
            "Skipping set_temperature for %s: entity mode %s not in apply_modes %s"
            % (entity_id, state, modes),
        )
    return SetTemperatureDecision(
        True,
        "Applying set_temperature for %s: entity mode %s is in apply_modes %s"
        % (entity_id, state, modes),
    )
