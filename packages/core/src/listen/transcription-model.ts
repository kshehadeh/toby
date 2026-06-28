import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createGroq } from "@ai-sdk/groq";
import { createOpenAI } from "@ai-sdk/openai";
import { experimental_transcribe as transcribe } from "ai";
import type { TranscriptPayload, TranscriptSegment } from "./transcript-types";
import { ListenTranscriptionError } from "./transcription-errors";
import {
	getTranscriptionProvider,
	resolveTranscriptionSelection,
} from "./transcription-providers";
import type { ListenRecordingFiles } from "./types";

export { ListenTranscriptionError } from "./transcription-errors";

export const TRANSCRIPTION_NOT_CONFIGURED_CODE = "transcription_not_configured";

export interface TranscribeWithModelOptions {
	readonly input: string;
	readonly outDir: string;
	readonly onStatus?: (message: string) => void;
}

interface PreparedInput {
	readonly inputPath: string;
	readonly cleanupDir?: string;
}

async function runAfconvert(
	inputPath: string,
	outputPath: string,
): Promise<void> {
	await new Promise<void>((resolve, reject) => {
		const child = spawn("/usr/bin/afconvert", [
			"-f",
			"WAVE",
			"-d",
			"LEI16@16000",
			"-c",
			"1",
			inputPath,
			outputPath,
		]);
		let stderr = "";
		child.stderr.on("data", (chunk) => {
			stderr += String(chunk);
		});
		child.on("error", reject);
		child.on("close", (code) => {
			if (code === 0) {
				resolve();
				return;
			}
			reject(
				new Error(stderr.trim() || `afconvert exited with status ${code}`),
			);
		});
	});
}

async function prepareInput(inputPath: string): Promise<PreparedInput> {
	if (path.extname(inputPath).toLowerCase() === ".wav") {
		return { inputPath };
	}
	if (process.platform !== "darwin" || !fs.existsSync("/usr/bin/afconvert")) {
		return { inputPath };
	}
	const cleanupDir = await fs.promises.mkdtemp(
		path.join(os.tmpdir(), "TobyTranscriptionInput-"),
	);
	const outputPath = path.join(cleanupDir, "transcription-input.wav");
	try {
		await runAfconvert(inputPath, outputPath);
		return { inputPath: outputPath, cleanupDir };
	} catch (error) {
		await fs.promises
			.rm(cleanupDir, { force: true, recursive: true })
			.catch(() => undefined);
		throw error;
	}
}

async function removePathBestEffort(targetPath: string): Promise<void> {
	try {
		await fs.promises.rm(targetPath, { force: true, recursive: true });
	} catch {
		// ignore cleanup failures
	}
}

function createTranscriptionModel(
	providerId: string,
	model: string,
	apiKey: string,
) {
	switch (providerId) {
		case "openai": {
			const openai = createOpenAI({ apiKey });
			return openai.transcription(model);
		}
		case "groq": {
			const groq = createGroq({ apiKey });
			return groq.transcription(model);
		}
		default:
			throw new Error(`Unsupported transcription provider: ${providerId}`);
	}
}

function buildTranscriptSegments(
	segments: readonly {
		readonly text: string;
		readonly startSecond: number;
		readonly endSecond: number;
	}[],
): TranscriptSegment[] {
	return segments.map((segment) => ({
		text: segment.text,
		timestamp: segment.startSecond,
		duration: Math.max(0, segment.endSecond - segment.startSecond),
		confidence: 1,
		alternatives: [],
	}));
}

export async function transcribeWithModel(
	options: TranscribeWithModelOptions,
): Promise<ListenRecordingFiles> {
	const selection = resolveTranscriptionSelection();
	if (!selection) {
		throw new ListenTranscriptionError(
			TRANSCRIPTION_NOT_CONFIGURED_CODE,
			"No transcription model is configured. Open Settings → Transcription to choose a provider and model.",
		);
	}

	const inputPath = path.resolve(options.input);
	if (!fs.existsSync(inputPath)) {
		throw new ListenTranscriptionError(
			"input_missing",
			`Audio file does not exist: ${inputPath}`,
		);
	}

	const provider = getTranscriptionProvider(selection.provider);
	if (!provider) {
		throw new ListenTranscriptionError(
			"provider_missing",
			`Unknown transcription provider: ${selection.provider}`,
		);
	}

	const prepared = await prepareInput(inputPath);
	try {
		options.onStatus?.("Transcribing recording…");
		const model = createTranscriptionModel(
			selection.provider,
			selection.model,
			selection.apiKey,
		);
		const audio = await fs.promises.readFile(prepared.inputPath);
		const result = await transcribe({
			// ai v6 types transcription models as V2/V3; provider packages already
			// return V4. Runtime is compatible, so cast across the version boundary.
			model: model as Parameters<typeof transcribe>[0]["model"],
			audio,
		});

		const outDir = path.resolve(options.outDir);
		await fs.promises.mkdir(outDir, { recursive: true });

		const text = result.text.trim();
		await fs.promises.writeFile(
			path.join(outDir, "transcript.txt"),
			`${text}\n`,
		);

		const payload: TranscriptPayload = {
			text,
			segments: buildTranscriptSegments(result.segments ?? []),
			sourceAudio: path.basename(inputPath),
			createdAt: new Date().toISOString(),
			locale: result.language ?? "auto",
		};
		await fs.promises.writeFile(
			path.join(outDir, "transcript.json"),
			`${JSON.stringify(payload, null, 2)}\n`,
		);

		return { transcript: "transcript.txt", transcriptJson: "transcript.json" };
	} finally {
		if (prepared.cleanupDir) {
			await removePathBestEffort(prepared.cleanupDir);
		}
	}
}
