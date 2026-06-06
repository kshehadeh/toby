/**
 * On Windows, large model downloads often fail at the final rename step
 * (`.tmp.<pid>.<hash>` -> `model.onnx`) when Defender, the Search Indexer,
 * or another process briefly holds the file open. The OS surfaces this as
 * `EPERM` / `EACCES` / `EBUSY` mentioning `rename`. A short backoff retry
 * absorbs the transient lock without changing any user-visible behavior on
 * the happy path.
 */
export function isWindowsRenameLockError(err: unknown): boolean {
	const message =
		err instanceof Error
			? err.message
			: typeof err === "string"
				? err
				: undefined;
	if (!message) return false;
	return /(EPERM|EACCES|EBUSY)[\s\S]*rename/i.test(message);
}

export interface WindowsRenameRetryOptions {
	readonly attempts?: number;
	readonly baseDelayMs?: number;
	readonly onRetry?: (attempt: number, error: unknown) => void;
}

export async function withWindowsRenameRetry<T>(
	fn: () => Promise<T>,
	options?: WindowsRenameRetryOptions,
): Promise<T> {
	const attempts = Math.max(1, options?.attempts ?? 4);
	const baseDelayMs = Math.max(0, options?.baseDelayMs ?? 250);
	let lastError: unknown;
	for (let attempt = 0; attempt < attempts; attempt++) {
		try {
			return await fn();
		} catch (err) {
			lastError = err;
			if (!isWindowsRenameLockError(err) || attempt === attempts - 1) {
				throw err;
			}
			options?.onRetry?.(attempt + 1, err);
			const delay = baseDelayMs * 2 ** attempt;
			await new Promise((resolve) => setTimeout(resolve, delay));
		}
	}
	throw lastError;
}
