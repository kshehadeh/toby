import { Output, generateText, zodSchema } from "ai";
import { z } from "zod";
import {
	createModelForPersona,
	isAIProviderConfigured,
	resolveAuxiliaryModelId,
} from "../ai/model-factory";
import {
	modelSupportsStructuredOutput,
	resolveAIProvidersForUI,
} from "../ai/model-list/index";
import type { AIProviderForUI } from "../ai/model-list/index";
import { readConfig } from "../config/index";
import type { Persona } from "../config/index";
import { resolveFeedModel } from "../feed/model";
import { daemonLog } from "../logging/daemon-log";
import { resolveDefaultPersona } from "../personas/index";
import type { FollowupUnit } from "./types";
import { followupEvaluationSchema } from "./types";

export interface EvaluatorModelRef {
	readonly provider: string;
	readonly model: string;
}

export type EvaluatorModelResolution =
	| {
			readonly ok: true;
			readonly ref: EvaluatorModelRef;
			readonly source: "config" | "auxiliary" | "feed";
	  }
	| { readonly ok: false; readonly reason: string };

export interface EvaluatorModelDeps {
	readonly config: ReturnType<typeof readConfig>;
	readonly persona: Persona;
	readonly providers: readonly AIProviderForUI[];
	readonly isConfigured: (providerId: string) => boolean;
	readonly auxiliaryModelId: (providerId: string) => string;
	readonly feedModel:
		| { readonly ok: true; readonly ref: EvaluatorModelRef }
		| { readonly ok: false; readonly reason: string };
}

function eligible(ref: EvaluatorModelRef, deps: EvaluatorModelDeps): boolean {
	if (!deps.isConfigured(ref.provider)) return false;
	const provider = deps.providers.find((entry) => entry.id === ref.provider);
	return modelSupportsStructuredOutput(
		provider?.models.find((model) => model.id === ref.model),
	);
}

export function resolveEvaluatorModelFrom(
	deps: EvaluatorModelDeps,
): EvaluatorModelResolution {
	const configured = deps.config.followups?.evaluator;
	if (configured?.provider || configured?.model) {
		const provider = configured.provider?.trim() || deps.persona.ai.provider;
		const requested = configured.model?.trim();
		const firstEligible = deps.providers
			.find((item) => item.id === provider)
			?.models.find((item) => modelSupportsStructuredOutput(item))?.id;
		const ref = { provider, model: requested || firstEligible || "" };
		if (ref.model && eligible(ref, deps))
			return { ok: true, ref, source: "config" };
		return {
			ok: false,
			reason: ref.model
				? `The follow-up evaluator model "${ref.model}" does not support structured output or its provider is not configured.`
				: `No structured-output model is available for ${provider}. Choose one in Settings → Follow-ups.`,
		};
	}

	const auxiliary = {
		provider: deps.persona.ai.provider,
		model: deps.auxiliaryModelId(deps.persona.ai.provider),
	};
	if (eligible(auxiliary, deps))
		return { ok: true, ref: auxiliary, source: "auxiliary" };
	if (deps.feedModel.ok && eligible(deps.feedModel.ref, deps)) {
		return { ok: true, ref: deps.feedModel.ref, source: "feed" };
	}
	return {
		ok: false,
		reason:
			"Connect an AI provider with a structured-output model, or choose an evaluator in Settings → Follow-ups.",
	};
}

export async function resolveEvaluatorModel(): Promise<EvaluatorModelResolution> {
	const providers = await resolveAIProvidersForUI();
	const feed = await resolveFeedModel();
	return resolveEvaluatorModelFrom({
		config: readConfig(),
		persona: resolveDefaultPersona(),
		providers,
		isConfigured: isAIProviderConfigured,
		auxiliaryModelId: (provider) => resolveAuxiliaryModelId(provider),
		feedModel: feed.ok ? { ok: true, ref: feed.ref } : feed,
	});
}

function personaFor(ref: EvaluatorModelRef): Persona {
	const persona = resolveDefaultPersona();
	return { ...persona, ai: { provider: ref.provider, model: ref.model } };
}

function recordUsage(
	operation: string,
	result: {
		usage?: {
			inputTokens?: number;
			outputTokens?: number;
			totalTokens?: number;
		};
	},
): void {
	const usage = result.usage;
	daemonLog("info", "general", "followup_model_usage", {
		operation,
		...(usage?.inputTokens !== undefined
			? { inputTokens: usage.inputTokens }
			: {}),
		...(usage?.outputTokens !== undefined
			? { outputTokens: usage.outputTokens }
			: {}),
		...(usage?.totalTokens !== undefined
			? { totalTokens: usage.totalTokens }
			: {}),
	});
}

const extractedEntitySchema = z.object({
	type: z.enum(["person", "org", "project", "topic"]),
	name: z.string().trim().min(1).max(200),
	identifiers: z.array(z.string().trim().min(1).max(320)).max(20).optional(),
	confidence: z.number().min(0).max(1),
});
const graphExtractionSchema = z.object({
	entities: z.array(extractedEntitySchema).max(100),
	links: z
		.array(
			z.object({
				nodeId: z.string(),
				entity: extractedEntitySchema,
				edgeType: z.enum(["mentions", "about", "works_at", "alias_of"]),
			}),
		)
		.max(200),
});

async function modelForRun() {
	const resolution = await resolveEvaluatorModel();
	if (!resolution.ok) throw new Error(resolution.reason);
	return {
		model: createModelForPersona(personaFor(resolution.ref)),
		ref: resolution.ref,
	};
}

/** Evaluate a small batch with schema-constrained output only. */
export async function evaluateFollowupUnits(
	units: readonly FollowupUnit[],
): Promise<unknown> {
	const { model, ref } = await modelForRun();
	const config = readConfig().followups;
	const system = [
		"You are Toby's follow-up evaluator. Decide only from the provided evidence; do not invent facts.",
		"Create an item only when the user clearly owes a reply, is waiting on a reply after the configured wait, or made a concrete commitment.",
		"owe_reply: an inbound direct question or request still needs the user's answer. Example: 'Can you review the deck?' qualifies; 'Thanks!' does not.",
		"awaiting_reply: the user's outbound request remains unanswered after the wait window. Example: 'Can you send the invoice?' qualifies; an outbound FYI does not.",
		"commitment: the user promised a specific action. Example: 'I will send the deck Friday' qualifies; 'We should meet sometime' does not.",
		"For awaiting_reply, require that the message has been unanswered for at least the configured number of days as of the evaluation time.",
		"Do not create generic reminders from newsletters, automated mail, bulk messages, or no-reply senders.",
		"Close a loop only when new evidence clearly shows it is done. Acknowledgment or vague intent is not completion.",
		"Use only supplied unit IDs, loop IDs, and evidence IDs. Keep titles concise and action-oriented. Do not quote message bodies in titles.",
		`Enabled kinds: ${JSON.stringify(config?.kinds ?? {})}. Awaiting-reply wait: ${config?.awaitingReplyDays ?? 3} days.`,
	].join("\n");
	const prompt = JSON.stringify({
		instructions: units.length ? units[0]?.promptContext : "",
		units: units.map((unit) => ({
			unitId: unit.unitId,
			evaluatedAt: unit.evaluatedAt,
			nodeIds: unit.nodeIds,
			loopIds: unit.loopIds,
			waitingReplyEligible: unit.waitingReplyEligible,
			evidence: unit.sourceText,
			graphContext: unit.promptContext,
		})),
	});
	const result = await generateText({
		model,
		instructions: system,
		prompt,
		output: Output.object({
			schema: zodSchema(followupEvaluationSchema),
			name: "TobyFollowupEvaluation",
			description:
				"Follow-up opening and closing decisions tied to evidence IDs",
		}),
		maxOutputTokens: 2500,
	});
	recordUsage(`evaluate:${ref.provider}/${ref.model}`, result);
	return followupEvaluationSchema.parse(result.output);
}

/** Extract graph entities for new safe nodes using the same configured evaluator. */
export async function extractGraphEntities(
	nodes: Parameters<import("../graph/enrichment").GraphExtract>[0],
): Promise<unknown> {
	const { model, ref } = await modelForRun();
	const result = await generateText({
		model,
		instructions:
			"Extract only explicit entities and relationships stated in the supplied Toby evidence. Do not infer identities. Use stable identifiers only when present verbatim. Confidence must reflect evidence strength.",
		prompt: JSON.stringify({
			nodes: nodes.map((node) => ({
				nodeId: node.id,
				type: node.type,
				label: node.label,
				text:
					typeof node.props.text === "string"
						? node.props.text.slice(0, 1000)
						: "",
			})),
		}),
		output: Output.object({
			schema: zodSchema(graphExtractionSchema),
			name: "TobyGraphEntities",
			description:
				"Entities and evidence-backed links for a bounded graph batch",
		}),
		maxOutputTokens: 1600,
	});
	recordUsage(`extract:${ref.provider}/${ref.model}`, result);
	return graphExtractionSchema.parse(result.output);
}
