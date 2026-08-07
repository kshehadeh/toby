import { resolveAIProvidersForUI } from "../ai/model-list";
import { listOpenRouterTranscriptionModels } from "../ai/model-list/openrouter-transcription-catalog";
import { listVercelTranscriptionModels } from "../ai/model-list/vercel-catalog";
import { type Persona, readConfig } from "../config/index";
import { getIntegrationModules } from "../integrations/index";
import { pluginDiscoveryFingerprint } from "../integrations/plugins/discovery";
import { resetPluginModuleCache } from "../integrations/plugins/registry";
import { TRANSCRIPTION_PROVIDERS } from "../listen/transcription-providers";
import { DEFAULT_CHAT_PERSONA } from "../personas/index";
import { redactConfigureValues, seedConfigureValues } from "./persistence";
import { buildSettingsTree } from "./tree";
import type { SettingsItem } from "./types";

interface CachedSettings {
	readonly tree: SettingsItem;
	readonly redactedValues: Record<string, string>;
	readonly integrationLabels: Record<string, string>;
	readonly sectionsTree: SettingsItem[];
	/** Plugin discovery fingerprint when this snapshot was built. */
	readonly pluginFingerprint: string;
}

let cached: CachedSettings | null = null;
let inFlight: Promise<CachedSettings> | null = null;

function buildIntegrationLabels(): Record<string, string> {
	const labels: Record<string, string> = { "(none)": "None" };
	for (const mod of getIntegrationModules()) {
		labels[mod.name] = mod.displayName;
	}
	return labels;
}

function getPersonas(): Persona[] {
	const config = readConfig();
	return config.personas.some((p) => p.name === DEFAULT_CHAT_PERSONA.name)
		? config.personas
		: [DEFAULT_CHAT_PERSONA, ...config.personas];
}

const SETTINGS_SECTION_KEYS = [
	"chatInbound",
	"defaults",
	"ai",
	"transcription",
	"webSearch",
	"weather",
	"dashboard",
];

function stripToSectionNodes(node: SettingsItem): SettingsItem {
	const sectionChildren = (node.children ?? [])
		.filter((child) => child.kind === "section")
		.map(stripToSectionNodes);
	return {
		...node,
		children: sectionChildren,
	};
}

async function buildCachedSettings(): Promise<CachedSettings> {
	const values = seedConfigureValues();
	const redacted = redactConfigureValues(values);
	const personas = getPersonas();
	const availableProviders = await resolveAIProvidersForUI();
	const [vercelTranscriptionModels, openRouterTranscriptionModels] =
		await Promise.all([
			listVercelTranscriptionModels(),
			listOpenRouterTranscriptionModels(),
		]);
	// Build a uniform model map for every transcription provider:
	// live catalogs for Vercel/OpenRouter, static built-in lists for the rest.
	const transcriptionCatalogModels: Record<string, readonly string[]> = {};
	for (const p of TRANSCRIPTION_PROVIDERS) {
		transcriptionCatalogModels[p.id] = p.models;
	}
	transcriptionCatalogModels.vercel = vercelTranscriptionModels;
	transcriptionCatalogModels.openrouter = openRouterTranscriptionModels;
	const tree = buildSettingsTree(
		personas,
		availableProviders,
		redacted,
		readConfig().defaultProviders,
		{ daemonRunning: true, transcriptionCatalogModels },
	);
	const sectionMap = new Map(
		(tree.children ?? []).map((child) => [child.key, child]),
	);
	const sectionsTree = SETTINGS_SECTION_KEYS.map((key) => sectionMap.get(key))
		.filter((s): s is SettingsItem => s != null)
		.map(stripToSectionNodes);

	return {
		tree,
		redactedValues: redacted,
		integrationLabels: buildIntegrationLabels(),
		sectionsTree,
		pluginFingerprint: pluginDiscoveryFingerprint(),
	};
}

/**
 * Returns the cached settings snapshot, building it on first access.
 * The cache is invalidated by {@link invalidateSettingsCache} whenever
 * config/credentials are written, plugins change, or schedule rows change
 * (create/update/delete schedule, create/complete schedule runs). Schedule
 * recent-run status is embedded in the tree, so run completion must drop
 * this cache or list UIs stay stuck on RUNNING until the daemon restarts.
 *
 * Also auto-invalidates when the on-disk plugin set changes (dev rebuilds of
 * `dist/toby-plugin-*`), so iconUrls and integration sections stay in sync
 * without a daemon restart.
 */
export async function getSettingsCache(): Promise<CachedSettings> {
	if (cached) {
		const currentFingerprint = pluginDiscoveryFingerprint();
		if (cached.pluginFingerprint !== currentFingerprint) {
			// Plugin binaries/directories changed under us (common after
			// `bun run build:plugins`). Drop both caches so modules re-resolve.
			resetPluginModuleCache();
			cached = null;
		} else {
			return cached;
		}
	}
	if (inFlight) {
		return inFlight;
	}
	inFlight = buildCachedSettings()
		.then((result) => {
			cached = result;
			return result;
		})
		.finally(() => {
			inFlight = null;
		});
	return inFlight;
}

/**
 * Invalidate the cached settings snapshot. Call after any config or
 * credential write (patch, action, connect/disconnect, etc.).
 */
export function invalidateSettingsCache(): void {
	cached = null;
	inFlight = null;
}

/**
 * Force a fresh plugin discovery cycle and invalidate the settings cache.
 * Use when plugins are installed, removed, or toggled.
 */
export function refreshPluginsAndSettings(): void {
	resetPluginModuleCache();
	invalidateSettingsCache();
}
