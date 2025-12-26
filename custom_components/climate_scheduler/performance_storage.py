"""Performance tracking storage for Climate Scheduler."""
import logging
from typing import Any, Dict, List, Optional
from datetime import datetime, timedelta

from homeassistant.core import HomeAssistant
from homeassistant.helpers.storage import Store

_LOGGER = logging.getLogger(__name__)

STORAGE_VERSION = 1
STORAGE_KEY_MAIN = "climate_scheduler_performance"
STORAGE_KEY_PREFIX = "climate_scheduler_performance_"


class PerformanceStorage:
    """Handle storage of heating/cooling performance data."""

    def __init__(self, hass: HomeAssistant) -> None:
        """Initialize performance storage."""
        self.hass = hass
        self._store_main = Store(hass, STORAGE_VERSION, STORAGE_KEY_MAIN)
        self._data: Dict[str, Any] = {}
        self._monthly_stores: Dict[str, Store] = {}  # Cache of Store instances

    async def async_load(self) -> None:
        """Load main performance data from storage."""
        data = await self._store_main.async_load()
        if data is None:
            self._data = {
                "schema_version": STORAGE_VERSION,
                "settings": {
                    "enabled": False,
                    "outdoor_sensor": None
                },
                "statistics": {},
                "months": []
            }
        else:
            self._data = data
            # Ensure schema version exists
            if "schema_version" not in self._data:
                self._data["schema_version"] = STORAGE_VERSION
        _LOGGER.info(f"Loaded performance tracking data: {len(self._data.get('months', []))} months tracked")

    async def async_save(self) -> None:
        """Save main performance data to storage."""
        await self._store_main.async_save(self._data)
        _LOGGER.debug("Saved performance tracking main data")

    def _get_month_key(self, dt: datetime) -> str:
        """Get month key in format YYYY_MM."""
        return dt.strftime("%Y_%m")

    def _get_monthly_store(self, month_key: str) -> Store:
        """Get or create Store instance for a specific month."""
        if month_key not in self._monthly_stores:
            self._monthly_stores[month_key] = Store(
                self.hass,
                STORAGE_VERSION,
                f"{STORAGE_KEY_PREFIX}{month_key}"
            )
        return self._monthly_stores[month_key]

    async def _ensure_month_partition(self, month_key: str) -> None:
        """Ensure monthly partition file exists."""
        store = self._get_monthly_store(month_key)
        data = await store.async_load()
        if data is None:
            # Create new monthly partition
            await store.async_save({
                "schema_version": STORAGE_VERSION,
                "sessions": {}
            })
            # Add to months list if not already present
            if month_key not in self._data["months"]:
                self._data["months"].append(month_key)
                self._data["months"].sort()
                await self.async_save()
            _LOGGER.info(f"Created new monthly partition: {month_key}")

    def _determine_season(self, month: int) -> str:
        """Determine season from month (Northern Hemisphere)."""
        if month in [12, 1, 2]:
            return "winter"
        elif month in [3, 4, 5]:
            return "spring"
        elif month in [6, 7, 8]:
            return "summer"
        else:
            return "autumn"

    def _determine_time_category(self, hour: int) -> str:
        """Determine time category from hour."""
        if 6 <= hour < 12:
            return "morning"
        elif 12 <= hour < 18:
            return "day"
        elif 18 <= hour < 22:
            return "evening"
        else:
            return "night"

    async def async_add_session(self, session: Dict[str, Any]) -> None:
        """Add a performance session to the appropriate monthly partition."""
        if not self._data["settings"].get("enabled", False):
            _LOGGER.debug("Performance tracking disabled, skipping session storage")
            return

        # Get month key from session end time
        end_time = datetime.fromisoformat(session["end_time"])
        month_key = self._get_month_key(end_time)

        # Ensure partition exists
        await self._ensure_month_partition(month_key)

        # Load monthly data
        store = self._get_monthly_store(month_key)
        monthly_data = await store.async_load()

        # Get entity sessions list
        entity_id = session["entity_id"]
        if entity_id not in monthly_data["sessions"]:
            monthly_data["sessions"][entity_id] = []

        # Remove entity_id from session dict (it's the key)
        session_copy = {k: v for k, v in session.items() if k != "entity_id"}
        
        # Add session
        monthly_data["sessions"][entity_id].append(session_copy)

        # Save monthly partition
        await store.async_save(monthly_data)
        _LOGGER.info(f"Saved performance session for {entity_id} in partition {month_key}")

        # Update statistics
        await self._update_statistics(entity_id)

    async def _update_statistics(self, entity_id: str) -> None:
        """Recalculate statistics for an entity from all sessions."""
        # Load all sessions for this entity across all months
        all_sessions = await self.async_get_sessions(entity_id=entity_id)

        if not all_sessions:
            return

        # Calculate statistics
        warming_sessions = [s for s in all_sessions if s["session_type"] == "heating"]
        cooling_sessions = [s for s in all_sessions if s["session_type"] == "cooling"]

        stats = {
            "total_sessions": len(all_sessions),
            "warming_sessions": len(warming_sessions),
            "cooling_sessions": len(cooling_sessions),
            "avg_warming_rate": None,
            "avg_cooling_rate": None,
            "avg_indoor_outdoor_differential": None,
            "first_session_date": None,
            "last_updated": datetime.now().isoformat()
        }

        # Calculate average warming rate
        if warming_sessions:
            total_rate = sum(s["rate"] for s in warming_sessions)
            stats["avg_warming_rate"] = round(total_rate / len(warming_sessions), 2)

        # Calculate average cooling rate
        if cooling_sessions:
            total_rate = sum(s["rate"] for s in cooling_sessions)
            stats["avg_cooling_rate"] = round(total_rate / len(cooling_sessions), 2)

        # Calculate average indoor-outdoor differential (if available)
        sessions_with_outdoor = [
            s for s in all_sessions 
            if s.get("indoor_outdoor_differential_start") is not None
        ]
        if sessions_with_outdoor:
            total_diff = sum(s["indoor_outdoor_differential_start"] for s in sessions_with_outdoor)
            stats["avg_indoor_outdoor_differential"] = round(total_diff / len(sessions_with_outdoor), 2)

        # Get first session date
        if all_sessions:
            first_session = min(all_sessions, key=lambda s: s["start_time"])
            stats["first_session_date"] = first_session["start_time"]

        # Update statistics in main data
        self._data["statistics"][entity_id] = stats
        await self.async_save()
        _LOGGER.debug(f"Updated statistics for {entity_id}: {stats}")

    async def async_get_sessions(
        self,
        entity_id: Optional[str] = None,
        session_type: Optional[str] = None,
        date_range: Optional[tuple[datetime, datetime]] = None,
        day_of_week: Optional[str] = None,
        time_category: Optional[str] = None,
        season: Optional[str] = None,
        profile: Optional[str] = None,
        completed_only: bool = False
    ) -> List[Dict[str, Any]]:
        """Get sessions with optional filters."""
        # Determine which months to load
        months_to_load = []
        if date_range:
            start_date, end_date = date_range
            current = start_date.replace(day=1)
            while current <= end_date:
                month_key = self._get_month_key(current)
                if month_key in self._data["months"]:
                    months_to_load.append(month_key)
                # Move to next month
                if current.month == 12:
                    current = current.replace(year=current.year + 1, month=1)
                else:
                    current = current.replace(month=current.month + 1)
        else:
            # Load all months
            months_to_load = self._data["months"]

        # Load and aggregate sessions
        all_sessions = []
        for month_key in months_to_load:
            store = self._get_monthly_store(month_key)
            monthly_data = await store.async_load()
            if not monthly_data:
                continue

            # Filter by entity if specified
            entities_to_process = [entity_id] if entity_id else monthly_data["sessions"].keys()

            for ent_id in entities_to_process:
                if ent_id not in monthly_data["sessions"]:
                    continue

                for session in monthly_data["sessions"][ent_id]:
                    # Add entity_id back to session dict
                    session_with_id = {"entity_id": ent_id, **session}

                    # Apply filters
                    if session_type and session.get("session_type") != session_type:
                        continue
                    if day_of_week and session.get("day_of_week") != day_of_week:
                        continue
                    if time_category and session.get("time_category") != time_category:
                        continue
                    if season and session.get("season") != season:
                        continue
                    if profile and session.get("active_profile") != profile:
                        continue
                    if completed_only and not session.get("completed", True):
                        continue
                    if date_range:
                        session_time = datetime.fromisoformat(session["start_time"])
                        if not (date_range[0] <= session_time <= date_range[1]):
                            continue

                    all_sessions.append(session_with_id)

        return all_sessions

    async def async_get_stats(self, entity_id: Optional[str] = None) -> Dict[str, Any]:
        """Get statistics for entity or all entities."""
        if entity_id:
            return self._data["statistics"].get(entity_id, {})
        return self._data["statistics"]

    async def async_get_settings(self) -> Dict[str, Any]:
        """Get performance tracking settings."""
        return self._data["settings"]

    async def async_save_settings(self, settings: Dict[str, Any]) -> None:
        """Save performance tracking settings."""
        self._data["settings"].update(settings)
        await self.async_save()
        _LOGGER.info(f"Saved performance tracking settings: {settings}")

    async def async_clear_history(
        self,
        entity_id: Optional[str] = None,
        months: Optional[List[str]] = None
    ) -> None:
        """Clear performance history for entity or specific months."""
        if months:
            # Delete specific monthly files
            for month_key in months:
                if month_key in self._data["months"]:
                    store = self._get_monthly_store(month_key)
                    # Delete the file by saving empty data (Home Assistant Store doesn't have delete)
                    await store.async_save(None)
                    self._data["months"].remove(month_key)
                    if month_key in self._monthly_stores:
                        del self._monthly_stores[month_key]
            await self.async_save()
            _LOGGER.info(f"Deleted monthly partitions: {months}")
        elif entity_id:
            # Clear entity from all monthly files
            for month_key in self._data["months"]:
                store = self._get_monthly_store(month_key)
                monthly_data = await store.async_load()
                if monthly_data and entity_id in monthly_data["sessions"]:
                    del monthly_data["sessions"][entity_id]
                    await store.async_save(monthly_data)
            # Clear statistics
            if entity_id in self._data["statistics"]:
                del self._data["statistics"][entity_id]
            await self.async_save()
            _LOGGER.info(f"Cleared history for entity: {entity_id}")
        else:
            # Clear all
            for month_key in self._data["months"]:
                store = self._get_monthly_store(month_key)
                await store.async_save(None)
            self._data["months"] = []
            self._data["statistics"] = {}
            self._monthly_stores = {}
            await self.async_save()
            _LOGGER.info("Cleared all performance history")

    async def async_recalculate_stats(self, entity_id: Optional[str] = None) -> None:
        """Recalculate statistics from raw sessions."""
        if entity_id:
            await self._update_statistics(entity_id)
        else:
            # Recalculate for all entities
            all_entity_ids = set()
            for month_key in self._data["months"]:
                store = self._get_monthly_store(month_key)
                monthly_data = await store.async_load()
                if monthly_data:
                    all_entity_ids.update(monthly_data["sessions"].keys())

            for ent_id in all_entity_ids:
                await self._update_statistics(ent_id)

        _LOGGER.info(f"Recalculated statistics for {entity_id or 'all entities'}")
