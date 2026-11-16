import {
	isAIProviderConfigured,
	resolveAuxiliaryModelId,
} from "../ai/model-factory";
import {
	type AIProviderForUI,
	modelSupportsStructuredOutput,
	resolveAIProvidersForUI,
} from "../ai/model-list/index";
import { type Persona, readConfig } from "../config/index";
import type { DashboardFeedConfig } from "../config/index";
import { resolveDashboardPersona } from "../dashboard/prompts";
import type { FeedModelRef } from "./types";

/** Where the resolved Feed model came from. */
export type FeedModelSource = "config" | "dashboardPersona" | "auxiliary";

export type FeedModelResolution =
	| {
			readonly ok: true;
			readonly ref: FeedModelRef;
			readonly source: FeedModelSource;
	  }
	| { readonly ok: false; readonly reason: string };

export interface FeedModelDeps {
	readonly feedConfig: DashboardFeedConfig | undefined;
	readonly dashboardPersona: Persona;
	/** Same provider/model catalog the settings pickers use. */
	readonly providers: readonly AIProviderForUI[];
	readonly isProviderConfigured: (providerId: string) => boolean;
	readonly auxiliaryModelId: (providerId: string) => string;
}

/**
 * Eligibility for The Feed: provider configured and the catalog marks the
 * model as supporting structured output. Unknown models (custom ids, models a
 * catalog doesn't tag) are ineligible.
 */
export function isFeedModelEligible(
	ref: FeedModelRef,
	deps: Pick<FeedModelDeps, "providers" | "isProviderConfigured">,
): boolean {
	if (!deps.isProviderConfigured(ref.provider)) return false;
	const provider = deps.providers.find((p) => p.id === ref.provider);
	const item = provider?.models.find((m) => m.id === ref.model);
	return modelSupportsStructuredOutput(item);
}

/** Configured providers with at least one eligible model, eligible models only. */
export function eligibleFeedProviders(
	deps: Pick<FeedModelDeps, "providers" | "isProviderConfigured">,
): AIProviderForUI[] {
	return deps.providers
		.filter((p) => deps.isProviderConfigured(p.id))
		.map((p) => ({
			...p,
			models: p.models.filter((m) => modelSupportsStructuredOutput(m)),
		}))
		.filter((p) => p.models.length > 0);
}

/**
 * Resolve the Feed model.
 *
 * An explicit `dashboard.feed` choice is authoritative: if it is ineligible
 * the Feed asks for setup instead of silently using another model. With no
 * choice, try the dashboard persona's model, then the auxiliary model on that
 * persona's provider.
 */
export function resolveFeedModelFrom(deps: FeedModelDeps): FeedModelResolution {
	const provider = deps.feedConfig?.provider?.trim();
	const model = deps.feedConfig?.model?.trim();
	if (provider && !model) {
		const first = eligibleFeedProviders(deps).find((p) => p.id === provider)
			?.models[0];
		if (first) {
			return { ok: true, ref: { provider, model: first.id }, source: "config" };
		}
		return {
			ok: false,
			reason: deps.isProviderConfigured(provider)
				? `"${provider}" has no models with structured output. Choose another Feed provider in Settings → Home.`
				: `The Feed's AI provider "${provider}" isn't configured. Choose a Feed model in Settings → Home.`,
		};
	}
	if (provider && model) {
		const ref = { provider, model };
		if (isFeedModelEligible(ref, deps)) {
			return { ok: true, ref, source: "config" };
		}
		return {
			ok: false,
			reason: deps.isProviderConfigured(provider)
				? `The Feed model "${model}" doesn't support structured output. Choose another model in Settings → Home.`
				: `The Feed's AI provider "${provider}" isn't configured. Choose a Feed model in Settings → Home.`,
		};
	}

	const personaRef = {
		provider: deps.dashboardPersona.ai.provider,
		model: deps.dashboardPersona.ai.model,
	};
	if (isFeedModelEligible(personaRef, deps)) {
		return { ok: true, ref: personaRef, source: "dashboardPersona" };
	}

	const auxRef = {
		provider: personaRef.provider,
		model: deps.auxiliaryModelId(personaRef.provider),
	};
	if (auxRef.model && isFeedModelEligible(auxRef, deps)) {
		return { ok: true, ref: auxRef, source: "auxiliary" };
	}

	return {
		ok: false,
		reason:
			eligibleFeedProviders(deps).length > 0
				? "Choose a Feed model that supports structured output in Settings → Home."
				: "No connected AI provider offers a model with structured output. Connect OpenAI, OpenRouter, Vercel AI Gateway, or Chutes to use The Feed.",
	};
}

/** Live resolution against config + the cached model catalogs. */
export async function resolveFeedModel(): Promise<FeedModelResolution> {
	return resolveFeedModelFrom({
		feedConfig: readConfig().dashboard?.feed,
		dashboardPersona: resolveDashboardPersona(),
		providers: await resolveAIProvidersForUI(),
		isProviderConfigured: isAIProviderConfigured,
		auxiliaryModelId: (id) => resolveAuxiliaryModelId(id),
	});
}
