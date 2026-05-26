/**
 * In-memory rate limiter. Per-key token-bucket-ish: keeps a list of
 * timestamps for each key, prunes anything older than `windowMs`, and
 * rejects when the bucket is full.
 *
 * Suitable for low-volume hot paths (auth endpoints). Not suitable for
 * cluster deployments — each process keeps its own counters. For
 * production at scale, swap to a shared store (Redis / DB-backed).
 *
 * Keys are arbitrary strings; callers usually combine ip + email.
 */
const buckets = new Map<string, number[]>();

export interface RateLimitConfig {
	max: number;
	windowMs: number;
}

export interface RateLimitResult {
	ok: boolean;
	remaining: number;
	retryAfterMs: number;
}

export function checkRateLimit(key: string, config: RateLimitConfig): RateLimitResult {
	const now = Date.now();
	const cutoff = now - config.windowMs;
	const timestamps = (buckets.get(key) ?? []).filter((t) => t > cutoff);

	if (timestamps.length >= config.max) {
		const oldest = timestamps[0];
		return {
			ok: false,
			remaining: 0,
			retryAfterMs: Math.max(0, oldest + config.windowMs - now)
		};
	}

	timestamps.push(now);
	buckets.set(key, timestamps);
	return {
		ok: true,
		remaining: config.max - timestamps.length,
		retryAfterMs: 0
	};
}

/** Clear the in-memory bucket store. Intended for tests. */
export function clearRateLimits(): void {
	buckets.clear();
}

// Periodic cleanup so abandoned keys don't leak memory. Runs every
// 5 min, drops keys whose newest timestamp is more than an hour old.
const CLEANUP_INTERVAL_MS = 5 * 60_000;
const STALE_AFTER_MS = 60 * 60_000;

if (typeof setInterval === 'function') {
	const handle = setInterval(() => {
		const cutoff = Date.now() - STALE_AFTER_MS;
		for (const [key, timestamps] of buckets) {
			const newest = timestamps[timestamps.length - 1] ?? 0;
			if (newest < cutoff) buckets.delete(key);
		}
	}, CLEANUP_INTERVAL_MS);
	// Don't keep the event loop alive just for this.
	if (typeof handle?.unref === 'function') handle.unref();
}
