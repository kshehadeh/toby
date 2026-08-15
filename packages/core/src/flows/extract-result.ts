import type { FlowDocument, FlowResultPointer } from "./document-types";
import { getByPath } from "./resolve-inputs";
import type { FlowContextBag } from "./types";

export type FlowResultFormat = "markdown" | "plain" | "json";

export type ExtractedFlowResult = {
	readonly text: string;
	readonly format: FlowResultFormat;
	readonly pointer: FlowResultPointer;
};

function firstBagKeyForPath(
	outputs: Readonly<Record<string, string>> | undefined,
	preferredPath: string,
	fallbackKey: string,
): string {
	if (!outputs) return fallbackKey;
	const match = Object.entries(outputs).find(
		([, path]) => path === preferredPath || path === "." || path === "",
	);
	if (match) return match[0];
	const keys = Object.keys(outputs);
	return keys[0] ?? fallbackKey;
}

/** Infer which bag slice is the flow’s declared result. */
export function inferResultPointer(document: FlowDocument): FlowResultPointer {
	if (document.result?.from.trim()) {
		return {
			from: document.result.from.trim(),
			...(document.result.path !== undefined
				? { path: document.result.path }
				: {}),
		};
	}

	const last = document.nodes[document.nodes.length - 1];
	if (!last) {
		return { from: "result" };
	}

	if (last.type === "llm_prompter") {
		const from = firstBagKeyForPath(last.outputs, "object", "object");
		return { from, path: "markdown" };
	}

	const from = firstBagKeyForPath(last.outputs, "result", "result");
	return { from };
}

function stringList(value: unknown): string[] | null {
	if (!Array.isArray(value) || value.length === 0) return null;
	if (!value.every((item) => typeof item === "string" && item.trim())) {
		return null;
	}
	return value.map((item) => (item as string).trim());
}

function looksLikeMarkdown(text: string): boolean {
	return /(^|\n)\s{0,3}#{1,6}\s|(^|\n)\s*[-*]\s|\*\*[^*]+\*\*|`[^`]+`/.test(
		text,
	);
}

function prettyJson(value: unknown): string {
	try {
		return JSON.stringify(value, null, 2);
	} catch {
		return String(value);
	}
}

function renderValue(
	value: unknown,
	options?: { readonly lastNodeResult?: unknown },
): { text: string; format: FlowResultFormat } {
	if (typeof value === "string") {
		const text = value.trim();
		return {
			text,
			format: looksLikeMarkdown(text) ? "markdown" : "plain",
		};
	}

	if (value && typeof value === "object") {
		const record = value as Record<string, unknown>;
		if (typeof record.markdown === "string" && record.markdown.trim()) {
			return { text: record.markdown.trim(), format: "markdown" };
		}
		const actions = stringList(record.appliedActions);
		if (actions) {
			return { text: actions.join("\n"), format: "plain" };
		}
		if (typeof record.message === "string" && record.message.trim()) {
			return { text: record.message.trim(), format: "plain" };
		}
	}

	const last = options?.lastNodeResult;
	if (last && typeof last === "object" && last !== null) {
		const actions = stringList(
			(last as { appliedActions?: unknown }).appliedActions,
		);
		if (actions) {
			return { text: actions.join("\n"), format: "plain" };
		}
	}

	if (value === undefined || value === null) {
		return { text: "", format: "plain" };
	}

	if (value && typeof value === "object") {
		return { text: prettyJson(value), format: "json" };
	}

	return { text: String(value), format: "plain" };
}

/**
 * Pull the declared (or inferred) result out of a finished run’s context bag.
 * Pass `lastNodeResult` so tool `appliedActions` can become the prose when the
 * bag only holds the plugin `result` payload.
 */
export function extractFlowResult(
	bag: Readonly<FlowContextBag>,
	document: FlowDocument,
	options?: { readonly lastNodeResult?: unknown },
): ExtractedFlowResult {
	const pointer = inferResultPointer(document);
	const root = bag[pointer.from];
	const value = getByPath(root, pointer.path);
	const rendered = renderValue(value, options);
	const format =
		pointer.path === "markdown" && rendered.text ? "markdown" : rendered.format;
	return {
		text: rendered.text,
		format,
		pointer,
	};
}
