import {
	type CredentialsFile,
	readConfig,
	readCredentials,
	writeConfig,
	writeCredentials,
} from "../../config/index";

const MIGRATED_PLUGINS = ["todoist", "jira", "slack"] as const;

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

/** Drop config entries for integrations removed from the product. */
function migrateRetiredIntegrations(): void {
	const config = readConfig();
	const integrations = config.integrations;
	if (
		!integrations?.applemail &&
		!integrations?.websearch &&
		!integrations?.bravesearch
	) {
		return;
	}

	const nextIntegrations = { ...integrations };
	Reflect.deleteProperty(nextIntegrations, "applemail");
	Reflect.deleteProperty(nextIntegrations, "websearch");
	Reflect.deleteProperty(nextIntegrations, "bravesearch");
	writeConfig({
		...config,
		integrations: nextIntegrations,
	});

	const creds = readCredentials();
	const credIntegrations = creds.integrations;
	if (!credIntegrations?.websearch && !credIntegrations?.bravesearch) return;
	const nextCredIntegrations = { ...credIntegrations };
	Reflect.deleteProperty(nextCredIntegrations, "websearch");
	Reflect.deleteProperty(nextCredIntegrations, "bravesearch");
	writeCredentials({ ...creds, integrations: nextCredIntegrations });
}
