import { describe, expect, it } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
	type CredentialsFile,
	readConfig,
	readCredentials,
	writeConfig,
	writeCredentials,
} from "@toby/core/config/index";
import {
	TRANSCRIPTION_PROVIDERS,
	getTranscriptionProvider,
	isTranscriptionConfigured,
	resolveTranscriptionApiKey,
	resolveTranscriptionSelection,
} from "@toby/core/listen/transcription-providers";

function withTempTobyDir(run: () => void | Promise<void>): Promise<void> {
	const previous = process.env.TOBY_DIR;
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), "toby-transcription-"));
	process.env.TOBY_DIR = dir;
	return Promise.resolve()
		.then(run)
		.finally(() => {
			if (previous === undefined) {
				Reflect.deleteProperty(process.env, "TOBY_DIR");
			} else {
				process.env.TOBY_DIR = previous;
			}
			fs.rmSync(dir, { recursive: true, force: true });
		});
}

describe("transcription providers", () => {
	it("exposes openai and groq providers", () => {
		const ids = TRANSCRIPTION_PROVIDERS.map((p) => p.id);
		expect(ids).toContain("openai");
		expect(ids).toContain("groq");
		expect(getTranscriptionProvider("openai")?.models).toContain("whisper-1");
		expect(getTranscriptionProvider("groq")?.models).toContain(
			"whisper-large-v3",
		);
	});

	it("openai provider reuses the shared openai token", () => {
		expect(getTranscriptionProvider("openai")?.reusesOpenAiToken).toBe(true);
	});
});

describe("transcription selection resolution", () => {
	it("returns undefined when no provider/model configured", () => {
		withTempTobyDir(() => {
			expect(isTranscriptionConfigured()).toBe(false);
			expect(resolveTranscriptionSelection()).toBeUndefined();
		});
	});

	it("returns undefined when configured but no api key present", () => {
		withTempTobyDir(() => {
			writeConfig({
				integrations: {},
				personas: [],
				transcription: { provider: "groq", model: "whisper-large-v3" },
			});
			expect(isTranscriptionConfigured()).toBe(false);
		});
	});

	it("resolves openai via the shared openai token", () => {
		withTempTobyDir(() => {
			const creds: CredentialsFile = {
				ai: { openai: { token: "sk-test-openai" } },
			};
			writeCredentials(creds);
			writeConfig({
				integrations: {},
				personas: [],
				transcription: { provider: "openai", model: "whisper-1" },
			});
			expect(resolveTranscriptionApiKey("openai")).toBe("sk-test-openai");
			const selection = resolveTranscriptionSelection();
			expect(selection).toEqual({
				provider: "openai",
				model: "whisper-1",
				apiKey: "sk-test-openai",
			});
			expect(isTranscriptionConfigured()).toBe(true);
		});
	});

	it("prefers a transcription-specific openai key over the shared token", () => {
		withTempTobyDir(() => {
			writeCredentials({
				ai: { openai: { token: "shared" } },
				transcription: { openai: { apiKey: "transcription-specific" } },
			});
			writeConfig({
				integrations: {},
				personas: [],
				transcription: { provider: "openai", model: "whisper-1" },
			});
			expect(resolveTranscriptionApiKey("openai")).toBe(
				"transcription-specific",
			);
		});
	});

	it("resolves groq via transcription credentials", () => {
		withTempTobyDir(() => {
			writeCredentials({ transcription: { groq: { apiKey: "gq-key" } } });
			writeConfig({
				integrations: {},
				personas: [],
				transcription: { provider: "groq", model: "whisper-large-v3" },
			});
			const selection = resolveTranscriptionSelection();
			expect(selection?.provider).toBe("groq");
			expect(selection?.apiKey).toBe("gq-key");
		});
	});
});

describe("transcription config persistence", () => {
	it("persists transcription config through readConfig/writeConfig", () => {
		withTempTobyDir(() => {
			writeConfig({
				integrations: {},
				personas: [],
				transcription: { provider: "groq", model: "whisper-large-v3" },
			});
			expect(readConfig().transcription).toEqual({
				provider: "groq",
				model: "whisper-large-v3",
			});
		});
	});

	it("round-trips transcription credentials through writeCredentials/readCredentials", () => {
		withTempTobyDir(() => {
			writeCredentials({ transcription: { groq: { apiKey: "gq-key" } } });
			expect(readCredentials().transcription?.groq?.apiKey).toBe("gq-key");
		});
	});
});
