import { generateText } from "ai";
import { createModelForPersona } from "../ai/model-factory";
import { type Persona, readConfig } from "../config/index";
import { extractDashboardSummaryText } from "../dashboard/summarizer";
import { daemonLog } from "../logging/daemon-log";
import { resolveDefaultPersona, resolvePersona } from "../personas/index";
import { composeSystemPromptWithPersona } from "../personas/prompt";

const SUMMARY_TIMEOUT_MS = 60_000;
const SUMMARY_MAX_TOKENS = 2000;

const RECORDING_SUMMARY_PROMPT = `You are summarizing a recording transcript for the user.

Produce a clear, scannable summary in markdown:
- Start with a short overview (1-3 sentences) of what the recording is about.
- Use bullet points for key topics, decisions, and action items when they appear.
- Call out names, deadlines, and concrete next steps with **bold** where helpful.
- Match length to the transcript: short for brief notes, a bit longer for meetings — but stay concise overall.
- Do not invent details that are not in the transcript.
- Output ONLY the final user-facing summary. Do not include chain-of-thought, planning, or meta-commentary.
- Do not reference these instructions or mention that you are summarizing.`;

/** Resolve the persona configured for recording summaries, falling back to default. */
export function resolveListenSummaryPersona(): Persona {
	const config = readConfig();
	const name = config.listen?.summaryPersona?.trim();
	if (name) {
		const resolved = resolvePersona(name);
		if (resolved) return resolved;
	}
	return resolveDefaultPersona();
}

export interface SummarizeRecordingParams {
	readonly transcript: string;
	readonly recordingName?: string;
	readonly durationMs?: number;
}

export interface SummarizeRecordingResult {
	readonly text: string;
	readonly personaName: string;
	readonly createdAt: string;
}

function formatDuration(durationMs?: number): string | undefined {
	if (durationMs == null || !Number.isFinite(durationMs) || durationMs < 0) {
		return undefined;
	}
	const totalSec = Math.round(durationMs / 1000);
	const min = Math.floor(totalSec / 60);
	const sec = totalSec % 60;
	if (min === 0) return `${sec}s`;
	return `${min}m ${sec.toString().padStart(2, "0")}s`;
}

function buildUserPrompt(params: SummarizeRecordingParams): string {
	const parts: string[] = [];
	if (params.recordingName?.trim()) {
		parts.push(`Recording name: ${params.recordingName.trim()}`);
	}
	const duration = formatDuration(params.durationMs);
	if (duration) {
		parts.push(`Duration: ${duration}`);
	}
	const header = parts.length > 0 ? `${parts.join("\n")}\n\n` : "";
	return `${header}Transcript:\n\n${params.transcript.trim()}`;
}

/**
 * Generate an AI summary for a recording transcript using the configured
 * listen summary persona (or the default persona).
 */
export async function summarizeRecordingTranscript(
	params: SummarizeRecordingParams,
): Promise<SummarizeRecordingResult> {
	const transcript = params.transcript.trim();
	if (!transcript) {
		throw new Error("Cannot summarize an empty transcript.");
	}

	const persona = resolveListenSummaryPersona();
	const system = composeSystemPromptWithPersona(
		RECORDING_SUMMARY_PROMPT,
		persona,
	);
	const userPrompt = buildUserPrompt(params);

	const controller = new AbortController();
	const timer = setTimeout(() => controller.abort(), SUMMARY_TIMEOUT_MS);

	try {
		const model = createModelForPersona(persona);
		const result = await generateText({
			model,
			instructions: system,
			prompt: userPrompt,
			abortSignal: controller.signal,
			temperature: 0.3,
			maxOutputTokens: SUMMARY_MAX_TOKENS,
		});

		const text = extractDashboardSummaryText(result.text);
		if (!text) {
			throw new Error("Model returned an empty summary.");
		}

		return {
			text,
			personaName: persona.name,
			createdAt: new Date().toISOString(),
		};
	} catch (error) {
		daemonLog("warn", "general", "listen_summary_error", {
			error: error instanceof Error ? error.message : String(error),
			persona: persona.name,
		});
		throw error;
	} finally {
		clearTimeout(timer);
	}
}

const TITLE_GENERATION_PROMPT = `You are generating a very short title for a recording based on its summary.

Create a concise title (3-6 words) that captures the main topic or purpose:
- Be specific and descriptive
- Use sentence case (capitalize first word only, except proper nouns)
- NO quotes, NO punctuation at the end
- Keep it brief and scannable
- Output ONLY the title text, nothing else`;

const TITLE_TIMEOUT_MS = 20_000;
const TITLE_MAX_TOKENS = 50;

export interface GenerateTitleFromSummaryParams {
	readonly summary: string;
}

export interface GenerateTitleResult {
	readonly title: string;
}

/**
 * Generate a short title (3-6 words) from a recording summary using the same
 * AI model that created the summary. Falls back gracefully on errors.
 */
export async function generateTitleFromSummary(
	params: GenerateTitleFromSummaryParams,
): Promise<GenerateTitleResult> {
	const summary = params.summary.trim();
	if (!summary) {
		throw new Error("Cannot generate a title from an empty summary.");
	}

	const persona = resolveListenSummaryPersona();
	const system = composeSystemPromptWithPersona(
		TITLE_GENERATION_PROMPT,
		persona,
	);
	const userPrompt = `Summary:\n\n${summary}`;

	const controller = new AbortController();
	const timer = setTimeout(() => controller.abort(), TITLE_TIMEOUT_MS);

	try {
		const model = createModelForPersona(persona);
		const result = await generateText({
			model,
			instructions: system,
			prompt: userPrompt,
			abortSignal: controller.signal,
			temperature: 0.3,
			maxOutputTokens: TITLE_MAX_TOKENS,
		});

		let title = result.text.trim();
		// Strip any surrounding quotes that the model might have added
		title = title.replace(/^["']|["']$/g, "");
		// Remove trailing punctuation
		title = title.replace(/[.!?;,]+$/, "");
		title = title.trim();

		if (!title || title.length === 0) {
			throw new Error("Model returned an empty title.");
		}

		return { title };
	} catch (error) {
		daemonLog("warn", "general", "listen_title_generation_error", {
			error: error instanceof Error ? error.message : String(error),
			persona: persona.name,
		});
		throw error;
	} finally {
		clearTimeout(timer);
	}
}
