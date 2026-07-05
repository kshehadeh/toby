import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
	clearActiveProjectSlug,
	getActiveProjectSlug,
	setActiveProjectSlug,
} from "@toby/core/config/index";
import {
	type Project,
	clearActiveProjectSlug as clearProjectActive,
	createProject,
	deleteProject,
	formatProjectContextForPrompt,
	generateProjectNameFromPrompt,
	listProjects,
	loadProjectContextDocuments,
	resolveActiveProject,
	resolveProject,
	slugifyProjectName,
	updateProjectMetadata,
} from "@toby/core/projects/index";
import { closeChatDbForTests } from "@toby/core/session-store";

let tempDir: string;
let previousTobyDir: string | undefined;

beforeEach(() => {
	tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "toby-projects-"));
	previousTobyDir = process.env.TOBY_DIR;
	process.env.TOBY_DIR = tempDir;
});

afterEach(() => {
	closeChatDbForTests();
	if (previousTobyDir === undefined) {
		process.env.TOBY_DIR = undefined;
	} else {
		process.env.TOBY_DIR = previousTobyDir;
	}
	fs.rmSync(tempDir, { recursive: true, force: true });
});

describe("slugifyProjectName", () => {
	it("converts to kebab-case", () => {
		expect(slugifyProjectName("My Cool Project")).toBe("my-cool-project");
	});

	it("trims and lowercases", () => {
		expect(slugifyProjectName("  Hello World  ")).toBe("hello-world");
	});

	it("limits to 64 chars", () => {
		const long = "a".repeat(100);
		expect(slugifyProjectName(long).length).toBeLessThanOrEqual(64);
	});

	it("returns empty for no alphanumeric", () => {
		expect(slugifyProjectName("!!!")).toBe("");
	});
});

describe("generateProjectNameFromPrompt", () => {
	it("title-cases first 6 words", () => {
		expect(generateProjectNameFromPrompt("build a rust cli tool", 1)).toBe(
			"Build A Rust Cli Tool",
		);
	});

	it("falls back to numbered default", () => {
		expect(generateProjectNameFromPrompt("", 3)).toBe("Project 3");
	});
});

describe("project CRUD", () => {
	it("starts with no projects", () => {
		expect(listProjects()).toEqual([]);
	});

	it("creates a project with auto-generated name", () => {
		const project = createProject();
		expect(project.name).toBeTruthy();
		expect(project.slug).toBeTruthy();
		expect(path.basename(project.dir)).toBe(project.id);
		expect(fs.existsSync(project.dir)).toBe(true);
		expect(fs.existsSync(path.join(project.dir, "AGENTS.md"))).toBe(true);
		expect(fs.existsSync(path.join(project.dir, ".agent", "skills"))).toBe(
			true,
		);
	});

	it("creates a project with given name", () => {
		const project = createProject({ name: "My App" });
		expect(project.name).toBe("My App");
		expect(project.slug).toBe("my-app");
	});

	it("lists created projects", () => {
		createProject({ name: "Alpha" });
		createProject({ name: "Beta" });
		const projects = listProjects();
		expect(projects.length).toBe(2);
		expect(projects.map((p) => p.name)).toEqual(["Alpha", "Beta"]);
	});

	it("deduplicates slugs", () => {
		const p1 = createProject({ name: "Test" });
		const p2 = createProject({ name: "Test" });
		expect(p1.slug).not.toBe(p2.slug);
	});

	it("resolves project by slug", () => {
		const created = createProject({ name: "Resolver" });
		const resolved = resolveProject(created.slug);
		expect(resolved).not.toBeNull();
		expect(resolved?.name).toBe("Resolver");
	});

	it("returns null for unknown slug", () => {
		expect(resolveProject("nonexistent")).toBeNull();
	});

	it("updates project metadata", () => {
		const created = createProject({ name: "Original" });
		const updated = updateProjectMetadata(created.slug, {
			name: "Updated",
			summary: "Updated summary",
		});
		expect(updated.name).toBe("Updated");
		expect(updated.summary).toBe("Updated summary");
	});

	it("deletes a project", () => {
		const created = createProject({ name: "ToDelete" });
		deleteProject(created.slug);
		expect(resolveProject(created.slug)).toBeNull();
		expect(fs.existsSync(created.dir)).toBe(true);
	});

	it("clears active project when deleting it", () => {
		const created = createProject({ name: "ActiveDel" });
		setActiveProjectSlug(created.slug);
		expect(getActiveProjectSlug()).toBe(created.slug);
		deleteProject(created.slug);
		expect(getActiveProjectSlug()).toBeUndefined();
	});
});

describe("active project config", () => {
	it("starts with no active project", () => {
		expect(getActiveProjectSlug()).toBeUndefined();
		expect(resolveActiveProject()).toBeNull();
	});

	it("sets and gets active project", () => {
		const project = createProject({ name: "Active" });
		setActiveProjectSlug(project.slug);
		expect(getActiveProjectSlug()).toBe(project.slug);
		const resolved = resolveActiveProject();
		expect(resolved).not.toBeNull();
		expect(resolved?.slug).toBe(project.slug);
	});

	it("clears active project", () => {
		const project = createProject({ name: "Clearable" });
		setActiveProjectSlug(project.slug);
		clearActiveProjectSlug();
		expect(getActiveProjectSlug()).toBeUndefined();
	});

	it("returns null when active slug is missing", () => {
		setActiveProjectSlug("ghost");
		expect(resolveActiveProject()).toBeNull();
	});
});

describe("project context documents", () => {
	it("loads AGENTS.md guidance by default", () => {
		const project = createProject({ name: "EmptyCtx" });
		const docs = loadProjectContextDocuments(project);
		expect(docs.length).toBe(1);
		expect(docs[0].relativePath).toBe("AGENTS.md");
	});

	it("loads edited AGENTS.md guidance", () => {
		const project = createProject({ name: "CtxDocs" });
		fs.writeFileSync(
			path.join(project.folderPath, "AGENTS.md"),
			"Use short weekly summaries.",
		);
		const docs = loadProjectContextDocuments(project);
		expect(docs).toEqual([
			{ relativePath: "AGENTS.md", content: "Use short weekly summaries." },
		]);
	});

	it("returns no docs when AGENTS.md is missing", () => {
		const project = createProject({ name: "BinSkip" });
		fs.unlinkSync(path.join(project.folderPath, "AGENTS.md"));
		expect(loadProjectContextDocuments(project)).toEqual([]);
	});
});

describe("formatProjectContextForPrompt", () => {
	it("returns empty string for no docs", () => {
		const project = createProject({ name: "NoDocs" });
		expect(formatProjectContextForPrompt(project, [])).toContain(
			"Active project: **NoDocs**",
		);
	});

	it("formats docs with headers", () => {
		const project = createProject({ name: "FmtDocs" });
		const docs = [
			{ relativePath: "intro.md", content: "Hello" },
			{ relativePath: "notes.txt", content: "Some notes" },
		];
		const result = formatProjectContextForPrompt(project, docs);
		expect(result).toContain("Active project: **FmtDocs**");
		expect(result).toContain("### intro.md");
		expect(result).toContain("### notes.txt");
	});
});
