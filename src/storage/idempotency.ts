import type { NormalizedKiwifyEvent } from "../kiwify/schemas";

const processedTtlSeconds = 60 * 60 * 24 * 30;
const lockTtlSeconds = 60;

export function getIdempotencyKey(event: NormalizedKiwifyEvent) {
  return `kiwify:${event.source}:${event.transactionId}:${event.event}`;
}

/**
 * Attempts to reserve an event for processing using a two-step KV lock.
 *
 * Returns:
 *  - `"processed"` if the event was already successfully handled (permanent key exists).
 *  - `"locked"`    if another instance is currently processing the same event.
 *  - `"reserved"`  if this instance acquired the lock and should proceed.
 *
 * SEC-04 (TOCTOU): This lock is **best-effort**, not atomic. Cloudflare KV is
 * eventually consistent, so two concurrent requests can both read a missing lock
 * and proceed simultaneously. For strong idempotency guarantees, migrate this
 * lock to a Cloudflare Durable Object which supports atomic compare-and-swap.
 */
export async function reserveEvent(namespace: KVNamespace, key: string) {
  const processed = await namespace.get(key);
  if (processed) {
    return "processed" as const;
  }

  const lockKey = `${key}:lock`;
  const existingLock = await namespace.get(lockKey);
  if (existingLock) {
    return "locked" as const;
  }

  await namespace.put(lockKey, new Date().toISOString(), { expirationTtl: lockTtlSeconds });
  return "reserved" as const;
}

export async function markEventProcessed(namespace: KVNamespace, key: string) {
  await namespace.put(key, new Date().toISOString(), { expirationTtl: processedTtlSeconds });
  await namespace.delete(`${key}:lock`);
}

export async function releaseEvent(namespace: KVNamespace, key: string) {
  await namespace.delete(`${key}:lock`);
}
