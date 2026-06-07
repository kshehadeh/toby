export interface RateLimitConfig {
	readonly maxConcurrent: number;
	readonly minDelayMs: number;
}

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

interface RateLimitConfigWithKey extends RateLimitConfig {
	readonly key?: string;
}

const semaphoreCache = new Map<string, Semaphore>();
const lastStartCache = new Map<string, { value: number }>();

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

export async function withRateLimit<T>(
	config: RateLimitConfig,
	fn: () => Promise<T>,
): Promise<T> {
	const keyedConfig = config as RateLimitConfigWithKey;
	const semaphore = getSemaphore(keyedConfig);
	const lastStart = getLastStart(keyedConfig.key ?? "default");

	await semaphore.acquire();
	try {
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

export interface RetryOptions {
	readonly maxRetries?: number;
	readonly baseDelayMs?: number;
	readonly maxDelayMs?: number;
}

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

function isRetryableError(err: unknown): boolean {
	if (!(err instanceof Error)) {
		return false;
	}
	const msg = err.message.toLowerCase();
	return (
		msg.includes("rate limit") ||
		msg.includes("ratelimit") ||
		msg.includes("429") ||
		msg.includes("userratelimitexceeded") ||
		msg.includes("ratelimitexceeded") ||
		(msg.includes("403") && msg.includes("limit"))
	);
}

function sleep(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}
