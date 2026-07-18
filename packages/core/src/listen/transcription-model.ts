import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createGateway } from "@ai-sdk/gateway";
import { createGroq } from "@ai-sdk/groq";
import { createOpenAI } from "@ai-sdk/openai";
import { transcribe } from "ai";
import {
	OPENROUTER_DEFAULT_BASE_URL,
	buildAiGatewayAttributionHeaders,
} from "../ai/model-factory";
import type { TranscriptPayload, TranscriptSegment } from "./transcript-types";
import { ListenTranscriptionError } from "./transcription-errors";
import {
	type TranscriptionSelection,
	getTranscriptionProvider,
	resolveTranscriptionSelection,
} from "./transcription-providers";
import type { ListenRecordingFiles } from "./types";

export { ListenTranscriptionError } from "./transcription-errors";

export const TRANSCRIPTION_NOT_CONFIGURED_CODE = "transcription_not_configured";

/** Default max audio payload size (25 MB) — matches common provider limits. */
const DEFAULT_MAX_AUDIO_BYTES = 25 * 1024 * 1024;
/** Safety margin below the limit to account for HTTP/multipart overhead. */
const CHUNK_SAFETY_MARGIN = 256 * 1024;

export interface TranscribeWithModelOptions {
	readonly input: string;
	readonly outDir: string;
	readonly onStatus?: (message: string) => void;
}

interface PreparedInput {
	readonly inputPath: string;
	readonly cleanupDir?: string;
}

interface TranscriptionResultData {
	readonly text: string;
	readonly segments: readonly TranscriptSegment[];
	readonly language?: string;
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
		case "vercel": {
			const gateway = createGateway({
				...(apiKey ? { apiKey } : {}),
				headers: buildAiGatewayAttributionHeaders(),
			});
			return gateway.transcriptionModel(model);
		}
		case "openrouter": {
			// OpenRouter's /audio/transcriptions is OpenAI-compatible (multipart).
			// Point the OpenAI provider at OpenRouter so AI SDK `transcribe()` works.
			const openai = createOpenAI({
				apiKey,
				baseURL: OPENROUTER_DEFAULT_BASE_URL,
				headers: buildAiGatewayAttributionHeaders(),
			});
			return openai.transcription(model);
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

// ---------------------------------------------------------------------------
// Size-limit helpers
// ---------------------------------------------------------------------------

function getMaxAudioBytes(): number {
	const env = process.env.TOBY_TRANSCRIPTION_MAX_AUDIO_BYTES?.trim();
	if (env) {
		const n = Number.parseInt(env, 10);
		if (Number.isFinite(n) && n > 0) return n;
	}
	return DEFAULT_MAX_AUDIO_BYTES;
}

/** Parse a 413 "Maximum content size limit (N) exceeded" error for a retry limit. */
export function parse413Limit(message: string): number | undefined {
	const match = message.match(/Maximum content size limit \((\d+)\)/);
	if (match) {
		const n = Number.parseInt(match[1], 10);
		if (Number.isFinite(n) && n > 0) return n;
	}
	return undefined;
}

// ---------------------------------------------------------------------------
// WAV parsing & chunking
// ---------------------------------------------------------------------------

interface WavInfo {
	readonly sampleRate: number;
	readonly bitsPerSample: number;
	readonly channels: number;
	readonly dataOffset: number;
	readonly dataSize: number;
}

export function parseWavHeader(buf: Buffer): WavInfo {
	if (
		buf.length < 12 ||
		buf.toString("ascii", 0, 4) !== "RIFF" ||
		buf.toString("ascii", 8, 12) !== "WAVE"
	) {
		throw new Error("Not a valid PCM WAV file");
	}

	let offset = 12;
	let fmtFound = false;
	let audioFormat = 0;
	let channels = 0;
	let sampleRate = 0;
	let bitsPerSample = 0;
	let dataOffset = 0;
	let dataSize = 0;

	while (offset + 8 <= buf.length) {
		const chunkId = buf.toString("ascii", offset, offset + 4);
		const chunkSize = buf.readUInt32LE(offset + 4);

		if (chunkId === "fmt ") {
			audioFormat = buf.readUInt16LE(offset + 8);
			channels = buf.readUInt16LE(offset + 10);
			sampleRate = buf.readUInt32LE(offset + 12);
			bitsPerSample = buf.readUInt16LE(offset + 22);
			fmtFound = true;
		} else if (chunkId === "data") {
			dataOffset = offset + 8;
			dataSize = chunkSize;
			break;
		}

		offset += 8 + chunkSize + (chunkSize % 2);
	}

	if (!fmtFound) throw new Error("No fmt chunk found in WAV file");
	if (!dataOffset) throw new Error("No data chunk found in WAV file");
	if (audioFormat !== 1) {
		throw new Error(
			`Unsupported WAV format (audio format ${audioFormat}, expected PCM)`,
		);
	}

	return { sampleRate, bitsPerSample, channels, dataOffset, dataSize };
}

export function makeWavBuffer(
	pcmData: Buffer,
	info: Pick<WavInfo, "sampleRate" | "bitsPerSample" | "channels">,
): Buffer {
	const header = Buffer.alloc(44);
	header.write("RIFF", 0, "ascii");
	header.writeUInt32LE(36 + pcmData.length, 4);
	header.write("WAVE", 8, "ascii");
	header.write("fmt ", 12, "ascii");
	header.writeUInt32LE(16, 16);
	header.writeUInt16LE(1, 20); // PCM
	header.writeUInt16LE(info.channels, 22);
	header.writeUInt32LE(info.sampleRate, 24);
	const byteRate = (info.sampleRate * info.channels * info.bitsPerSample) / 8;
	header.writeUInt32LE(byteRate, 28);
	const blockAlign = (info.channels * info.bitsPerSample) / 8;
	header.writeUInt16LE(blockAlign, 32);
	header.writeUInt16LE(info.bitsPerSample, 34);
	header.write("data", 36, "ascii");
	header.writeUInt32LE(pcmData.length, 40);
	return Buffer.concat([header, pcmData]);
}

interface WavChunk {
	readonly buffer: Buffer;
	readonly startSecond: number;
}

export function splitWavIntoChunks(
	wavBuf: Buffer,
	info: WavInfo,
	maxBytes: number,
): WavChunk[] {
	const bytesPerSample = (info.bitsPerSample * info.channels) / 8;
	const maxPcmBytes = Math.max(
		bytesPerSample,
		maxBytes - 44 - CHUNK_SAFETY_MARGIN,
	);
	const chunkPcmBytes =
		Math.floor(maxPcmBytes / bytesPerSample) * bytesPerSample;

	const dataEnd = Math.min(info.dataOffset + info.dataSize, wavBuf.length);
	const totalPcmBytes = dataEnd - info.dataOffset;
	if (totalPcmBytes <= 0) return [];

	const bytesPerSecond = info.sampleRate * bytesPerSample;
	const chunkCount = Math.ceil(totalPcmBytes / chunkPcmBytes);

	const chunks: WavChunk[] = [];
	for (let i = 0; i < chunkCount; i++) {
		const start = info.dataOffset + i * chunkPcmBytes;
		const end = Math.min(start + chunkPcmBytes, dataEnd);
		const pcmData = wavBuf.subarray(start, end);
		chunks.push({
			buffer: makeWavBuffer(pcmData, info),
			startSecond: (i * chunkPcmBytes) / bytesPerSecond,
		});
	}
	return chunks;
}

// ---------------------------------------------------------------------------
// Transcription (single or chunked)
// ---------------------------------------------------------------------------

async function transcribeChunkedOrSingle(params: {
	readonly inputPath: string;
	readonly selection: TranscriptionSelection;
	readonly maxBytes: number;
	readonly onStatus?: (message: string) => void;
}): Promise<TranscriptionResultData> {
	const stat = await fs.promises.stat(params.inputPath);
	const model = createTranscriptionModel(
		params.selection.provider,
		params.selection.model,
		params.selection.apiKey,
	);

	if (stat.size <= params.maxBytes) {
		params.onStatus?.("Transcribing recording…");
		const audio = await fs.promises.readFile(params.inputPath);
		const result = await transcribe({
			model,
			audio,
		});
		return {
			text: result.text.trim(),
			segments: buildTranscriptSegments(result.segments ?? []),
			language: result.language,
		};
	}

	// File exceeds the limit — split into WAV chunks.
	let wavBuf = await fs.promises.readFile(params.inputPath);
	let wavInfo: WavInfo;
	try {
		wavInfo = parseWavHeader(wavBuf);
	} catch {
		// Not a parseable PCM WAV — try converting via afconvert.
		if (process.platform !== "darwin" || !fs.existsSync("/usr/bin/afconvert")) {
			throw new Error(
				`Audio file (${stat.size} bytes) exceeds the transcription size limit (${params.maxBytes} bytes) and could not be split. Try a shorter recording.`,
			);
		}
		const tmpDir = await fs.promises.mkdtemp(
			path.join(os.tmpdir(), "TobyTranscriptionChunk-"),
		);
		const tmpWav = path.join(tmpDir, "chunk-input.wav");
		try {
			await runAfconvert(params.inputPath, tmpWav);
			wavBuf = await fs.promises.readFile(tmpWav);
			wavInfo = parseWavHeader(wavBuf);
		} finally {
			await removePathBestEffort(tmpDir);
		}
	}

	const chunks = splitWavIntoChunks(wavBuf, wavInfo, params.maxBytes);
	if (chunks.length === 0) {
		return { text: "", segments: [], language: undefined };
	}

	const allText: string[] = [];
	const allSegments: TranscriptSegment[] = [];
	let language: string | undefined;

	for (let i = 0; i < chunks.length; i++) {
		params.onStatus?.(`Transcribing chunk ${i + 1}/${chunks.length}…`);
		const result = await transcribe({
			model,
			audio: chunks[i].buffer,
		});
		if (!language) language = result.language;
		allText.push(result.text.trim());
		const offset = chunks[i].startSecond;
		const offsetSegments = (result.segments ?? []).map((seg) => ({
			text: seg.text,
			startSecond: seg.startSecond + offset,
			endSecond: seg.endSecond + offset,
		}));
		allSegments.push(...buildTranscriptSegments(offsetSegments));
	}

	return {
		text: allText.join(" ").trim(),
		segments: allSegments,
		language,
	};
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

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
		let maxBytes = getMaxAudioBytes();
		let result: TranscriptionResultData;
		try {
			result = await transcribeChunkedOrSingle({
				inputPath: prepared.inputPath,
				selection,
				maxBytes,
				onStatus: options.onStatus,
			});
		} catch (error) {
			const msg = error instanceof Error ? error.message : String(error);
			const parsedLimit = parse413Limit(msg);
			if (parsedLimit !== undefined && parsedLimit < maxBytes) {
				options.onStatus?.(
					"Audio too large for provider, retrying with smaller chunks…",
				);
				maxBytes = parsedLimit;
				result = await transcribeChunkedOrSingle({
					inputPath: prepared.inputPath,
					selection,
					maxBytes,
					onStatus: options.onStatus,
				});
			} else {
				throw error;
			}
		}

		const outDir = path.resolve(options.outDir);
		await fs.promises.mkdir(outDir, { recursive: true });

		const text = result.text;
		await fs.promises.writeFile(
			path.join(outDir, "transcript.txt"),
			`${text}\n`,
		);

		const payload: TranscriptPayload = {
			text,
			segments: result.segments,
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
