import fs from "node:fs";
import path from "node:path";
import {
	NoOutputGeneratedError,
	Output,
	type Tool,
	generateText,
	tool,
	zodSchema,
} from "ai";
import { z } from "zod";
import type { ChatEventSink } from "../chat-pipeline/chat-events";
import {
	type Persona,
	ensureTobyDir,
	getDefaultPersonaName,
	getGeneratedFilesDir,
	getSkillsDir,
} from "../config/index";
import { log } from "../logging/chat-log";
import type { Project } from "../projects/index";
import { loadProjectSkills } from "../projects/index";
import { humanToCronAsync } from "../schedules/cron-parser";
import { createSchedule } from "../schedules/store";
import {
	formatSkillsCatalogForPrompt,
	loadLocalSkills,
	parseSkillFileContent,
	parseSkillFrontmatterAndBody,
	resolveSkillsByNames,
} from "../skills/index";
import { formatChatModelError } from "./chat";
import { getCurrentDateTimeInfo } from "./current-datetime";
import {
	createListenChatTools,
	listenChatToolsPromptSection,
} from "./listen-chat-tools";
import { createLocationGlobalTools } from "./location-global-tools";
import { createModelForAuxiliary } from "./model-factory";
import { createReflectTools, reflectToolsPromptSection } from "./reflect-tools";
import { createSubAgentTool, subAgentPromptSection } from "./sub-agent-tool";
import {
	createWeatherGlobalTools,
	isWeatherAvailable,
} from "./weather/weather-global-tools";
import { createWebFetchTools } from "./web-fetch-tool";
import {
	createWebSearchGlobalTools,
	isWebSearchAvailable,
} from "./web-search-global-tools";

const SKILL_MD_BASENAME = "SKILL.md";

const skillDraftSchema = z.object({
	recommendedFolderName: z
		.string()
		.describe(
			"Suggested folder name under the target skills directory (kebab-case, lowercase)",
		),
	skillMarkdown: z
		.string()
		.describe(
			"Complete SKILL.md file: YAML frontmatter (name, description) between --- fences, then markdown body",
		),
});

const DRAFT_SYSTEM = `You author Toby SKILL.md files. Toby loads global skills from ~/.toby/skills/<folder>/SKILL.md and project skills from <project>/.agent/skills/<folder>/SKILL.md.

Return only structured fields matching the schema.

skillMarkdown requirements:
- Must begin with YAML frontmatter delimited by lines containing only ---.
- Frontmatter keys must include:
  - name: short identifier (prefer lowercase kebab-case matching the folder name)
  - description: when this skill should apply (one or two sentences; used for automatic routing)
- After the closing ---, write the instructional markdown body (headings, lists, steps as appropriate).
- Do not wrap the file in markdown code fences.
- Do not invent user-specific secrets or unrelated filesystem paths.

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
	/** Active project, used to scope `writeTextFile` into the project context. */
	readonly project?: Project | null;
	/** Abort signal from the parent turn, propagated to the sub-agent. */
	readonly abortSignal?: AbortSignal;
	/** Event sink for emitting sub-agent tool-call events to the UI. */
	readonly emit?: ChatEventSink;
	/** Sequence counter for event emission. */
	readonly nextSeq?: () => number;
	/** Session ID for log attribution. */
	readonly sessionId?: string;
};

/** Text file extensions `writeTextFile` is allowed to create. */
const WRITE_TEXT_FILE_EXTENSIONS: ReadonlySet<string> = new Set([
	".md",
	".markdown",
	".txt",
	".text",
	".json",
	".yaml",
	".yml",
	".csv",
	".tsv",
	".log",
	".xml",
	".html",
	".rst",
]);

type WriteTextFileLocation = "context" | "outputs";

interface ResolveWriteTargetResult {
	readonly ok: boolean;
	readonly error?: string;
	readonly absPath?: string;
	readonly baseDir?: string;
	/** Human-readable label for the base location. */
	readonly baseLabel?: string;
}

/**
 * Resolve and validate the absolute target path for `writeTextFile`. Rejects
 * absolute inputs, parent-directory traversal, and paths that escape the base
 * directory (active project context/root, or the generated-files fallback).
 */
export function resolveWriteTextFileTarget(params: {
	readonly inputPath: string;
	readonly location: WriteTextFileLocation;
	readonly project?: Project | null;
}): ResolveWriteTargetResult {
	const raw = params.inputPath.trim();
	if (!raw) {
		return { ok: false, error: "path must not be empty." };
	}
	if (path.isAbsolute(raw)) {
		return {
			ok: false,
			error: "path must be relative (absolute paths are not allowed).",
		};
	}
	const normalized = path.normalize(raw);
	if (
		normalized === ".." ||
		normalized.startsWith(`..${path.sep}`) ||
		normalized.split(path.sep).includes("..")
	) {
		return {
			ok: false,
			error: "path must not traverse outside the base directory.",
		};
	}

	let baseDir: string;
	let baseLabel: string;
	if (params.project) {
		switch (params.location) {
			case "outputs":
				baseDir = params.project.outputsDir;
				baseLabel = `project "${params.project.name}" outputs`;
				break;
			default:
				baseDir =
					(params.project as { folderPath?: string }).folderPath ??
					params.project.dir;
				baseLabel = `project "${params.project.name}" folder`;
				break;
		}
	} else {
		baseDir = getGeneratedFilesDir();
		baseLabel = "~/.toby/generated-files";
	}

	const absPath = path.resolve(baseDir, normalized);
	const relCheck = path.relative(baseDir, absPath);
	if (relCheck.startsWith("..") || path.isAbsolute(relCheck)) {
		return { ok: false, error: "Resolved path escapes the base directory." };
	}

	const ext = path.extname(absPath).toLowerCase();
	if (!ext) {
		return { ok: false, error: "path must include a file extension." };
	}
	if (!WRITE_TEXT_FILE_EXTENSIONS.has(ext)) {
		return {
			ok: false,
			error: `Unsupported file type "${ext}". Allowed: ${[...WRITE_TEXT_FILE_EXTENSIONS].join(", ")}.`,
		};
	}

	return { ok: true, absPath, baseDir, baseLabel };
}

/** Explains global tools for integration system prompts. */
export function globalChatToolsPromptSection(
	project?: Project | null,
	persona?: Persona | null,
): string {
	const globalSkills = loadLocalSkills().filter((s) => s.enabled !== false);
	const projectSkills = project ? loadProjectSkills(project) : [];
	const allSkills = [...globalSkills, ...projectSkills];
	const skillsCatalog = formatSkillsCatalogForPrompt(allSkills);
	const hasSearch = isWebSearchAvailable(persona);
	const hasWeather = isWeatherAvailable(persona);
	const searchToolLine = hasSearch
		? "\n- **webSearch**: Search the web via Perplexity through the AI Gateway. Returns titles, URLs, snippets, and optional dates. Use when the user asks about current events, facts, research, or anything requiring up-to-date information from the web. Always cite source URLs from search results."
		: "";
	const weatherToolLine = hasWeather
		? "\n- **getWeather**: Fetch structured weather forecast (and current conditions when asking about today) for a place name or lat/lon and optional date. Worldwide via Open-Meteo. Prefer this over webSearch for weather, temperature, precipitation, or forecast questions."
		: "";
	const locationToolLine =
		"\n- **getMyLocation**: Read the user's current geographic location from this Mac (lat/lon + reverse-geocoded place). Triggers the macOS Location Services permission prompt for Toby.app if needed. macOS only.";
	const searchRules = hasSearch
		? `
Web search and fetch rules:
- When the user asks to search, find, look up, or research something on the web, use **webSearch** first, then optionally **fetchWebContent** on the most relevant result URLs.
- When the user shares a URL or asks to read a specific page, use **fetchWebContent** directly.
- Never claim knowledge about current events, recent news, or time-sensitive facts without using **webSearch** first.`
		: "";
	const weatherRules = hasWeather
		? `
Weather rules:
- When the user asks about weather, forecast, temperature, rain, or climate conditions for a place/date, use **getWeather**.
- Prefer **getWeather** over **webSearch** for structured weather data.
- If the place is ambiguous, pass the best location string you can; the tool geocodes place names.
- When the user asks about weather "here" / "near me" without a place name, call **getMyLocation** first, then pass coordinates or the place name into **getWeather**.`
		: "";
	const locationRules = `
Location rules:
- When the user asks where they are, for their current location, or for "near me" / "here" geographic context, use **getMyLocation**.
- **getMyLocation** may prompt for macOS Location Services permission the first time; if access is denied, explain that the user can allow Location for Toby in System Settings or the Permissions window.`;
	return `
Global Toby tools (always available in addition to integration tools):
- **loadLocalSkillInstructions**: Load full SKILL.md instruction bodies for one or more local skills by exact name.
- **memorySearch**: Search the user's stored personal memories (preferences, relationships, projects, facts, etc.).
- **memoryPropose**: Propose saving a new memory. High-confidence normal preferences are auto-saved; sensitive or low-confidence items stay pending until confirmed with **memorySave**.
- **memorySave**: Confirm a pending memory proposal.
- **memoryForget**: Delete a stored memory.
- **memoryExplain**: Show why a memory exists (source and audit trail).
- **memoryRetrieveForTask**: Retrieve memories relevant to the current task.
- **getCurrentDateTime**: Return the current local/UTC date-time and timezone.
- **fetchWebContent**: Fetch a web page and extract its main readable content (strips ads, navigation, footers). Returns article title, text content, excerpt, and metadata. Use to read blog posts, articles, documentation, or any page with substantive text.${searchToolLine}${weatherToolLine}${locationToolLine}
- **createSchedule**: Create a recurring scheduled chat run. Required: \`intention\` (what the schedule does), \`targetOutput\` (\`slack\` | \`project\` | \`none\`). Optional: \`frequency\` (natural language like "every weekday at 9am" or a cron expression) and \`projectId\`. If the user has not specified a frequency, **omit it** — the tool will return a signal; then call **askUser** to ask the user how often it should run and retry. The schedule runs headlessly via the daemon using the default persona.
${searchRules}${weatherRules}${locationRules}

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

Create or update a skill (explicit request only):
- **createLocalSkill** is available only when the user explicitly asks to create, draft, or update a Toby skill (or when pretreatment selected it for that request). Do not use it to capture general conversation, memories, or one-off instructions.
- It saves to the shared skills folder at \`~/.toby/skills/<folder>/SKILL.md\`.
- When a project is active, it saves to \`<project>/.agent/skills/<folder>/SKILL.md\`.
- When the request is to author a skill, **always prefer createLocalSkill over writeTextFile** — do not hand-write a SKILL.md with writeTextFile.
- Required: \`description\`. Optional: \`preferredFolderName\` (kebab-case). Optional: \`updateExisting\` (boolean, default false).

Write a text file (explicit request only):
- **writeTextFile** is available only when the user explicitly asks to write, generate, or save a file (Markdown or any text format). Do not use it for general notes or memories.
- Do not use writeTextFile to author Toby skills (SKILL.md). Use **createLocalSkill** instead.
- When a project is active, writes go to the project's **outputs** folder by default (for generated artifacts). Use \`location='context'\` only when the user wants to place a reference file in the project folder. When no project is active, writes go to \`~/.toby/generated-files\`.
- Required: \`path\` (relative) and \`content\`. Optional: \`location\` (\`outputs\` | \`context\`), \`overwrite\` (default false).

Available local skills (name + description):
${skillsCatalog}

${listenChatToolsPromptSection()}
${reflectToolsPromptSection()}
${subAgentPromptSection()}
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

type SkillDraftResult = {
	readonly ok: boolean;
	readonly draft?: z.infer<typeof skillDraftSchema>;
	readonly error?: string;
};

/**
 * Convert a frontmatter `name` value into a kebab-case folder segment.
 * Falls back to null if the result is empty.
 */
function folderFromName(name: string): string | null {
	const slug = name
		.trim()
		.toLowerCase()
		.replace(/[^\w\s-]/g, " ")
		.split(/\s+/)
		.filter(Boolean)
		.join("-")
		.replace(/-+/g, "-")
		.replace(/^-|-$/g, "");
	return slug || null;
}

async function draftSkillMarkdown(params: {
	readonly persona: Persona;
	readonly description: string;
	readonly preferredFolderHint?: string;
	readonly existingSkillMarkdown?: string;
}): Promise<SkillDraftResult> {
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
	const modelLabel = `${params.persona.ai.provider}/${params.persona.ai.model}`;
	const systemPrompt = `${DRAFT_SYSTEM}${existing ? UPDATE_APPENDIX : ""}`;
	const userPrompt = `Write a SKILL.md for this skill request:${hint}

User description:
${params.description.trim()}${existing}`;

	// --- Attempt 1: structured output via Output.object ---
	try {
		const model = createModelForAuxiliary({ persona: params.persona });
		const result = await generateText({
			model,
			instructions: systemPrompt,
			prompt: userPrompt,
			output: Output.object({
				schema: zodSchema(skillDraftSchema),
				name: "SkillDraft",
				description: "SKILL.md draft for Toby",
			}),
			temperature: 0.3,
			maxOutputTokens: 8192,
		});
		if (result.output) {
			return { ok: true, draft: result.output };
		}
		// output was null without throwing — fall through to text fallback
		log("warn", "tool", "skill_draft_empty_output", {
			persona: params.persona.name,
			model: modelLabel,
		});
	} catch (error) {
		const errorMsg = formatChatModelError(error);
		log("warn", "tool", "skill_draft_failed", {
			persona: params.persona.name,
			model: modelLabel,
			error: errorMsg,
		});

		// If structured output parsing failed, retry with plain text generation.
		// Many models (especially through non-OpenAI providers) produce valid
		// SKILL.md content but can't conform to the structured-output schema.
		if (NoOutputGeneratedError.isInstance(error)) {
			const fallback = await draftSkillMarkdownFromText({
				persona: params.persona,
				systemPrompt,
				userPrompt,
				preferredFolderHint: params.preferredFolderHint,
				modelLabel,
			});
			if (fallback.ok) return fallback;
			return {
				ok: false,
				error: `Structured output parsing failed (${errorMsg}) and text fallback also failed: ${fallback.error}`,
			};
		}

		return { ok: false, error: errorMsg };
	}

	// --- Attempt 2: plain text fallback (structured output returned null) ---
	const fallback = await draftSkillMarkdownFromText({
		persona: params.persona,
		systemPrompt,
		userPrompt,
		preferredFolderHint: params.preferredFolderHint,
		modelLabel,
	});
	if (fallback.ok) return fallback;
	return {
		ok: false,
		error: `Structured output returned no result and text fallback failed: ${fallback.error}`,
	};
}

/**
 * Fallback that asks the model to produce the SKILL.md as plain text (no
 * structured-output schema) and parses the frontmatter manually. Used when
 * `Output.object` fails or returns null.
 */
async function draftSkillMarkdownFromText(params: {
	readonly persona: Persona;
	readonly systemPrompt: string;
	readonly userPrompt: string;
	readonly preferredFolderHint?: string;
	readonly modelLabel: string;
}): Promise<SkillDraftResult> {
	const textSystem = `${params.systemPrompt}

IMPORTANT: Respond with ONLY the raw SKILL.md file content. Start with --- on its own line, then YAML frontmatter (name, description), then --- on its own line, then the markdown body. Do not wrap the output in markdown code fences. Do not add any commentary before or after the file content.`;

	try {
		const model = createModelForAuxiliary({ persona: params.persona });
		const result = await generateText({
			model,
			instructions: textSystem,
			prompt: params.userPrompt,
			temperature: 0.3,
			maxOutputTokens: 8192,
		});

		const raw = result.text?.trim();
		if (!raw) {
			return { ok: false, error: "Model returned empty text." };
		}

		// Strip markdown code fences if the model added them despite instructions.
		const stripped = raw
			.replace(/^```(?:markdown|md|yaml)?\s*\n?/, "")
			.replace(/\n?```\s*$/, "");

		const parsed = parseSkillFrontmatterAndBody(stripped);
		if (!parsed) {
			return {
				ok: false,
				error: "Could not parse YAML frontmatter from model text response.",
			};
		}

		const fmName = parsed.frontmatter.name?.trim();
		const fmDesc = parsed.frontmatter.description?.trim();
		if (!fmName || !fmDesc) {
			return {
				ok: false,
				error: "Frontmatter is missing non-empty name or description.",
			};
		}

		// Derive a folder name from the preferred hint or the frontmatter name.
		let folder: string | null = null;
		if (params.preferredFolderHint?.trim()) {
			folder = sanitizeSkillFolderSegment(params.preferredFolderHint);
		}
		if (!folder) {
			folder = folderFromName(fmName);
		}
		if (!folder) {
			return {
				ok: false,
				error:
					"Could not derive a valid kebab-case folder name from the skill name.",
			};
		}

		log("info", "tool", "skill_draft_text_fallback_ok", {
			persona: params.persona.name,
			model: params.modelLabel,
			folder,
		});

		return {
			ok: true,
			draft: {
				recommendedFolderName: folder,
				skillMarkdown: stripped,
			},
		};
	} catch (error) {
		const errorMsg = formatChatModelError(error);
		log("warn", "tool", "skill_draft_text_fallback_failed", {
			persona: params.persona.name,
			model: params.modelLabel,
			error: errorMsg,
		});
		return { ok: false, error: errorMsg };
	}
}

type ScheduleTargetOutput = "slack" | "project" | "none";

/** Derive a concise kebab-case schedule name from the user's intention. */
function intentionToScheduleName(intention: string): string {
	const words = intention
		.trim()
		.toLowerCase()
		.replace(/[^\w\s-]/g, " ")
		.split(/\s+/)
		.filter(Boolean)
		.slice(0, 6);
	const slug = words.join("-").replace(/-+/g, "-").replace(/^-|-$/g, "");
	return slug || "schedule";
}

/** Build the schedule prompt by appending a delivery instruction for the target output. */
function buildSchedulePrompt(
	intention: string,
	targetOutput: ScheduleTargetOutput,
): string {
	const base = intention.trim();
	switch (targetOutput) {
		case "slack":
			return `${base}\n\nAfter completing your work, post a concise summary of the results to Slack using your available Slack tools (pick an appropriate channel based on the workspace's channels).`;
		case "project":
			return `${base}\n\nAfter completing your work, save the result as a Markdown file in the project outputs using the writeTextFile tool with location='outputs'. Use a descriptive filename.`;
		default:
			return base;
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
		...createListenChatTools(),
		...createWebFetchTools(),
		...createWebSearchGlobalTools({
			persona: ctx.persona,
			dryRun: ctx.dryRun,
			appliedActions: ctx.appliedActions,
		}),
		...createWeatherGlobalTools({
			persona: ctx.persona,
			dryRun: ctx.dryRun,
			appliedActions: ctx.appliedActions,
		}),
		...createLocationGlobalTools({
			dryRun: ctx.dryRun,
			appliedActions: ctx.appliedActions,
		}),
		...createSubAgentTool({
			persona: ctx.persona,
			dryRun: ctx.dryRun,
			abortSignal: ctx.abortSignal,
			emit: ctx.emit,
			nextSeq: ctx.nextSeq,
			sessionId: ctx.sessionId,
			appliedActions: ctx.appliedActions,
		}),
		getCurrentDateTime: tool({
			description:
				"Get the current local datetime, UTC datetime, timezone, and Unix milliseconds.",
			inputSchema: z.object({}),
			execute: async () => {
				return getCurrentDateTimeInfo();
			},
		}),
		createSchedule: tool({
			description:
				"Create a recurring scheduled chat run that executes headlessly via the Toby daemon. Required: 'intention' (what the schedule does), 'targetOutput' (where results go: 'slack' to post a summary to Slack, 'project' to save a file to project outputs, 'none' for actions-only with no external output). Optional: 'frequency' (natural language like 'every weekday at 9am' or a 5-field cron expression) and 'projectId'. If the user has not specified a frequency, OMIT the frequency field — the tool returns a needsFrequency signal; then call askUser to ask the user how often it should run, and call createSchedule again with the answer.",
			inputSchema: z.object({
				intention: z
					.string()
					.min(1)
					.describe(
						"What the schedule does, e.g. 'Summarize my unread email and send key items'",
					),
				targetOutput: z
					.enum(["slack", "project", "none"])
					.describe(
						"'slack' = post a summary to Slack; 'project' = save a Markdown file to project outputs; 'none' = just take actions, no external output",
					),
				frequency: z
					.string()
					.optional()
					.describe(
						"How often it runs, as natural language ('every weekday at 9am', 'every 6 hours') or a 5-field cron expression. Omit if the user hasn't specified a cadence.",
					),
				projectId: z
					.string()
					.optional()
					.describe(
						"Optional project id. When omitted from a project chat and targetOutput='project', the current project is used.",
					),
			}),
			execute: async ({ intention, targetOutput, frequency, projectId }) => {
				if (!frequency || !frequency.trim()) {
					return {
						ok: false as const,
						needsFrequency: true as const,
						error:
							"Frequency was not provided. Use the askUser tool to ask the user how often this schedule should run (e.g. 'every weekday at 9am', 'daily at noon', 'every Monday'), then call createSchedule again with the frequency.",
					};
				}

				let cronExpression: string;
				try {
					cronExpression = await humanToCronAsync(frequency.trim());
				} catch (e) {
					return {
						ok: false as const,
						error:
							e instanceof Error
								? `Could not parse frequency "${frequency}": ${e.message}`
								: `Could not parse frequency "${frequency}".`,
					};
				}

				if (ctx.dryRun) {
					const name = intentionToScheduleName(intention);
					const prompt = buildSchedulePrompt(intention, targetOutput);
					const personaName = getDefaultPersonaName() ?? "Toby";
					const resolvedProjectId =
						projectId?.trim() ||
						(targetOutput === "project" ? ctx.project?.id : undefined);
					const msg = `[dry-run] Would create schedule "${name}" (${cronExpression})`;
					ctx.appliedActions.push(msg);
					return {
						ok: true as const,
						dryRun: true,
						name,
						cronExpression,
						personaName,
						projectId: resolvedProjectId ?? null,
						prompt,
						message: msg,
					};
				}

				const name = intentionToScheduleName(intention);
				const prompt = buildSchedulePrompt(intention, targetOutput);
				const personaName = getDefaultPersonaName() ?? "Toby";
				const resolvedProjectId =
					projectId?.trim() ||
					(targetOutput === "project" ? ctx.project?.id : undefined);

				try {
					const schedule = createSchedule({
						name,
						prompt,
						personaName,
						cronExpression,
						projectId: resolvedProjectId ?? null,
						enabled: true,
					});
					const msg = `Created schedule "${schedule.name}" (id: ${schedule.id}, cron: ${schedule.cronExpression}). It will run ${frequency.trim()} via the daemon.`;
					ctx.appliedActions.push(msg);
					return {
						ok: true as const,
						dryRun: false,
						id: schedule.id,
						name: schedule.name,
						cronExpression: schedule.cronExpression,
						personaName: schedule.personaName,
						enabled: schedule.enabled,
						message: msg,
					};
				} catch (e) {
					return {
						ok: false as const,
						error:
							e instanceof Error ? e.message : "Failed to create schedule.",
					};
				}
			},
		}),
		writeTextFile: tool({
			description:
				"Create or update a UTF-8 text file (Markdown or any other text format). Only call when the user explicitly asks to write, generate, or save a file. Do NOT use this to author a Toby skill — use createLocalSkill instead, which takes precedence for skill authoring. When a project is active, writes go to the project's outputs folder by default (location='outputs') — use location='context' to place a reference file in the project folder. When no project is active, writes go to ~/.toby/generated-files. Paths must be relative and within the base directory. Set overwrite=true to replace an existing file.",
			inputSchema: z.object({
				path: z
					.string()
					.min(1)
					.describe(
						"Relative path (including filename and extension) within the base location, e.g. 'notes.md' or 'reports/summary.md'",
					),
				content: z
					.string()
					.describe("Full UTF-8 text content to write to the file"),
				location: z
					.enum(["context", "outputs"])
					.optional()
					.describe(
						"Where to write within the active project: 'outputs' (default — for generated artifacts), or 'context' (project folder reference file). Ignored when no project is active.",
					),
				overwrite: z
					.boolean()
					.optional()
					.describe(
						"When true, overwrite an existing file instead of failing (default false)",
					),
			}),
			execute: async ({ path: inputPath, content, location, overwrite }) => {
				if (content.includes("\u0000")) {
					return {
						ok: false as const,
						error: "content appears to be binary (contains NUL bytes).",
					};
				}
				const resolved = resolveWriteTextFileTarget({
					inputPath,
					location: location ?? "outputs",
					project: ctx.project ?? null,
				});
				if (!resolved.ok || !resolved.absPath) {
					return {
						ok: false as const,
						error: resolved.error ?? "Could not resolve target path.",
					};
				}
				const targetFile = resolved.absPath;

				let alreadyExists = false;
				try {
					const stat = fs.lstatSync(targetFile);
					alreadyExists = true;
					if (stat.isSymbolicLink()) {
						return {
							ok: false as const,
							error: "Refusing to write through a symlink.",
						};
					}
					if (stat.isDirectory()) {
						return {
							ok: false as const,
							error: "Target path is a directory.",
						};
					}
				} catch {
					alreadyExists = false;
				}

				if (alreadyExists && overwrite !== true) {
					return {
						ok: false as const,
						error: `File already exists at ${targetFile}. Set overwrite=true to replace it.`,
					};
				}

				if (ctx.dryRun) {
					const verb = alreadyExists ? "update" : "write";
					const msg = `[dry-run] Would ${verb} ${targetFile}`;
					ctx.appliedActions.push(msg);
					return {
						ok: true as const,
						dryRun: true,
						path: targetFile,
						created: !alreadyExists,
						message: msg,
					};
				}

				try {
					ensureTobyDir();
					fs.mkdirSync(path.dirname(targetFile), { recursive: true });
					const normalizedContent = content.endsWith("\n")
						? content
						: `${content}\n`;
					fs.writeFileSync(targetFile, normalizedContent, "utf-8");
				} catch (e) {
					return {
						ok: false as const,
						error:
							e instanceof Error ? e.message : "Failed to write text file.",
					};
				}

				const msg = alreadyExists
					? `Updated ${targetFile}`
					: `Wrote ${targetFile} (${resolved.baseLabel})`;
				ctx.appliedActions.push(msg);
				return {
					ok: true as const,
					dryRun: false,
					path: targetFile,
					created: !alreadyExists,
					message: msg,
				};
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
				const globalSkills = loadLocalSkills().filter(
					(s) => s.enabled !== false,
				);
				const projectSkills = ctx.project ? loadProjectSkills(ctx.project) : [];
				const all = [...globalSkills, ...projectSkills];
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
						bodyMarkdown: s.bodyMarkdown,
					})),
					missingNames: missing,
				};
			},
		}),
		createLocalSkill: tool({
			description:
				"Create or update a Toby skill: drafts a SKILL.md (frontmatter + body) from a description and saves it under ~/.toby/skills/<folder>/SKILL.md. When a project is active, saves to the project's .agent/skills/ directory instead so the skill is automatically included in that project's sessions. Only call when the user explicitly asks to create, draft, or update a local skill — not for general notes, memories, or workflow capture unless they asked for a skill file. Use updateExisting=true to revise an existing skill in place.",
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
						"When true, overwrite an existing skill SKILL.md instead of creating a new one",
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
				const project = ctx.project;
				const isProject = project != null;
				const skillsRoot = isProject ? project.skillsDir : getSkillsDir();
				const skillsRootLabel = isProject
					? `project "${project.name}" skills`
					: "~/.toby/skills";
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
							error: `No existing skill found at ${skillsRootLabel}/${folder}/SKILL.md to update.`,
						};
					}
					if (!shouldUpdate && exists) {
						return {
							ok: false as const,
							error: `SKILL.md already exists at ${skillsRootLabel}/${folder}/SKILL.md — choose another preferredFolderName or set updateExisting=true.`,
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

				const draftResult = await draftSkillMarkdown({
					persona: ctx.persona,
					description,
					preferredFolderHint: preferredFolderName,
					existingSkillMarkdown,
				});
				if (!draftResult.ok || !draftResult.draft) {
					return {
						ok: false as const,
						error:
							draftResult.error ??
							"Could not draft SKILL.md. Try again with a clearer description.",
					};
				}
				const draft = draftResult.draft;

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
					? `Updated skill ${skillsRootLabel}/${folder}/SKILL.md (${probe.name})`
					: `Wrote skill ${skillsRootLabel}/${folder}/SKILL.md (${probe.name})`;
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
