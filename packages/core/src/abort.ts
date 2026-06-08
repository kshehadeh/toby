export function createChatTurnAbortError(): Error {
	const error = new Error("Chat turn aborted");
	error.name = "AbortError";
	return error;
}

export function isAbortError(e: unknown): boolean {
	if (e instanceof DOMException && e.name === "AbortError") return true;
	if (e instanceof Error) {
		if (e.name === "AbortError") return true;
		if (/abort/i.test(e.message)) return true;
	}
	return false;
}

export function throwIfAborted(signal?: AbortSignal): void {
	if (signal?.aborted) {
		throw createChatTurnAbortError();
	}
}

export async function awaitWithAbort<T>(
	promise: Promise<T>,
	signal: AbortSignal | undefined,
): Promise<T> {
	if (!signal) {
		return await promise;
	}
	throwIfAborted(signal);
	return await new Promise<T>((resolve, reject) => {
		const onAbort = () => reject(createChatTurnAbortError());
		signal.addEventListener("abort", onAbort, { once: true });
		promise.then(resolve, reject).finally(() => {
			signal.removeEventListener("abort", onAbort);
		});
	});
}
