from datetime import timedelta
from types import SimpleNamespace

import pytest


class _FakeState:
    def __init__(self, attributes):
        self.attributes = attributes


class _FakeStates:
    def __init__(self, state_map):
        self._state_map = state_map

    def get(self, entity_id):
        return self._state_map.get(entity_id)


class _FakeServices:
    def __init__(self):
        self.calls = []

    async def async_call(self, domain, service, data, blocking=True):
        self.calls.append((domain, service, data, blocking))
        if service == "set_temperature":
            raise RuntimeError("boom")


class _FakeBus:
    def __init__(self):
        self.events = []

    def async_fire(self, event_type, payload):
        self.events.append((event_type, payload))


class _FakeStorage:
    def __init__(self):
        self.saved_history = []

    async def async_get_settings(self):
        return {}

    async def async_get_groups(self):
        return {
            "Living": {
                "enabled": True,
                "ignored": False,
                "entities": ["climate.test"],
                "_is_single_entity_group": True,
            }
        }

    async def async_get_group_schedule(self, group_name, day):
        return {
            "nodes": [{"time": "00:00", "temp": 21, "hvac_mode": "heat"}],
            "schedule_mode": "all_days",
        }

    async def async_save_advance_history(self, history):
        self.saved_history.append(history.copy())


@pytest.mark.asyncio
async def test_advance_rolls_back_override_state_when_apply_fails() -> None:
    from custom_components.climate_scheduler.coordinator import HeatingSchedulerCoordinator

    fake_storage = _FakeStorage()
    fake_hass = SimpleNamespace(
        states=_FakeStates(
            {
                "climate.test": _FakeState(
                    {
                        "hvac_modes": ["heat", "off"],
                        "fan_modes": [],
                        "swing_modes": [],
                        "preset_modes": [],
                        "current_temperature": 20,
                        # feature bit 0 (TARGET_TEMPERATURE) marks entities
                        # whose temperature can be set (see upstream 0cae78c)
                        "supported_features": 1,
                    }
                )
            }
        ),
        services=_FakeServices(),
        bus=_FakeBus(),
    )

    coordinator = HeatingSchedulerCoordinator(fake_hass, fake_storage, timedelta(seconds=60))

    result = await coordinator.advance_to_next_node("climate.test")

    assert result["success"] is False
    assert "Failed to set temperature" in result["error"]
    assert "climate.test" not in coordinator.override_until
    assert coordinator.advance_history["climate.test"][-1]["cancelled_at"] is not None
    assert len(fake_storage.saved_history) >= 2
