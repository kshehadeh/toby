import { describe, expect, it } from "bun:test";
import {
	makeWavBuffer,
	parse413Limit,
	parseWavHeader,
	splitWavIntoChunks,
} from "@toby/core/listen/transcription-model";

// ---------------------------------------------------------------------------
// 413 limit parser
// ---------------------------------------------------------------------------

describe("parse413Limit", () => {
	it("parses the limit from a provider 413 error message", () => {
		const msg =
			"413: Maximum content size limit (26214400) exceeded (26394240 bytes read)";
		expect(parse413Limit(msg)).toBe(26214400);
	});

	it("parses limits with varying digit counts", () => {
		expect(parse413Limit("Maximum content size limit (1000) exceeded")).toBe(
			1000,
		);
		expect(
			parse413Limit("Maximum content size limit (10485760) exceeded"),
		).toBe(10485760);
	});

	it("returns undefined when the pattern is absent", () => {
		expect(parse413Limit("some other error")).toBeUndefined();
		expect(parse413Limit("")).toBeUndefined();
	});

	it("returns undefined for non-numeric values", () => {
		expect(
			parse413Limit("Maximum content size limit (abc) exceeded"),
		).toBeUndefined();
	});
});

// ---------------------------------------------------------------------------
// WAV header parsing
// ---------------------------------------------------------------------------

describe("parseWavHeader", () => {
	it("parses a standard 16 kHz mono 16-bit WAV", () => {
		const pcm = Buffer.alloc(3200); // 0.1 second at 16 kHz mono 16-bit
		const wav = makeWavBuffer(pcm, {
			sampleRate: 16000,
			bitsPerSample: 16,
			channels: 1,
		});
		const info = parseWavHeader(wav);
		expect(info.sampleRate).toBe(16000);
		expect(info.channels).toBe(1);
		expect(info.bitsPerSample).toBe(16);
		expect(info.dataOffset).toBe(44);
		expect(info.dataSize).toBe(3200);
	});

	it("parses a 44.1 kHz stereo WAV", () => {
		const pcm = Buffer.alloc(44100 * 2 * 2); // 1 second at 44.1 kHz stereo 16-bit
		const wav = makeWavBuffer(pcm, {
			sampleRate: 44100,
			bitsPerSample: 16,
			channels: 2,
		});
		const info = parseWavHeader(wav);
		expect(info.sampleRate).toBe(44100);
		expect(info.channels).toBe(2);
		expect(info.bitsPerSample).toBe(16);
		expect(info.dataSize).toBe(44100 * 2 * 2);
	});

	it("throws for non-RIFF data", () => {
		expect(() => parseWavHeader(Buffer.alloc(100))).toThrow(
			/Not a valid PCM WAV file/,
		);
	});

	it("throws for RIFF but not WAVE", () => {
		const buf = Buffer.alloc(12);
		buf.write("RIFF", 0, "ascii");
		buf.write("AVI ", 8, "ascii");
		expect(() => parseWavHeader(buf)).toThrow(/Not a valid PCM WAV file/);
	});
});

// ---------------------------------------------------------------------------
// WAV chunk splitting
// ---------------------------------------------------------------------------

describe("splitWavIntoChunks", () => {
	function makeWavWithDuration(
		seconds: number,
		sampleRate = 16000,
		channels = 1,
		bitsPerSample = 16,
	): { wav: Buffer; info: ReturnType<typeof parseWavHeader> } {
		const bytesPerSample = (bitsPerSample * channels) / 8;
		const pcm = Buffer.alloc(seconds * sampleRate * bytesPerSample);
		const wav = makeWavBuffer(pcm, { sampleRate, bitsPerSample, channels });
		const info = parseWavHeader(wav);
		return { wav, info };
	}

	it("returns a single chunk when data fits under the limit", () => {
		const { wav, info } = makeWavWithDuration(1); // 32 KB
		const chunks = splitWavIntoChunks(wav, info, 1024 * 1024);
		expect(chunks).toHaveLength(1);
		expect(chunks[0].buffer.length).toBe(wav.length);
		expect(chunks[0].startSecond).toBe(0);
	});

	it("splits a large WAV into multiple chunks under the byte limit", () => {
		// 60 seconds at 16 kHz mono 16-bit = 1,920,032 bytes (with header)
		const { wav, info } = makeWavWithDuration(60);
		const maxBytes = 1024 * 1024; // 1 MB — should produce ~3 chunks
		const chunks = splitWavIntoChunks(wav, info, maxBytes);

		expect(chunks.length).toBeGreaterThan(1);
		for (const chunk of chunks) {
			// Each chunk WAV file (44-byte header + PCM data) must be under the limit
			expect(chunk.buffer.length).toBeLessThanOrEqual(maxBytes);
			// Each chunk must be a valid WAV
			const chunkInfo = parseWavHeader(chunk.buffer);
			expect(chunkInfo.sampleRate).toBe(16000);
			expect(chunkInfo.channels).toBe(1);
			expect(chunkInfo.bitsPerSample).toBe(16);
		}
	});

	it("offsets chunk start times correctly", () => {
		const { wav, info } = makeWavWithDuration(60);
		const maxBytes = 1024 * 1024;
		const chunks = splitWavIntoChunks(wav, info, maxBytes);

		expect(chunks.length).toBeGreaterThan(1);
		// First chunk starts at 0
		expect(chunks[0].startSecond).toBe(0);
		// Subsequent chunks have increasing start times
		for (let i = 1; i < chunks.length; i++) {
			expect(chunks[i].startSecond).toBeGreaterThan(chunks[i - 1].startSecond);
		}
		// Last chunk's start time should be less than the total duration
		expect(chunks[chunks.length - 1].startSecond).toBeLessThan(60);
	});

	it("handles empty PCM data", () => {
		const wav = makeWavBuffer(Buffer.alloc(0), {
			sampleRate: 16000,
			bitsPerSample: 16,
			channels: 1,
		});
		const info = parseWavHeader(wav);
		const chunks = splitWavIntoChunks(wav, info, 1024 * 1024);
		expect(chunks).toHaveLength(0);
	});

	it("preserves all PCM data across chunks", () => {
		const { wav, info } = makeWavWithDuration(10);
		const maxBytes = 1024 * 1024;
		const chunks = splitWavIntoChunks(wav, info, maxBytes);

		// Re-extract PCM data from each chunk and compare with original
		const originalPcm = wav.subarray(
			info.dataOffset,
			info.dataOffset + info.dataSize,
		);
		let reassembled = Buffer.alloc(0);
		for (const chunk of chunks) {
			const chunkInfo = parseWavHeader(chunk.buffer);
			reassembled = Buffer.concat([
				reassembled,
				chunk.buffer.subarray(
					chunkInfo.dataOffset,
					chunkInfo.dataOffset + chunkInfo.dataSize,
				),
			]);
		}
		expect(reassembled.length).toBe(originalPcm.length);
		expect(reassembled.equals(originalPcm)).toBe(true);
	});

	it("splits stereo 44.1 kHz WAV correctly", () => {
		// 10 seconds at 44.1 kHz stereo 16-bit = ~1.77 MB
		const { wav, info } = makeWavWithDuration(10, 44100, 2);
		const maxBytes = 1024 * 1024;
		const chunks = splitWavIntoChunks(wav, info, maxBytes);

		expect(chunks.length).toBeGreaterThan(1);
		for (const chunk of chunks) {
			expect(chunk.buffer.length).toBeLessThanOrEqual(maxBytes);
			const chunkInfo = parseWavHeader(chunk.buffer);
			expect(chunkInfo.sampleRate).toBe(44100);
			expect(chunkInfo.channels).toBe(2);
		}
	});

	it("respects sample alignment in chunk boundaries", () => {
		// 16 kHz mono 16-bit: 2 bytes per sample
		const { wav, info } = makeWavWithDuration(60);
		const chunks = splitWavIntoChunks(wav, info, 1024 * 1024);
		for (const chunk of chunks) {
			const chunkInfo = parseWavHeader(chunk.buffer);
			// Data size must be a multiple of bytesPerSample (2 for 16-bit mono)
			expect(chunkInfo.dataSize % 2).toBe(0);
		}
	});
});
