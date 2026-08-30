import { describe, expect, it } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
	createGlobalChatTools,
	resolveProjectFileTarget,
	sanitizeSkillFolderSegment,
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
	it("renames and deletes existing project files", async () => {
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
			expect(
				(
					await rename?.({
						sourcePath: "draft.txt",
						destinationPath: "final.txt",
					})
				)?.ok,
			).toBe(true);
			expect(fs.existsSync(path.join(folderPath, "draft.txt"))).toBe(false);
			expect(fs.readFileSync(path.join(folderPath, "final.txt"), "utf8")).toBe(
				"draft",
			);

			expect((await remove?.({ path: "final.txt" }))?.ok).toBe(true);
			expect(fs.existsSync(path.join(folderPath, "final.txt"))).toBe(false);
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
});
