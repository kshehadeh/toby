/**
 * Shared rate-limiting utilities for integration API calls.
 *
 * - `withRateLimit`: bounds concurrency and enforces minimum inter-call delay.
 * - `withRetry`: exponential-backoff with jitter on transient 429/403 errors.
 */

export interface RateLimitConfig {
	/** Maximum number of in-flight requests at any one time. */
	readonly maxConcurrent: number;
	/** Minimum milliseconds between successive call starts. */
	readonly minDelayMs: number;
}

// ---------------------------------------------------------------------------
// Semaphore-style concurrency limiter
// ---------------------------------------------------------------------------

class Semaphore {
	private queue: Array<() => void> = [];

	constructor(private permits: number) {}

	acquire(): Promise<void> {
		if (this.permits > 0) {
			this.permits--;
			return Promise.resolve();
		}
		return new Promise<void>((resolve) => {
			this.queue.push(resolve);
		});
	}

	release(): void {
		const next = this.queue.shift();
		if (next) {
			next();
		} else {
			this.permits++;
		}
	}
}

// ---------------------------------------------------------------------------
// Rate-limited executor
// ---------------------------------------------------------------------------

/**
 * Run `fn` subject to the concurrency and spacing constraints in `config`.
 *
 * Guarantees:
 * - At most `config.maxConcurrent` calls are in flight simultaneously.
 * - At least `config.minDelayMs` elapses between the *start* of consecutive calls.
 */
export async function withRateLimit<T>(
	config: RateLimitConfig,
	fn: () => Promise<T>,
): Promise<T> {
	const keyedConfig = config as RateLimitConfigWithKey;
	const semaphore = getSemaphore(keyedConfig);
	const lastStart = getLastStart(keyedConfig.key ?? "default");

	await semaphore.acquire();
	try {
		// Enforce minimum spacing.
		const elapsed = Date.now() - lastStart.value;
		if (elapsed < config.minDelayMs) {
			await sleep(config.minDelayMs - elapsed);
		}
		lastStart.value = Date.now();
		return await fn();
	} finally {
		semaphore.release();
	}
}

// Per-key singletons so separate call sites share the same semaphore/timestamp.
const semaphoreCache = new Map<string, Semaphore>();
const lastStartCache = new Map<string, { value: number }>();

interface RateLimitConfigWithKey extends RateLimitConfig {
	/** Optional key to share state across separate `withRateLimit` call sites. */
	readonly key?: string;
}

function getSemaphore(config: RateLimitConfigWithKey): Semaphore {
	const key = config.key ?? `c${config.maxConcurrent}_d${config.minDelayMs}`;
	let sem = semaphoreCache.get(key);
	if (!sem) {
		sem = new Semaphore(config.maxConcurrent);
		semaphoreCache.set(key, sem);
	}
	return sem;
}

function getLastStart(key: string): { value: number } {
	let ls = lastStartCache.get(key);
	if (!ls) {
		ls = { value: 0 };
		lastStartCache.set(key, ls);
	}
	return ls;
}

// ---------------------------------------------------------------------------
// Retry with exponential backoff + jitter
// ---------------------------------------------------------------------------

export interface RetryOptions {
	/** Maximum retry attempts (default 5). */
	readonly maxRetries?: number;
	/** Base delay in ms for the first retry (default 1000). */
	readonly baseDelayMs?: number;
	/** Maximum delay cap in ms (default 32_000). */
	readonly maxDelayMs?: number;
}

/**
 * Execute `fn` with automatic retry on transient rate-limit errors (429/403).
 * Uses exponential backoff with random jitter.
 */
export async function withRetry<T>(
	fn: () => Promise<T>,
	opts?: RetryOptions,
): Promise<T> {
	const maxRetries = opts?.maxRetries ?? 5;
	const baseDelayMs = opts?.baseDelayMs ?? 1000;
	const maxDelayMs = opts?.maxDelayMs ?? 32_000;

	let lastError: unknown;
	for (let attempt = 0; attempt <= maxRetries; attempt++) {
		try {
			return await fn();
		} catch (err: unknown) {
			lastError = err;
			if (!isRetryableError(err) || attempt === maxRetries) {
				throw err;
			}
			const delay = Math.min(
				baseDelayMs * 2 ** attempt + Math.random() * 1000,
				maxDelayMs,
			);
			await sleep(delay);
		}
	}
	throw lastError;
}

/**
 * Detect Gmail/Todoist rate-limit errors that are safe to retry.
 */
function isRetryableError(err: unknown): boolean {
	if (!(err instanceof Error)) {
		return false;
	}
	const msg = err.message.toLowerCase();

	// Google API patterns
	if (
		msg.includes("rate limit") ||
		msg.includes("ratelimit") ||
		msg.includes("429") ||
		msg.includes("userRateLimitExceeded") ||
		msg.includes("rateLimitExceeded")
	) {
		return true;
	}

	// Todoist pattern
	if (msg.includes("too many requests") || msg.includes("request limit")) {
		return true;
	}

	// HTTP 403 that is a rate-limit (not a permission error)
	if (msg.includes("403") && msg.includes("limit")) {
		return true;
	}

	return false;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function sleep(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}
