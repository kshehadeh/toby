import { formatLocalTimestampForPrompt } from "../ai/current-datetime";
import type { StandardItemActionId } from "../dashboard/types";
import type {
	FeedAction,
	FeedActionId,
	FeedActionKind,
	FeedCandidate,
	FeedCategory,
} from "./types";

interface FeedActionSpec {
	readonly label: string;
	readonly kind: FeedActionKind;
	/** Short hint shown to the ranking model. */
	readonly hint: string;
}

/** Static catalog — the model chooses from these, it never defines actions. */
export const FEED_ACTIONS: Readonly<Record<FeedActionId, FeedActionSpec>> = {
	"email.draftReply": {
		label: "Draft a reply",
		kind: "chat",
		hint: "the email asks the user something or expects a response",
	},
	"email.archive": {
		label: "Archive",
		kind: "tool",
		hint: "informational mail the user can file away",
	},
	"email.markRead": {
		label: "Mark read",
		kind: "tool",
		hint: "FYI mail that needs no action",
	},
	"calendar.prep": {
		label: "Prep for this meeting",
		kind: "chat",
		hint: "a meeting worth preparing for (external people, agenda, decisions)",
	},
	"task.complete": {
		label: "Mark complete",
		kind: "tool",
		hint: "a task that looks quick or may already be done",
	},
	"task.help": {
		label: "Help me with this",
		kind: "chat",
		hint: "a task that needs thinking, research, or writing",
	},
	"todo.add": {
		label: "Add to my todo list",
		kind: "tool",
		hint: "the item implies follow-up work the user should track",
	},
	"chat.draftReply": {
		label: "Draft a reply",
		kind: "chat",
		hint: "someone asked the user a question or is waiting on them in chat",
	},
	"news.discuss": {
		label: "Tell me more",
		kind: "chat",
		hint: "a story worth a short briefing",
	},
	open: { label: "Open", kind: "open", hint: "view the original item" },
	snooze: {
		label: "Snooze until tomorrow",
		kind: "local",
		hint: "hide until tomorrow morning",
	},
	notRelevant: {
		label: "Not relevant to me",
		kind: "local",
		hint: "hide and show fewer items like this",
	},
	dismiss: { label: "Dismiss", kind: "local", hint: "hide from the Feed" },
};

/**
 * Feed actions executed by the source plugin through a standard item-action
 * tool. Toby todos complete through the todos service instead.
 */
export const PROVIDER_ITEM_ACTIONS: Readonly<
	Partial<Record<FeedActionId, StandardItemActionId>>
> = {
	"email.archive": "email.archiveItem",
	"email.markRead": "email.markItemRead",
	"task.complete": "tasks.completeItem",
};

/** Whether the candidate's source can run `id` (provider support or core). */
export function isActionSupported(
	id: FeedActionId,
	candidate: Pick<FeedCandidate, "category" | "providerActions">,
): boolean {
	if (id === "task.complete" && candidate.category === "todos") return true;
	const standard = PROVIDER_ITEM_ACTIONS[id];
	if (!standard) return true;
	return candidate.providerActions?.includes(standard) === true;
}

/** Actions the model may pick per category (ordered by typical usefulness). */
const ALLOWED_BY_CATEGORY: Readonly<
	Record<FeedCategory, readonly FeedActionId[]>
> = {
	email: ["email.draftReply", "todo.add", "email.archive", "email.markRead"],
	calendar: ["calendar.prep", "todo.add"],
	tasks: ["task.help", "task.complete"],
	todos: ["task.help", "task.complete"],
	chat: ["chat.draftReply", "todo.add"],
	news: ["news.discuss"],
};

/**
 * Actions offered on every item of a category regardless of the model's
 * picks (when the source supports them): finishing a task shouldn't depend
 * on the ranker remembering to suggest it.
 */
const ALWAYS_OFFERED: Readonly<
	Partial<Record<FeedCategory, readonly FeedActionId[]>>
> = {
	tasks: ["task.complete"],
	todos: ["task.complete"],
};

/** Default primary action when the model picks none that are valid. */
const DEFAULT_PRIMARY: Readonly<Record<FeedCategory, FeedActionId>> = {
	email: "email.draftReply",
	calendar: "calendar.prep",
	tasks: "task.help",
	todos: "task.help",
	chat: "chat.draftReply",
	news: "news.discuss",
};

/**
 * Model-selectable action ids for a candidate (excludes open/snooze/dismiss
 * and provider actions the source plugin doesn't implement).
 */
export function allowedActionIds(
	candidate: Pick<FeedCandidate, "category" | "providerActions">,
): readonly FeedActionId[] {
	return ALLOWED_BY_CATEGORY[candidate.category].filter((id) =>
		isActionSupported(id, candidate),
	);
}

function when(candidate: FeedCandidate): string {
	return candidate.timestamp
		? formatLocalTimestampForPrompt(candidate.timestamp)
		: "";
}

/** Seeded chat prompt for `chat` actions. Includes ids so tools can fetch the item. */
export function chatPromptFor(
	id: FeedActionId,
	candidate: FeedCandidate,
): string | undefined {
	const ref = `(${candidate.providerDisplayName ?? candidate.providerName} item id \`${candidate.itemId}\`)`;
	switch (id) {
		case "email.draftReply":
			return [
				`Draft a reply to the email "${candidate.title}"${candidate.subtitle ? ` from ${candidate.subtitle}` : ""} ${ref}.`,
				"Read the full message first, then write a reply in my voice and save it as a draft. Do not send it — show me the draft so I can review it.",
			].join(" ");
		case "calendar.prep": {
			const at = when(candidate);
			return [
				`Help me prepare for "${candidate.title}"${at ? ` on ${at}` : ""} ${ref}.`,
				"Look at the attendees, any related recent email, and my notes, then give me a short prep brief: purpose, what I need to know, and questions or decisions to raise.",
			].join(" ");
		}
		case "task.help":
			return [
				`Help me with the task "${candidate.title}"${candidate.subtitle ? ` (${candidate.subtitle})` : ""} ${ref}.`,
				"Break it into concrete next steps and do any research or drafting you can for me.",
			].join(" ");
		case "chat.draftReply":
			return [
				`Draft a reply to this ${candidate.providerDisplayName ?? "chat"} message${candidate.subtitle ? ` (${candidate.subtitle})` : ""} ${ref}: "${candidate.detail ?? candidate.title}".`,
				candidate.url ? `Link: ${candidate.url}.` : "",
				"Read the thread for context if you can, then write a reply in my voice. Do not post it — show me the draft so I can review it.",
			]
				.filter(Boolean)
				.join(" ");
		case "news.discuss":
			return [
				`Give me a short briefing on this story: "${candidate.title}"${candidate.subtitle ? ` (${candidate.subtitle})` : ""}.`,
				candidate.url ? `Source: ${candidate.url}.` : "",
				"Explain what happened, why it matters, and anything relevant to me.",
			]
				.filter(Boolean)
				.join(" ");
		default:
			return undefined;
	}
}

function buildAction(
	id: FeedActionId,
	candidate: FeedCandidate,
): FeedAction | null {
	const spec = FEED_ACTIONS[id];
	if (spec.kind === "open") {
		return candidate.url
			? { id, label: spec.label, kind: spec.kind, url: candidate.url }
			: null;
	}
	if (spec.kind === "chat") {
		const prompt = chatPromptFor(id, candidate);
		return prompt ? { id, label: spec.label, kind: spec.kind, prompt } : null;
	}
	return { id, label: spec.label, kind: spec.kind };
}

/**
 * Turn the model's chosen action ids into concrete actions: drop ids not
 * allowed for the category, de-dupe, fall back to the category default when
 * nothing valid remains, then append `open` (when there is a URL), `snooze`,
 * `notRelevant`, and `dismiss`.
 */
export function resolveActions(
	candidate: FeedCandidate,
	chosen: readonly string[],
): FeedAction[] {
	const allowed = new Set<string>(allowedActionIds(candidate));
	const ids: FeedActionId[] = [];
	for (const raw of chosen) {
		const id = raw.trim();
		if (allowed.has(id) && !ids.includes(id as FeedActionId)) {
			ids.push(id as FeedActionId);
		}
	}
	if (ids.length === 0) ids.push(DEFAULT_PRIMARY[candidate.category]);
	for (const id of ALWAYS_OFFERED[candidate.category] ?? []) {
		if (allowed.has(id) && !ids.includes(id)) ids.push(id);
	}
	ids.push("open", "snooze", "notRelevant", "dismiss");
	return ids
		.map((id) => buildAction(id, candidate))
		.filter((a): a is FeedAction => a !== null);
}
