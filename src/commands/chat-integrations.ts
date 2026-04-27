import { readCredentials } from "../config/index";
import {
	getIntegrationModule,
	getModulesWithCapability,
} from "../integrations/index";
import type { IntegrationModule } from "../integrations/types";

/**
 * Whether this integration can run in chat (picker + default selection).
 * Todoist treats a non-empty API key in credentials as usable even if
 * `toby connect todoist` was never run (configure-only setup).
 */
export async function isIntegrationUsableInChat(
	module: IntegrationModule,
): Promise<boolean> {
	if (await module.isConnected()) {
		return true;
	}
	if (module.name === "todoist") {
		const creds = readCredentials();
		return Boolean(creds.todoist?.apiKey?.trim());
	}
	if (module.name === "azuread") {
		const creds = readCredentials();
		return Boolean(
			creds.azuread?.tenantId?.trim() &&
				creds.azuread?.clientId?.trim() &&
				creds.azuread?.clientSecret?.trim(),
		);
	}
	return false;
}

function dedupeNames(names: readonly string[]): string[] {
	const seen = new Set<string>();
	const out: string[] = [];
	for (const raw of names) {
		const n = raw.trim().toLowerCase();
		if (!n || seen.has(n)) continue;
		seen.add(n);
		out.push(n);
	}
	return out;
}

/**
 * Parse CLI words (after options are stripped) into an explicit integration list
 * or "use all connected" (explicitNames === null).
 *
 * Rules:
 * - If `--integration` flags were used, every positional word is prompt text only.
 * - Otherwise, if the first word is a chat-capable integration name, it is peeled off as the sole explicit integration and the rest is the prompt.
 * - Otherwise, all connected chat integrations are implied (explicitNames === null) and the full positional string is the prompt.
 */
export function parseChatCliInput(
	positionalWords: readonly string[],
	flagIntegrations: readonly string[],
): { explicitNames: string[] | null; prompt: string } {
	const flags = dedupeNames(flagIntegrations);

	if (flags.length > 0) {
		return {
			explicitNames: flags,
			prompt: positionalWords.join(" ").trim(),
		};
	}

	if (positionalWords.length === 0) {
		return { explicitNames: null, prompt: "" };
	}

	const first = positionalWords[0]?.trim() ?? "";
	if (!first) {
		return { explicitNames: null, prompt: "" };
	}

	const mod = getIntegrationModule(first);
	if (mod?.capabilities.includes("chat") && mod.chat) {
		return {
			explicitNames: [mod.name],
			prompt: positionalWords.slice(1).join(" ").trim(),
		};
	}

	return {
		explicitNames: null,
		prompt: positionalWords.join(" ").trim(),
	};
}

export async function resolveChatIntegrationModules(
	explicitNames: string[] | null,
): Promise<
	{ ok: true; modules: IntegrationModule[] } | { ok: false; message: string }
> {
	const chatMods = getModulesWithCapability("chat").filter((m) => m.chat);

	if (explicitNames === null) {
		const usable: IntegrationModule[] = [];
		for (const m of chatMods) {
			if (await isIntegrationUsableInChat(m)) {
				usable.push(m);
			}
		}
		if (usable.length === 0) {
			const names = chatMods.map((m) => m.name).join(", ") || "(none)";
			return {
				ok: false,
				message: `No usable chat integrations. For Gmail run \`toby connect gmail\`; for Todoist add an API key in \`toby configure\` or run \`toby connect todoist\`. Chat-capable modules: ${names}.`,
			};
		}
		return { ok: true, modules: usable };
	}

	const out: IntegrationModule[] = [];
	for (const name of explicitNames) {
		const mod = getIntegrationModule(name);
		if (!mod) {
			return { ok: false, message: `Unknown integration: ${name}` };
		}
		if (!mod.capabilities.includes("chat") || !mod.chat) {
			const supported = chatMods.map((m) => m.name).join(", ") || "(none)";
			return {
				ok: false,
				message: `Chat is not available for "${mod.name}". Supported: ${supported}.`,
			};
		}
		if (!(await isIntegrationUsableInChat(mod))) {
			let hint = `Run \`toby connect ${mod.name}\` first.`;
			if (mod.name === "todoist") {
				hint =
					"Add a Todoist API key in `toby configure` or run `toby connect todoist`.";
			} else if (mod.name === "azuread") {
				hint =
					"Add Azure AD tenantId/clientId/clientSecret in `toby configure` (or run `toby connect azuread` after configuring).";
			}
			return {
				ok: false,
				message: `"${mod.name}" is not ready for chat. ${hint}`,
			};
		}
		out.push(mod);
	}

	return { ok: true, modules: out };
}

export function sortModulesByName(
	modules: readonly IntegrationModule[],
): IntegrationModule[] {
	return [...modules].sort((a, b) => a.name.localeCompare(b.name));
}

export function modulesEqual(
	a: readonly IntegrationModule[],
	b: readonly IntegrationModule[],
): boolean {
	if (a.length !== b.length) return false;
	const an = new Set(a.map((m) => m.name));
	for (const m of b) {
		if (!an.has(m.name)) return false;
	}
	return true;
}
