import fs from "node:fs";
import path from "node:path";
import type {
	LanguageModelV4CallOptions,
	LanguageModelV4GenerateResult,
	LanguageModelV4StreamPart,
} from "@ai-sdk/provider";
import { resolveRecordingPath } from "./paths";
import {
	RECORDING_FORMAT_VERSION,
	type RecordedModelCall,
	type SessionRecording,
	computeParamsDigest,
	parseRecording,
	serializeGenerateResult,
	serializeRecording,
} from "./recording-format";

type SessionMode = "off" | "record" | "replay";

let mode: SessionMode = "off";
let recordingFilePath: string | null = null;
let recording: SessionRecording | null = null;
let replayStore: ReplayStore | null = null;
let exitHandlerRegistered = false;

export class ReplayStore {
	private cursor = 0;

	constructor(private readonly entries: readonly RecordedModelCall[]) {}

	take(
		op: RecordedModelCall["op"],
		params: LanguageModelV4CallOptions,
	): RecordedModelCall {
		if (this.cursor >= this.entries.length) {
			throw new Error(
				`Recording exhausted at entry ${this.cursor + 1}: no recorded ${op} response remains.`,
			);
		}

		const digest = computeParamsDigest(params);
		let index = -1;
		for (let i = this.cursor; i < this.entries.length; i += 1) {
			const entry = this.entries[i];
			if (entry && entry.op === op && entry.paramsDigest === digest) {
				index = i;
				break;
			}
		}
		if (index < 0) {
			const fallback = this.entries[this.cursor];
			if (!fallback || fallback.op !== op) {
				throw new Error(
					`No recorded ${op} response matches this call (digest ${digest.slice(0, 12)}…, cursor ${this.cursor + 1}/${this.entries.length}).`,
				);
			}
			index = this.cursor;
		}

		const entry = this.entries[index];
		if (!entry) {
			throw new Error(`Recording entry ${index + 1} is missing.`);
		}
		this.cursor = index + 1;
		return entry;
	}
}

function ensureRecordingParentDir(filePath: string): void {
	const parent = path.dirname(filePath);
	if (!fs.existsSync(parent)) {
		fs.mkdirSync(parent, { recursive: true });
	}
}

function ensureExitHandler(): void {
	if (exitHandlerRegistered) {
		return;
	}
	exitHandlerRegistered = true;
	process.on("exit", () => {
		flushRecording();
	});
}

export function isRecording(): boolean {
	return mode === "record";
}

export function isReplaying(): boolean {
	return mode === "replay";
}

export function getRecordingFilePath(): string | null {
	return recordingFilePath;
}

export function getReplayStore(): ReplayStore {
	if (!replayStore) {
		throw new Error("Replay session is not active.");
	}
	return replayStore;
}

export function beginRecording(
	filePath: string,
	persona: SessionRecording["persona"],
): void {
	endSession();
	recordingFilePath = resolveRecordingPath(filePath);
	ensureRecordingParentDir(recordingFilePath);
	recording = {
		version: RECORDING_FORMAT_VERSION,
		createdAt: new Date().toISOString(),
		persona,
		entries: [],
	};
	mode = "record";
	ensureExitHandler();
}

export function beginReplay(filePath: string): void {
	endSession();
	const resolved = resolveRecordingPath(filePath);
	if (!fs.existsSync(resolved)) {
		throw new Error(`Recording file not found: ${resolved}`);
	}
	const parsed = parseRecording(fs.readFileSync(resolved, "utf8"));
	replayStore = new ReplayStore(parsed.entries);
	mode = "replay";
}

export function appendRecordedCall(entry: RecordedModelCall): void {
	if (!isRecording() || !recording) {
		return;
	}
	recording.entries.push(entry);
}

export function flushRecording(): void {
	if (!isRecording() || !recording || !recordingFilePath) {
		return;
	}
	ensureRecordingParentDir(recordingFilePath);
	fs.writeFileSync(recordingFilePath, serializeRecording(recording), "utf8");
}

export function recordGenerateCall(
	params: LanguageModelV4CallOptions,
	result: LanguageModelV4GenerateResult,
): void {
	appendRecordedCall({
		op: "generate",
		paramsDigest: computeParamsDigest(params),
		result: serializeGenerateResult(result),
	});
	flushRecording();
}

export function recordStreamCall(
	params: LanguageModelV4CallOptions,
	chunks: readonly LanguageModelV4StreamPart[],
): void {
	appendRecordedCall({
		op: "stream",
		paramsDigest: computeParamsDigest(params),
		chunks,
	});
	flushRecording();
}

export function endSession(): void {
	mode = "off";
	recordingFilePath = null;
	recording = null;
	replayStore = null;
}

/** Test helper — reset process-global replay session state. */
export function resetReplaySessionForTests(): void {
	endSession();
}
