import fs from "node:fs";
import path from "node:path";
import { Output, type Tool, generateText, tool, zodSchema } from "ai";
import { z } from "zod";
import { type Persona, ensureTobyDir, getSkillsDir } from "../config/index";
import { getBraveSearchApiKeyRaw } from "../integrations/bravesearch/client";
import { createBraveSearchTools } from "../integrations/bravesearch/tools";
import {
	formatSkillsCatalogForPrompt,
	loadLocalSkills,
	parseSkillFileContent,
	parseSkillFrontmatterAndBody,
	resolveSkillsByNames,
} from "../skills/index";
import { createModelForPersona } from "./chat";
import { getCurrentDateTimeInfo } from "./current-datetime";
import { createReflectTools, reflectToolsPromptSection } from "./reflect-tools";
import { createWebFetchTools } from "./web-fetch-tool";

const SKILL_MD_BASENAME = "SKILL.md";

const skillDraftSchema = z.object({
	recommendedFolderName: z
		.string()
		.describe(
			"Suggested folder name under ~/.toby/skills (kebab-case, lowercase)",
		),
	skillMarkdown: z
		.string()
		.describe(
			"Complete SKILL.md file: YAML frontmatter (name, description, optional summary) between --- fences, then markdown body",
		),
});

const DRAFT_SYSTEM = `You author Toby SKILL.md files. Toby loads skills from ~/.toby/skills/<folder>/SKILL.md.

Return only structured fields matching the schema.

skillMarkdown requirements:
- Must begin with YAML frontmatter delimited by lines containing only ---.
- Frontmatter keys must include:
  - name: short identifier (prefer lowercase kebab-case matching the folder name)
  - description: when this skill should apply (one or two sentences; used for automatic routing)
  - summary: optional concise summary of key instructions (one sentence; shown alongside description in skill catalogs for better routing)
- After the closing ---, write the instructional markdown body (headings, lists, steps as appropriate).
- Do not wrap the file in markdown code fences.
- Do not invent user-specific secrets or paths outside ~/.toby/skills.

recommendedFolderName must be a single path segment: lowercase letters, digits, and hyphens only (kebab-case).`;

const UPDATE_APPENDIX = `
When updating an existing skill:
- Keep the same skill intent unless the user explicitly asks to repurpose it.
- Preserve useful existing instructions, refining them instead of replacing everything by default.
- Keep frontmatter valid with non-empty name and description.`;

type GlobalChatToolsContext = {
	readonly dryRun: boolean;
	readonly persona: Persona;
	/** Mutated on successful writes (and dry-run previews). */
	readonly appliedActions: string[];
};

/** Explains global tools for integration system prompts. */
export function globalChatToolsPromptSection(): string {
	const skillsCatalog = formatSkillsCatalogForPrompt(loadLocalSkills());
	const hasSearch = Boolean(getBraveSearchApiKeyRaw());
	const searchToolLine = hasSearch
		? "\n- **webSearch**: Search the web using Brave Search. Returns titles, URLs, descriptions, and optional page age. Use when the user asks about current events, facts, research, or anything requiring up-to-date information from the web. Always cite source URLs from search results."
		: "";
	const searchRules = hasSearch
		? `
Web search and fetch rules:
- When the user asks to search, find, look up, or research something on the web, use **webSearch** first, then optionally **fetchWebContent** on the most relevant result URLs.
- When the user shares a URL or asks to read a specific page, use **fetchWebContent** directly.
- Never claim knowledge about current events, recent news, or time-sensitive facts without using **webSearch** first.`
		: "";
	return `
Global Toby tools (always available in addition to integration tools):
- **createLocalSkill**: Draft a SKILL.md from your written description and save it under ~/.toby/skills/<folder>/SKILL.md. Required: \`description\`. Optional: \`preferredFolderName\` (kebab-case). Optional: \`updateExisting\` (boolean, default false). If the folder name is omitted, the drafting step recommends one; if that folder already exists and no preferred name was given, a numeric suffix is used. If \`updateExisting\` is true with a matching folder, the existing SKILL.md is revised in place; otherwise existing skills are not overwritten.
- **loadLocalSkillInstructions**: Load full SKILL.md instruction bodies for one or more local skills by exact name.
- **memorySearch**: Search the user's stored personal memories (preferences, relationships, projects, facts, etc.).
- **memoryPropose**: Propose saving a new memory. High-confidence normal preferences are auto-saved; sensitive or low-confidence items stay pending until confirmed with **memorySave**.
- **memorySave**: Confirm a pending memory proposal.
- **memoryForget**: Delete a stored memory.
- **memoryExplain**: Show why a memory exists (source and audit trail).
- **memoryRetrieveForTask**: Retrieve memories relevant to the current task.
- **getCurrentDateTime**: Return the current local/UTC date-time and timezone.
- **fetchWebContent**: Fetch a web page and extract its main readable content (strips ads, navigation, footers). Returns article title, text content, excerpt, and metadata. Use to read blog posts, articles, documentation, or any page with substantive text.${searchToolLine}
${searchRules}

Memory rules:
- **Always** use **memoryPropose** when the user shares a durable preference, fact, or personal context worth remembering. Never skip this.
- Use **memoryRetrieveForTask** at the start of a turn to recall relevant context before acting.
- Use **memorySearch** when you need to look up something specific the user previously mentioned.
- Use **memoryForget** when the user asks to remove a memory.
- Use **memoryExplain** when the user asks why you know something.

Time/date rules:
- Treat "today", "now", "this week", deadlines, and scheduling as time-sensitive requests.
- For time-sensitive work, call **getCurrentDateTime** before finalizing your answer.

Local skill routing:
- First, use the descriptions below to decide if a local skill is relevant.
- If relevant, call **loadLocalSkillInstructions** with exact skill names before finalizing the answer.
- Only load skills that are clearly applicable; do not load unrelated skills "just in case".

Available local skills (name + description):
${skillsCatalog}

${reflectToolsPromptSection()}
`;
}

export function sanitizeSkillFolderSegment(raw: string): string | null {
	const s = raw
		.trim()
		.toLowerCase()
		.replace(/\s+/g, "-")
		.replace(/[^a-z0-9-]/g, "")
		.replace(/-+/g, "-")
		.replace(/^-|-$/g, "");
	if (!s || s.length > 80 || s === "." || s === "..") {
		return null;
	}
	return s;
}

function skillFilePath(skillsRoot: string, folder: string): string {
	return path.join(skillsRoot, folder, SKILL_MD_BASENAME);
}

function skillMarkdownExists(skillsRoot: string, folder: string): boolean {
	return fs.existsSync(skillFilePath(skillsRoot, folder));
}

function allocateUniqueFolder(skillsRoot: string, base: string): string {
	let candidate = base;
	let i = 2;
	while (fs.existsSync(path.join(skillsRoot, candidate))) {
		candidate = `${base}-${i}`;
		i += 1;
	}
	return candidate;
}

async function draftSkillMarkdown(params: {
	readonly persona: Persona;
	readonly description: string;
	readonly preferredFolderHint?: string;
	readonly existingSkillMarkdown?: string;
}): Promise<z.infer<typeof skillDraftSchema> | null> {
	const hint =
		params.preferredFolderHint?.trim() &&
		params.preferredFolderHint.trim().length > 0
			? `\nPreferred folder name (if valid kebab-case): ${params.preferredFolderHint.trim()}`
			: "";
	const existing =
		params.existingSkillMarkdown &&
		params.existingSkillMarkdown.trim().length > 0
			? `\n\nExisting SKILL.md to revise:\n${params.existingSkillMarkdown.trim()}`
			: "";
	try {
		const model = createModelForPersona(params.persona);
		const result = await generateText({
			model,
			system: `${DRAFT_SYSTEM}${existing ? UPDATE_APPENDIX : ""}`,
			prompt: `Write a SKILL.md for this skill request:${hint}

User description:
${params.description.trim()}${existing}`,
			output: Output.object({
				schema: zodSchema(skillDraftSchema),
				name: "SkillDraft",
				description: "SKILL.md draft for Toby",
			}),
			temperature: 0.3,
			maxOutputTokens: 8192,
		});
		return result.output ?? null;
	} catch {
		return null;
	}
}

export function createGlobalChatTools(
	ctx: GlobalChatToolsContext,
): Record<string, Tool> {
	const reflectTools = createReflectTools({
		dryRun: ctx.dryRun,
		persona: ctx.persona,
	});
	return {
		...reflectTools,
		...createWebFetchTools(),
		...(getBraveSearchApiKeyRaw()
			? createBraveSearchTools({
					dryRun: ctx.dryRun,
					appliedActions: ctx.appliedActions,
				})
			: {}),
		getCurrentDateTime: tool({
			description:
				"Get the current local datetime, UTC datetime, timezone, and Unix milliseconds.",
			inputSchema: z.object({}),
			execute: async () => {
				return getCurrentDateTimeInfo();
			},
		}),
		loadLocalSkillInstructions: tool({
			description:
				"Load full local SKILL.md instruction bodies by exact skill name. Use this after reviewing available skill descriptions in the prompt when a skill appears relevant to the user's request.",
			inputSchema: z.object({
				names: z
					.array(z.string().min(1))
					.min(1)
					.max(5)
					.describe(
						"Exact local skill names to load (as listed in available local skills)",
					),
			}),
			execute: async ({ names }) => {
				const all = loadLocalSkills();
				const wanted = [...new Set(names.map((n) => n.trim()).filter(Boolean))];
				const resolved = resolveSkillsByNames(all, wanted);
				const resolvedByLower = new Set(
					resolved.map((s) => s.name.trim().toLowerCase()),
				);
				const missing = wanted.filter(
					(n) => !resolvedByLower.has(n.trim().toLowerCase()),
				);
				if (resolved.length === 0) {
					return {
						ok: false as const,
						error:
							"No matching local skills were found for the requested names.",
						requested: wanted,
						availableSkillNames: all.map((s) => s.name),
					};
				}
				return {
					ok: true as const,
					loaded: resolved.map((s) => ({
						name: s.name,
						description: s.description,
						summary: s.summary || undefined,
						bodyMarkdown: s.bodyMarkdown,
					})),
					missingNames: missing,
				};
			},
		}),
		createLocalSkill: tool({
			description:
				"Create or update a Toby skill: drafts a SKILL.md (frontmatter + body) from a description and saves it under ~/.toby/skills/<folder>/SKILL.md. Use updateExisting=true to revise an existing skill in place.",
			inputSchema: z.object({
				description: z
					.string()
					.min(1)
					.describe("What the skill should contain or how it should behave"),
				preferredFolderName: z
					.string()
					.optional()
					.describe(
						"Optional kebab-case folder name; when updateExisting=true this targets the skill folder to revise",
					),
				updateExisting: z
					.boolean()
					.optional()
					.describe(
						"When true, overwrite an existing ~/.toby/skills/<folder>/SKILL.md instead of creating a new one",
					),
			}),
			execute: async ({ description, preferredFolderName, updateExisting }) => {
				const shouldUpdate = updateExisting === true;
				const preferred = preferredFolderName?.trim()
					? sanitizeSkillFolderSegment(preferredFolderName)
					: null;
				if (preferredFolderName?.trim() && !preferred) {
					return {
						ok: false as const,
						error:
							"preferredFolderName must be kebab-case (letters, digits, hyphens only).",
					};
				}

				if (shouldUpdate && !preferred) {
					return {
						ok: false as const,
						error:
							"updateExisting=true requires preferredFolderName so Toby knows which skill to update.",
					};
				}

				ensureTobyDir();
				const skillsRoot = getSkillsDir();
				try {
					fs.mkdirSync(skillsRoot, { recursive: true });
				} catch (e) {
					return {
						ok: false as const,
						error:
							e instanceof Error
								? e.message
								: "Could not create skills directory.",
					};
				}

				let folder: string | null = null;
				let existingSkillMarkdown: string | undefined;
				if (preferred) {
					folder = preferred;
					const targetFile = skillFilePath(skillsRoot, folder);
					const exists = skillMarkdownExists(skillsRoot, folder);
					if (shouldUpdate && !exists) {
						return {
							ok: false as const,
							error: `No existing skill found at ~/.toby/skills/${folder}/SKILL.md to update.`,
						};
					}
					if (!shouldUpdate && exists) {
						return {
							ok: false as const,
							error: `SKILL.md already exists at ~/.toby/skills/${folder}/SKILL.md — choose another preferredFolderName or set updateExisting=true.`,
						};
					}
					if (shouldUpdate) {
						try {
							existingSkillMarkdown = fs.readFileSync(targetFile, "utf-8");
						} catch (e) {
							return {
								ok: false as const,
								error:
									e instanceof Error
										? e.message
										: "Failed to read existing SKILL.md for update.",
							};
						}
					}
				}

				const draft = await draftSkillMarkdown({
					persona: ctx.persona,
					description,
					preferredFolderHint: preferredFolderName,
					existingSkillMarkdown,
				});
				if (!draft) {
					return {
						ok: false as const,
						error:
							"Could not draft SKILL.md (model error or timeout). Try again with a clearer description.",
					};
				}

				const parsedFm = parseSkillFrontmatterAndBody(draft.skillMarkdown);
				if (!parsedFm) {
					return {
						ok: false as const,
						error:
							"Draft SKILL.md is missing valid YAML frontmatter (expected --- blocks).",
					};
				}
				const fmName = parsedFm.frontmatter.name?.trim();
				const fmDesc = parsedFm.frontmatter.description?.trim();
				if (!fmName || !fmDesc) {
					return {
						ok: false as const,
						error:
							"Draft frontmatter must include non-empty name and description.",
					};
				}
				if (!preferred) {
					const aiFolder = sanitizeSkillFolderSegment(
						draft.recommendedFolderName,
					);
					if (!aiFolder) {
						return {
							ok: false as const,
							error:
								"Model returned an invalid recommendedFolderName; ask for a preferredFolderName.",
						};
					}
					folder = allocateUniqueFolder(skillsRoot, aiFolder);
				}
				if (!folder) {
					return {
						ok: false as const,
						error: "Could not resolve target skill folder.",
					};
				}

				const probe = parseSkillFileContent(folder, draft.skillMarkdown);
				if (!probe) {
					return {
						ok: false as const,
						error: "Draft failed validation after folder resolution.",
					};
				}

				const targetDir = path.join(skillsRoot, folder);
				const targetFile = skillFilePath(skillsRoot, folder);

				if (ctx.dryRun) {
					const action = shouldUpdate ? "update" : "write";
					const msg = `[dry-run] Would ${action} ${targetFile}`;
					ctx.appliedActions.push(msg);
					return {
						ok: true as const,
						dryRun: true,
						folder,
						path: targetFile,
						skillName: probe.name,
						message: msg,
					};
				}

				try {
					fs.mkdirSync(targetDir, { recursive: true });
					fs.writeFileSync(
						targetFile,
						`${draft.skillMarkdown.trimEnd()}\n`,
						shouldUpdate
							? { encoding: "utf-8", flag: "w" }
							: { encoding: "utf-8", flag: "wx" },
					);
				} catch (e) {
					const code =
						e !== null &&
						typeof e === "object" &&
						"code" in e &&
						typeof (e as { code?: unknown }).code === "string"
							? (e as { code: string }).code
							: undefined;
					if (code === "EEXIST") {
						return {
							ok: false as const,
							error: `SKILL.md already exists at ${targetFile}.`,
						};
					}
					return {
						ok: false as const,
						error: e instanceof Error ? e.message : "Failed to write SKILL.md.",
					};
				}

				const msg = shouldUpdate
					? `Updated skill ~/.toby/skills/${folder}/SKILL.md (${probe.name})`
					: `Wrote skill ~/.toby/skills/${folder}/SKILL.md (${probe.name})`;
				ctx.appliedActions.push(msg);
				return {
					ok: true as const,
					dryRun: false,
					folder,
					path: targetFile,
					skillName: probe.name,
					message: msg,
				};
			},
		}),
	};
}
