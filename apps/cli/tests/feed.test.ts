import { describe, expect, it } from "bun:test";
import { parseChutesModels } from "@toby/core/ai/model-list/adapters/chutes";
import {
	isOpenAiStructuredOutputModelId,
	parseOpenAiModels,
} from "@toby/core/ai/model-list/adapters/openai";
import { parseOpenRouterModels } from "@toby/core/ai/model-list/adapters/openrouter";
import { vercelCatalogToListItems } from "@toby/core/ai/model-list/adapters/vercel-gateway";
import type { AIProviderForUI } from "@toby/core/ai/model-list/fetch";
import { rebuildDashboardConfig } from "@toby/core/configure/persistence";
import { buildFeedModelItems } from "@toby/core/configure/tree";
import { resolveActions } from "@toby/core/feed/actions";
import {
	candidatesFromCategory,
	candidatesFromTodos,
} from "@toby/core/feed/collect";
import {
	type FeedModelDeps,
	resolveFeedModelFrom,
} from "@toby/core/feed/model";
import {
	MAX_CANDIDATES_PER_CATEGORY,
	type RawFeedCandidate,
	candidateSignature,
	localDateKey,
	prefilterCandidates,
} from "@toby/core/feed/prefilter";
import {
	MAX_FEED_ITEMS,
	candidateKey,
	feedItemsFromRanking,
	formatCandidatesForPrompt,
	rankFeedCandidates,
} from "@toby/core/feed/rank";
import type { FeedCandidate } from "@toby/core/feed/types";
import type { Todo } from "@toby/core/todos/types";

const NOW = new Date("2026-11-16T15:00:00Z");
const minutes = (n: number) =>
	new Date(NOW.getTime() + n * 60_000).toISOString();

function raw(
	partial: Partial<RawFeedCandidate> &
		Pick<RawFeedCandidate, "category" | "itemId">,
): RawFeedCandidate {
	return {
		id: `${partial.category}:p:${partial.itemId}`,
		providerName: "p",
		title: `Item ${partial.itemId}`,
		...partial,
	};
}

function candidate(
	partial: Partial<FeedCandidate> & Pick<FeedCandidate, "category" | "itemId">,
): FeedCandidate {
	return { ...raw(partial), signals: [], score: 0, ...partial };
}

describe("feed prefilter", () => {
	it("drops past and out-of-horizon calendar events and flags imminent ones", () => {
		const out = prefilterCandidates(
			[
				raw({ category: "calendar", itemId: "past", timestamp: minutes(-90) }),
				raw({ category: "calendar", itemId: "soon", timestamp: minutes(20) }),
				raw({
					category: "calendar",
					itemId: "far",
					timestamp: minutes(60 * 24 * 5),
				}),
			],
			NOW,
		);
		expect(out.map((c) => c.itemId)).toEqual(["soon"]);
		expect(out[0]?.signals).toContain("starts in 20 minutes");
	});

	it("down-ranks bulk senders and boosts flagged mail", () => {
		const out = prefilterCandidates(
			[
				raw({
					category: "email",
					itemId: "bulk",
					subtitle: "newsletter@shop.example",
					timestamp: minutes(-30),
				}),
				raw({
					category: "email",
					itemId: "person",
					subtitle: "alex@example.com",
					timestamp: minutes(-30),
				}),
				raw({
					category: "email",
					itemId: "flagged",
					subtitle: "boss@example.com",
					urgency: "high",
					timestamp: minutes(-60 * 30),
				}),
			],
			NOW,
		);
		expect(out.map((c) => c.itemId)).toEqual(["flagged", "person", "bulk"]);
		expect(out[2]?.signals).toContain("likely automated or bulk sender");
	});

	it("marks overdue and due-today tasks", () => {
		const today = localDateKey(NOW);
		const out = prefilterCandidates(
			[
				raw({ category: "todos", itemId: "late", dueDate: "2026-11-10" }),
				raw({ category: "todos", itemId: "today", dueDate: today }),
			],
			NOW,
		);
		expect(out[0]?.itemId).toBe("late");
		expect(out[0]?.signals.some((s) => s.startsWith("overdue by"))).toBe(true);
		expect(out[1]?.signals).toContain("due today");
	});

	it("de-dupes ids and caps each category", () => {
		const many = Array.from(
			{ length: MAX_CANDIDATES_PER_CATEGORY + 5 },
			(_, i) =>
				raw({ category: "email", itemId: String(i), timestamp: minutes(-10) }),
		);
		const out = prefilterCandidates(
			[...many, many[0] as RawFeedCandidate],
			NOW,
		);
		expect(out).toHaveLength(MAX_CANDIDATES_PER_CATEGORY);
	});

	it("signature ignores time-relative signals but tracks item changes", () => {
		const items = [
			raw({ category: "calendar", itemId: "a", timestamp: minutes(30) }),
		];
		const early = prefilterCandidates(items, NOW);
		const later = prefilterCandidates(
			items,
			new Date(NOW.getTime() + 10 * 60_000),
		);
		expect(early[0]?.signals).not.toEqual(later[0]?.signals);
		expect(candidateSignature(early)).toBe(candidateSignature(later));
		const renamed = prefilterCandidates(
			[{ ...(items[0] as RawFeedCandidate), title: "Renamed" }],
			NOW,
		);
		expect(candidateSignature(renamed)).not.toBe(candidateSignature(early));
		expect(candidateSignature(early, ["m1"])).not.toBe(
			candidateSignature(early, ["m2"]),
		);
	});
});

describe("feed collection mapping", () => {
	it("maps aggregator items with provider names and stable ids", () => {
		const out = candidatesFromCategory("email", {
			count: 1,
			sources: [
				{
					providerName: "email",
					providerDisplayName: "Email (IMAP/SMTP)",
					summary: { count: 1, items: [], generatedAt: NOW.toISOString() },
				},
			],
			items: [
				{
					id: "42:INBOX",
					title: "Contract",
					subtitle: "alex@example.com",
					providerName: "email",
				},
			],
			groups: [],
			generatedAt: NOW.toISOString(),
		});
		expect(out[0]).toMatchObject({
			id: "email:email:42:INBOX",
			itemId: "42:INBOX",
			providerDisplayName: "Email (IMAP/SMTP)",
		});
	});

	it("keeps open todos due by tomorrow or high priority", () => {
		const base = {
			description: "",
			deleted: false,
			state: { status: "open" as const, at: null },
			priority: "none" as const,
			due: null,
		};
		const todos = [
			{
				...base,
				id: "a",
				title: "Due",
				due: { date: "2026-11-17", time: null, timezone: "UTC" },
			},
			{
				...base,
				id: "b",
				title: "Later",
				due: { date: "2026-12-01", time: null, timezone: "UTC" },
			},
			{ ...base, id: "c", title: "Important", priority: "high" as const },
			{
				...base,
				id: "d",
				title: "Done",
				state: { status: "completed" as const, at: null },
			},
		] as unknown as Todo[];
		const out = candidatesFromTodos(todos, "2026-11-17");
		expect(out.map((c) => c.itemId)).toEqual(["a", "c"]);
		expect(out[1]?.urgency).toBe("high");
	});
});

describe("feed actions", () => {
	it("filters to the category allow-list, keeps order, appends open + snooze + dismiss", () => {
		const c = candidate({
			category: "email",
			itemId: "1",
			url: "message://1",
		});
		const actions = resolveActions(c, [
			"todo.add",
			"calendar.prep",
			"bogus",
			"todo.add",
			"email.draftReply",
		]);
		expect(actions.map((a) => a.id)).toEqual([
			"todo.add",
			"email.draftReply",
			"open",
			"snooze",
			"dismiss",
		]);
		expect(actions.find((a) => a.id === "open")?.url).toBe("message://1");
	});

	it("falls back to the category default and omits open without a URL", () => {
		const actions = resolveActions(
			candidate({ category: "calendar", itemId: "e" }),
			[],
		);
		expect(actions.map((a) => a.id)).toEqual([
			"calendar.prep",
			"snooze",
			"dismiss",
		]);
	});

	it("chat actions carry a seeded prompt with the item id and never send", () => {
		const [reply] = resolveActions(
			candidate({
				category: "email",
				itemId: "42:INBOX",
				title: "Contract",
				subtitle: "alex@example.com",
			}),
			["email.draftReply"],
		);
		expect(reply?.kind).toBe("chat");
		expect(reply?.prompt).toContain("42:INBOX");
		expect(reply?.prompt).toContain("Do not send it");
	});
});

describe("feed ranking validation", () => {
	const candidates = [
		candidate({ category: "email", itemId: "e1", title: "Reply needed" }),
		candidate({ category: "calendar", itemId: "c1", title: "1:1" }),
		candidate({ category: "todos", itemId: "t1", title: "Taxes" }),
	];

	it("drops unknown and duplicate keys and groups by tier preserving order", () => {
		const items = feedItemsFromRanking(
			{
				items: [
					{
						key: "c3",
						tier: "fyi",
						reason: "Taxes are due soon.",
						actions: [],
					},
					{ key: "c9", tier: "now", reason: "Invented.", actions: [] },
					{
						key: "c2",
						tier: "now",
						reason: "Starts soon.",
						actions: ["calendar.prep"],
					},
					{
						key: "C1",
						tier: "today",
						reason: "Alex asked a question.",
						actions: ["email.draftReply"],
					},
					{ key: "c2", tier: "fyi", reason: "Duplicate.", actions: [] },
				],
			},
			candidates,
		);
		expect(items.map((i) => i.source.itemId)).toEqual(["c1", "e1", "t1"]);
		expect(items.map((i) => i.tier)).toEqual(["now", "today", "fyi"]);
		expect(items[1]?.actions[0]?.id).toBe("email.draftReply");
	});

	it("caps the number of items", () => {
		const many = Array.from({ length: 20 }, (_, i) =>
			candidate({ category: "email", itemId: String(i) }),
		);
		const items = feedItemsFromRanking(
			{
				items: many.map((_, i) => ({
					key: candidateKey(i),
					tier: "today" as const,
					reason: "r",
					actions: [],
				})),
			},
			many,
		);
		expect(items).toHaveLength(MAX_FEED_ITEMS);
	});

	it("orders by model priority within a tier, not by source type", () => {
		const items = feedItemsFromRanking(
			{
				items: [
					{ key: "c2", tier: "today", priority: 40, reason: "r", actions: [] },
					{ key: "c1", tier: "today", priority: 85, reason: "r", actions: [] },
					{ key: "c3", tier: "now", priority: 10, reason: "r", actions: [] },
				],
			},
			candidates,
		);
		expect(items.map((i) => i.source.itemId)).toEqual(["t1", "e1", "c1"]);
	});

	it("prompt interleaves categories but keeps index keys", () => {
		const mixed = [
			candidate({ category: "calendar", itemId: "a", title: "Cal A" }),
			candidate({ category: "calendar", itemId: "b", title: "Cal B" }),
			candidate({ category: "tasks", itemId: "c", title: "Task C" }),
			candidate({ category: "email", itemId: "d", title: "Mail D" }),
		].map((c) => ({ ...c, signals: [] }) as FeedCandidate);
		const keys = formatCandidatesForPrompt(mixed)
			.split("\n")
			.filter((l) => /^c\d/.test(l))
			.map((l) => l.split(" ")[0]);
		expect(keys).toEqual(["c1", "c3", "c4", "c2"]);
	});

	it("prompt lists keys, signals, and allowed actions", () => {
		const text = formatCandidatesForPrompt([
			{ ...candidates[0], signals: ["flagged"] } as FeedCandidate,
		]);
		expect(text).toContain("c1 [email] Reply needed");
		expect(text).toContain("signals: flagged");
		expect(text).toContain("allowed actions: email.draftReply");
	});

	it("runs with the Feed model swapped into the dashboard persona", async () => {
		let seen: { provider: string; model: string } | undefined;
		const result = await rankFeedCandidates({
			candidates,
			persona: {
				name: "Home",
				instructions: "",
				promptMode: "add",
				ai: { provider: "ollama", model: "llama3" },
			},
			model: { provider: "openrouter", model: "openai/gpt-5-mini" },
			run: (async (
				_def: unknown,
				opts: { personaOverride?: { ai: { provider: string; model: string } } },
			) => {
				seen = opts.personaOverride?.ai;
				return {
					ok: true,
					outputs: {
						ranking: {
							items: [
								{
									key: "c1",
									tier: "now",
									priority: 80,
									reason: "r",
									actions: [],
								},
							],
						},
					},
				};
			}) as never,
		});
		expect(seen).toEqual({
			provider: "openrouter",
			model: "openai/gpt-5-mini",
		});
		expect(result.ok && result.items[0]?.source.itemId).toBe("e1");
	});
});

describe("structured-output capability in model catalogs", () => {
	it("OpenRouter: supported_parameters structured_outputs", () => {
		const models = parseOpenRouterModels({
			data: [
				{ id: "a/yes", supported_parameters: ["tools", "structured_outputs"] },
				{ id: "a/json-only", supported_parameters: ["response_format"] },
			],
		});
		expect(models.map((m) => [m.id, m.structuredOutput === true])).toEqual([
			["a/yes", true],
			["a/json-only", false],
		]);
	});

	it("Vercel: structured-output tag", () => {
		const models = vercelCatalogToListItems({
			models: [
				{ id: "openai/gpt-5", type: "language", tags: ["structured-output"] },
				{ id: "x/plain", type: "language", tags: ["tool-use"] },
			],
			contextWindows: new Map(),
			fetchedAt: 0,
		});
		expect(models.map((m) => m.structuredOutput === true)).toEqual([
			true,
			false,
		]);
	});

	it("Chutes: supported_features structured_outputs", () => {
		const models = parseChutesModels({
			data: [
				{ id: "yes", supported_features: ["json_mode", "structured_outputs"] },
				{ id: "no", supported_features: ["json_mode"] },
			],
		});
		expect(models.map((m) => m.structuredOutput === true)).toEqual([
			true,
			false,
		]);
	});

	it("OpenAI: curated family allow-list", () => {
		for (const id of [
			"gpt-4o",
			"gpt-4o-mini",
			"gpt-4.1-nano",
			"gpt-5",
			"gpt-5-mini",
			"o3",
			"o4-mini",
		]) {
			expect(isOpenAiStructuredOutputModelId(id)).toBe(true);
		}
		for (const id of [
			"gpt-3.5-turbo",
			"gpt-4",
			"gpt-4-turbo",
			"o1-mini",
			"gpt-4o-search-preview",
			"chatgpt-4o-latest",
			"gpt-4o-realtime-preview",
		]) {
			expect(isOpenAiStructuredOutputModelId(id)).toBe(false);
		}
		const parsed = parseOpenAiModels({
			data: [{ id: "gpt-5" }, { id: "gpt-4" }],
		});
		expect(parsed.map((m) => m.structuredOutput === true)).toEqual([
			true,
			false,
		]);
	});
});

function provider(
	id: string,
	models: { id: string; structuredOutput?: boolean }[],
): AIProviderForUI {
	return {
		id,
		displayName: id.toUpperCase(),
		models,
	} as unknown as AIProviderForUI;
}

const PROVIDERS = [
	provider("openrouter", [
		{ id: "plain/model" },
		{ id: "openai/gpt-5-mini", structuredOutput: true },
		{ id: "anthropic/claude", structuredOutput: true },
	]),
	provider("openai", [
		{ id: "gpt-5", structuredOutput: true },
		{ id: "custom-id" },
	]),
	provider("ollama", [{ id: "llama3" }]),
];

function deps(partial: Partial<FeedModelDeps> = {}): FeedModelDeps {
	return {
		feedConfig: undefined,
		dashboardPersona: {
			name: "Home",
			instructions: "",
			promptMode: "add",
			ai: { provider: "openrouter", model: "plain/model" },
		},
		providers: PROVIDERS,
		isProviderConfigured: (id) => id !== "openai",
		auxiliaryModelId: () => "openai/gpt-5-mini",
		...partial,
	};
}

describe("feed model resolution", () => {
	it("uses an eligible configured model", () => {
		expect(
			resolveFeedModelFrom(
				deps({
					feedConfig: { provider: "openrouter", model: "anthropic/claude" },
				}),
			),
		).toEqual({
			ok: true,
			ref: { provider: "openrouter", model: "anthropic/claude" },
			source: "config",
		});
	});

	it("never falls back when the configured model lacks structured output", () => {
		const r = resolveFeedModelFrom(
			deps({ feedConfig: { provider: "openrouter", model: "plain/model" } }),
		);
		expect(r.ok).toBe(false);
		expect(!r.ok && r.reason).toContain("doesn't support structured output");
	});

	it("rejects custom/unknown models and unconfigured providers", () => {
		const unknown = resolveFeedModelFrom(
			deps({ feedConfig: { provider: "openrouter", model: "made/up" } }),
		);
		expect(unknown.ok).toBe(false);
		const unconfigured = resolveFeedModelFrom(
			deps({ feedConfig: { provider: "openai", model: "gpt-5" } }),
		);
		expect(!unconfigured.ok && unconfigured.reason).toContain(
			"isn't configured",
		);
	});

	it("provider-only config picks that provider's first eligible model", () => {
		const r = resolveFeedModelFrom(
			deps({ feedConfig: { provider: "openrouter" } }),
		);
		expect(r.ok && r.ref.model).toBe("openai/gpt-5-mini");
	});

	it("automatic: persona model, then auxiliary, then setup", () => {
		const persona = resolveFeedModelFrom(
			deps({
				dashboardPersona: {
					name: "Home",
					instructions: "",
					promptMode: "add",
					ai: { provider: "openrouter", model: "anthropic/claude" },
				},
			}),
		);
		expect(persona.ok && persona.source).toBe("dashboardPersona");

		const aux = resolveFeedModelFrom(deps());
		expect(aux.ok && aux.source).toBe("auxiliary");
		expect(aux.ok && aux.ref.model).toBe("openai/gpt-5-mini");

		const none = resolveFeedModelFrom(
			deps({ auxiliaryModelId: () => "plain/model" }),
		);
		expect(none.ok).toBe(false);
		expect(!none.ok && none.reason).toContain("Settings → Home");

		const noProviders = resolveFeedModelFrom(
			deps({ isProviderConfigured: () => false }),
		);
		expect(!noProviders.ok && noProviders.reason).toContain(
			"No connected AI provider",
		);
	});
});

describe("feed model settings", () => {
	const configured = (id: string) => id !== "openai";

	it("offers only configured providers with structured-output models, and only those models", () => {
		const items = buildFeedModelItems(
			PROVIDERS,
			{
				"dashboard.feed.provider": "openrouter",
				"dashboard.feed.model": "anthropic/claude",
			},
			configured,
		);
		const providerRow = items.find((i) => i.key === "dashboard.feed.provider");
		const modelRow = items.find((i) => i.key === "dashboard.feed.model");
		expect(providerRow?.options).toEqual(["(auto)", "openrouter"]);
		expect(modelRow?.options).toEqual([
			"openai/gpt-5-mini",
			"anthropic/claude",
		]);
		expect(modelRow?.currentValue).toBe("anthropic/claude");
		expect(modelRow?.options).not.toContain("+ Add custom model…");
	});

	it("explains a configured model that is no longer eligible", () => {
		const items = buildFeedModelItems(
			PROVIDERS,
			{
				"dashboard.feed.provider": "openrouter",
				"dashboard.feed.model": "plain/model",
			},
			configured,
		);
		const modelRow = items.find((i) => i.key === "dashboard.feed.model");
		expect(modelRow?.currentValue).toBe("openai/gpt-5-mini");
		expect(modelRow?.description).toContain(
			"doesn't support structured output",
		);
	});

	it("shows only a hint when nothing is eligible, and hides the model row on Automatic", () => {
		expect(
			buildFeedModelItems(PROVIDERS, {}, () => false).map((i) => i.kind),
		).toEqual(["hint"]);
		expect(
			buildFeedModelItems(
				PROVIDERS,
				{ "dashboard.feed.provider": "(auto)" },
				configured,
			).map((i) => i.key),
		).toEqual(["dashboard.feed._hint", "dashboard.feed.provider"]);
	});

	it("persists provider/model and clears them on Automatic", () => {
		expect(
			rebuildDashboardConfig({
				"dashboard.persona": "(default)",
				"dashboard.feed.provider": "openrouter",
				"dashboard.feed.model": "anthropic/claude",
			}),
		).toEqual({ feed: { provider: "openrouter", model: "anthropic/claude" } });
		expect(
			rebuildDashboardConfig({
				"dashboard.persona": "Home",
				"dashboard.feed.provider": "(auto)",
				"dashboard.feed.model": "anthropic/claude",
			}),
		).toEqual({ persona: "Home" });
	});
});
