/**
 * A short-lived in-memory cache for expensive summary numbers (dashboard and
 * analytics totals) that do not need to be exact to the second. Per server
 * instance and per practice; entries expire on their own, and concurrent
 * callers share one computation. Put dataStamp() (server/data-stamp.ts) in
 * the key so a posting or a new claim shows at once. Never use it for anything
 * a user just changed and expects to see exactly, such as a claim's status or
 * a balance on a patient page.
 */
const store = new Map<string, { until: number; value: Promise<unknown> }>();
const MAX_ENTRIES = 500;

export function memo<T>(key: string, ttlMs: number, compute: () => Promise<T>, now = Date.now()): Promise<T> {
  const hit = store.get(key);
  if (hit && hit.until > now) return hit.value as Promise<T>;
  if (store.size >= MAX_ENTRIES) for (const [k, v] of store) if (v.until <= now || store.size >= MAX_ENTRIES) store.delete(k);
  const value = compute().catch((e) => {
    store.delete(key);
    throw e;
  });
  store.set(key, { until: now + ttlMs, value });
  return value;
}

export function forget(prefix: string) {
  for (const k of store.keys()) if (k.startsWith(prefix)) store.delete(k);
}
