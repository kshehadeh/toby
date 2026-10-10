import { AsyncLocalStorage } from "node:async_hooks";
import fs from "node:fs";
import path from "node:path";
import type { Tool } from "ai";
import type { ValidatedChatAttachment } from "../../chat-pipeline/attachments";
import { getGeneratedFilesDir } from "../../config/index";
import type { Project } from "../../projects/index";
import type { PluginFileContext } from "./protocol";

type TurnFiles = {
	readonly attachments?: readonly ValidatedChatAttachment[];
	readonly project?: Project | null;
};
const turnFiles = new AsyncLocalStorage<TurnFiles>();

/** Bind execution, not cached definitions, to the current turn's files. */
export function bindPluginFileContext(
	tools: Record<string, Tool>,
	context: TurnFiles,
): Record<string, Tool> {
	return Object.fromEntries(
		Object.entries(tools).map(([name, definition]) => {
			const execute = definition.execute;
			return [
				name,
				execute
					? {
							...definition,
							execute: (...args: Parameters<typeof execute>) =>
								turnFiles.run(context, () => execute(...args)),
						}
					: definition,
			];
		}),
	);
}

function contained(root: string, file: string): boolean {
	const relative = path.relative(root, file);
	return (
		relative !== ".." &&
		!relative.startsWith(`..${path.sep}`) &&
		!path.isAbsolute(relative)
	);
}

function projectOutputDir(project: Project): string {
	const root = fs.realpathSync(project.folderPath);
	const relativeOutput = path.relative(
		path.resolve(project.folderPath),
		path.resolve(project.outputsDir),
	);
	const output = path.resolve(root, relativeOutput);
	if (!contained(root, output))
		throw new Error("Output directory escapes the project.");
	// Check each existing component, including outputs itself, before creating it.
	let current = root;
	for (const part of path
		.relative(root, output)
		.split(path.sep)
		.filter(Boolean)) {
		current = path.join(current, part);
		const stat = (() => {
			try {
				return fs.lstatSync(current);
			} catch (error) {
				if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
				throw error;
			}
		})();
		if (stat?.isSymbolicLink())
			throw new Error("Project output directory must not contain symlinks.");
	}
	return output;
}

/** Opt-in file tools use `source`; no files are materialized during resolution. */
export function resolvePluginFileContext(
	input: Record<string, unknown>,
): PluginFileContext {
	const context = turnFiles.getStore();
	const source = input.source;
	if (typeof source !== "string" || !source.trim())
		throw new Error("source is required.");
	const outputDir = context?.project
		? projectOutputDir(context.project)
		: getGeneratedFilesDir();
	const outputLocation = input.outputLocation ?? "default";
	if (outputLocation !== "default" && outputLocation !== "source")
		throw new Error("outputLocation must be default or source.");
	if (source.startsWith("attachment:")) {
		if (outputLocation === "source")
			throw new Error(
				"Attachments have no source folder. Use the default output location.",
			);
		const filename = source.slice("attachment:".length);
		const matches =
			context?.attachments?.filter(
				(attachment) => attachment.filename === filename,
			) ?? [];
		if (matches.length !== 1)
			throw new Error(
				`Expected one current-turn attachment named "${filename}".`,
			);
		const attachment = matches[0];
		if (!attachment) throw new Error("Attachment not found.");
		return {
			source: { filename, dataBase64: attachment.dataBase64 },
			outputDir,
		};
	}
	if (/^[a-z][a-z0-9+.-]*:/i.test(source))
		throw new Error("Use a local path or attachment reference, not a URL.");
	let file: string;
	if (context?.project) {
		const root = fs.realpathSync(context.project.folderPath);
		file = fs.realpathSync(path.resolve(root, source));
		if (!contained(root, file))
			throw new Error("Source escapes the active project.");
	} else {
		if (!path.isAbsolute(source))
			throw new Error("Use an absolute local path outside project chats.");
		file = fs.realpathSync(source);
	}
	if (!fs.statSync(file).isFile())
		throw new Error("Source must be a regular file.");
	return {
		source: { path: file, filename: path.basename(file) },
		outputDir: outputLocation === "source" ? path.dirname(file) : outputDir,
	};
}
