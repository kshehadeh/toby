import fs from "node:fs";
import path from "node:path";
import { type Tool, tool } from "ai";
import { z } from "zod";
import type { ValidatedChatAttachment } from "../chat-pipeline/attachments";
import {
	type Project,
	createProject,
	deleteProject,
	listProjects,
	resolveProject,
	slugifyProjectName,
} from "../projects/index";
import { executeSaveProjectAttachment } from "./project-attachment";
import { executeWriteTextFile } from "./write-text-file";

type ProjectSummary = {
	readonly id: string;
	readonly slug: string;
	readonly name: string;
	readonly summary: string;
	readonly folderPath: string;
};

type ProjectLookup =
	| { readonly ok: true; readonly project: Project }
	| {
			readonly ok: false;
			readonly error: string;
			readonly candidates?: readonly ProjectSummary[];
	  };

function summarizeProject(project: Project): ProjectSummary {
	return {
		id: project.id,
		slug: project.slug,
		name: project.name,
		summary: project.summary,
		folderPath: project.folderPath,
	};
}

/**
 * Resolve a project by id, slug, or display name (case-insensitive). Names
 * that match more than one project are rejected with the candidates so the
 * model can retry with an id.
 */
export function findProjectByReference(reference: string): ProjectLookup {
	const key = reference.trim();
	if (!key) return { ok: false, error: "project must not be empty." };
	const direct = resolveProject(key);
	if (direct) return { ok: true, project: direct };

	const lowered = key.toLowerCase();
	const slug = slugifyProjectName(key);
	const projects = listProjects();
	let matches = projects.filter((p) => p.name.toLowerCase() === lowered);
	if (matches.length === 0 && slug) {
		matches = projects.filter((p) => slugifyProjectName(p.name) === slug);
	}
	if (matches.length === 1 && matches[0]) {
		return { ok: true, project: matches[0] };
	}
	if (matches.length > 1) {
		return {
			ok: false,
			error: `More than one project is named "${key}". Retry with the project id.`,
			candidates: matches.map(summarizeProject),
		};
	}
	return {
		ok: false,
		error: `No project matches "${key}". Call listTobyProjects to see existing projects.`,
	};
}

const projectReference = z
	.string()
	.min(1)
	.describe("Project id, slug, or exact name (from listTobyProjects)");

const createProjectSchema = z.object({
	name: z.string().trim().min(1).describe("Display name for the new project"),
	summary: z
		.string()
		.optional()
		.describe(
			"Short description of the project's purpose, used as context in project chats",
		),
	folderPath: z
		.string()
		.optional()
		.describe(
			"Absolute path to an existing folder to use as the project folder. Omit to let Toby create a managed folder.",
		),
});

const saveToProjectSchema = z.object({
	project: projectReference,
	path: z
		.string()
		.min(1)
		.describe(
			"Relative path (including filename and extension) within the project location, e.g. 'notes.md' or 'research/summary.md'",
		),
	content: z.string().describe("Full UTF-8 text content to write to the file"),
	location: z
		.enum(["context", "outputs"])
		.optional()
		.describe(
			"'context' (default) writes into the project folder; 'outputs' writes into the project's outputs folder for generated artifacts",
		),
	overwrite: z
		.boolean()
		.optional()
		.describe(
			"When true, overwrite an existing file instead of failing (default false)",
		),
});

const saveAttachmentSchema = z.object({
	project: projectReference,
	filename: z
		.string()
		.min(1)
		.describe("Exact filename of a file attached to the current user message"),
	overwrite: z
		.boolean()
		.optional()
		.describe(
			"Replace an existing attachment with the same name (default false)",
		),
});

const deleteProjectSchema = z.object({ project: projectReference });

/**
 * Built-in tools for managing Toby projects from any chat, including chats
 * that are not inside a project.
 */
export function createProjectManagementTools(ctx: {
	readonly dryRun: boolean;
	readonly appliedActions: string[];
	/** Validated files attached to the current turn. */
	readonly attachments?: readonly ValidatedChatAttachment[];
}): Record<string, Tool> {
	return {
		listTobyProjects: tool({
			description:
				"List the user's Toby projects (id, slug, name, summary, folder). Use to find the project to save into or delete.",
			inputSchema: z.object({}),
			execute: async () => ({
				projects: listProjects().map(summarizeProject),
			}),
		}),
		createTobyProject: tool({
			description:
				"Create a new Toby project (a workspace folder with its own chats, files, and skills). Only call when the user asks to create a project. Optionally point it at an existing folder with an absolute folderPath.",
			inputSchema: createProjectSchema,
			execute: async ({ name, summary, folderPath }) => {
				const folder = folderPath?.trim();
				if (folder) {
					if (!path.isAbsolute(folder)) {
						return { ok: false, error: "folderPath must be an absolute path." };
					}
					if (fs.existsSync(folder) && !fs.statSync(folder).isDirectory()) {
						return { ok: false, error: "folderPath is not a folder." };
					}
				}
				if (ctx.dryRun) {
					const message = `[dry-run] Would create project ${name}`;
					ctx.appliedActions.push(message);
					return { ok: true, dryRun: true, message };
				}
				try {
					const project = createProject({
						name,
						summary,
						folderPath: folder,
					});
					const message = `Created project ${project.name} at ${project.folderPath}`;
					ctx.appliedActions.push(message);
					return {
						ok: true,
						dryRun: false,
						project: summarizeProject(project),
						message,
					};
				} catch (error) {
					return {
						ok: false,
						error: error instanceof Error ? error.message : String(error),
					};
				}
			},
		}),
		saveToTobyProject: tool({
			description:
				"Save a UTF-8 text file (notes, research, Markdown, JSON, etc.) into an existing Toby project by name or id. Works from any chat, including chats outside that project. Only call when the user asks to save or add information to a project. In a chat already inside the target project, prefer writeTextFile.",
			inputSchema: saveToProjectSchema,
			execute: async ({
				project: reference,
				path: inputPath,
				content,
				location,
				overwrite,
			}) => {
				const lookup = findProjectByReference(reference);
				if (!lookup.ok) return lookup;
				return executeWriteTextFile({
					inputPath,
					content,
					location: location ?? "context",
					overwrite: overwrite === true,
					project: lookup.project,
					dryRun: ctx.dryRun,
					appliedActions: ctx.appliedActions,
				});
			},
		}),
		saveAttachmentToTobyProject: tool({
			description:
				"Save an original file attached to the current message (PDF, image, document, etc.) into an existing Toby project's attachments folder, by project name or id. Works from any chat. Preserves the file bytes. Only call when the user asks to add or save an attached file to a project.",
			inputSchema: saveAttachmentSchema,
			execute: async ({ project: reference, filename, overwrite }) => {
				const lookup = findProjectByReference(reference);
				if (!lookup.ok) return lookup;
				return executeSaveProjectAttachment({
					project: lookup.project,
					filename,
					overwrite: overwrite === true,
					attachments: ctx.attachments,
					dryRun: ctx.dryRun,
					appliedActions: ctx.appliedActions,
				});
			},
		}),
		deleteTobyProject: tool({
			description:
				"Delete a Toby project. Only call when the user explicitly asks to delete that project. Its chats are kept but no longer belong to the project, and its folder and files stay on disk.",
			inputSchema: deleteProjectSchema,
			execute: async ({ project: reference }) => {
				const lookup = findProjectByReference(reference);
				if (!lookup.ok) return lookup;
				const project = summarizeProject(lookup.project);
				if (ctx.dryRun) {
					const message = `[dry-run] Would delete project ${project.name}`;
					ctx.appliedActions.push(message);
					return { ok: true, dryRun: true, project, message };
				}
				deleteProject(project.id);
				const message = `Deleted project ${project.name} (files kept at ${project.folderPath})`;
				ctx.appliedActions.push(message);
				return { ok: true, dryRun: false, project, message };
			},
		}),
	};
}
