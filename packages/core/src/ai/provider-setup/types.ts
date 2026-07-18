/**
 * Guided onboarding contract for AI providers.
 *
 * Each provider that supports in-app setup registers an adapter. HTTP routes
 * and the native wizard talk only to this contract — payloads stay open-ended
 * via `fields` / `meta` / `details` so OAuth-style or multi-field flows can
 * land without new top-level routes.
 */

/** A single step shown in the setup wizard (deep links optional). */
export type ProviderSetupStep = {
	readonly id: string;
	readonly title: string;
	readonly description?: string;
	readonly url?: string;
	readonly urlLabel?: string;
};

/** Credential (or other) field the wizard should collect. */
export type ProviderSetupField = {
	readonly key: string;
	readonly label: string;
	/** When true, render as a secure field and treat as secret on save. */
	readonly secret?: boolean;
	readonly placeholder?: string;
	readonly required?: boolean;
};

/** Static (or lightly dynamic) guide for one provider's setup wizard. */
export type ProviderSetupGuide = {
	readonly providerId: string;
	readonly displayName: string;
	readonly description?: string;
	/** Model applied when the client omits `model` on POST setup. */
	readonly defaultModel?: string;
	readonly steps: readonly ProviderSetupStep[];
	/** Open-ended form schema; clients submit matching keys under `fields`. */
	readonly fields: readonly ProviderSetupField[];
	/**
	 * Provider-specific extras for the UI (e.g. marketing links, badges).
	 * Not required for a working wizard.
	 */
	readonly meta?: Readonly<Record<string, unknown>>;
};

/** Client payload for completing setup. */
export type ProviderSetupRequest = {
	/**
	 * Open-ended credentials / tokens / codes. Adapters read the keys they
	 * documented in {@link ProviderSetupGuide.fields}.
	 */
	readonly fields: Readonly<Record<string, string>>;
	/** Optional model override; defaults to the guide's defaultModel. */
	readonly model?: string;
};

export type ProviderSetupSuccess = {
	readonly ok: true;
	readonly providerId: string;
	readonly model?: string;
	readonly personaName?: string;
	/** Open-ended extras (balances, team names, etc.). */
	readonly details?: Readonly<Record<string, unknown>>;
};

export type ProviderSetupFailure = {
	readonly ok: false;
	readonly error: string;
	/** Suggested HTTP status for the transport layer (401, 400, …). */
	readonly status?: number;
};

export type ProviderSetupResult = ProviderSetupSuccess | ProviderSetupFailure;

/** Per-provider guided setup implementation. */
export interface ProviderSetupAdapter {
	readonly providerId: string;
	getGuide(): ProviderSetupGuide | Promise<ProviderSetupGuide>;
	/**
	 * Validate client-supplied fields, persist credentials, and optionally
	 * update the default persona. Must not throw for user errors — return
	 * `{ ok: false }` instead. May throw for unexpected internal failures.
	 */
	setup(request: ProviderSetupRequest): Promise<ProviderSetupResult>;
}
