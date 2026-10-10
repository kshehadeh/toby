import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { resolveChatInputCapability } from "@toby/core/ai/chat-input-capabilities";
import { resolveChatAttachmentCapability } from "@toby/core/ai/model-capabilities";
import { validateChatAttachments } from "@toby/core/chat-pipeline/attachments";
import { readConfig, writeConfig } from "@toby/core/config/index";
import {
	createPluginIntegrationModule,
	loadPluginMetadata,
} from "@toby/core/integrations/plugins/adapter";
import { bindPluginFileContext } from "@toby/core/integrations/plugins/file-context";
import type { Project } from "@toby/core/projects/index";

const pluginDir = path.resolve(import.meta.dirname, "../../plugin-images");
let directory: string;
let previousDir: string | undefined;
const persona = {
	name: "Test",
	instructions: "",
	promptMode: "add" as const,
	ai: { provider: "ollama", model: "llama3.2" },
};
// Tiny opaque PNG fixture; no runtime test dependency on Sharp in the CLI package.
const image =
	"iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a2ioAAAAASUVORK5CYII=";
const attachment = {
	filename: "image.png",
	mediaType: "image/png",
	dataBase64: image,
	byteSize: Buffer.from(image, "base64").length,
};

beforeEach(() => {
	previousDir = process.env.TOBY_DIR;
	directory = fs.realpathSync(
		fs.mkdtempSync(path.join(os.tmpdir(), "toby-images-plugin-")),
	);
	process.env.TOBY_DIR = directory;
});
afterEach(() => {
	if (previousDir === undefined)
		Reflect.deleteProperty(process.env, "TOBY_DIR");
	else process.env.TOBY_DIR = previousDir;
	fs.rmSync(directory, { recursive: true, force: true });
});
async function protocol(args: string[], body: unknown = {}) {
	const process = Bun.spawn(
		[Bun.which("bun") ?? "bun", path.join(pluginDir, "src/index.ts"), ...args],
		{ stdin: "pipe", stdout: "pipe", stderr: "pipe" },
	);
	process.stdin.write(JSON.stringify(body));
	process.stdin.end();
	const [stdout, stderr, exitCode] = await Promise.all([
		new Response(process.stdout).text(),
		new Response(process.stderr).text(),
		process.exited,
	]);
	return { body: JSON.parse(stdout), stderr, exitCode };
}
function metadata() {
	const loaded = loadPluginMetadata({
		kind: "bun-package",
		binaryName: "toby-plugin-images",
		directoryPath: pluginDir,
		manifestPath: path.join(pluginDir, "manifest.json"),
		entryPath: path.join(pluginDir, "src/index.ts"),
	});
	if ("error" in loaded) throw new Error(loaded.error);
	return loaded;
}

describe("Images integration", () => {
	it("reports protocol, readiness, and no credential fields", async () => {
		const disconnected = await protocol(["status"]);
		expect(disconnected.body).toMatchObject({
			ok: true,
			name: "images",
			connected: false,
			chatReadiness: { ok: false },
		});
		expect(disconnected.body.chatModelPrep).toBeDefined();
		expect((await protocol(["connect"])).body.ok).toBe(true);
		expect(
			(
				await protocol(["status"], {
					state: { connectedAt: "now" },
					validateTools: true,
				})
			).body.tools,
		).toHaveLength(4);
		expect((await protocol(["config", "shape"])).body.fields).toEqual([]);
		expect((await protocol(["disconnect"])).body.ok).toBe(true);
	});
	it("binds cached adapter tools to the current attachment and scopes outputs", async () => {
		const loaded = metadata();
		expect(loaded.readOnlyTools).not.toContain("imagesInspect");
		const module = createPluginIntegrationModule(loaded);
		const bundle = await module.createChatTools?.({ dryRun: false });
		if (!bundle) throw new Error("Missing tools");
		const bound = bindPluginFileContext(bundle.tools, {
			attachments: [attachment],
		});
		const conversion = bound.imagesConvert;
		if (!conversion?.execute) throw new Error("Missing conversion");
		const args = {
			source: "attachment:image.png",
			format: "webp",
			outputName: "result.webp",
		};
		const parsed = (
			conversion.inputSchema as { parse(value: unknown): unknown }
		).parse(args);
		const result = await conversion.execute(parsed, {
			toolCallId: "test",
			messages: [],
		});
		expect(result).toMatchObject({ format: "webp", width: 1, height: 1 });
		expect(result).toHaveProperty("markdown");
		expect(
			fs.existsSync(path.join(directory, "generated-files", "result.webp")),
		).toBe(true);
		const next = bindPluginFileContext(bundle.tools, { attachments: [] });
		const missing = await next.imagesInspect?.execute?.(
			{ source: "attachment:image.png" },
			{ toolCallId: "test", messages: [] },
		);
		expect(missing).toHaveProperty("error");
	});
	it("creates a downloadable JPEG through the adapter with the chat's encoder fields", async () => {
		const module = createPluginIntegrationModule(metadata());
		const bundle = await module.createChatTools?.({ dryRun: false });
		if (!bundle) throw new Error("Missing tools");
		const bound = bindPluginFileContext(bundle.tools, {
			attachments: [attachment],
		});
		const result = await bound.imagesConvert?.execute?.(
			{
				source: "attachment:image.png",
				outputName: "converted.jpg",
				format: "jpeg",
				quality: 85,
				lossless: false,
				compressionLevel: 6,
				background: "#FFFFFF",
			},
			{ toolCallId: "test", messages: [] },
		);
		expect(result).not.toHaveProperty("error");
		expect(result).toHaveProperty("format", "jpeg");
		const converted = result as { path: string; markdown: string };
		expect(fs.existsSync(converted.path)).toBe(true);
		expect(fs.readFileSync(converted.path).subarray(0, 3)).toEqual(
			Buffer.from([0xff, 0xd8, 0xff]),
		);
		expect(converted.markdown).toContain("Download converted.jpg");
	});
	it("saves beside the source with the same basename and preserves both existing files", async () => {
		const folder = path.join(directory, "Downloads");
		fs.mkdirSync(folder);
		const source = path.join(folder, "Photo with spaces.png");
		const original = Buffer.from(image, "base64");
		fs.writeFileSync(source, original);
		const module = createPluginIntegrationModule(metadata());
		const bundle = await module.createChatTools?.({ dryRun: false });
		if (!bundle) throw new Error("Missing tools");
		const bound = bindPluginFileContext(bundle.tools, {});
		const args = { source, format: "jpeg", outputLocation: "source" };
		const options = { toolCallId: "test", messages: [] };
		const result = await bound.imagesConvert?.execute?.(args, options);
		const output = path.join(folder, "Photo with spaces.jpg");
		expect(result).toHaveProperty("path", output);
		expect(fs.readFileSync(source)).toEqual(original);
		expect(fs.readFileSync(output).subarray(0, 3)).toEqual(
			Buffer.from([0xff, 0xd8, 0xff]),
		);
		expect(await bound.imagesConvert?.execute?.(args, options)).toHaveProperty(
			"error",
		);
		expect(
			await bindPluginFileContext(bundle.tools, {
				attachments: [attachment],
			}).imagesConvert?.execute?.(
				{
					source: "attachment:image.png",
					format: "jpeg",
					outputLocation: "source",
				},
				options,
			),
		).toHaveProperty("error");
		const project = {
			folderPath: folder,
			outputsDir: path.join(folder, "outputs"),
		} as Project;
		expect(
			await bindPluginFileContext(bundle.tools, {
				project,
			}).imagesConvert?.execute?.(
				{ ...args, outputName: "project-copy.jpg" },
				options,
			),
		).toHaveProperty("path", path.join(folder, "project-copy.jpg"));
		fs.writeFileSync(path.join(directory, "outside.png"), original);
		expect(
			await bindPluginFileContext(bundle.tools, {
				project,
			}).imagesConvert?.execute?.(
				{
					source: path.join(directory, "outside.png"),
					format: "jpeg",
					outputLocation: "source",
				},
				options,
			),
		).toHaveProperty("error");
	});
	it("allows image tools on text-only models while preserving vision gating", () => {
		expect(() => validateChatAttachments([attachment], persona)).toThrow();
		const config = readConfig();
		config.integrations.images = { connectedAt: new Date().toISOString() };
		writeConfig(config);
		expect(validateChatAttachments([attachment], persona)).toHaveLength(1);
		expect(resolveChatInputCapability(persona).supported).toBe(true);
		expect(resolveChatAttachmentCapability(persona).supported).toBe(false);
		expect(
			resolveChatInputCapability(persona).acceptedMediaTypes,
		).not.toContain("image/gif");
	});
	it("rejects project source/output symlink escapes and honours project outputs", async () => {
		const folderPath = path.join(directory, "project");
		fs.mkdirSync(folderPath);
		const outputsDir = path.join(folderPath, "outputs");
		const project = { folderPath, outputsDir } as Project;
		const module = createPluginIntegrationModule(metadata());
		const bundle = await module.createChatTools?.({ dryRun: false });
		if (!bundle) throw new Error("Missing tools");
		const bound = bindPluginFileContext(bundle.tools, {
			project,
			attachments: [attachment],
		});
		const result = await bound.imagesConvert?.execute?.(
			{ source: "attachment:image.png", outputName: "project.png" },
			{ toolCallId: "test", messages: [] },
		);
		expect(result).toHaveProperty("path", path.join(outputsDir, "project.png"));
		const external = path.join(directory, "outside.png");
		fs.writeFileSync(external, Buffer.from(image, "base64"));
		fs.symlinkSync(external, path.join(folderPath, "escape.png"));
		expect(
			await bound.imagesInspect?.execute?.(
				{ source: "escape.png" },
				{ toolCallId: "test", messages: [] },
			),
		).toHaveProperty("error");
		fs.rmSync(outputsDir, { recursive: true });
		fs.symlinkSync(directory, outputsDir);
		expect(
			await bound.imagesConvert?.execute?.(
				{ source: "attachment:image.png" },
				{ toolCallId: "test", messages: [] },
			),
		).toHaveProperty("error");
	});
});
