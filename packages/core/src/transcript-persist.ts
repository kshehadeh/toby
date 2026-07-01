import type { TranscriptEntry } from "./chat-pipeline/transcript-types";

type ToolCallPayload = {
	readonly blockKey: string;
	readonly title: string;
	readonly toolName?: string;
};
type ToolOutputPayload = {
	readonly blockKey: string;
	readonly detail: string;
	readonly toolName?: string;
};
type AskUserQaPayload = {
	readonly blockKey: string;
	readonly query: string;
	readonly answer: string;
	readonly error?: string;
};

type NoticePayload = {
	readonly text: string;
	readonly tone?: "info" | "success" | "error";
};

type BoxedStepPayload = {
	readonly id: string;
	readonly seq: number;
	readonly variant:
		| "prep"
		| "lifecycle"
		| "assistant"
		| "assistant_interim"
		| "tool"
		| "plan"
		| "thinking";
	readonly header: string;
	readonly body: string;
	readonly toolBlockKey?: string;
	readonly toolName?: string;
	readonly integrationLabel?: string;
	readonly cacheHit?: boolean;
	readonly durationMs?: number;
	readonly toolRuns?: readonly {
		readonly blockKey: string;
		readonly header: string;
		readonly body: string;
		readonly cacheHit?: boolean;
		readonly durationMs?: number;
	}[];
};

/** Serialize a transcript entry for SQLite (`kind` + `text` columns). */
export function serializeTranscriptEntry(e: TranscriptEntry): {
	kind: string;
	text: string;
} {
	if (e.kind === "boxed_step") {
		const payload: BoxedStepPayload = {
			id: e.id,
			seq: e.seq,
			variant: e.variant,
			header: e.header,
			body: e.body,
			...(e.toolBlockKey !== undefined ? { toolBlockKey: e.toolBlockKey } : {}),
			...(e.toolName !== undefined ? { toolName: e.toolName } : {}),
			...(e.integrationLabel !== undefined
				? { integrationLabel: e.integrationLabel }
				: {}),
			...(e.cacheHit !== undefined ? { cacheHit: e.cacheHit } : {}),
			...(e.durationMs !== undefined ? { durationMs: e.durationMs } : {}),
			...(e.toolRuns !== undefined ? { toolRuns: e.toolRuns } : {}),
		};
		return { kind: "boxed_step", text: JSON.stringify(payload) };
	}
	if (e.kind === "tool_call") {
		const payload: ToolCallPayload = {
			blockKey: e.blockKey,
			title: e.title,
			...(e.toolName !== undefined ? { toolName: e.toolName } : {}),
		};
		return { kind: "tool_call", text: JSON.stringify(payload) };
	}
	if (e.kind === "tool_output") {
		const payload: ToolOutputPayload = {
			blockKey: e.blockKey,
			detail: e.detail,
			...(e.toolName !== undefined ? { toolName: e.toolName } : {}),
		};
		return { kind: "tool_output", text: JSON.stringify(payload) };
	}
	if (e.kind === "ask_user_qa") {
		const payload: AskUserQaPayload = {
			blockKey: e.blockKey,
			query: e.query,
			answer: e.answer,
			...(e.error !== undefined ? { error: e.error } : {}),
		};
		return { kind: "ask_user_qa", text: JSON.stringify(payload) };
	}
	if (e.kind === "notice") {
		const payload: NoticePayload = {
			text: e.text,
			...(e.tone !== undefined ? { tone: e.tone } : {}),
		};
		return { kind: "notice", text: JSON.stringify(payload) };
	}
	if (e.kind === "turn_work") {
		return {
			kind: "turn_work",
			text: JSON.stringify({ durationMs: e.durationMs }),
		};
	}
	return { kind: e.kind, text: e.text };
}

/** Parse a DB row into a `TranscriptEntry` (handles legacy rows and corrupt JSON). */
export function deserializeTranscriptRow(row: {
	kind: string;
	text: string;
}): TranscriptEntry {
	if (row.kind === "boxed_step") {
		try {
			const p = JSON.parse(row.text) as Partial<BoxedStepPayload>;
			if (
				typeof p.id === "string" &&
				p.id.length > 0 &&
				typeof p.seq === "number" &&
				(p.variant === "prep" ||
					p.variant === "lifecycle" ||
					p.variant === "assistant" ||
					p.variant === "assistant_interim" ||
					p.variant === "tool" ||
					p.variant === "plan" ||
					p.variant === "thinking") &&
				typeof p.header === "string" &&
				typeof p.body === "string"
			) {
				return {
					kind: "boxed_step",
					id: p.id,
					seq: p.seq,
					variant: p.variant,
					header: p.header,
					body: p.body,
					...(typeof p.toolBlockKey === "string"
						? { toolBlockKey: p.toolBlockKey }
						: {}),
					...(typeof p.toolName === "string" ? { toolName: p.toolName } : {}),
					...(typeof p.integrationLabel === "string"
						? { integrationLabel: p.integrationLabel }
						: {}),
					...(typeof p.cacheHit === "boolean" ? { cacheHit: p.cacheHit } : {}),
					...(typeof p.durationMs === "number" && Number.isFinite(p.durationMs)
						? { durationMs: Math.max(0, p.durationMs) }
						: {}),
					...(Array.isArray(p.toolRuns)
						? {
								toolRuns: p.toolRuns
									.filter(
										(
											run,
										): run is {
											blockKey: string;
											header: string;
											body: string;
											cacheHit?: boolean;
											durationMs?: number;
										} =>
											typeof run?.blockKey === "string" &&
											run.blockKey.length > 0 &&
											typeof run.header === "string" &&
											typeof run.body === "string" &&
											(run.cacheHit === undefined ||
												typeof run.cacheHit === "boolean") &&
											(run.durationMs === undefined ||
												(typeof run.durationMs === "number" &&
													Number.isFinite(run.durationMs))),
									)
									.map((run) => ({
										blockKey: run.blockKey,
										header: run.header,
										body: run.body,
										...(typeof run.cacheHit === "boolean"
											? { cacheHit: run.cacheHit }
											: {}),
										...(typeof run.durationMs === "number" &&
										Number.isFinite(run.durationMs)
											? { durationMs: Math.max(0, run.durationMs) }
											: {}),
									})),
							}
						: {}),
				};
			}
		} catch {
			// fall through
		}
		return { kind: "meta", text: row.text };
	}
	if (row.kind === "tool_call") {
		try {
			const p = JSON.parse(row.text) as Partial<ToolCallPayload>;
			if (
				typeof p.blockKey === "string" &&
				p.blockKey.length > 0 &&
				typeof p.title === "string"
			) {
				return {
					kind: "tool_call",
					blockKey: p.blockKey,
					title: p.title,
					...(typeof p.toolName === "string" ? { toolName: p.toolName } : {}),
				};
			}
		} catch {
			// fall through
		}
		return { kind: "meta", text: row.text };
	}
	if (row.kind === "tool_output") {
		try {
			const p = JSON.parse(row.text) as Partial<ToolOutputPayload>;
			if (
				typeof p.blockKey === "string" &&
				p.blockKey.length > 0 &&
				typeof p.detail === "string"
			) {
				return {
					kind: "tool_output",
					blockKey: p.blockKey,
					detail: p.detail,
					...(typeof p.toolName === "string" ? { toolName: p.toolName } : {}),
				};
			}
		} catch {
			// fall through
		}
		return { kind: "meta", text: row.text };
	}
	if (row.kind === "ask_user_qa") {
		try {
			const p = JSON.parse(row.text) as Partial<AskUserQaPayload>;
			if (
				typeof p.blockKey === "string" &&
				p.blockKey.length > 0 &&
				typeof p.query === "string" &&
				typeof p.answer === "string"
			) {
				return {
					kind: "ask_user_qa",
					blockKey: p.blockKey,
					query: p.query,
					answer: p.answer,
					...(typeof p.error === "string" ? { error: p.error } : {}),
				};
			}
		} catch {
			// fall through
		}
		return { kind: "meta", text: row.text };
	}
	if (row.kind === "notice") {
		try {
			const p = JSON.parse(row.text) as Partial<NoticePayload>;
			if (typeof p.text === "string") {
				return {
					kind: "notice",
					text: p.text,
					...(p.tone === "info" || p.tone === "success" || p.tone === "error"
						? { tone: p.tone }
						: {}),
				};
			}
		} catch {
			// fall through — legacy plain-text notice rows
		}
		return { kind: "notice", text: row.text };
	}
	if (row.kind === "turn_work") {
		try {
			const p = JSON.parse(row.text) as { durationMs?: number };
			if (typeof p.durationMs === "number" && Number.isFinite(p.durationMs)) {
				return { kind: "turn_work", durationMs: Math.max(0, p.durationMs) };
			}
		} catch {
			// fall through
		}
		return { kind: "meta", text: row.text };
	}
	if (
		row.kind === "user" ||
		row.kind === "assistant" ||
		row.kind === "meta" ||
		row.kind === "error"
	) {
		return { kind: row.kind, text: row.text };
	}
	return { kind: "meta", text: row.text };
}
