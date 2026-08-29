import type { CoreMessage } from "./ai/chat";
import { currentDateTimePromptSection } from "./ai/current-datetime";
import { globalChatToolsPromptSection } from "./ai/global-chat-tools";
import {
	type UserIntentSpec,
	formatUserMessageWithPretreatment,
} from "./ai/pretreatment";
import { isWeatherAvailable } from "./ai/weather/weather-global-tools";
import { isWebSearchAvailable } from "./ai/web-search-global-tools";
import type { Persona } from "./config/index";
import { getDefaultProvider } from "./config/index";
import {
	ALL_PROVIDER_CATEGORIES,
	PROVIDER_CATEGORY_LABELS,
	type ProviderCategory,
} from "./integrations/types";
import type { IntegrationModule } from "./integrations/types";
import * as memory from "./memory/memory-service";
import {
	DEFAULT_MEMORY_USER_ID,
	MEMORY_INSTRUCTIONS_APPENDIX_START,
	formatMemoriesForInstructions,
} from "./memory/prompt";
import { composeSystemPromptWithPersona } from "./personas/prompt";
import {
	PROJECT_CONTEXT_APPENDIX_START,
	type Project,
	type ProjectContextDoc,
	formatProjectContextForPrompt,
	loadProjectContextDocuments,
} from "./projects/index";
import { type LocalSkill, resolveSkillsByNames } from "./skills/index";

/** Marker appended to system prompts when preflight attaches full SKILL.md bodies. */
export const SKILL_INSTRUCTIONS_APPENDIX_START =
	"\n\n---\n\n## Attached skill instructions (preflight)\n\n";
const CURRENT_DATETIME_START = "<!-- TOBY_DATETIME_START -->";
const CURRENT_DATETIME_END = "<!-- TOBY_DATETIME_END -->";

function buildCurrentDatetimeAppendix(): string {
	return `\n\n${CURRENT_DATETIME_START}
${currentDateTimePromptSection()}
${CURRENT_DATETIME_END}`;
}

function stripCurrentDatetimeAppendix(systemContent: string): string {
	const pattern = new RegExp(
		`\\n\\n${CURRENT_DATETIME_START}[\\s\\S]*?${CURRENT_DATETIME_END}`,
		"g",
	);
	return systemContent.replace(pattern, "");
}

/**
 * Removes any inline datetime appendix from the first system message so it
 * stays stable for prompt caching. Datetime is injected as a separate short
 * system message after the first one (see {@link injectCurrentDateTimeAsSeparateMessage}).
 */
export function stripCurrentDateTimeFromFirstSystemMessage(
	messages: readonly CoreMessage[],
): CoreMessage[] {
	if (messages.length === 0) return [...messages];
	const first = messages[0];
	if (!first || first.role !== "system" || typeof first.content !== "string") {
		return [...messages];
	}
	const cleaned = stripCurrentDatetimeAppendix(first.content);
	if (cleaned === first.content) return [...messages];
	const next = [...messages];
	next[0] = { ...first, content: cleaned };
	return next;
}

/**
 * Inject current date/time as a separate short system message after the first
 * system message. This keeps the first system message stable across turns for
 * provider prompt caching, while still giving the model time context.
 */
export function injectCurrentDateTimeAsSeparateMessage(
	messages: readonly CoreMessage[],
): CoreMessage[] {
	if (messages.length === 0) return [...messages];
	// Ensure no inline datetime in the first system message.
	const cleaned = stripCurrentDateTimeFromFirstSystemMessage(messages);
	const first = cleaned[0];
	if (!first || first.role !== "system") {
		return [...messages];
	}
	const datetimeContent = buildCurrentDatetimeAppendix().trim();
	// Check if a datetime system message already exists right after the first.
	if (
		cleaned.length >= 2 &&
		cleaned[1]?.role === "system" &&
		typeof cleaned[1]?.content === "string" &&
		cleaned[1]?.content.includes(CURRENT_DATETIME_START)
	) {
		const next = [...cleaned];
		next[1] = { role: "system", content: datetimeContent };
		return next;
	}
	// Insert datetime system message after the first system message.
	return [
		first,
		{ role: "system", content: datetimeContent },
		...cleaned.slice(1),
	];
}

/**
 * Legacy: inject datetime into the first system message. Kept for backward
 * compatibility but prefer {@link injectCurrentDateTimeAsSeparateMessage}.
 */
export function injectCurrentDateTimeIntoFirstSystemMessage(
	messages: readonly CoreMessage[],
): CoreMessage[] {
	return injectCurrentDateTimeAsSeparateMessage(messages);
}

export function stripSkillInstructionsAppendix(systemContent: string): string {
	const idx = systemContent.indexOf(SKILL_INSTRUCTIONS_APPENDIX_START);
	if (idx === -1) {
		return systemContent;
	}
	return systemContent.slice(0, idx);
}

/**
 * Appends resolved skill markdown bodies to the first system message.
 * Replaces any prior appendix from an earlier turn (same marker).
 */
export function injectSkillBodiesIntoFirstSystemMessage(
	messages: readonly CoreMessage[],
	selectedSkillNames: readonly string[],
	allSkills: readonly LocalSkill[],
): CoreMessage[] {
	if (messages.length === 0) {
		return [...messages];
	}
	const first = messages[0];
	if (!first || first.role !== "system" || typeof first.content !== "string") {
		return [...messages];
	}
	const base = stripSkillInstructionsAppendix(first.content);
	const resolved = resolveSkillsByNames(allSkills, selectedSkillNames);
	if (resolved.length === 0) {
		if (base === first.content) {
			return [...messages];
		}
		const next = [...messages];
		next[0] = { ...first, content: base };
		return next;
	}

	const blocks = resolved
		.map((s) => `### Skill: ${s.name}\n\n${s.bodyMarkdown}`)
		.join("\n\n---\n\n");
	const appendix = `${SKILL_INSTRUCTIONS_APPENDIX_START}${blocks}`;

	const next = [...messages];
	next[0] = { ...first, content: base + appendix };
	return next;
}

/**
 * Strip any existing project context appendix from a system message string.
 */
export function stripProjectContextAppendix(systemContent: string): string {
	const idx = systemContent.indexOf(PROJECT_CONTEXT_APPENDIX_START);
	if (idx === -1) {
		return systemContent;
	}
	return systemContent.slice(0, idx);
}

/**
 * Append project context documents into the first system message.
 * Replaces any prior appendix from an earlier turn.
 */
export function injectProjectContextIntoFirstSystemMessage(
	messages: readonly CoreMessage[],
	project: Project,
	docs?: readonly ProjectContextDoc[],
): CoreMessage[] {
	if (messages.length === 0) {
		return [...messages];
	}
	const first = messages[0];
	if (!first || first.role !== "system" || typeof first.content !== "string") {
		return [...messages];
	}
	const loadedDocs = docs ?? loadProjectContextDocuments(project);
	const base = stripProjectContextAppendix(first.content);
	const appendix = formatProjectContextForPrompt(project, loadedDocs);
	if (!appendix) {
		if (base === first.content) {
			return [...messages];
		}
		const next = [...messages];
		next[0] = { ...first, content: base };
		return next;
	}
	const next = [...messages];
	next[0] = { ...first, content: base + appendix };
	return next;
}

export function stripMemoryInstructionsAppendix(systemContent: string): string {
	const idx = systemContent.indexOf(MEMORY_INSTRUCTIONS_APPENDIX_START);
	if (idx === -1) {
		return systemContent;
	}
	return systemContent.slice(0, idx);
}

/**
 * Append privacy-filtered memories to the first system message when they fit
 * under the 20k-character budget. Replaces any prior appendix from an earlier turn.
 */
export function injectMemoriesIntoFirstSystemMessage(
	messages: readonly CoreMessage[],
	userId: string = DEFAULT_MEMORY_USER_ID,
): CoreMessage[] {
	if (messages.length === 0) {
		return [...messages];
	}
	const first = messages[0];
	if (!first || first.role !== "system" || typeof first.content !== "string") {
		return [...messages];
	}
	const base = stripMemoryInstructionsAppendix(first.content);
	let appendix = "";
	try {
		appendix = formatMemoriesForInstructions(
			memory.listUsableForPrompt(userId),
		);
	} catch {
		appendix = "";
	}
	if (!appendix) {
		if (base === first.content) {
			return [...messages];
		}
		const next = [...messages];
		next[0] = { ...first, content: base };
		return next;
	}
	const next = [...messages];
	next[0] = { ...first, content: base + appendix };
	return next;
}

function buildDefaultProvidersSection(): string {
	const lines: string[] = [];
	for (const cat of ALL_PROVIDER_CATEGORIES) {
		const defaultName = getDefaultProvider(cat);
		if (defaultName) {
			lines.push(
				`- ${PROVIDER_CATEGORY_LABELS[cat]}: **${defaultName}** (use its tools by default for ${cat} tasks)`,
			);
		}
	}
	if (lines.length === 0) {
		return "";
	}
	return `Default providers (prefer these when the user's request matches):
${lines.join("\n")}`;
}

function buildCombinedChatBasePrompt(
	modules: readonly IntegrationModule[],
	project?: Project | null,
	persona?: Persona | null,
): string {
	const labels = modules.map((m) => m.displayName).join(", ");
	const integrationBlocks = modules
		.map((m) => m.chatModelPrep?.systemPromptSection?.trim())
		.filter((b): b is string => Boolean(b && b.length > 0))
		.join("\n\n");
	const defaultsSection = buildDefaultProvidersSection();

	const hasSearch = isWebSearchAvailable(persona);
	const hasWeather = isWeatherAvailable(persona);
	const searchToolsList = hasSearch ? ", **webSearch**" : "";
	const weatherToolsList = hasWeather ? ", **getWeather**" : "";
	const locationToolsList = ", **getMyLocation**";
	const searchRule = hasSearch
		? "\n- **Web search**: When the user asks about current events, facts, research, or anything requiring up-to-date information, use **webSearch** (Perplexity via AI Gateway) to find results. When the user shares a URL or asks to read a page, use **fetchWebContent** to extract the article content. Never claim knowledge about current events without searching first."
		: "";
	const weatherRule = hasWeather
		? '\n- **Weather**: When the user asks about weather, forecast, or temperature for a place, use **getWeather** (prefer over webSearch for structured weather data). For weather "here" / "near me", call **getMyLocation** first when no place is given.'
		: "";
	const locationRule =
		'\n- **Location**: When the user asks where they live / their home / a saved address, search memory first. Use **getMyLocation** only for where they are right now or for "near me" / "here" (may prompt for macOS Location Services).';
	return `You are Toby, a personal assistant with access to: **${labels}**.

Use the integration tools below for your connected integrations, plus the global Toby tools (**askUser**, **fetchWebContent**${searchToolsList}${weatherToolsList}${locationToolsList}). Pick the right integration based on the user's request. Use **createLocalSkill** only when the user explicitly asks to create or update a ~/.toby/skills skill file.

Shared rules:
- Use **askUser** whenever you need a multiple-choice decision from the user. The terminal does not respond to questions written only in plain assistant text.
- If the request is fully answered, stop without dangling "Would you like…?" in prose unless you call **askUser** with concrete options.
- When listing emails, tasks, or options in assistant text, prefer markdown list items (\`- item\`) with one item per line.${searchRule}${weatherRule}${locationRule}
${defaultsSection ? `\n${defaultsSection}\n` : ""}
${integrationBlocks}
${globalChatToolsPromptSection(project, persona)}
`;
}

function formatIntegrationPrepError(
	module: IntegrationModule,
	error: unknown,
): string {
	const message = error instanceof Error ? error.message : String(error);
	return `## ${module.displayName}\n\nConnection context unavailable (${message}). Integration tools may still work once the connection recovers.`;
}

async function buildSingleModuleSessionMessages(
	module: IntegrationModule,
	persona: Persona,
	userPrompt: string,
): Promise<CoreMessage[]> {
	if (!module.chatModelPrep) {
		throw new Error(
			`prepareChatSessionMessages: integration "${module.name}" does not export chatModelPrep`,
		);
	}
	try {
		return await module.chatModelPrep.buildSingleSessionMessages(
			persona,
			userPrompt,
		);
	} catch (error) {
		const section = module.chatModelPrep.systemPromptSection?.trim();
		const systemContent = composeSystemPromptWithPersona(
			section
				? `### ${module.displayName}\n${section}`
				: `### ${module.displayName}`,
			persona,
		);
		return [
			{ role: "system", content: systemContent },
			{
				role: "user",
				content: `${formatIntegrationPrepError(module, error)}\n\nUser request:\n${userPrompt || "(no additional text — follow the system instruction.)"}`,
			},
		];
	}
}

export type SessionPrepProgress = (detail: string) => void | Promise<void>;

export async function prepareChatSessionMessages(
	modules: readonly IntegrationModule[],
	persona: Persona,
	userPrompt: string,
	onProgress?: SessionPrepProgress,
	project?: Project | null,
): Promise<CoreMessage[]> {
	if (modules.length === 0) {
		throw new Error("prepareChatSessionMessages: no modules");
	}

	const report = async (detail: string): Promise<void> => {
		await onProgress?.(detail);
	};

	if (modules.length === 1) {
		const only = modules[0];
		if (only) {
			await report(`Integration: ${only.displayName}`);
		}
	} else {
		await report(
			`Integrations: ${modules.map((m) => m.displayName).join(", ")}`,
		);
	}

	if (modules.length === 1) {
		const module = modules[0];
		if (!module) {
			throw new Error("prepareChatSessionMessages: missing module");
		}
		await report(`Loading ${module.displayName} connection context…`);
		const messages = await buildSingleModuleSessionMessages(
			module,
			persona,
			userPrompt,
		);
		await report(`${module.displayName} context ready.`);
		return injectCurrentDateTimeIntoFirstSystemMessage(messages);
	}
	await report("Loading integration context in parallel…");
	const parts = await Promise.all(
		modules.map(async (m) => {
			if (!m.chatModelPrep) {
				throw new Error(
					`prepareChatSessionMessages: integration "${m.name}" does not export chatModelPrep`,
				);
			}
			await report(`Loading ${m.displayName} connection context…`);
			try {
				const content = await m.chatModelPrep.buildMultiUserContent(userPrompt);
				await report(`${m.displayName} context ready.`);
				return content;
			} catch (error) {
				await report(`${m.displayName} context unavailable.`);
				return formatIntegrationPrepError(m, error);
			}
		}),
	);

	await report("Assembling combined session prompt…");
	const systemContent = composeSystemPromptWithPersona(
		buildCombinedChatBasePrompt(modules, project, persona),
		persona,
	);

	return injectCurrentDateTimeIntoFirstSystemMessage([
		{ role: "system", content: systemContent },
		{
			role: "user",
			content: parts.filter(Boolean).join("\n\n---\n\n"),
		},
	]);
}

function coreMessageUserText(message: CoreMessage | undefined): string {
	if (!message || message.role !== "user") {
		return "";
	}
	const { content } = message;
	if (typeof content === "string") {
		return content;
	}
	if (Array.isArray(content)) {
		return content
			.map((part) => {
				if (typeof part === "string") {
					return part;
				}
				if (part && typeof part === "object" && "text" in part) {
					return String((part as { text: string }).text);
				}
				return "";
			})
			.join("");
	}
	return "";
}

/**
 * Replace only the first system message so a new persona applies to the rest of the session.
 */
export async function replaceSessionSystemMessageForPersona(
	modules: readonly IntegrationModule[],
	messages: readonly CoreMessage[],
	persona: Persona,
	project?: Project | null,
): Promise<CoreMessage[]> {
	if (messages.length === 0) {
		throw new Error("replaceSessionSystemMessageForPersona: empty messages");
	}
	if (modules.length === 0) {
		throw new Error("replaceSessionSystemMessageForPersona: no modules");
	}

	if (modules.length === 1) {
		const module = modules[0];
		if (!module) {
			throw new Error("replaceSessionSystemMessageForPersona: missing module");
		}
		if (!module.chatModelPrep) {
			throw new Error(
				`replaceSessionSystemMessageForPersona: integration "${module.name}" has no chatModelPrep`,
			);
		}
		const userPrompt = coreMessageUserText(messages[1]);
		const rebuilt = await module.chatModelPrep.buildSingleSessionMessages(
			persona,
			userPrompt,
		);
		const newSystem = rebuilt[0];
		if (!newSystem || newSystem.role !== "system") {
			throw new Error(
				"replaceSessionSystemMessageForPersona: expected system message at index 0",
			);
		}
		let result = injectCurrentDateTimeIntoFirstSystemMessage([
			newSystem,
			...messages.slice(1),
		]);
		if (project) {
			result = injectProjectContextIntoFirstSystemMessage(result, project);
		}
		return injectMemoriesIntoFirstSystemMessage(result);
	}

	const systemContent = composeSystemPromptWithPersona(
		buildCombinedChatBasePrompt(modules, project, persona),
		persona,
	);

	let result = injectCurrentDateTimeIntoFirstSystemMessage([
		{ role: "system", content: systemContent },
		...messages.slice(1),
	]);
	if (project) {
		result = injectProjectContextIntoFirstSystemMessage(result, project);
	}
	return injectMemoriesIntoFirstSystemMessage(result);
}

/**
 * Merge a verbatim user prompt with an optional pretreatment spec for `prepareChatSessionMessages`.
 * Integration builders stay unaware of pretreatment; they only receive the final string.
 */
export function mergeUserPromptWithPretreatmentSpec(
	verbatim: string,
	spec: UserIntentSpec | null,
	skillsCatalog?: readonly LocalSkill[],
): string {
	return formatUserMessageWithPretreatment(verbatim, spec, skillsCatalog);
}
