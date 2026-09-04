import { describe, expect, it } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
	createGlobalChatTools,
	globalChatToolsPromptSection,
	readProjectTextFile,
	resolveProjectFileTarget,
	sanitizeSkillFolderSegment,
	searchProjectFileContents,
} from "@toby/core/ai/global-chat-tools";
import type { Persona } from "@toby/core/config/index";
import type { Project } from "@toby/core/projects/index";

const persona: Persona = {
	name: "Test",
	instructions: "",
	promptMode: "add",
	ai: { provider: "ollama", model: "llama3.2" },
};

describe("sanitizeSkillFolderSegment", () => {
	it("normalizes to kebab-case", () => {
		expect(sanitizeSkillFolderSegment("  My Cool Skill  ")).toBe(
			"my-cool-skill",
		);
	});

	it("rejects empty or invalid", () => {
		expect(sanitizeSkillFolderSegment("")).toBeNull();
		expect(sanitizeSkillFolderSegment("!!!")).toBeNull();
		expect(sanitizeSkillFolderSegment("..")).toBeNull();
	});
});

describe("saveProjectAttachment", () => {
	it("preserves a current-turn attachment in the project", async () => {
		const folderPath = fs.mkdtempSync(
			path.join(os.tmpdir(), "toby-project-attachment-"),
		);
		const project = {
			id: "project-1",
			name: "Test Project",
			folderPath,
		} as Project;
		const tools = createGlobalChatTools({
			dryRun: false,
			persona,
			appliedActions: [],
			project,
			attachments: [
				{
					filename: "brief.pdf",
					mediaType: "application/pdf",
					dataBase64: "aGVsbG8=",
					byteSize: 5,
				},
			],
		});
		const execute = tools.saveProjectAttachment?.execute as
			| ((input: { filename: string; overwrite?: boolean }) => Promise<{
					ok: boolean;
			  }>)
			| undefined;

		try {
			const result = await execute?.({ filename: "brief.pdf" });
			expect(result?.ok).toBe(true);
			expect(
				fs.readFileSync(
					path.join(folderPath, "attachments", "brief.pdf"),
					"utf8",
				),
			).toBe("hello");
		} finally {
			fs.rmSync(folderPath, { recursive: true, force: true });
		}
	});
});

describe("project file management", () => {
	it("creates folders, moves files, and deletes existing project files", async () => {
		const folderPath = fs.mkdtempSync(
			path.join(os.tmpdir(), "toby-project-files-"),
		);
		const project = {
			id: "project-1",
			name: "Test Project",
			folderPath,
		} as Project;
		fs.writeFileSync(path.join(folderPath, "draft.txt"), "draft");
		const tools = createGlobalChatTools({
			dryRun: false,
			persona,
			appliedActions: [],
			project,
		});
		const listFiles = tools.listProjectFiles?.execute as
			| (() => Promise<{
					ok: boolean;
					tree?: readonly { relativePath: string }[];
			  }>)
			| undefined;
		const createFolder = tools.createProjectFolder?.execute as
			| ((input: { path: string }) => Promise<{ ok: boolean }>)
			| undefined;
		const rename = tools.renameProjectFile?.execute as
			| ((input: {
					sourcePath: string;
					destinationPath: string;
					overwrite?: boolean;
			  }) => Promise<{ ok: boolean }>)
			| undefined;
		const remove = tools.deleteProjectFile?.execute as
			| ((input: { path: string }) => Promise<{ ok: boolean }>)
			| undefined;

		try {
			expect((await listFiles?.())?.tree).toEqual(
				expect.arrayContaining([
					expect.objectContaining({ relativePath: "draft.txt" }),
				]),
			);
			expect((await createFolder?.({ path: "references/designs" }))?.ok).toBe(
				true,
			);
			expect(
				fs
					.statSync(path.join(folderPath, "references", "designs"))
					.isDirectory(),
			).toBe(true);
			expect(
				(
					await rename?.({
						sourcePath: "draft.txt",
						destinationPath: "references/designs/final.txt",
					})
				)?.ok,
			).toBe(true);
			expect(fs.existsSync(path.join(folderPath, "draft.txt"))).toBe(false);
			expect(
				fs.readFileSync(
					path.join(folderPath, "references", "designs", "final.txt"),
					"utf8",
				),
			).toBe("draft");

			expect(
				(await remove?.({ path: "references/designs/final.txt" }))?.ok,
			).toBe(true);
			expect(
				fs.existsSync(
					path.join(folderPath, "references", "designs", "final.txt"),
				),
			).toBe(false);
		} finally {
			fs.rmSync(folderPath, { recursive: true, force: true });
		}
	});

	it("rejects paths that escape a project", () => {
		const project = { folderPath: "/tmp/project" } as Project;
		expect(
			resolveProjectFileTarget({ inputPath: "../outside.txt", project }).ok,
		).toBe(false);
		expect(
			resolveProjectFileTarget({ inputPath: "/tmp/outside.txt", project }).ok,
		).toBe(false);
	});

	it("explains how to create folders and move files in project chats", () => {
		const project = {
			id: "project-1",
			name: "Test Project",
			folderPath: "/tmp/project",
		} as Project;
		const prompt = globalChatToolsPromptSection(project, persona);
		expect(prompt).toContain("**listProjectFiles**");
		expect(prompt).toContain(
			"call `listProjectFiles` to inspect the project tree",
		);
		expect(prompt).toContain("**createProjectFolder**");
		expect(prompt).toContain(
			"To move a file to another folder, call `renameProjectFile`",
		);
		expect(prompt).toContain("**readPdf**");
		expect(prompt).toContain("then **readPdf** with the project-relative");
		expect(prompt).toContain("**searchProjectFiles**");
		expect(prompt).toContain("**readProjectFile**");
		expect(prompt).toContain("Prefer project files over general knowledge");
		expect(prompt).toContain("project-organization");
		expect(prompt).not.toContain(
			"Only call when the user explicitly asks to create a folder",
		);
	});

	it("searches and reads project text files", () => {
		const folderPath = fs.mkdtempSync(
			path.join(os.tmpdir(), "toby-project-search-"),
		);
		const project = {
			id: "project-1",
			name: "Test Project",
			folderPath,
		} as Project;
		fs.mkdirSync(path.join(folderPath, "research"));
		fs.writeFileSync(
			path.join(folderPath, "research", "notes.md"),
			"# Notes\nFind the widget launch date here.\n",
		);
		fs.writeFileSync(path.join(folderPath, "binary.bin"), "\u0000\u0001");
		try {
			const search = searchProjectFileContents({
				project,
				query: "widget launch",
			});
			expect(search.ok).toBe(true);
			if (search.ok) {
				expect(search.matches).toEqual([
					expect.objectContaining({
						path: "research/notes.md",
						line: 2,
						text: "Find the widget launch date here.",
					}),
				]);
			}
			const scoped = searchProjectFileContents({
				project,
				query: "widget",
				pathPrefix: "outputs",
			});
			expect(scoped.ok).toBe(true);
			if (scoped.ok) {
				expect(scoped.matches).toEqual([]);
			}
			const read = readProjectTextFile({
				project,
				inputPath: "research/notes.md",
			});
			expect(read).toMatchObject({
				ok: true,
				path: "research/notes.md",
				truncated: false,
			});
			if (read.ok) {
				expect(read.content).toContain("widget launch");
			}
			expect(
				readProjectTextFile({ project, inputPath: "../outside.md" }).ok,
			).toBe(false);
			expect(readProjectTextFile({ project, inputPath: "binary.bin" }).ok).toBe(
				false,
			);
		} finally {
			fs.rmSync(folderPath, { recursive: true, force: true });
		}
	});
});
