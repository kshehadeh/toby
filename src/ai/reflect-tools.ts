import type { Tool } from "ai";
import { tool } from "ai";
import { z } from "zod";
import type { Persona } from "../config/index";
import {
	getDefaultProvider,
	readConfig,
	readCredentials,
} from "../config/index";
import {
	getIntegrationModule,
	getIntegrationModules,
	getModulesForCategory,
} from "../integrations/index";
import {
	ALL_PROVIDER_CATEGORIES,
	PROVIDER_CATEGORY_LABELS,
} from "../integrations/types";
import { loadLocalSkills } from "../skills/index";

type ReflectToolsContext = {
	readonly dryRun: boolean;
	readonly persona: Persona;
};

export function createReflectTools(
	ctx: ReflectToolsContext,
): Record<string, Tool> {
	return {
		tobyListIntegrations: tool({
			description:
				"List all registered Toby integration modules with live connection status, provider categories, and auth methods. Use this when the user asks about available integrations or which ones are connected.",
			inputSchema: z.object({}),
			execute: async () => {
				if (ctx.dryRun) {
					return {
						dryRun: true,
						message: "Would list all integrations with connection status.",
					};
				}
				const modules = getIntegrationModules();
				const results = await Promise.all(
					modules.map(async (m) => {
						let connected = false;
						try {
							connected = await m.isConnected();
						} catch {
							connected = false;
						}
						return {
							name: m.name,
							displayName: m.displayName,
							description: m.description,
							providerCategories: m.providerCategories ?? [],
							capabilities: [...m.capabilities],
							authMethods:
								m.authMethods?.map((a) => ({
									id: a.id,
									label: a.label,
									isDefault: a.isDefault ?? false,
								})) ?? [],
							connected,
						};
					}),
				);
				return { integrations: results };
			},
		}),

		tobyGetIntegrationSetup: tool({
			description:
				"Get detailed setup information for a specific integration: credential fields, auth methods, resources, and a live health probe. Use this when the user asks how to connect or configure a particular integration.",
			inputSchema: z.object({
				integration: z
					.string()
					.min(1)
					.describe(
						"Integration module name (e.g. 'gmail', 'todoist', 'slack')",
					),
			}),
			execute: async ({ integration }) => {
				if (ctx.dryRun) {
					return {
						dryRun: true,
						message: `Would get setup info for ${integration}.`,
					};
				}
				const m = getIntegrationModule(integration);
				if (!m) {
					const available = getIntegrationModules().map((mod) => mod.name);
					return {
						ok: false,
						error: `Unknown integration "${integration}".`,
						availableIntegrations: available,
					};
				}
				const credentialFields = m.getCredentialDescriptors().map((d) => ({
					key: d.key,
					label: d.label,
					kind: d.kind ?? "value",
					options: d.options,
					masked: d.masked ?? false,
					multiline: d.multiline ?? false,
					showForAuthMethods: d.showForAuthMethods,
					showForInbound: d.showForInbound,
				}));
				let connected = false;
				try {
					connected = await m.isConnected();
				} catch {
					connected = false;
				}
				let health = null;
				if (connected) {
					try {
						const h = await m.testConnection({ validateTools: true });
						health = {
							ok: h.ok,
							details: h.details,
							tools: h.tools?.map((t) => ({
								tool: t.tool,
								ok: t.ok,
								details: t.details,
							})),
						};
					} catch {
						health = { ok: false, details: "Health probe failed." };
					}
				}
				const chatReadiness = m.chatReadiness
					? await m.chatReadiness(readCredentials()).catch(() => null)
					: null;
				return {
					ok: true,
					name: m.name,
					displayName: m.displayName,
					description: m.description,
					providerCategories: m.providerCategories ?? [],
					capabilities: [...m.capabilities],
					authMethods:
						m.authMethods?.map((a) => ({
							id: a.id,
							label: a.label,
							isDefault: a.isDefault ?? false,
						})) ?? [],
					resources: m.resources ?? [],
					credentialFields,
					connected,
					chatReady: chatReadiness
						? { ok: chatReadiness.ok, hint: chatReadiness.hint }
						: null,
					health,
					setupHint: connected
						? null
						: (chatReadiness?.hint ??
							`Run \`toby connect ${m.name}\` or configure credentials via \`toby configure\`.`),
				};
			},
		}),

		tobyListDefaults: tool({
			description:
				"List the default provider for each provider category (email, calendar, tasks, contacts, chat) and which integrations are eligible. Use this when the user asks about default integrations or which integration handles a given category.",
			inputSchema: z.object({}),
			execute: async () => {
				if (ctx.dryRun) {
					return {
						dryRun: true,
						message: "Would list default providers per category.",
					};
				}
				const config = readConfig();
				const categories = ALL_PROVIDER_CATEGORIES.map((cat) => {
					const defaultName = config.defaultProviders?.[cat] ?? null;
					const eligible = getModulesForCategory(cat).map((m) => ({
						name: m.name,
						displayName: m.displayName,
					}));
					return {
						category: cat,
						label: PROVIDER_CATEGORY_LABELS[cat],
						defaultIntegration: defaultName,
						eligibleIntegrations: eligible,
					};
				});
				return { categories };
			},
		}),

		tobyListTools: tool({
			description:
				"List all chat tools currently available across connected integrations (grouped by integration) plus global tools. Use this when the user asks what tools Toby has or what actions are available.",
			inputSchema: z.object({}),
			execute: async () => {
				if (ctx.dryRun) {
					return {
						dryRun: true,
						message: "Would list all available chat tools.",
					};
				}
				const modules = getIntegrationModules();
				const byIntegration: Record<
					string,
					{ name: string; description: string }[]
				> = {};
				for (const m of modules) {
					if (!m.createChatTools) continue;
					try {
						const bundle = await m.createChatTools({
							dryRun: true,
						});
						const entries: { name: string; description: string }[] = [];
						for (const [toolName, t] of Object.entries(bundle.tools)) {
							const desc =
								typeof t.description === "string"
									? t.description
									: "(no description)";
							entries.push({ name: toolName, description: desc });
						}
						byIntegration[m.name] = entries;
					} catch {
						byIntegration[m.name] = [];
					}
				}
				const globalTools = {
					tools: createGlobalToolsPreview(),
				};
				return { byIntegration, globalTools };
			},
		}),

		tobyListSkills: tool({
			description:
				"List installed local skills from ~/.toby/skills/ with name, description, and folder. Also explains how to create a new skill. Use this when the user asks about available skills or how to add a skill.",
			inputSchema: z.object({}),
			execute: async () => {
				if (ctx.dryRun) {
					return {
						dryRun: true,
						message: "Would list installed local skills.",
					};
				}
				const skills = loadLocalSkills();
				return {
					skills: skills.map((s) => ({
						name: s.name,
						description: s.description,
						summary: s.summary || undefined,
						folder: s.dirName,
					})),
					createSkillHint:
						"Use the createLocalSkill tool to draft and save a new SKILL.md under ~/.toby/skills/<folder>/SKILL.md.",
				};
			},
		}),
	};
}

function createGlobalToolsPreview(): { name: string; description: string }[] {
	const lines = [
		{
			name: "getCurrentDateTime",
			description:
				"Get the current local datetime, UTC datetime, timezone, and Unix milliseconds.",
		},
		{
			name: "loadLocalSkillInstructions",
			description:
				"Load full local SKILL.md instruction bodies by exact skill name.",
		},
		{
			name: "createLocalSkill",
			description:
				"Create a new Toby skill: drafts a SKILL.md from a description and saves it under ~/.toby/skills/.",
		},
		{
			name: "memorySearch",
			description:
				"Search the user's stored personal memories (preferences, relationships, projects, facts, etc.).",
		},
		{
			name: "memoryPropose",
			description: "Propose saving a new memory.",
		},
		{
			name: "memorySave",
			description: "Confirm a pending memory proposal.",
		},
		{
			name: "memoryForget",
			description: "Delete a stored memory.",
		},
		{
			name: "memoryExplain",
			description: "Show why a memory exists (source and audit trail).",
		},
		{
			name: "memoryRetrieveForTask",
			description: "Retrieve memories relevant to the current task.",
		},
		{
			name: "tobyListIntegrations",
			description:
				"List all registered Toby integrations with connection status.",
		},
		{
			name: "tobyGetIntegrationSetup",
			description:
				"Get detailed setup info for a specific integration (credentials, health probe).",
		},
		{
			name: "tobyListDefaults",
			description:
				"List default providers for each category and eligible integrations.",
		},
		{
			name: "tobyListTools",
			description:
				"List all chat tools available across integrations, grouped by integration.",
		},
		{
			name: "tobyListSkills",
			description: "List installed local skills and how to create new ones.",
		},
	];
	return lines;
}

/** Explains reflect tools for integration system prompts. */
export function reflectToolsPromptSection(): string {
	return `
Toby self-reflection tools (always available):
- **tobyListIntegrations**: List all registered integrations with live connection status, provider categories, and auth methods.
- **tobyGetIntegrationSetup**: Get detailed setup info for a specific integration — credential fields, auth methods, health probe, and setup hints. Takes \`integration\` (name string).
- **tobyListDefaults**: Show the default provider for every provider category (email, calendar, tasks, contacts, chat) and which integrations are eligible.
- **tobyListTools**: List all currently available chat tools across integrations, grouped by integration, plus global tools.
- **tobyListSkills**: List installed local skills from ~/.toby/skills/ with descriptions, and explain how to create new skills.

When to use:
- Use **tobyListIntegrations** when the user asks what integrations exist or which are connected.
- Use **tobyGetIntegrationSetup** when the user asks how to set up, connect, or configure a specific integration.
- Use **tobyListDefaults** when the user asks about default integrations per category.
- Use **tobyListTools** when the user asks what actions or capabilities are available.
- Use **tobyListSkills** when the user asks about installed skills or how to create a new skill.
`;
}
