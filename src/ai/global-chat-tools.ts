import fs from "node:fs";
import path from "node:path";
import { Output, type Tool, generateText, tool, zodSchema } from "ai";
import { z } from "zod";
import { type Persona, ensureTobyDir, getSkillsDir } from "../config/index";
import {
	parseSkillFileContent,
	parseSkillFrontmatterAndBody,
} from "../skills/index";
import { createModelForPersona } from "./chat";

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
			"Complete SKILL.md file: YAML frontmatter (name, description) between --- fences, then markdown body",
		),
});

const DRAFT_SYSTEM = `You author Toby SKILL.md files. Toby loads skills from ~/.toby/skills/<folder>/SKILL.md.

Return only structured fields matching the schema.

skillMarkdown requirements:
- Must begin with YAML frontmatter delimited by lines containing only ---.
- Frontmatter keys must include:
  - name: short identifier (prefer lowercase kebab-case matching the folder name)
  - description: when this skill should apply (one or two sentences; used for automatic routing)
- After the closing ---, write the instructional markdown body (headings, lists, steps as appropriate).
- Do not wrap the file in markdown code fences.
- Do not invent user-specific secrets or paths outside ~/.toby/skills.

recommendedFolderName must be a single path segment: lowercase letters, digits, and hyphens only (kebab-case).`;

export type GlobalChatToolsContext = {
	readonly dryRun: boolean;
	readonly persona: Persona;
	/** Mutated on successful writes (and dry-run previews). */
	readonly appliedActions: string[];
};

/** Explains global tools for integration system prompts. */
export function globalChatToolsPromptSection(): string {
	return `
Global Toby tools (always available in addition to integration tools):
- **createLocalSkill**: Draft a SKILL.md from your written description and save it under ~/.toby/skills/<folder>/SKILL.md. Required: \`description\`. Optional: \`preferredFolderName\` (kebab-case). If the folder name is omitted, the drafting step recommends one; if that folder already exists and no preferred name was given, a numeric suffix is used. If the user supplied \`preferredFolderName\` and SKILL.md already exists there, the tool fails so nothing is overwritten.
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
}): Promise<z.infer<typeof skillDraftSchema> | null> {
	const hint =
		params.preferredFolderHint?.trim() &&
		params.preferredFolderHint.trim().length > 0
			? `\nPreferred folder name (if valid kebab-case): ${params.preferredFolderHint.trim()}`
			: "";
	try {
		const model = createModelForPersona(params.persona);
		const result = await generateText({
			model,
			system: DRAFT_SYSTEM,
			prompt: `Write a SKILL.md for this skill request:${hint}

User description:
${params.description.trim()}`,
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
	return {
		createLocalSkill: tool({
			description:
				"Create a new Toby skill: drafts a SKILL.md (frontmatter + body) from a description and saves it under ~/.toby/skills/<folder>/SKILL.md. Use when the user wants reusable assistant instructions as a local skill.",
			inputSchema: z.object({
				description: z
					.string()
					.min(1)
					.describe("What the skill should contain or how it should behave"),
				preferredFolderName: z
					.string()
					.optional()
					.describe(
						"Optional kebab-case folder name; must not collide with an existing SKILL.md",
					),
			}),
			execute: async ({ description, preferredFolderName }) => {
				const draft = await draftSkillMarkdown({
					persona: ctx.persona,
					description,
					preferredFolderHint: preferredFolderName,
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

				let folder: string;
				if (preferred) {
					folder = preferred;
					if (skillMarkdownExists(skillsRoot, folder)) {
						return {
							ok: false as const,
							error: `SKILL.md already exists at ~/.toby/skills/${folder}/SKILL.md — choose another preferredFolderName or delete the existing skill.`,
						};
					}
				} else {
					folder = allocateUniqueFolder(skillsRoot, aiFolder);
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
					const msg = `[dry-run] Would write ${targetFile}`;
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
					fs.writeFileSync(targetFile, `${draft.skillMarkdown.trimEnd()}\n`, {
						encoding: "utf-8",
						flag: "wx",
					});
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

				const msg = `Wrote skill ~/.toby/skills/${folder}/SKILL.md (${probe.name})`;
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
