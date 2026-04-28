import type { TranscriptEntry } from "./types";

type ToolCallPayload = { readonly blockKey: string; readonly title: string };
type ToolOutputPayload = { readonly blockKey: string; readonly detail: string };
type AskUserQaPayload = {
	readonly blockKey: string;
	readonly query: string;
	readonly answer: string;
	readonly error?: string;
};

/** Serialize a transcript entry for SQLite (`kind` + `text` columns). */
export function serializeTranscriptEntry(e: TranscriptEntry): {
	kind: string;
	text: string;
} {
	if (e.kind === "tool_call") {
		const payload: ToolCallPayload = {
			blockKey: e.blockKey,
			title: e.title,
		};
		return { kind: "tool_call", text: JSON.stringify(payload) };
	}
	if (e.kind === "tool_output") {
		const payload: ToolOutputPayload = {
			blockKey: e.blockKey,
			detail: e.detail,
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
	return { kind: e.kind, text: e.text };
}

/** Parse a DB row into a `TranscriptEntry` (handles legacy rows and corrupt JSON). */
export function deserializeTranscriptRow(row: {
	kind: string;
	text: string;
}): TranscriptEntry {
	if (row.kind === "tool_call") {
		try {
			const p = JSON.parse(row.text) as Partial<ToolCallPayload>;
			if (
				typeof p.blockKey === "string" &&
				p.blockKey.length > 0 &&
				typeof p.title === "string"
			) {
				return { kind: "tool_call", blockKey: p.blockKey, title: p.title };
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
				return { kind: "tool_output", blockKey: p.blockKey, detail: p.detail };
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
