import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
	createProjectManagementTools,
	findProjectByReference,
} from "@toby/core/ai/project-management-tools";
import type { ValidatedChatAttachment } from "@toby/core/chat-pipeline/attachments";
import {
	createProject,
	listProjects,
	resolveProject,
} from "@toby/core/projects/index";
import { closeChatDbForTests } from "@toby/core/session-store";

type Execute = (input: unknown) => Promise<Record<string, unknown>>;

function tools(
	dryRun = false,
	appliedActions: string[] = [],
	attachments?: readonly ValidatedChatAttachment[],
) {
	const all = createProjectManagementTools({
		dryRun,
		appliedActions,
		attachments,
	});
	const run =
		(name: string): Execute =>
		(input) =>
			all[name]?.execute?.(input, {
				toolCallId: name,
				messages: [],
			}) as Promise<Record<string, unknown>>;
	return {
		list: run("listTobyProjects"),
		create: run("createTobyProject"),
		save: run("saveToTobyProject"),
		saveAttachment: run("saveAttachmentToTobyProject"),
		remove: run("deleteTobyProject"),
	};
}

describe("project management tools", () => {
	let dir: string;
	let previous: string | undefined;
	beforeEach(() => {
		closeChatDbForTests();
		previous = process.env.TOBY_DIR;
		dir = fs.mkdtempSync(path.join(os.tmpdir(), "toby-project-tools-"));
		process.env.TOBY_DIR = dir;
	});
	afterEach(() => {
		closeChatDbForTests();
		if (previous === undefined) Reflect.deleteProperty(process.env, "TOBY_DIR");
		else process.env.TOBY_DIR = previous;
		fs.rmSync(dir, { recursive: true, force: true });
	});

	it("creates a project and lists it", async () => {
		const actions: string[] = [];
		const { create, list } = tools(false, actions);
		const result = await create({ name: "Garden Plan", summary: "Beds" });
		expect(result).toMatchObject({
			ok: true,
			project: { name: "Garden Plan", summary: "Beds", slug: "garden-plan" },
		});
		expect(actions).toHaveLength(1);
		const listed = await list({});
		expect(listed.projects).toEqual([
			expect.objectContaining({ name: "Garden Plan" }),
		]);
	});

	it("uses an existing folder when folderPath is given", async () => {
		const folder = path.join(dir, "existing");
		fs.mkdirSync(folder);
		fs.writeFileSync(path.join(folder, "keep.md"), "keep");
		const result = await tools().create({
			name: "Existing",
			folderPath: folder,
		});
		expect(result).toMatchObject({ ok: true, project: { folderPath: folder } });
		expect(fs.readFileSync(path.join(folder, "keep.md"), "utf8")).toBe("keep");
		expect(
			await tools().create({ name: "Relative", folderPath: "rel/path" }),
		).toMatchObject({ ok: false });
	});

	it("does not create a project in dry-run mode", async () => {
		const result = await tools(true).create({ name: "Preview" });
		expect(result).toMatchObject({ ok: true, dryRun: true });
		expect(listProjects()).toEqual([]);
	});

	it("saves into a project by name from outside the project", async () => {
		const project = createProject({ name: "Trip Notes" });
		const result = await tools().save({
			project: "trip notes",
			path: "research/hotels.md",
			content: "# Hotels",
		});
		expect(result).toMatchObject({ ok: true, created: true });
		expect(
			fs.readFileSync(
				path.join(project.folderPath, "research", "hotels.md"),
				"utf8",
			),
		).toBe("# Hotels\n");

		const outputs = await tools().save({
			project: project.id,
			path: "itinerary.md",
			content: "Day 1",
			location: "outputs",
		});
		expect(outputs).toMatchObject({ ok: true });
		expect(fs.existsSync(path.join(project.outputsDir, "itinerary.md"))).toBe(
			true,
		);
	});

	it("refuses overwrites, traversal, and unknown projects", async () => {
		const project = createProject({ name: "Safe" });
		const { save } = tools();
		await save({ project: "Safe", path: "a.md", content: "one" });
		expect(
			await save({ project: "Safe", path: "a.md", content: "two" }),
		).toMatchObject({ ok: false });
		expect(
			await save({
				project: "Safe",
				path: "a.md",
				content: "two",
				overwrite: true,
			}),
		).toMatchObject({ ok: true, created: false });
		expect(
			await save({ project: "Safe", path: "../escape.md", content: "x" }),
		).toMatchObject({ ok: false });
		expect(
			await save({ project: "Missing", path: "a.md", content: "x" }),
		).toMatchObject({ ok: false });
		expect(fs.readFileSync(path.join(project.folderPath, "a.md"), "utf8")).toBe(
			"two\n",
		);
	});

	it("saves a current-turn attachment into a project by name", async () => {
		const project = createProject({ name: "Receipts" });
		const bytes = Buffer.from([0x25, 0x50, 0x44, 0x46, 0x00, 0xff]);
		const attachment = {
			filename: "invoice.pdf",
			mediaType: "application/pdf",
			byteSize: bytes.length,
			dataBase64: bytes.toString("base64"),
		} satisfies ValidatedChatAttachment;
		const { saveAttachment } = tools(false, [], [attachment]);

		const result = await saveAttachment({
			project: "receipts",
			filename: "invoice.pdf",
		});
		expect(result).toMatchObject({ ok: true, created: true });
		const saved = path.join(project.folderPath, "attachments", "invoice.pdf");
		expect(fs.readFileSync(saved).equals(bytes)).toBe(true);

		expect(
			await saveAttachment({ project: "Receipts", filename: "invoice.pdf" }),
		).toMatchObject({ ok: false });
		expect(
			await saveAttachment({ project: "Receipts", filename: "missing.pdf" }),
		).toMatchObject({ ok: false });
		expect(
			await saveAttachment({ project: "Nope", filename: "invoice.pdf" }),
		).toMatchObject({ ok: false });
	});

	it("rejects ambiguous project names", () => {
		createProject({ name: "Duplicate" });
		createProject({ name: "Duplicate" });
		const lookup = findProjectByReference("Duplicate");
		expect(lookup.ok).toBe(false);
		if (!lookup.ok) expect(lookup.candidates).toHaveLength(2);
	});

	it("deletes a project but keeps its files", async () => {
		const project = createProject({ name: "Old Work" });
		const preview = await tools(true).remove({ project: "Old Work" });
		expect(preview).toMatchObject({ ok: true, dryRun: true });
		expect(resolveProject(project.id)).not.toBeNull();

		const result = await tools().remove({ project: "Old Work" });
		expect(result).toMatchObject({ ok: true, dryRun: false });
		expect(resolveProject(project.id)).toBeNull();
		expect(fs.existsSync(project.folderPath)).toBe(true);
		expect(await tools().remove({ project: "Old Work" })).toMatchObject({
			ok: false,
		});
	});
});
