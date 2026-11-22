import {
	type CredentialsFile,
	readConfig,
	readCredentials,
	writeConfig,
	writeCredentials,
} from "../../config/index";

const MIGRATED_PLUGINS = ["jira", "slack"] as const;

/** Copy legacy top-level credential blocks into integrations.<name> when empty. */
export function migrateLegacyPluginCredentials(): void {
	const creds = readCredentials();
	let changed = false;
	const integrations = { ...(creds.integrations ?? {}) };

	for (const name of MIGRATED_PLUGINS) {
		const legacy = creds[name as keyof CredentialsFile];
		if (!legacy || typeof legacy !== "object" || Array.isArray(legacy)) {
			continue;
		}
		const existing = integrations[name];
		if (existing && Object.keys(existing).length > 0) {
			continue;
		}

		const nextBlock: Record<string, string> = {};
		for (const [key, value] of Object.entries(
			legacy as Record<string, unknown>,
		)) {
			if (value === undefined || value === null) continue;
			nextBlock[key] = String(value);
		}
		if (Object.keys(nextBlock).length === 0) {
			continue;
		}

		integrations[name] = nextBlock;
		changed = true;
	}

	if (changed) {
		writeCredentials({
			...creds,
			integrations,
		});
	}

	migratePrefixedIntegrationCredentialKeys();
	migrateRetiredIntegrations();
}

/** Normalize plugin credential keys stored as `<name>.<field>` inside integrations.<name>. */
function migratePrefixedIntegrationCredentialKeys(): void {
	const creds = readCredentials();
	const integrations = { ...(creds.integrations ?? {}) };
	let changed = false;

	for (const [name, block] of Object.entries(integrations)) {
		if (!block || typeof block !== "object") continue;

		const prefix = `${name}.`;
		const nextBlock = { ...block };
		let blockChanged = false;

		for (const [key, value] of Object.entries(block)) {
			if (!key.startsWith(prefix)) continue;
			const localKey = key.slice(prefix.length);
			if (!localKey || nextBlock[localKey] !== undefined) {
				Reflect.deleteProperty(nextBlock, key);
				blockChanged = true;
				continue;
			}
			nextBlock[localKey] = value;
			Reflect.deleteProperty(nextBlock, key);
			blockChanged = true;
		}

		if (blockChanged) {
			integrations[name] = nextBlock;
			changed = true;
		}
	}

	if (changed) {
		writeCredentials({
			...creds,
			integrations,
		});
	}
}

/**
 * Integrations removed from the product. Their config, credentials and any
 * default-provider pointing at them are dropped. Todoist was replaced by
 * built-in Toby todos.
 */
export const RETIRED_INTEGRATIONS = [
	"applemail",
	"websearch",
	"bravesearch",
	"todoist",
] as const;

/** Drop config and credential entries for integrations removed from the product. */
function migrateRetiredIntegrations(): void {
	const retired = new Set<string>(RETIRED_INTEGRATIONS);

	const config = readConfig();
	const integrations = config.integrations ?? {};
	const defaults = config.defaultProviders ?? {};
	const staleIntegrations = Object.keys(integrations).filter((k) =>
		retired.has(k),
	);
	const staleDefaults = Object.entries(defaults).filter(
		([, v]) => typeof v === "string" && retired.has(v),
	);
	if (staleIntegrations.length > 0 || staleDefaults.length > 0) {
		const nextIntegrations = { ...integrations };
		for (const name of staleIntegrations) {
			Reflect.deleteProperty(nextIntegrations, name);
		}
		const nextDefaults = { ...defaults };
		for (const [category] of staleDefaults) {
			Reflect.deleteProperty(nextDefaults, category);
		}
		writeConfig({
			...config,
			integrations: nextIntegrations,
			...(config.defaultProviders ? { defaultProviders: nextDefaults } : {}),
		});
	}

	const creds = readCredentials();
	const credIntegrations = creds.integrations ?? {};
	const connections = creds.connections ?? {};
	const staleCreds = Object.keys(credIntegrations).filter((k) =>
		retired.has(k),
	);
	const staleConnections = Object.keys(connections).filter((k) =>
		retired.has(k),
	);
	const hasLegacyTodoist = creds.todoist !== undefined;
	if (
		staleCreds.length === 0 &&
		staleConnections.length === 0 &&
		!hasLegacyTodoist
	) {
		return;
	}
	const nextCredIntegrations = { ...credIntegrations };
	for (const name of staleCreds) {
		Reflect.deleteProperty(nextCredIntegrations, name);
	}
	const nextConnections = { ...connections };
	for (const name of staleConnections) {
		Reflect.deleteProperty(nextConnections, name);
	}
	const nextCreds: CredentialsFile = {
		...creds,
		integrations: nextCredIntegrations,
		...(creds.connections ? { connections: nextConnections } : {}),
	};
	Reflect.deleteProperty(nextCreds, "todoist");
	writeCredentials(nextCreds);
}
