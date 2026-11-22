import type { CoreMessage } from "../ai/chat";
import { getDashboardCategory } from "../dashboard/index";
import {
	executeNamedTool,
	listModuleToolDefinitions,
} from "../flows/tool-resolve";
import { isNodeVisible } from "../graph/query";
import { listNodes } from "../graph/store";
import { getIntegrationModules } from "../integrations/index";
import { daemonLog } from "../logging/daemon-log";
import { listChatSessions, loadChatSession } from "../session-store";
import { listTodos } from "../todos/service";
import { findObservation } from "./store";
import {
	ACTIVITY_RECENT_STANDARD_TOOL,
	type ActivityRecentInput,
	type ActivityRecentResult,
	type ObservationInput,
	observationInputSchema,
} from "./types";

/** One place observations come from: a plugin's `activity.recent` tool or a core adapter. */
export interface ObservationSource {
	readonly id: string;
	readonly displayName: string;
	readonly origin: "plugin" | "core";
	/** Whether the source is on when config doesn't say. */
	readonly defaultEnabled: boolean;
	/**
	 * Evidence-only sources feed completion checks but never open follow-ups
	 * on their own (e.g. the user's own Toby chats).
	 */
	readonly evidenceOnly?: boolean;
	collect(input: ActivityRecentInput): Promise<ActivityRecentResult>;
}

export const TOBY_CHAT_SOURCE_ID = "toby.chat";
export const TOBY_TODOS_SOURCE_ID = "toby.todos";
export const CALENDAR_SOURCE_ID = "calendar";
export const MEMORY_SOURCE_ID = "memory";
/** The user's own identity inside Toby chats. */
export const TOBY_SELF_HANDLE = "toby-user";

export function pluginSourceId(moduleName: string): string {
	return `plugin:${moduleName}`;
}

/** Validate each observation separately so one bad item doesn't drop a batch. */
export function parseActivityResult(raw: unknown): {
	readonly result: ActivityRecentResult;
	readonly invalid: number;
} {
	const record =
		raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
	const list = Array.isArray(record.observations) ? record.observations : [];
	const observations: ObservationInput[] = [];
	let invalid = 0;
	for (const item of list.slice(0, 1000)) {
		const parsed = observationInputSchema.safeParse(item);
		if (parsed.success) observations.push(parsed.data);
		else invalid++;
	}
	const selfRaw =
		record.self && typeof record.self === "object"
			? (record.self as Record<string, unknown>)
			: {};
	const strings = (v: unknown) =>
		Array.isArray(v)
			? v.filter((x): x is string => typeof x === "string").slice(0, 50)
			: [];
	return {
		result: {
			observations,
			self: {
				emails: strings(selfRaw.emails),
				handles: strings(selfRaw.handles),
			},
		},
		invalid,
	};
}

function pluginSource(
	moduleName: string,
	displayName: string,
	toolName: string,
): ObservationSource {
	return {
		id: pluginSourceId(moduleName),
		displayName,
		origin: "plugin",
		defaultEnabled: true,
		async collect(input) {
			const exec = await executeNamedTool({
				moduleName,
				toolName,
				input: { since: input.since, limit: input.limit ?? 200 },
				standardTool: ACTIVITY_RECENT_STANDARD_TOOL,
			});
			if (!exec.ok) throw new Error(exec.error ?? "activity.recent failed");
			const errorField = (exec.result as { error?: unknown } | null)?.error;
			if (typeof errorField === "string") throw new Error(errorField);
			const { result, invalid } = parseActivityResult(exec.result);
			if (invalid > 0) {
				daemonLog("warn", "plugin", "activity_recent_invalid_items", {
					plugin: moduleName,
					invalid,
				});
			}
			return result;
		},
	};
}

function messageText(message: CoreMessage): string {
	const content = (message as { content?: unknown }).content;
	if (typeof content === "string") return content;
	if (!Array.isArray(content)) return "";
	return content
		.map((part) =>
			part &&
			typeof part === "object" &&
			(part as { type?: string }).type === "text"
				? String((part as { text?: unknown }).text ?? "")
				: "",
		)
		.join(" ");
}

/**
 * The user's own words in Toby chats ("I sent Dana the deck"). External
 * (Slack-inbound) sessions are skipped: those turns are other people's.
 * Messages carry no timestamp, so new ones take the session's update time.
 * Existing turns retain their first observed occurrence time.
 */
export const tobyChatSource: ObservationSource = {
	id: TOBY_CHAT_SOURCE_ID,
	displayName: "Toby chats",
	origin: "core",
	defaultEnabled: true,
	evidenceOnly: true,
	async collect(input) {
		const observations: ObservationInput[] = [];
		const sessions = listChatSessions(100).filter(
			(s) => s.updatedAt >= input.since && !s.sourceIntegration,
		);
		for (const session of sessions) {
			const loaded = loadChatSession(session.id);
			if (!loaded) continue;
			loaded.messages.forEach((message, index) => {
				if (message.role !== "user") return;
				const text = messageText(message).replace(/\s+/g, " ").trim();
				if (text.length < 8) return;
				const externalId = `${session.id}:${index}`;
				const occurredAt =
					findObservation(TOBY_CHAT_SOURCE_ID, externalId)?.occurredAt ??
					session.updatedAt;
				observations.push({
					externalId,
					kind: "chat.message",
					threadId: session.id,
					direction: "outbound",
					occurredAt,
					title: text.slice(0, 160),
					excerpt: text.slice(0, 2000),
					url: `toby://chat/${session.id}`,
					actors: [{ role: "author", handle: TOBY_SELF_HANDLE, name: "You" }],
					facts: { tobyChat: true },
				});
			});
		}
		return {
			// Oldest first so a truncated page can be resumed from its newest item.
			observations: observations
				.sort((a, b) => a.occurredAt.localeCompare(b.occurredAt))
				.slice(0, input.limit ?? 200),
			self: { handles: [TOBY_SELF_HANDLE] },
		};
	},
};

/** Toby Todos changed since the cursor, as todo nodes (evidence and context). */
export const tobyTodosSource: ObservationSource = {
	id: TOBY_TODOS_SOURCE_ID,
	displayName: "Toby Todos",
	origin: "core",
	defaultEnabled: true,
	evidenceOnly: true,
	async collect(input) {
		const { todos } = listTodos({ status: "all", limit: 200 });
		const observations: ObservationInput[] = todos
			.filter((t) => t.updatedAt >= input.since)
			.map((t) => ({
				externalId: t.id,
				kind: "todo.item",
				occurredAt: t.updatedAt,
				title: t.title,
				...(t.description.trim() ? { excerpt: t.description.trim() } : {}),
				url: `toby://todos/${t.id}`,
				actors: [],
				facts: {
					status: t.state.status,
					listId: t.listId,
					...(t.due ? { due: t.due.date } : {}),
					...(t.deleted ? { deleted: true } : {}),
				},
			}));
		return { observations };
	},
};

/** Usable-by-AI memory nodes are included as context, never as private content. */
export const memorySource: ObservationSource = {
	id: MEMORY_SOURCE_ID,
	displayName: "Memories",
	origin: "core",
	defaultEnabled: true,
	evidenceOnly: true,
	async collect(input) {
		const observations: ObservationInput[] = listNodes({
			type: "memory",
			updatedSince: input.since,
			limit: input.limit ?? 200,
		})
			.filter((node) => isNodeVisible(node))
			.map((node) => ({
				externalId: node.key,
				kind: "memory.item",
				occurredAt: node.updatedAt,
				title: node.label,
				excerpt: typeof node.props.text === "string" ? node.props.text : "",
				actors: [],
				facts: {
					...(typeof node.props.expiresAt === "string"
						? { expiresAt: node.props.expiresAt }
						: {}),
					...(typeof node.props.memoryType === "string"
						? { memoryType: node.props.memoryType }
						: {}),
				},
			}));
		return { observations };
	},
};

/**
 * Upcoming events from the default calendar's dashboard summary. Event
 * times are in the future, so this adapter ignores `since` and relies on
 * content hashes to skip unchanged events.
 */
export const calendarSource: ObservationSource = {
	id: CALENDAR_SOURCE_ID,
	displayName: "Calendar",
	origin: "core",
	defaultEnabled: true,
	async collect() {
		const data = await getDashboardCategory("calendar", { limit: 40 });
		const observations: ObservationInput[] = (data?.items ?? []).map((item) => {
			const externalId = `${item.providerName ?? "calendar"}:${item.id}`;
			return {
				externalId,
				kind: "calendar.event",
				// Untimed events keep their first-seen time so the content hash stays stable.
				occurredAt:
					item.timestamp ??
					findObservation(CALENDAR_SOURCE_ID, externalId)?.occurredAt ??
					new Date().toISOString(),
				title: item.title || "(untitled event)",
				...(item.event?.notes ? { excerpt: item.event.notes } : {}),
				...(item.url ? { url: item.url } : {}),
				actors: [],
				facts: {
					...(item.subtitle ? { calendar: item.subtitle } : {}),
					...(item.event?.location ? { location: item.event.location } : {}),
					...(item.event?.attendeeCount !== undefined
						? { attendeeCount: item.event.attendeeCount }
						: {}),
					...(item.event?.allDay ? { allDay: true } : {}),
					...(item.event?.recurring ? { recurring: true } : {}),
				},
			};
		});
		return { observations };
	},
};

export const CORE_SOURCES: readonly ObservationSource[] = [
	calendarSource,
	memorySource,
	tobyChatSource,
	tobyTodosSource,
];

/** Connected plugins that tag a tool `activity.recent`, plus the core adapters. */
export async function listObservationSources(): Promise<ObservationSource[]> {
	const plugins: ObservationSource[] = [];
	for (const module of getIntegrationModules()) {
		const defs = listModuleToolDefinitions(module.name);
		const tool = defs?.find(
			(t) => t.standardTool === ACTIVITY_RECENT_STANDARD_TOOL,
		);
		if (!tool) continue;
		const connected = await module.isConnected().catch(() => false);
		if (!connected) continue;
		plugins.push(pluginSource(module.name, module.displayName, tool.name));
	}
	return [...plugins, ...CORE_SOURCES];
}
