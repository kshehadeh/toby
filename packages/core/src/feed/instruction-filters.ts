import { createHash } from "node:crypto";
import { z } from "zod";
import type { Persona } from "../config/index";
import { runFlowDefinition } from "../flows/runner";
import type { FlowDefinition } from "../flows/types";
import type { FeedInstruction, FeedInstructionRule } from "./state";
import type { FeedCandidate, FeedCategory, FeedModelRef } from "./types";

/**
 * User Feed instructions are prompt text, and models drift past them. Rules
 * that only leave items out are compiled once (per instruction text) into
 * structured filters that code applies before ranking, so "ignore X" holds
 * every time. The instruction still goes to the ranker for anything the
 * filters can't express (ordering, emphasis).
 */

/** Bump when the filter schema or matching semantics change. */
export const FEED_RULE_COMPILER_VERSION = "rules-v1";
const COMPILE_TIMEOUT_MS = 30_000;
/** A failed compile is retried after this long, not on every refresh. */
const COMPILE_RETRY_MS = 60 * 60 * 1000;
const FLOW_NAME = "dashboard.feed.rules";

const CATEGORIES: readonly FeedCategory[] = [
	"email",
	"calendar",
	"tasks",
	"todos",
	"chat",
	"news",
];
const ASSIGNMENTS = ["you", "someone_else", "unassigned"] as const;

/** Every field required: strict json_schema providers reject optional ones. */
const filterSchema = z.object({
	categories: z
		.array(z.enum(CATEGORIES as [FeedCategory, ...FeedCategory[]]))
		.describe("Categories this filter applies to; empty means any category"),
	providers: z
		.array(z.string())
		.describe("Provider ids from the list given; empty means any provider"),
	listMode: z
		.enum(["any", "in", "not_in"])
		.describe(
			"Match on the item's list/project/sender ('from/list'): any = ignore it",
		),
	lists: z.array(z.string()).describe("List/project names for listMode"),
	assignmentMode: z
		.enum(["any", "in", "not_in"])
		.describe("Match on who a task is assigned to: any = ignore it"),
	assignments: z
		.array(z.enum(ASSIGNMENTS))
		.describe("Assignees for assignmentMode; 'you' is the user"),
});

export const feedRuleCompileSchema = z.object({
	filters: z
		.array(filterSchema)
		.describe(
			"Hide a candidate that matches every condition of any one filter. Empty when the instruction does not leave anything out, or can't be expressed with these fields.",
		),
	summary: z
		.string()
		.describe(
			"Short plain sentence of what the filters hide, e.g. 'Hides Todoist tasks outside the Inbox'. Empty when filters is empty.",
		),
});

export type FeedRuleFilter = z.infer<typeof filterSchema>;
export type FeedRuleCompileOutput = z.infer<typeof feedRuleCompileSchema>;

export function instructionRuleHash(text: string): string {
	return createHash("sha256")
		.update(`${FEED_RULE_COMPILER_VERSION}|${text.trim().toLowerCase()}`)
		.digest("hex")
		.slice(0, 16);
}

function norm(value: string | undefined): string {
	return (value ?? "").trim().toLowerCase();
}

/** A filter that names nothing would hide everything; it's never applied. */
export function isMeaningfulFilter(filter: FeedRuleFilter): boolean {
	return (
		filter.categories.length > 0 ||
		filter.providers.length > 0 ||
		(filter.listMode !== "any" && filter.lists.length > 0) ||
		(filter.assignmentMode !== "any" && filter.assignments.length > 0)
	);
}

/**
 * Whether one filter hides a candidate. Missing facts never hide: an item
 * without a list isn't "outside" a list, and an item without assignment
 * facts (personal projects, email, calendar) is the user's own.
 */
export function filterMatches(
	filter: FeedRuleFilter,
	c: Pick<
		FeedCandidate,
		"category" | "providerName" | "providerDisplayName" | "subtitle" | "task"
	>,
): boolean {
	if (!isMeaningfulFilter(filter)) return false;
	if (filter.categories.length > 0 && !filter.categories.includes(c.category))
		return false;
	if (filter.providers.length > 0) {
		const names = [norm(c.providerName), norm(c.providerDisplayName)];
		if (!filter.providers.some((p) => names.includes(norm(p)))) return false;
	}
	if (filter.listMode !== "any" && filter.lists.length > 0) {
		const list = norm(c.subtitle);
		if (!list) return false;
		const listed = filter.lists.some((l) => norm(l) === list);
		if (filter.listMode === "in" ? !listed : listed) return false;
	}
	if (filter.assignmentMode !== "any" && filter.assignments.length > 0) {
		const assignment = c.task?.assignment ?? "you";
		const listed = filter.assignments.includes(assignment);
		if (filter.assignmentMode === "in" ? !listed : listed) return false;
	}
	return true;
}

/** Compiled filters from enabled instructions whose rule matches their text. */
export function activeRuleFilters(
	instructions: readonly FeedInstruction[],
): FeedRuleFilter[] {
	return instructions.flatMap((i) =>
		i.enabled &&
		i.rule?.status === "filter" &&
		i.rule.hash === instructionRuleHash(i.text)
			? i.rule.filters
			: [],
	);
}

/** Candidates the user's compiled instructions don't hide. */
export function applyRuleFilters<
	T extends Pick<
		FeedCandidate,
		"category" | "providerName" | "providerDisplayName" | "subtitle" | "task"
	>,
>(candidates: readonly T[], filters: readonly FeedRuleFilter[]): T[] {
	if (filters.length === 0) return [...candidates];
	return candidates.filter((c) => !filters.some((f) => filterMatches(f, c)));
}

/** Enabled instructions that have no current compiled rule (or a stale failure). */
export function instructionsNeedingCompile(
	instructions: readonly FeedInstruction[],
	now: Date,
): FeedInstruction[] {
	return instructions.filter((i) => {
		if (!i.enabled) return false;
		const hash = instructionRuleHash(i.text);
		if (!i.rule || i.rule.hash !== hash) return true;
		if (i.rule.status !== "failed") return false;
		const failedAt = Date.parse(i.rule.at);
		return (
			Number.isNaN(failedAt) || now.getTime() - failedAt >= COMPILE_RETRY_MS
		);
	});
}

/** What the compiler is told about the user's sources. */
export interface FeedRuleContext {
	readonly providers: ReadonlyArray<{
		readonly id: string;
		readonly displayName?: string;
		readonly category: FeedCategory;
		readonly lists: readonly string[];
	}>;
}

export function ruleContextFrom(
	candidates: ReadonlyArray<
		Pick<
			FeedCandidate,
			"category" | "providerName" | "providerDisplayName" | "subtitle"
		>
	>,
): FeedRuleContext {
	const byKey = new Map<
		string,
		{
			id: string;
			displayName?: string;
			category: FeedCategory;
			lists: Set<string>;
		}
	>();
	for (const c of candidates) {
		const key = `${c.category}:${c.providerName}`;
		const entry = byKey.get(key) ?? {
			id: c.providerName,
			...(c.providerDisplayName ? { displayName: c.providerDisplayName } : {}),
			category: c.category,
			lists: new Set<string>(),
		};
		if (c.subtitle?.trim() && entry.lists.size < 40)
			entry.lists.add(c.subtitle.trim());
		byKey.set(key, entry);
	}
	return {
		providers: [...byKey.values()].map((p) => ({
			...p,
			lists: [...p.lists].sort(),
		})),
	};
}

export function buildRuleCompilePrompt(
	text: string,
	context: FeedRuleContext,
): string {
	const providers = context.providers.length
		? context.providers
				.map(
					(p) =>
						`- ${p.id}${p.displayName ? ` ("${p.displayName}")` : ""} [${p.category}]${p.lists.length ? ` lists seen: ${p.lists.join(", ")}` : ""}`,
				)
				.join("\n")
		: "(none connected right now)";
	return `Turn this user instruction for The Feed into filters that hide items.

Instruction: "${text}"

Connected sources:
${providers}

Candidate fields you can filter on:
- category: one of ${CATEGORIES.join(", ")}
- provider: a provider id above (match the user's wording, e.g. "Todoist" → todoist)
- list: the item's list/project (tasks), folder or sender (email), or calendar name
- assignment (tasks in shared projects): you, someone_else, unassigned. Items with no assignment info count as "you".

Rules:
- Only produce filters for parts that leave items OUT ("ignore", "skip", "hide", "only show"). "Only show X" becomes a filter that hides everything that is not X.
- Ordering, priority, or emphasis ("put X first", "X matters most") produce no filter.
- Keep each filter as narrow as the instruction says: if it names a source, set providers; don't widen to other sources.
- When the instruction can't be expressed with these fields, return no filters.
- Use list names exactly as listed when one matches the user's wording.`;
}

function compileFlow(prompt: string): FlowDefinition {
	return {
		name: FLOW_NAME,
		description: "Compile a Feed instruction into structured filters.",
		nodes: [
			{
				id: "compile",
				type: "llm_prompter",
				schema: feedRuleCompileSchema,
				schemaName: "FeedRuleFilters",
				schemaDescription: "Filters that hide Feed candidates",
				structuredOutput: "required",
				temperature: 0,
				maxOutputTokens: 1000,
				timeoutMs: COMPILE_TIMEOUT_MS,
				systemPrompt: () =>
					"You convert short natural-language rules into precise structured filters. Be literal; never invent conditions the user did not state.",
				userPrompt: () => prompt,
				outputs: { rule: "object" },
			},
		],
	};
}

export type CompileInstruction = (
	text: string,
	context: FeedRuleContext,
) => Promise<FeedRuleCompileOutput>;

/** Model-backed compiler using the Feed model. */
export function modelRuleCompiler(params: {
	readonly persona: Persona;
	readonly model: FeedModelRef;
	readonly run?: typeof runFlowDefinition;
}): CompileInstruction {
	const run = params.run ?? runFlowDefinition;
	return async (text, context) => {
		const result = await run(
			compileFlow(buildRuleCompilePrompt(text, context)),
			{
				personaOverride: {
					...params.persona,
					ai: { provider: params.model.provider, model: params.model.model },
				},
				inputs: {},
				trigger: FLOW_NAME,
			},
		);
		if (!result.ok) throw new Error(result.error ?? "Rule compile failed");
		const parsed = feedRuleCompileSchema.safeParse(result.outputs.rule);
		if (!parsed.success)
			throw new Error("Rule compile returned an invalid shape");
		return parsed.data;
	};
}

/** Compile one instruction into the rule stored on it. Never throws. */
export async function compileInstructionRule(
	instruction: FeedInstruction,
	context: FeedRuleContext,
	compile: CompileInstruction,
	now: Date,
): Promise<FeedInstructionRule> {
	const hash = instructionRuleHash(instruction.text);
	const at = now.toISOString();
	try {
		const output = await compile(instruction.text, context);
		const filters = output.filters.filter(isMeaningfulFilter);
		return filters.length > 0
			? {
					status: "filter",
					hash,
					at,
					filters,
					summary: output.summary.trim() || "Hides matching items",
				}
			: { status: "guidance", hash, at };
	} catch (error) {
		return {
			status: "failed",
			hash,
			at,
			error: (error instanceof Error ? error.message : String(error)).slice(
				0,
				300,
			),
		};
	}
}
