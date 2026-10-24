import asyncio
from types import SimpleNamespace

import pytest


@pytest.mark.asyncio
async def test_async_set_group_schedule_rejects_invalid_day_for_individual() -> None:
    from custom_components.climate_scheduler.storage import ScheduleStorage

    hass = SimpleNamespace(
        config=SimpleNamespace(
            units=SimpleNamespace(temperature_unit="C")
        )
    )

    storage = ScheduleStorage(hass)
    storage._data = {
        "groups": {
            "Living": {
                "entities": ["climate.test"],
                "enabled": True,
                "ignored": False,
                "schedule_mode": "all_days",
                "schedules": {"all_days": [{"time": "00:00", "temp": 20}]},
                "active_profile": "Default",
            }
        },
        "profiles": {
            "Default": {
                "schedule_mode": "all_days",
                "schedules": {"all_days": [{"time": "00:00", "temp": 20}]},
            }
        },
        "settings": {},
        "advance_history": {},
    }

    with pytest.raises(ValueError, match="Invalid day"):
        await storage.async_set_group_schedule(
            "Living",
            [{"time": "06:00", "temp": 21}],
            day="weekday",
            schedule_mode="individual",
        )


def test_sanitize_schedule_nodes_strips_unapproved_fields() -> None:
    from custom_components.climate_scheduler.storage import _sanitize_schedule_nodes

    sanitized = _sanitize_schedule_nodes(
        [
            {
                "time": "24:00",
                "temp": 21,
                "noChange": True,
                "hvac_mode": " ",
                "fan_mode": "auto",
                "target_temp_low": 18,
                "evil": "drop-me",
                "A": "keep-legacy",
            }
        ]
    )

    assert sanitized[0]["time"] == "23:59"
    assert sanitized[0]["temp"] == 21.0
    assert sanitized[0]["noChange"] is True
    assert "hvac_mode" not in sanitized[0]
    assert sanitized[0]["fan_mode"] == "auto"
    assert sanitized[0]["target_temp_low"] == 18.0
    assert sanitized[0]["A"] == "keep-legacy"
    assert "evil" not in sanitized[0]
