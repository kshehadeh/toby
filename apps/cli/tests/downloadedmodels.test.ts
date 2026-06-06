import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@huggingface/transformers", () => ({
	ModelRegistry: {
		clear_cache: vi.fn(async () => undefined),
	},
}));

import {
	addDownloadedModel,
	addInferenceModel,
	getDownloadedModels,
	getInferenceModels,
	removeDownloadedModel,
	removeInferenceModel,
} from "@toby/core/huggingface/downloadedmodels";

const TOBY_DIR = path.join(os.homedir(), ".toby");
const CONFIG_PATH = path.join(TOBY_DIR, "config.json");

let originalConfig: string | null = null;

beforeEach(() => {
	if (fs.existsSync(CONFIG_PATH)) {
		originalConfig = fs.readFileSync(CONFIG_PATH, "utf-8");
	}
});

afterEach(() => {
	if (originalConfig !== null) {
		fs.writeFileSync(CONFIG_PATH, originalConfig);
	} else if (fs.existsSync(CONFIG_PATH)) {
		fs.unlinkSync(CONFIG_PATH);
	}
});

describe("downloadedmodels", () => {
	it("adds and lists self-hosted models", () => {
		addDownloadedModel("Qwen/Qwen3-0.6B");
		expect(getDownloadedModels()).toContain("Qwen/Qwen3-0.6B");
	});

	it("removes self-hosted models", async () => {
		addDownloadedModel("Qwen/Qwen3-0.6B");
		await removeDownloadedModel("Qwen/Qwen3-0.6B");
		expect(getDownloadedModels()).not.toContain("Qwen/Qwen3-0.6B");
	});

	it("adds and lists inference models", () => {
		addInferenceModel("meta-llama/Llama-3.2-3B-Instruct");
		expect(getInferenceModels()).toContain("meta-llama/Llama-3.2-3B-Instruct");
	});

	it("removes inference models", () => {
		addInferenceModel("meta-llama/Llama-3.2-3B-Instruct");
		removeInferenceModel("meta-llama/Llama-3.2-3B-Instruct");
		expect(getInferenceModels()).not.toContain(
			"meta-llama/Llama-3.2-3B-Instruct",
		);
	});
});
