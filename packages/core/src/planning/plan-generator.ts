import { Output, generateText, zodSchema } from "ai";
import { z } from "zod";
import { createModelForAuxiliary } from "../ai/model-factory";
import type { UserIntentSpec } from "../ai/pretreatment";
import type { Persona } from "../config/index";

const PLAN_GENERATION_MODEL = "gpt-4.1-mini";

const planPhaseSchema = z.object({
	label: z
		.string()
		.describe(
			"Short human-readable display label for this stage (3-6 words, e.g. 'Fetch today's emails' or 'Summarize today's emails')",
		),
	description: z
		.string()
		.describe(
			"Detailed instructions for executing this stage: what information to collect or process, what outcome to achieve, and any constraints",
		),
	toolsRequired: z
		.array(z.string())
		.describe(
			"Tool categories or integration tools likely needed for this stage, or none for reasoning-only stages",
		),
});

const planSchema = z.object({
	goal: z.string().describe("One-line summary of the overall goal"),
	phases: z
		.array(planPhaseSchema)
		.min(2)
		.describe(
			"Ordered list of phases to achieve the goal. Each phase should be a distinct, independently executable step.",
		),
});

const PLAN_SYSTEM = `You are a planning assistant for Toby, a CLI productivity tool. Given a user's intent specification, determine whether the request requires multiple distinct steps and produce an ordered plan.

Guidelines:
- Only produce a plan when the request genuinely requires 2+ sequential steps that depend on each other.
- Organize phases around human goals, not individual tool calls. Do not create one phase per API/tool call.
- Group related data collection tools into a single collection phase, then add a separate processing/action phase when the request requires reasoning over that data.
- Each phase should be independently describable — what information to gather or transform, what tools are likely needed, and what the expected outcome is.
- Phases should be ordered by dependency: earlier phases produce outputs that later phases need.
- Keep labels short (3-6 words) and descriptions practical.
- For requests like "summarize today's emails", prefer phases like "Fetch today's emails" and "Summarize today's emails", not "Fetch inbox overview", "Fetch email metadata", and "Fetch message content".
- If the request is simple enough for a single model turn, return null (the caller handles that).`;

/** Whether planning is globally disabled via env. */
export function isPlanningDisabled(): boolean {
	return process.env.TOBY_DISABLE_PLANNING === "1";
}

/**
 * Heuristic: should we attempt plan generation?
 * Runs when pretreatment's mustDo has 2+ items, or the user text matches
 * multi-clause patterns.
 */
export function shouldGeneratePlan(
	spec: UserIntentSpec | null,
	userText: string,
): boolean {
	if (isPlanningDisabled()) return false;
	if (spec && spec.mustDo.length >= 2) return true;
	const t = userText.trim().toLowerCase();
	if (
		/\band then\b|\bfirst\b.*\bthen\b|;\s*\w+|\d+\.\s+\w+.*\n.*\d+\.\s+/i.test(
			t,
		)
	) {
		return true;
	}
	if (
		/\b(summarize|summarise|summarie|analy[sz]e|categorize|categorise|organize|organise|prioritize|prioritise|draft|write)\b/i.test(
			t,
		) &&
		/\b(email|emails|mail|message|messages|inbox|task|tasks|todo|todos|ticket|tickets|event|events|calendar)\b/i.test(
			t,
		)
	) {
		return true;
	}
	return false;
}

type PlanGenerationResult = {
	goal: string;
	phases: readonly {
		label: string;
		description: string;
		toolsRequired: readonly string[];
	}[];
};

/**
 * Calls a small model to generate a plan from the user intent spec.
 * Returns null on failure/timeout or when no plan is needed.
 */
export async function generatePlan(
	spec: UserIntentSpec | null,
	userText: string,
	options?: {
		abortSignal?: AbortSignal;
		timeoutMs?: number;
		persona?: Persona;
	},
): Promise<PlanGenerationResult | null> {
	if (!shouldGeneratePlan(spec, userText)) {
		return null;
	}

	const controller = new AbortController();
	const onAbort = () => controller.abort();
	if (options?.abortSignal) {
		if (options.abortSignal.aborted) return null;
		options.abortSignal.addEventListener("abort", onAbort, { once: true });
	}
	const timer = setTimeout(
		() => controller.abort(),
		options?.timeoutMs ?? 6000,
	);

	try {
		const model = createModelForAuxiliary({
			persona: options?.persona,
			modelId: PLAN_GENERATION_MODEL,
		});

		const intentSection = spec
			? `Intent specification:
- Goal: ${spec.goal}
- Must do: ${spec.mustDo.join("; ")}
- Must not: ${spec.mustNotDo.join("; ")}
- Likely integrations: ${spec.relevantIntegrations.join(", ") || "(none)"}`
			: `User request: ${userText}`;

		const result = await generateText({
			model,
			system: PLAN_SYSTEM,
			prompt: intentSection,
			output: Output.object({
				schema: zodSchema(planSchema),
				name: "Plan",
				description:
					"Ordered multi-step plan to achieve the user's goal. Return null if the request is simple enough for a single turn.",
			}),
			abortSignal: controller.signal,
			temperature: 0,
			maxOutputTokens: 1024,
		});

		const out = result.output;
		if (!out || out.phases.length < 2) {
			return null;
		}
		return {
			goal: out.goal,
			phases: out.phases.map((p) => ({
				label: p.label,
				description:
					p.toolsRequired.length > 0
						? `${p.description}\nTools required: ${p.toolsRequired.join(", ")}`
						: p.description,
				toolsRequired: p.toolsRequired,
			})),
		};
	} catch {
		return null;
	} finally {
		clearTimeout(timer);
		if (options?.abortSignal) {
			options.abortSignal.removeEventListener("abort", onAbort);
		}
	}
}
