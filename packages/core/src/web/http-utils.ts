export function jsonResponse(data: unknown, status = 200): Response {
	return new Response(JSON.stringify(data), {
		status,
		headers: {
			"Content-Type": "application/json; charset=utf-8",
		},
	});
}

export function errorResponse(message: string, status = 400): Response {
	return jsonResponse({ error: message }, status);
}

export async function readJsonBody<T extends Record<string, unknown>>(
	req: Request,
): Promise<T | null> {
	try {
		const text = await req.text();
		if (!text.trim()) return {} as T;
		return JSON.parse(text) as T;
	} catch {
		return null;
	}
}

export function parseIntParam(
	value: string | null,
	defaultValue: number,
	max: number,
): number {
	if (!value) return defaultValue;
	const n = Number.parseInt(value, 10);
	if (!Number.isFinite(n) || n < 1) return defaultValue;
	return Math.min(n, max);
}
