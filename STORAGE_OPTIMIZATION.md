# Storage Optimization Roadmap

## Current State

The Climate Scheduler currently uses Home Assistant's `Store` class to persist all data to a single JSON file:
- **File:** `.storage/climate_scheduler.storage`
- **Structure:** `{groups: {...}, settings: {...}, advance_history: {...}}`
- **Write behavior:** Every save writes the **entire data structure** to disk
- **Current mitigation:** Frontend has 300ms debouncing to batch rapid changes

## The Problem

### Performance Issues
1. **Full file writes:** Saving a single group schedule rewrites the entire JSON file (all groups, settings, history)
2. **Growing I/O time:** As users add more groups, save operations get slower (linear with total data size)
3. **Network overhead:** Frontend sends complete schedule (all nodes) even for single-node changes

### Concurrency Concerns
1. **File locking:** Multiple simultaneous saves could cause contention (mitigated by frontend debouncing)
2. **No granular updates:** Can't update one group without loading/writing all groups
3. **Lost updates:** If two saves happen too close together, changes could be lost

### Current Workarounds
- ✅ Frontend: 300ms debounce prevents most concurrent saves
- ✅ Frontend: Pending save flag ensures changes aren't lost
- ❌ Backend: No write batching or debouncing
- ❌ Backend: No protection against concurrent file writes

## Optimization Options

### Option 1: Split into Multiple Files
**Complexity:** Low | **Migration effort:** Low | **Timeline:** 1-2 days

Split the monolithic JSON file into separate domain-specific files:

```python
# Current (single file)
Store(hass, STORAGE_VERSION, "climate_scheduler")

# Proposed (multiple files)
self._groups_store = Store(hass, STORAGE_VERSION, "climate_scheduler_groups")
self._settings_store = Store(hass, STORAGE_VERSION, "climate_scheduler_settings")
self._advance_store = Store(hass, STORAGE_VERSION, "climate_scheduler_advance")
```

**Pros:**
- ✅ Reduces lock contention (separate files = independent locks)
- ✅ Smaller write size per operation
- ✅ Uses native HA infrastructure (no new dependencies)
- ✅ Easy rollback (keep both systems during migration)
- ✅ Better modularity (settings changes don't touch schedule data)

**Cons:**
- ❌ Still writes entire groups dict on every group save
- ❌ No built-in delta/partial update support
- ❌ Each file still grows linearly with content

**Implementation:**
1. Create separate Store instances for each domain
2. Update `async_load()` to load from all files
3. Add migration logic to split existing single file
4. Update save methods to write to specific stores
5. Keep backward compatibility for one version

---

### Option 2: SQLite Database
**Complexity:** Medium | **Migration effort:** Medium | **Timeline:** 1-2 weeks

Replace JSON storage with SQLite for granular updates and query flexibility:

```sql
-- Groups metadata
CREATE TABLE groups (
    name TEXT PRIMARY KEY,
    entities TEXT,           -- JSON array
    enabled BOOLEAN DEFAULT 1,
    schedule_mode TEXT DEFAULT 'all_days',
    active_profile TEXT DEFAULT 'Default'
);

-- Schedule data (normalized)
CREATE TABLE group_schedules (
    group_name TEXT,
    day TEXT,                -- 'all_days', 'mon', 'tue', etc.
    nodes TEXT,              -- JSON array of nodes
    profile TEXT DEFAULT 'Default',
    PRIMARY KEY (group_name, day, profile),
    FOREIGN KEY (group_name) REFERENCES groups(name) ON DELETE CASCADE
);

-- Settings (key-value)
CREATE TABLE settings (
    key TEXT PRIMARY KEY,
    value TEXT               -- JSON-serialized value
);

-- Advance history
CREATE TABLE advance_history (
    entity_id TEXT PRIMARY KEY,
    history TEXT             -- JSON
);
```

**Pros:**
- ✅ **True delta updates:** `UPDATE group_schedules SET nodes = ? WHERE group_name = ? AND day = ?`
- ✅ **ACID transactions:** No concurrent write issues
- ✅ **Query flexibility:** Get single group without loading everything
- ✅ **Scalability:** Performance doesn't degrade with more groups
- ✅ **Frontend delta support:** Can send `{operation: 'update_node', index: 3, data: {...}}`
- ✅ **No file locks:** SQLite handles concurrency internally
- ✅ **Home Assistant already uses SQLite** for recorder (proven in HA ecosystem)

**Cons:**
- ❌ More complex migration path
- ❌ Adds sqlite3 dependency (though it's Python stdlib)
- ❌ Requires rewrite of storage.py
- ❌ Need to maintain schema migrations
- ❌ Slightly more code complexity

**Implementation:**
1. Design schema (see above)
2. Create `SQLiteScheduleStorage` class
3. Add migration from JSON → SQLite
4. Update all storage methods to use SQL queries
5. Optionally: Add frontend delta API for node-level updates
6. Add schema versioning for future migrations

**Frontend Delta API Example:**
```javascript
// Instead of sending all nodes
await haAPI.setGroupSchedule(group, nodes, day, mode);

// Send operation
await haAPI.updateGroupNode(group, day, {
    operation: 'update',
    node_index: 3,
    node_data: {time: "14:00", temp: 22.5}
});
```

---

### Option 3: Backend Write Batching (Quick Win)
**Complexity:** Very Low | **Migration effort:** Minimal | **Timeline:** 2-4 hours

Add debouncing/batching to `async_save()` to complement frontend debouncing:

```python
class ScheduleStorage:
    def __init__(self, hass: HomeAssistant):
        self.hass = hass
        self._store = Store(hass, STORAGE_VERSION, STORAGE_KEY)
        self._data = {}
        self._save_task = None
        self._save_pending = False
        self.SAVE_DELAY_SEC = 0.5  # Wait 500ms before writing

    async def async_save(self) -> None:
        """Save data to storage with batching."""
        self._save_pending = True
        
        # Cancel existing timer
        if self._save_task and not self._save_task.done():
            self._save_task.cancel()
        
        # Schedule delayed write
        self._save_task = self.hass.async_create_task(
            self._delayed_save()
        )
    
    async def _delayed_save(self) -> None:
        """Perform the actual save after delay."""
        await asyncio.sleep(self.SAVE_DELAY_SEC)
        if self._save_pending:
            await self._store.async_save(self._data)
            self._save_pending = False
            _LOGGER.debug("Batched save completed")
```

**Pros:**
- ✅ Reduces I/O by 80-90% (complements frontend debouncing)
- ✅ Minimal code changes
- ✅ Works with existing architecture
- ✅ Can implement in 1-2 hours
- ✅ No migration needed

**Cons:**
- ❌ Doesn't solve file size growth
- ❌ Still writing entire file
- ❌ No delta support
- ❌ Only addresses frequency, not size

---

## Recommended Path Forward

### Phase 1: Immediate (Now - Week 1)
**Implement Option 3: Backend Write Batching**
- Quick win with minimal effort
- Reduces I/O by ~90% when combined with frontend debouncing
- No breaking changes

### Phase 2: Short Term (Week 2-4)
**Implement Option 1: Split Files**
- Better isolation and modularity
- Reduces save size per operation
- Easier to backup/restore individual components
- Natural stepping stone toward database

### Phase 3: Long Term (Month 2-3, if needed)
**Consider Option 2: SQLite**
- Only if:
  - User base grows significantly (>100 groups per installation)
  - Need features like schedule history, reporting, or analytics
  - Multi-user concurrent editing becomes a requirement
  - Want to implement node-level delta updates from frontend

## Performance Estimates

### Current State
- **10 groups, 5 nodes each:** ~3KB file, 5-10ms save time
- **50 groups, 10 nodes each:** ~30KB file, 20-40ms save time
- **100 groups, 15 nodes each:** ~100KB file, 50-100ms save time

### After Option 3 (Batching)
- **Save frequency:** 10-15 saves/second → 1-2 saves/second (-90%)
- **I/O time:** Same per save, but 90% fewer saves
- **User impact:** Imperceptible for <100 groups

### After Option 1 (Split Files)
- **Groups save:** Only groups file written (~70% of data)
- **Settings save:** Only settings file written (~5% of data)
- **File sizes:** Smaller per domain, faster per operation

### After Option 2 (SQLite)
- **Single group save:** ~1-2ms (UPDATE query)
- **Single node update:** ~0.5ms (targeted UPDATE)
- **Bulk operations:** Transactions keep consistency
- **Scalability:** Performance flat regardless of total groups

## Migration Strategy

```
Current → +Batching → +Split Files → +SQLite (optional)
 v1.14      v1.15        v1.16          v2.0
```

Each phase is independently valuable and non-breaking. Users can stay at any phase that meets their needs.

## Related Code Files

- `custom_components/climate_scheduler/storage.py` - Main storage implementation
- `custom_components/climate_scheduler/services.py` - Service handlers that call storage
- `custom_components/climate_scheduler/frontend/app.js` - Frontend save logic (already has 300ms debouncing)
- `custom_components/climate_scheduler/frontend/ha-api.js` - API layer for service calls

## Notes

- Frontend debouncing (300ms) already implemented in v1.14.2
- Concurrent save prevention already implemented in frontend
- Backend has no write protection currently
- Home Assistant's `Store` class is thread-safe but not async-safe for concurrent writes
- SQLite would be the most robust long-term solution for multi-user scenarios
