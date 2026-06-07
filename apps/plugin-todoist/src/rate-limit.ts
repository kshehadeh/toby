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
	if (
		msg.includes("rate limit") ||
		msg.includes("ratelimit") ||
		msg.includes("429") ||
		msg.includes("too many requests") ||
		msg.includes("request limit")
	) {
		return true;
	}
	if (msg.includes("403") && msg.includes("limit")) {
		return true;
	}
	return false;
}

function sleep(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}
