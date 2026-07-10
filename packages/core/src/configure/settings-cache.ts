import { resolveAIProvidersForUI } from "../ai/model-list";
import { type Persona, readConfig } from "../config/index";
import { getIntegrationModules } from "../integrations/index";
import { resetPluginModuleCache } from "../integrations/plugins/registry";
import { DEFAULT_CHAT_PERSONA } from "../personas/index";
import { redactConfigureValues, seedConfigureValues } from "./persistence";
import { buildSettingsTree } from "./tree";
import type { SettingsItem } from "./types";

interface CachedSettings {
	readonly tree: SettingsItem;
	readonly redactedValues: Record<string, string>;
	readonly integrationLabels: Record<string, string>;
	readonly sectionsTree: SettingsItem[];
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
	"dashboard",
	"projects",
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
	const tree = buildSettingsTree(
		personas,
		availableProviders,
		redacted,
		readConfig().defaultProviders,
		{ daemonRunning: true },
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
	};
}

/**
 * Returns the cached settings snapshot, building it on first access.
 * The cache is invalidated by {@link invalidateSettingsCache} whenever
 * config or credentials are written.
 * (so newly installed/removed plugins are reflected without requiring a
 * daemon restart).
 */
export async function getSettingsCache(): Promise<CachedSettings> {
	if (cached) {
		return cached;
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
