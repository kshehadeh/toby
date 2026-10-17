import fs from "node:fs";
import path from "node:path";
import type { ValidatedChatAttachment } from "../chat-pipeline/attachments";
import { registerProjectFile } from "../library/library-catalog";
import { log } from "../logging/chat-log";
import type { Project } from "../projects/index";
import { writeTextFileSuccessPayload } from "./write-text-file";

/**
 * Copy an original current-turn attachment into `<project>/attachments/`,
 * preserving its bytes. Shared by `saveProjectAttachment` (active project) and
 * `saveAttachmentToTobyProject` (any project).
 */
export async function executeSaveProjectAttachment(params: {
	readonly project: Project;
	readonly filename: string;
	readonly overwrite: boolean;
	readonly attachments: readonly ValidatedChatAttachment[] | undefined;
	readonly dryRun: boolean;
	/** Mutated on successful saves (and dry-run previews). */
	readonly appliedActions: string[];
}) {
	const attachment = params.attachments?.find(
		(candidate) => candidate.filename === params.filename,
	);
	if (!attachment) {
		return {
			ok: false as const,
			error: `No current-turn attachment named "${params.filename}".`,
		};
	}

	const attachmentDir = path.join(params.project.folderPath, "attachments");
	const targetFile = path.join(attachmentDir, attachment.filename);
	try {
		const existingDir = fs.lstatSync(attachmentDir);
		if (!existingDir.isDirectory() || existingDir.isSymbolicLink()) {
			return {
				ok: false as const,
				error: "Project attachments path is not a safe directory.",
			};
		}
	} catch {
		// Create it below for new projects.
	}

	let alreadyExists = false;
	try {
		const existing = fs.lstatSync(targetFile);
		alreadyExists = true;
		if (existing.isSymbolicLink() || existing.isDirectory()) {
			return {
				ok: false as const,
				error: "Refusing to replace a symbolic link or directory.",
			};
		}
	} catch {
		// The target does not exist.
	}
	if (alreadyExists && !params.overwrite) {
		return {
			ok: false as const,
			error: `An attachment named "${attachment.filename}" already exists. Set overwrite=true to replace it.`,
		};
	}

	if (params.dryRun) {
		const verb = alreadyExists ? "replace" : "save";
		const message = `[dry-run] Would ${verb} ${targetFile}`;
		params.appliedActions.push(message);
		return writeTextFileSuccessPayload({
			absPath: targetFile,
			dryRun: true,
			created: !alreadyExists,
			message,
		});
	}

	try {
		fs.mkdirSync(attachmentDir, { recursive: true });
		fs.writeFileSync(targetFile, Buffer.from(attachment.dataBase64, "base64"));
	} catch (error) {
		return {
			ok: false as const,
			error:
				error instanceof Error
					? error.message
					: "Failed to save the project attachment.",
		};
	}
	const message = `Saved ${targetFile} (project attachments)`;
	params.appliedActions.push(message);
	const relativePath = `attachments/${attachment.filename}`;
	try {
		await registerProjectFile({
			projectId: params.project.id,
			projectName: params.project.name,
			relativePath,
			filename: attachment.filename,
			bytes: Buffer.from(attachment.dataBase64, "base64"),
			mediaType: attachment.mediaType,
		});
	} catch (error) {
		log("warn", "general", "library_catalog_skipped", {
			path: relativePath,
			reason: error instanceof Error ? error.message : String(error),
		});
	}
	return writeTextFileSuccessPayload({
		absPath: targetFile,
		dryRun: false,
		created: !alreadyExists,
		message,
	});
}
