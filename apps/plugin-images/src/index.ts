#!/usr/bin/env bun
import path from "node:path";
import { TOOL_DEFINITIONS } from "./tools";

type Json = Record<string, unknown>;
function emit(payload: Json, code = 0): never {
	process.stdout.write(`${JSON.stringify(payload)}\n`);
	process.exit(code);
}
function object(value: unknown): Json {
	if (!value || typeof value !== "object" || Array.isArray(value))
		throw new Error("Expected a JSON object.");
	return value as Json;
}
async function main() {
	const [command, subcommand] = process.argv.slice(2);
	let body: Json = {};
	const raw = process.stdin.isTTY ? "" : await Bun.stdin.text();
	try {
		if (raw.trim()) body = object(JSON.parse(raw));
	} catch {
		emit(
			{
				ok: false,
				error: "Invalid JSON object on stdin",
				code: "invalid_input",
			},
			2,
		);
	}
	const state = body.state ? object(body.state) : {};
	const connected = Boolean(state.connectedAt);
	if (command === "tools" && subcommand === "list")
		emit({ ok: true, tools: TOOL_DEFINITIONS });
	if (command === "config") {
		if (subcommand === "shape") emit({ ok: true, fields: [] });
		if (subcommand === "get") emit({ ok: true, config: {} });
		if (subcommand === "set") emit({ ok: true });
	}
	if (command === "disconnect")
		emit({
			ok: true,
			reason: "Images disconnected. Output files are preserved.",
		});
	if (command === "setup" && subcommand === "guide")
		emit({
			ok: true,
			name: "images",
			displayName: "Images",
			description: "Local image manipulation",
			steps: [
				{
					id: "overview",
					title: "Edit images locally",
					description:
						"Crop, resize, adjust colours, convert, and compress still JPEG, PNG, or WebP images. Originals are preserved. No account or API key is required.",
				},
				{
					id: "auth",
					title: "Connect",
					description:
						"Click Connect to validate local image processing and enable the tools.",
				},
			],
		});
	if (command === "status" || command === "connect") {
		let error: string | undefined;
		try {
			const { validateEngine } = await import("./engine");
			await validateEngine();
		} catch (cause) {
			error = cause instanceof Error ? cause.message : String(cause);
		}
		if (command === "connect")
			emit(
				{
					ok: !error,
					reason: error
						? `Image engine unavailable: ${error}`
						: "Images connected. Processing stays local.",
				},
				error ? 1 : 0,
			);
		emit({
			ok: true,
			name: "images",
			displayName: "Images",
			description:
				"Crop, resize, adjust colours, convert, and compress images locally",
			version: "1.0.0",
			protocolVersion: "1",
			icon: "🖼️",
			connected: connected && !error,
			capabilities: ["chat"],
			providerCategories: [],
			resources: ["images", "files"],
			chatReadiness: {
				ok: connected && !error,
				hint: error
					? `Image engine unavailable: ${error}`
					: connected
						? "Images ready."
						: "Connect Images to enable local tools.",
			},
			chatModelPrep: {
				systemPromptSection:
					"### Images\nEdit existing still JPEG, PNG, or WebP images locally. Use source attachment:<exact filename> for current-turn attachments; project-relative paths in project chats; absolute local paths elsewhere. Inspect first when dimensions matter. Combine edits with imagesTransform to avoid repeated lossy encoding. Output defaults to project outputs or generated-files. For same-folder requests on local files, set outputLocation: source; preserve the source basename with the new extension. Attachments have no source folder. Originals are preserved. Use quality for JPEG/WebP and compressionLevel for PNG; omit or pass null for unused options. Include the returned markdown Download link verbatim. If a tool fails, correct the reported argument or explain the error; never repeat an unchanged failing call. Explain targetMet=false. Do not claim encoding quality restores lost detail. Image generation is separate.",
				singleSessionRules:
					"Use Images tools for local image manipulation. For same-folder requests on local files, set outputLocation: source; keep the source basename and change the extension. Attachments have no source folder. Use quality for JPEG/WebP and compressionLevel for PNG; omit or pass null for unused options. Return the result's markdown link. Correct tool errors rather than repeating the same failing call.",
				singleSessionUserTemplate: "{{userPrompt}}",
				multiUserContentTemplate: "{{userPrompt}}",
			},
			details: error
				? `Image engine unavailable: ${error}`
				: connected
					? "Local JPEG, PNG, and WebP processing ready."
					: "No credentials required. Connect Images to enable it.",
			...(body.validateTools
				? {
						tools: TOOL_DEFINITIONS.map((tool) => ({
							tool: tool.name,
							ok: !error,
							details: error ?? "Local engine validated.",
						})),
					}
				: {}),
		});
	}
	if (command === "tools" && subcommand === "execute") {
		const input = object(body.input);
		const tool = String(body.tool ?? "");
		if (!TOOL_DEFINITIONS.some((definition) => definition.name === tool))
			emit(
				{ ok: false, error: `Unknown tool: ${tool}`, code: "unknown_tool" },
				2,
			);
		let files = body.files;
		if (!files) {
			const source = String(input.source ?? "");
			const paths = body.paths ? object(body.paths) : {};
			// Direct protocol callers must provide an explicit destination context.
			files = {
				source: { path: source, filename: path.basename(source) },
				outputDir: paths.outputDir ?? paths.dataDir,
			};
		}
		const context = object(files);
		const source = object(context.source);
		if (
			typeof source.filename !== "string" ||
			typeof context.outputDir !== "string"
		)
			emit(
				{
					ok: false,
					code: "invalid_input",
					error: "files requires source.filename and outputDir.",
				},
				2,
			);
		if (source.path !== undefined && typeof source.path !== "string")
			emit(
				{
					ok: false,
					code: "invalid_input",
					error: "source.path must be a string.",
				},
				2,
			);
		if (
			source.dataBase64 !== undefined &&
			typeof source.dataBase64 !== "string"
		)
			emit(
				{
					ok: false,
					code: "invalid_input",
					error: "source.dataBase64 must be a string.",
				},
				2,
			);
		try {
			const { executeImageTool } = await import("./engine");
			const result = await executeImageTool(
				tool,
				input,
				{
					source: source as {
						filename: string;
						path?: string;
						dataBase64?: string;
					},
					outputDir: context.outputDir,
				},
				body.dryRun === true,
			);
			emit({ ok: true, ...result });
		} catch (cause) {
			const code = (cause as { code?: string }).code;
			emit(
				{
					ok: false,
					code: code ?? "processing_failed",
					error: cause instanceof Error ? cause.message : String(cause),
				},
				1,
			);
		}
	}
	emit({ ok: false, error: `Unknown command: ${command}`, code: "usage" }, 2);
}
main().catch((cause) => {
	// Keep stdout protocol-only, even when loading native dependencies fails.
	emit(
		{
			ok: false,
			error: cause instanceof Error ? cause.message : String(cause),
			code: "internal_error",
		},
		2,
	);
});
