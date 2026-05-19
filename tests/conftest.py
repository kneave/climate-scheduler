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
# IMPORTANT: Some stubs need concrete classes (not MagicMock) because
# real code extends them. These are built as proper modules below.

# --- MagicMock stubs for modules that don't need concrete classes ---
_ha_magic_stubs = {
    "homeassistant": MagicMock(),
    "homeassistant.core": MagicMock(),
    "homeassistant.helpers": MagicMock(),
    "homeassistant.helpers.storage": MagicMock(),
    "homeassistant.helpers.typing": MagicMock(),
    "homeassistant.helpers.event": MagicMock(),
    "homeassistant.config_entries": MagicMock(),
    "homeassistant.const": MagicMock(),
    "homeassistant.components": MagicMock(),
    "homeassistant.components.http": MagicMock(),
    "homeassistant.components.climate": MagicMock(),
}

for mod_name, mod_obj in _ha_magic_stubs.items():
    if mod_name not in sys.modules:
        sys.modules[mod_name] = mod_obj

# --- Concrete stub for DataUpdateCoordinator ---
# HeatingSchedulerCoordinator extends this, so MagicMock won't work.
if "homeassistant.helpers.update_coordinator" not in sys.modules:
    _duc_mod = type(sys)("homeassistant.helpers.update_coordinator")

    class _StubDataUpdateCoordinator:
        """Concrete stub so HeatingSchedulerCoordinator can extend it."""
        def __init__(self, hass, logger, name=None, update_interval=None, update_method=None):
            self.hass = hass
            self._name = name
            self._update_interval = update_interval
            self._unsub_refresh = None
            self.data = None

        async def async_request_refresh(self):
            pass

        async def async_config_entry_first_refresh(self):
            pass

    _duc_mod.DataUpdateCoordinator = _StubDataUpdateCoordinator
    _duc_mod.UpdateFailed = Exception
    sys.modules["homeassistant.helpers.update_coordinator"] = _duc_mod

# --- Concrete stub for dt_util ---
# Coordinator calls dt_util.now() — needs to return real datetime.
if "homeassistant.util" not in sys.modules:
    sys.modules["homeassistant.util"] = MagicMock()
if "homeassistant.util.dt" not in sys.modules:
    _dt_mod = type(sys)("homeassistant.util.dt")
    from datetime import datetime as _dt, timezone as _tz

    def _now(tz=None):
        """Return current UTC time (or with timezone if given)."""
        return _dt.now(_tz.utc)

    def _as_utc(dt_val):
        """Ensure datetime is UTC-aware."""
        if dt_val and dt_val.tzinfo is None:
            return dt_val.replace(tzinfo=_tz.utc)
        return dt_val

    _dt_mod.now = _now
    _dt_mod.as_utc = _as_utc
    _dt_mod.DEFAULT_TIME_ZONE = _tz.utc
    sys.modules["homeassistant.util.dt"] = _dt_mod

# Add ATTR_TEMPERATURE constant to the homeassistant.const stub
sys.modules["homeassistant.const"].ATTR_TEMPERATURE = "temperature"
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