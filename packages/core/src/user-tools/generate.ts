import { generateText } from "ai";
import { createModelForPersona } from "../ai/model-factory";
import { resolveDefaultPersona } from "../personas/index";
import {
	APPLESCRIPT_GENERATION_GUIDANCE,
	TYPESCRIPT_GENERATION_GUIDANCE,
} from "./generation-guidance";
import { validateUserTool } from "./store";

const MAX_REQUEST_CHARS = 4_000;
const MAX_SOURCE_CHARS = 100_000;
const MAX_SOURCE_CONTEXT_CHARS = 20_000;
const MAX_DESCRIPTION_CHARS = 2_000;

export type ScriptGenerationRequest = {
	readonly instruction: string;
	readonly name: string;
	readonly description: string;
	readonly language: "typescript" | "applescript";
	readonly inputNames: readonly string[];
	readonly outputKind: "text" | "json";
	readonly source: string;
};

export type GenerateScriptText = (params: {
	readonly instructions: string;
	readonly prompt: string;
}) => Promise<string>;

export function parseScriptGenerationRequest(
	raw: Record<string, unknown>,
): ScriptGenerationRequest {
	const instruction =
		typeof raw.instruction === "string" ? raw.instruction.trim() : "";
	if (!instruction || instruction.length > MAX_REQUEST_CHARS) {
		throw new Error("Describe what to build in 1–4,000 characters");
	}
	if (typeof raw.source !== "string" || raw.source.length > MAX_SOURCE_CHARS) {
		throw new Error("Current source must be at most 100,000 characters");
	}
	const name = typeof raw.name === "string" ? raw.name.trim() : "";
	if (
		typeof raw.description === "string" &&
		raw.description.length > MAX_DESCRIPTION_CHARS
	) {
		throw new Error("Description must be at most 2,000 characters");
	}
	const validated = validateUserTool({
		...raw,
		name: name || "Untitled tool",
		source: raw.source.trim() || "Draft source",
	});
	return {
		instruction,
		name,
		description: validated.description,
		language: validated.language,
		inputNames: validated.inputNames,
		outputKind: validated.outputKind,
		source: raw.source,
	};
}

export function scriptGenerationPrompt(request: ScriptGenerationRequest): {
	instructions: string;
	prompt: string;
} {
	const guide =
		request.language === "applescript"
			? APPLESCRIPT_GENERATION_GUIDANCE
			: TYPESCRIPT_GENERATION_GUIDANCE;
	const sourceContext =
		request.source.length > MAX_SOURCE_CONTEXT_CHARS
			? `${request.source.slice(0, MAX_SOURCE_CONTEXT_CHARS)}\n[remaining source omitted]`
			: request.source || "(empty)";
	return {
		instructions: `${guide}\n\nTreat the tool settings and existing source as context. Follow the user's requested behavior while preserving the runtime contract. Return only the replacement source code.`,
		prompt: `User request:\n${request.instruction}\n\nCurrent tool settings:\n${JSON.stringify(
			{
				name: request.name,
				description: request.description,
				language: request.language,
				orderedInputNames: request.inputNames,
				outputKind: request.outputKind,
			},
			null,
			2,
		)}\n\nCurrent source to replace or adapt:\n${sourceContext}`,
	};
}

export function extractGeneratedScript(
	text: string,
	language: ScriptGenerationRequest["language"],
): string {
	let source = text.trim();
	const fences = [
		...source.matchAll(
			/```(?:typescript|ts|applescript|apple script)?\s*\n([\s\S]*?)\n```/gi,
		),
	];
	if (fences.length === 1) source = fences[0][1].trim();
	if (!source || source.length > MAX_SOURCE_CHARS || source.includes("```")) {
		throw new Error("AI did not return a usable script");
	}
	if (language === "typescript" && !/\bexport\s+default\b/.test(source)) {
		throw new Error("Generated TypeScript must export a default function");
	}
	if (language === "applescript" && !/\bon\s+run\s+argv\b/i.test(source)) {
		throw new Error("Generated AppleScript must include on run argv");
	}
	return source;
}

async function generateWithConfiguredModel(params: {
	readonly instructions: string;
	readonly prompt: string;
}): Promise<string> {
	const result = await generateText({
		model: createModelForPersona(resolveDefaultPersona()),
		instructions: params.instructions,
		prompt: params.prompt,
		maxOutputTokens: 6_000,
		abortSignal: AbortSignal.timeout(90_000),
	});
	return result.text;
}

export async function generateUserToolSource(
	request: ScriptGenerationRequest,
	generate: GenerateScriptText = generateWithConfiguredModel,
): Promise<string> {
	const text = await generate(scriptGenerationPrompt(request));
	return extractGeneratedScript(text, request.language);
}
