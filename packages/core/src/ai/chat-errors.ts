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

const GENERIC_PROVIDER_ERROR = "Provider returned error";

type GatewayErrorBody = {
	error?: {
		message?: unknown;
		metadata?: {
			provider_name?: unknown;
			raw?: unknown;
		};
	};
	message?: unknown;
};

function readString(value: unknown): string | undefined {
	return typeof value === "string" && value.trim().length > 0
		? value.trim()
		: undefined;
}

/**
 * OpenRouter wraps upstream failures as "Provider returned error" and puts the
 * provider text in `error.metadata.raw` (a JSON string or object).
 */
function readUpstreamProviderMessage(
	raw: unknown,
	depth = 0,
): string | undefined {
	if (depth > 3 || raw == null) {
		return undefined;
	}
	if (typeof raw === "string") {
		const trimmed = raw.trim();
		if (!trimmed) {
			return undefined;
		}
		try {
			const parsed: unknown = JSON.parse(trimmed);
			if (parsed && typeof parsed === "object") {
				return (
					readUpstreamProviderMessage(parsed, depth + 1) ??
					trimmed.slice(0, 500)
				);
			}
		} catch {
			return trimmed.slice(0, 500);
		}
		return trimmed.slice(0, 500);
	}
	if (typeof raw === "object") {
		const record = raw as GatewayErrorBody;
		return (
			readUpstreamProviderMessage(record.error, depth + 1) ??
			readString(record.message)?.slice(0, 500)
		);
	}
	return undefined;
}

function parseResponseBodyMessage(responseBody: unknown): string | undefined {
	if (typeof responseBody !== "string" || !responseBody.trim()) {
		return undefined;
	}
	try {
		const parsed = JSON.parse(responseBody) as GatewayErrorBody;
		const message =
			readString(parsed.error?.message) ?? readString(parsed.message);
		const metadata = parsed.error?.metadata;
		const upstream = readUpstreamProviderMessage(metadata?.raw);
		const providerName = readString(metadata?.provider_name);
		if (
			upstream &&
			upstream !== message &&
			upstream !== GENERIC_PROVIDER_ERROR
		) {
			return providerName ? `${providerName}: ${upstream}` : upstream;
		}
		return message;
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
