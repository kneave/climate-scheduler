import enum
import sys
import types
from datetime import datetime
from pathlib import Path


def _install_homeassistant_stubs() -> None:
    if "homeassistant" in sys.modules:
        return

    homeassistant = types.ModuleType("homeassistant")
    sys.modules["homeassistant"] = homeassistant

    core = types.ModuleType("homeassistant.core")

    class HomeAssistant:
        pass

    class ServiceCall:
        def __init__(self, data=None):
            self.data = data or {}

    class SupportsResponse(enum.Enum):
        NONE = "none"
        ONLY = "only"

    core.HomeAssistant = HomeAssistant
    core.ServiceCall = ServiceCall
    core.SupportsResponse = SupportsResponse
    sys.modules["homeassistant.core"] = core

    config_entries = types.ModuleType("homeassistant.config_entries")

    class ConfigEntry:
        pass

    config_entries.ConfigEntry = ConfigEntry
    sys.modules["homeassistant.config_entries"] = config_entries

    const = types.ModuleType("homeassistant.const")

    class UnitOfTemperature(enum.Enum):
        CELSIUS = "C"
        FAHRENHEIT = "F"

    const.UnitOfTemperature = UnitOfTemperature
    const.ATTR_TEMPERATURE = "temperature"
    const.__version__ = "2026.3.0"
    sys.modules["homeassistant.const"] = const

    helpers = types.ModuleType("homeassistant.helpers")
    sys.modules["homeassistant.helpers"] = helpers

    storage_mod = types.ModuleType("homeassistant.helpers.storage")

    class Store:
        def __init__(self, hass, version, key):
            self._data = None

        async def async_load(self):
            return self._data

        async def async_save(self, data):
            self._data = data

    storage_mod.Store = Store
    sys.modules["homeassistant.helpers.storage"] = storage_mod
    helpers.storage = storage_mod

    update_coordinator_mod = types.ModuleType("homeassistant.helpers.update_coordinator")

    class DataUpdateCoordinator:
        def __init__(self, hass, logger, name=None, update_interval=None):
            self.hass = hass
            self.logger = logger
            self.name = name
            self.update_interval = update_interval

        async def async_refresh(self):
            return None

        async def async_request_refresh(self):
            return None

    class UpdateFailed(Exception):
        pass

    update_coordinator_mod.DataUpdateCoordinator = DataUpdateCoordinator
    update_coordinator_mod.UpdateFailed = UpdateFailed
    sys.modules["homeassistant.helpers.update_coordinator"] = update_coordinator_mod
    helpers.update_coordinator = update_coordinator_mod

    selector_mod = types.ModuleType("homeassistant.helpers.selector")

    class SelectSelectorMode(enum.Enum):
        DROPDOWN = "dropdown"

    class SelectSelectorConfig:
        def __init__(self, options=None, mode=None):
            self.options = options or []
            self.mode = mode

    class SelectSelector:
        def __init__(self, config):
            self.config = config

    class EntitySelectorConfig:
        def __init__(self, domain=None):
            self.domain = domain

    class EntitySelector:
        def __init__(self, config):
            self.config = config

    selector_mod.SelectSelectorMode = SelectSelectorMode
    selector_mod.SelectSelectorConfig = SelectSelectorConfig
    selector_mod.SelectSelector = SelectSelector
    selector_mod.EntitySelectorConfig = EntitySelectorConfig
    selector_mod.EntitySelector = EntitySelector
    sys.modules["homeassistant.helpers.selector"] = selector_mod
    helpers.selector = selector_mod

    cv_mod = types.ModuleType("homeassistant.helpers.config_validation")
    cv_mod.boolean = bool
    cv_mod.string = str
    sys.modules["homeassistant.helpers.config_validation"] = cv_mod
    helpers.config_validation = cv_mod

    util_mod = types.ModuleType("homeassistant.util")
    sys.modules["homeassistant.util"] = util_mod

    json_mod = types.ModuleType("homeassistant.util.json")
    sys.modules["homeassistant.util.json"] = json_mod
    util_mod.json = json_mod

    dt_mod = types.ModuleType("homeassistant.util.dt")

    def now():
        return datetime.now()

    dt_mod.now = now
    sys.modules["homeassistant.util.dt"] = dt_mod
    util_mod.dt = dt_mod


_install_homeassistant_stubs()


def _install_custom_component_package_stubs() -> None:
    repo_root = Path(__file__).resolve().parents[1]

    if "custom_components" not in sys.modules:
        custom_components = types.ModuleType("custom_components")
        custom_components.__path__ = [str(repo_root / "custom_components")]
        sys.modules["custom_components"] = custom_components

    if "custom_components.climate_scheduler" not in sys.modules:
        climate_scheduler_pkg = types.ModuleType("custom_components.climate_scheduler")
        climate_scheduler_pkg.__path__ = [
            str(repo_root / "custom_components" / "climate_scheduler")
        ]
        sys.modules["custom_components.climate_scheduler"] = climate_scheduler_pkg


_install_custom_component_package_stubs()
