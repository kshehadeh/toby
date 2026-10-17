import type { ToolDisplayArgs } from "./transcript-types";

/**
 * Tool step presentation: how a tool call is rendered in the transcript.
 *
 * Tools (core or plugin) declare a presentation `kind`; Toby.app maps each
 * kind to a native step renderer that draws the title, argument chips, the
 * transient live-progress rail, and the completion summary. Plugins cannot
 * ship native views, so this is a data contract, not a view contract.
 */

export const TOOL_PRESENTATION_KINDS = [
	"search",
	"read",
	"write",
	"list",
	"fetch",
	"action",
	"agent",
	"generic",
] as const;

export type ToolPresentationKind = (typeof TOOL_PRESENTATION_KINDS)[number];

export type ToolPresentation = {
	readonly kind: ToolPresentationKind;
	/** Title while running and after completion, e.g. ["Searching tasks", "Searched tasks"]. */
	readonly verbs?: readonly [string, string];
	/** Argument keys to surface as chips, in display order. Defaults per kind. */
	readonly argChips?: readonly string[];
	/** Argument key holding the primary subject (query, path, URL). */
	readonly primaryArg?: string;
};

export type ToolProgressItemState = "waiting" | "running" | "done" | "failed";

/** One transient sub-item on a running tool step's live rail. */
export type ToolProgressItem = {
	/** Stable id; later updates with the same id replace the item. */
	readonly id: string;
	readonly label: string;
	readonly state: ToolProgressItemState;
	/** Trailing detail, e.g. "8 results" or "212 scanned". */
	readonly detail?: string;
	readonly url?: string;
};

export type ToolProgressUpdate = {
	readonly items?: readonly ToolProgressItem[];
	/** Overall completion between 0 and 1, when the tool can measure it. */
	readonly fraction?: number;
};

const CORE_TOOL_PRESENTATIONS: Record<string, ToolPresentation> = {
	webSearch: {
		kind: "search",
		verbs: ["Searching the web", "Searched the web"],
		argChips: ["query", "search_recency_filter", "country"],
		primaryArg: "query",
	},
	fetchWebContent: {
		kind: "fetch",
		verbs: ["Fetching page", "Fetched page"],
		argChips: ["url"],
		primaryArg: "url",
	},
	readPdf: {
		kind: "read",
		verbs: ["Reading PDF", "Read PDF"],
		argChips: ["url", "path"],
	},
	memorySearch: {
		kind: "search",
		verbs: ["Searching memory", "Searched memory"],
		argChips: ["query"],
		primaryArg: "query",
	},
	memoryRetrieveForTask: {
		kind: "search",
		verbs: ["Recalling memories", "Recalled memories"],
	},
	find_in_library: {
		kind: "search",
		verbs: ["Searching library", "Searched library"],
		argChips: ["query", "id"],
		primaryArg: "query",
	},
	searchProjectFiles: {
		kind: "search",
		verbs: ["Searching project files", "Searched project files"],
		argChips: ["query", "pathPrefix"],
		primaryArg: "query",
	},
	listProjectFiles: {
		kind: "list",
		verbs: ["Listing project files", "Listed project files"],
		argChips: ["path"],
	},
	readProjectFile: {
		kind: "read",
		verbs: ["Reading project file", "Read project file"],
		argChips: ["path"],
		primaryArg: "path",
	},
	readTranscript: {
		kind: "read",
		verbs: ["Reading transcript", "Read transcript"],
	},
	writeTextFile: {
		kind: "write",
		verbs: ["Writing file", "Wrote file"],
		argChips: ["path", "location"],
		primaryArg: "path",
	},
	getWeather: {
		kind: "fetch",
		verbs: ["Checking weather", "Checked weather"],
		argChips: ["location", "date"],
	},
	delegateToSubAgent: {
		kind: "agent",
		verbs: ["Delegating", "Delegated"],
		argChips: ["task"],
		primaryArg: "task",
	},
};

const pluginToolPresentations = new Map<string, ToolPresentation>();

export function isToolPresentationKind(
	value: unknown,
): value is ToolPresentationKind {
	return (
		typeof value === "string" &&
		(TOOL_PRESENTATION_KINDS as readonly string[]).includes(value)
	);
}

/** Validate an untrusted (plugin-supplied) presentation; drops invalid fields. */
export function parseToolPresentation(
	value: unknown,
): ToolPresentation | undefined {
	if (!value || typeof value !== "object" || Array.isArray(value)) {
		return undefined;
	}
	const raw = value as Record<string, unknown>;
	if (!isToolPresentationKind(raw.kind)) {
		return undefined;
	}
	const verbs =
		Array.isArray(raw.verbs) &&
		raw.verbs.length === 2 &&
		raw.verbs.every((v) => typeof v === "string" && v.trim().length > 0)
			? ([raw.verbs[0], raw.verbs[1]] as [string, string])
			: undefined;
	const argChips = Array.isArray(raw.argChips)
		? raw.argChips.filter((k): k is string => typeof k === "string")
		: undefined;
	const primaryArg =
		typeof raw.primaryArg === "string" ? raw.primaryArg : undefined;
	return {
		kind: raw.kind,
		...(verbs ? { verbs } : {}),
		...(argChips && argChips.length > 0 ? { argChips } : {}),
		...(primaryArg ? { primaryArg } : {}),
	};
}

const PROGRESS_STATES: readonly ToolProgressItemState[] = [
	"waiting",
	"running",
	"done",
	"failed",
];
const MAX_PROGRESS_ITEMS = 20;

/** Validate an untrusted progress update (plugin stderr). Invalid items are dropped. */
export function parsePluginProgress(value: unknown): ToolProgressUpdate {
	if (!value || typeof value !== "object" || Array.isArray(value)) return {};
	const raw = value as Record<string, unknown>;
	const items: ToolProgressItem[] = [];
	if (Array.isArray(raw.items)) {
		for (const entry of raw.items.slice(0, MAX_PROGRESS_ITEMS)) {
			if (!entry || typeof entry !== "object") continue;
			const item = entry as Record<string, unknown>;
			if (typeof item.id !== "string" || typeof item.label !== "string") {
				continue;
			}
			const state = PROGRESS_STATES.includes(
				item.state as ToolProgressItemState,
			)
				? (item.state as ToolProgressItemState)
				: "running";
			items.push({
				id: item.id,
				label: item.label.slice(0, 200),
				state,
				...(typeof item.detail === "string"
					? { detail: item.detail.slice(0, 80) }
					: {}),
				...(typeof item.url === "string" ? { url: item.url } : {}),
			});
		}
	}
	const fraction =
		typeof raw.fraction === "number" && Number.isFinite(raw.fraction)
			? raw.fraction
			: undefined;
	return {
		...(items.length > 0 ? { items } : {}),
		...(fraction !== undefined ? { fraction } : {}),
	};
}

/** Register presentations from a plugin's `tools list` response. */
export function registerPluginToolPresentations(
	tools: ReadonlyArray<{
		readonly name: string;
		readonly presentation?: unknown;
	}>,
): void {
	for (const t of tools) {
		const presentation = parseToolPresentation(t.presentation);
		if (presentation) {
			pluginToolPresentations.set(t.name, presentation);
		}
	}
}

/** Clear plugin-registered presentations (used in tests). */
export function clearPluginToolPresentations(): void {
	pluginToolPresentations.clear();
}

export function getToolPresentation(
	toolName: string,
): ToolPresentation | undefined {
	return (
		pluginToolPresentations.get(toolName) ?? CORE_TOOL_PRESENTATIONS[toolName]
	);
}

const MAX_ARG_STRING = 240;
const MAX_ARG_ARRAY = 8;
const MAX_ARG_KEYS = 12;

/**
 * Reduce tool args to small display-safe scalars for the persisted transcript.
 * Long strings are truncated; nested objects and large payloads (file content)
 * are dropped so transcripts stay compact.
 */
export function sanitizeToolArgsForDisplay(
	args: Record<string, unknown>,
): ToolDisplayArgs | undefined {
	const out: Record<string, string | number | boolean | string[]> = {};
	let count = 0;
	for (const [key, value] of Object.entries(args)) {
		if (count >= MAX_ARG_KEYS) break;
		if (key === "content" || key === "dataBase64" || key === "body") continue;
		if (typeof value === "string") {
			const trimmed = value.trim();
			if (!trimmed) continue;
			out[key] =
				trimmed.length > MAX_ARG_STRING
					? `${trimmed.slice(0, MAX_ARG_STRING - 1)}…`
					: trimmed;
		} else if (typeof value === "number" || typeof value === "boolean") {
			out[key] = value;
		} else if (Array.isArray(value)) {
			const strings = value
				.filter(
					(v): v is string | number =>
						typeof v === "string" || typeof v === "number",
				)
				.slice(0, MAX_ARG_ARRAY)
				.map((v) => {
					const s = String(v).trim();
					return s.length > MAX_ARG_STRING
						? `${s.slice(0, MAX_ARG_STRING - 1)}…`
						: s;
				})
				.filter((s) => s.length > 0);
			if (strings.length === 0) continue;
			out[key] = strings;
		} else {
			continue;
		}
		count += 1;
	}
	return count > 0 ? out : undefined;
}

function hostOf(url: unknown): string | undefined {
	if (typeof url !== "string") return undefined;
	try {
		return new URL(url).hostname.replace(/^www\./, "");
	} catch {
		return undefined;
	}
}

/**
 * Renderer-shaped one-line summary for a completed call, or `undefined` to
 * fall back to the generic output formatter.
 */
export function formatToolPresentationSummary(
	toolName: string,
	result: unknown,
	error: unknown,
): string | undefined {
	if (error !== undefined && error !== null) return undefined;
	if (!result || typeof result !== "object" || Array.isArray(result)) {
		return undefined;
	}
	const record = result as Record<string, unknown>;
	if (typeof record.error === "string" && record.error.trim()) return undefined;
	if (toolName === "webSearch") {
		const results = Array.isArray(record.results) ? record.results : [];
		if (results.length === 0) return "No results";
		const hosts: string[] = [];
		for (const r of results) {
			const host =
				r && typeof r === "object"
					? hostOf((r as Record<string, unknown>).url)
					: undefined;
			if (host && !hosts.includes(host)) hosts.push(host);
		}
		const noun = results.length === 1 ? "result" : "results";
		if (hosts.length === 0) return `${results.length} ${noun}`;
		const shown = hosts.slice(0, 2).join(", ");
		const more = hosts.length > 2 ? ` +${hosts.length - 2}` : "";
		return `${results.length} ${noun} · ${shown}${more}`;
	}
	return undefined;
}
