"""Shared test fixtures for Climate Scheduler tests.

We use lightweight mocking instead of the full HA test framework
so these tests can run without a Home Assistant installation.
"""
import asyncio
import json
from datetime import time
from unittest.mock import AsyncMock, MagicMock, patch
import pytest

# ---------------------------------------------------------------------------
# Make the integration importable without HA on sys.path
# ---------------------------------------------------------------------------
import sys
import os

COMP_ROOT = os.path.join(os.path.dirname(__file__), "..", "custom_components")
sys.path.insert(0, os.path.abspath(COMP_ROOT))

# Stub out heavy HA imports that the integration relies on
# so we can run pure-logic and storage tests without installing HA.
_ha_stubs = {
    "homeassistant": MagicMock(),
    "homeassistant.core": MagicMock(),
    "homeassistant.helpers": MagicMock(),
    "homeassistant.helpers.storage": MagicMock(),
    "homeassistant.helpers.update_coordinator": MagicMock(),
    "homeassistant.helpers.typing": MagicMock(),
    "homeassistant.helpers.event": MagicMock(),
    "homeassistant.config_entries": MagicMock(),
    "homeassistant.const": MagicMock(),
    "homeassistant.util": MagicMock(),
    "homeassistant.util.dt": MagicMock(),
    "homeassistant.components": MagicMock(),
    "homeassistant.components.http": MagicMock(),
    "homeassistant.components.climate": MagicMock(),
}

for mod_name, mod_obj in _ha_stubs.items():
    if mod_name not in sys.modules:
        sys.modules[mod_name] = mod_obj

# Minimal stubs for constants that the code imports
from custom_components.climate_scheduler.const import (
    DOMAIN,
    STORAGE_KEY,
    STORAGE_VERSION,
    MIN_TEMP,
    MAX_TEMP,
    NO_CHANGE_TEMP,
    UPDATE_INTERVAL_SECONDS,
)


# ---------------------------------------------------------------------------
# Fake Store – in-memory replacement for HA's Store
# ---------------------------------------------------------------------------
class FakeStore:
    """In-memory storage stub that replaces homeassistant.helpers.storage.Store."""

    def __init__(self, hass, version, key):
        self._data = None
        self._version = version
        self._key = key

    async def async_load(self):
        return self._data

    async def async_save(self, data):
        self._data = data


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------
@pytest.fixture
def fake_hass():
    """Minimal fake HomeAssistant object."""
    hass = MagicMock()
    hass.data = {DOMAIN: {}}
    hass.services = MagicMock()
    hass.bus = MagicMock()
    hass.states = MagicMock()
    return hass


@pytest.fixture
def fake_store(fake_hass):
    """Return a FakeStore instance."""
    return FakeStore(fake_hass, STORAGE_VERSION, STORAGE_KEY)


@pytest.fixture
def storage(fake_hass, fake_store, monkeypatch):
    """Return a ScheduleStorage wired to FakeStore."""
    from custom_components.climate_scheduler.storage import ScheduleStorage

    # Patch Store class so ScheduleStorage uses our fake
    monkeypatch.setattr(
        "custom_components.climate_scheduler.storage.Store",
        lambda hass, version, key: fake_store,
    )
    s = ScheduleStorage(fake_hass)
    # Pre-seed empty data so async_load doesn't fail
    fake_store._data = {"groups": {}, "settings": {}, "advance_history": {}}
    return s


def _make_storage_with_data(fake_hass, fake_store, monkeypatch, data):
    """Helper: return a ScheduleStorage pre-loaded with *data*."""
    from custom_components.climate_scheduler.storage import ScheduleStorage

    monkeypatch.setattr(
        "custom_components.climate_scheduler.storage.Store",
        lambda hass, version, key: fake_store,
    )
    fake_store._data = data
    s = ScheduleStorage(fake_hass)
    s._data = data  # skip async_load
    return s