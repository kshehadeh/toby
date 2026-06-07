type JsonRecord = Record<string, unknown>;

export function readStdin(): Promise<string> {
	return new Promise((resolve) => {
		const chunks: Buffer[] = [];
		process.stdin.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
		process.stdin.on("end", () =>
			resolve(Buffer.concat(chunks).toString("utf8")),
		);
		if (process.stdin.isTTY) {
			resolve("");
		}
	});
}

export function parseEnvelope(raw: string): {
	config: JsonRecord;
	state: JsonRecord;
	validateTools: boolean;
} {
	if (!raw.trim()) {
		return { config: {}, state: {}, validateTools: false };
	}
	try {
		const parsed = JSON.parse(raw) as JsonRecord;
		const config =
			parsed.config &&
			typeof parsed.config === "object" &&
			!Array.isArray(parsed.config)
				? (parsed.config as JsonRecord)
				: {};
		const state =
			parsed.state &&
			typeof parsed.state === "object" &&
			!Array.isArray(parsed.state)
				? (parsed.state as JsonRecord)
				: {};
		return {
			config,
			state,
			validateTools: Boolean(parsed.validateTools),
		};
	} catch {
		emitError("Invalid JSON on stdin", "invalid_input", 2);
	}
}

export function emitJson(payload: JsonRecord, exitCode = 0): never {
	process.stdout.write(`${JSON.stringify(payload)}\n`);
	process.exit(exitCode);
}

export function emitError(message: string, code: string, exitCode: 1 | 2 = 1): never {
	emitJson({ ok: false, error: message, code }, exitCode);
}
