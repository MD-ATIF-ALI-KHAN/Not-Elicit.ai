import "server-only";

// A small in-memory limiter for authentication attempts. It is per server
// process, which suits a single self-hosted instance.

const buckets = new Map<string, number[]>();

/** Records an attempt; returns false when `limit` attempts already happened within `windowMs`. */
export function allowAttempt(key: string, limit: number, windowMs: number, now = Date.now()): boolean {
  const recent = (buckets.get(key) ?? []).filter((time) => now - time < windowMs);
  if (recent.length >= limit) {
    buckets.set(key, recent);
    return false;
  }
  recent.push(now);
  buckets.set(key, recent);
  // Keep memory bounded if many distinct keys are seen.
  if (buckets.size > 10_000) {
    for (const [k, times] of buckets) if (times.every((time) => now - time >= windowMs)) buckets.delete(k);
  }
  return true;
}

export function resetAttempts(key: string): void {
  buckets.delete(key);
}
