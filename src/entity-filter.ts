/**
 * Lovelace card scope for one thermostat or a list of thermostats.
 * A filtered card is a UI scope, not a security boundary: the backend
 * still applies schedules for every assigned entity.
 *
 * `entity` (string or list) and `entities` (list or comma/JSON string)
 * are unioned and de-duplicated. Order is `entity` first, then `entities`.
 * Empty values are ignored. No ids means no filter (house-wide editor).
 */
export function normalizeEntityFilter(source: unknown): string[] | null {
  const ordered: string[] = [];
  const seen = new Set<string>();

  const add = (value: unknown): void => {
    if (typeof value !== 'string') {
      return;
    }
    const id = value.trim();
    if (!id || seen.has(id)) {
      return;
    }
    seen.add(id);
    ordered.push(id);
  };

  const walk = (value: unknown): void => {
    if (value == null) {
      return;
    }
    if (typeof value === 'string') {
      const trimmed = value.trim();
      if (!trimmed) {
        return;
      }
      if (trimmed.startsWith('[')) {
        try {
          walk(JSON.parse(trimmed));
          return;
        } catch {
          // Fall through to a comma-separated list.
        }
      }
      trimmed.split(',').forEach(add);
      return;
    }
    if (Array.isArray(value)) {
      value.forEach(walk);
      return;
    }
    if (typeof value === 'object') {
      const record = value as { entity?: unknown; entities?: unknown };
      if ('entity' in record) {
        walk(record.entity);
      }
      if ('entities' in record) {
        walk(record.entities);
      }
    }
  };

  walk(source);
  return ordered.length ? ordered : null;
}
