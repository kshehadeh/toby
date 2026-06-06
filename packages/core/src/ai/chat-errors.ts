import { APICallError, NoOutputGeneratedError } from "ai";

function readObjectMessage(value: unknown): string | undefined {
	if (!value || typeof value !== "object") {
		return undefined;
	}
	const message = (value as { message?: unknown }).message;
	return typeof message === "string" && message.trim().length > 0
		? message.trim()
		: undefined;
}

function parseResponseBodyMessage(responseBody: unknown): string | undefined {
	if (typeof responseBody !== "string" || !responseBody.trim()) {
		return undefined;
	}
	try {
		const parsed = JSON.parse(responseBody) as {
			error?: { message?: string };
			message?: string;
		};
		return parsed.error?.message ?? parsed.message;
	} catch {
		return responseBody.slice(0, 500);
	}
}

/** Prefer a human-readable message from AI SDK / gateway failures. */
export function formatChatModelError(
	error: unknown,
	streamError?: unknown,
): string {
	const candidates = [streamError, error];
	for (const candidate of candidates) {
		if (!candidate) continue;

		if (NoOutputGeneratedError.isInstance(candidate)) {
			const fromCause = candidate.cause
				? formatChatModelError(candidate.cause)
				: undefined;
			if (fromCause) return fromCause;
			continue;
		}

		if (APICallError.isInstance(candidate)) {
			const fromBody = parseResponseBodyMessage(candidate.responseBody);
			if (fromBody) return fromBody;
			if (
				typeof candidate.message === "string" &&
				candidate.message !== "[object Object]"
			) {
				return candidate.message;
			}
		}

		if (candidate instanceof Error) {
			const nested = readObjectMessage(
				(candidate as Error & { data?: unknown }).data,
			);
			if (nested) return nested;

			const fromBody = parseResponseBodyMessage(
				(candidate as Error & { responseBody?: unknown }).responseBody,
			);
			if (fromBody) return fromBody;

			if (candidate.message && candidate.message !== "[object Object]") {
				return candidate.message;
			}
		}

		if (typeof candidate === "string" && candidate.trim()) {
			return candidate.trim();
		}
	}

	if (NoOutputGeneratedError.isInstance(error)) {
		return "The model returned no output. This usually means the provider rejected the request — check AI credentials, model settings, and account credits.";
	}

	if (error instanceof Error && error.message) {
		return error.message;
	}

	return String(error);
}

export function enrichChatModelError(
	error: unknown,
	streamError?: unknown,
): Error {
	const message = formatChatModelError(error, streamError);
	if (error instanceof Error && error.message === message) {
		return error;
	}
	const wrapped = new Error(message);
	if (error instanceof Error) {
		wrapped.cause = streamError ?? error;
	}
	return wrapped;
}
