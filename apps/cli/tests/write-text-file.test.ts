import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { resolveWriteTextFileTarget } from "@toby/core/ai/global-chat-tools";
import type { Project } from "@toby/core/projects/index";
import { afterEach, beforeEach, describe, expect, it } from "bun:test";

let tempDir: string;
let previousTobyDir: string | undefined;

beforeEach(() => {
	tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "toby-writefile-"));
	previousTobyDir = process.env.TOBY_DIR;
	process.env.TOBY_DIR = tempDir;
});

afterEach(() => {
	if (previousTobyDir === undefined) {
		process.env.TOBY_DIR = undefined;
	} else {
		process.env.TOBY_DIR = previousTobyDir;
	}
	fs.rmSync(tempDir, { recursive: true, force: true });
});

const fakeProject: Project = {
	slug: "test-project",
	name: "Test Project",
	dir: "",
	contextDir: "",
	outputsDir: "",
	skills: [],
	integrations: [],
};

describe("resolveWriteTextFileTarget", () => {
	it("accepts a simple relative markdown path", () => {
		const result = resolveWriteTextFileTarget({
			inputPath: "notes.md",
			location: "context",
			project: null,
		});
		expect(result.ok).toBe(true);
		expect(result.absPath).toMatch(/generated-files\/notes\.md$/);
	});

	it("accepts a nested relative path", () => {
		const result = resolveWriteTextFileTarget({
			inputPath: "reports/summary.md",
			location: "context",
			project: null,
		});
		expect(result.ok).toBe(true);
	});

	it("rejects absolute paths", () => {
		const result = resolveWriteTextFileTarget({
			inputPath: "/tmp/evil.md",
			location: "context",
			project: null,
		});
		expect(result.ok).toBe(false);
		expect(result.error).toContain("relative");
	});

	it("rejects parent traversal", () => {
		const result = resolveWriteTextFileTarget({
			inputPath: "../../../etc/passwd.md",
			location: "context",
			project: null,
		});
		expect(result.ok).toBe(false);
		expect(result.error).toContain("traverse");
	});

	it("rejects encoded traversal", () => {
		const result = resolveWriteTextFileTarget({
			inputPath: "sub/../../escape.md",
			location: "context",
			project: null,
		});
		expect(result.ok).toBe(false);
	});

	it("rejects empty path", () => {
		const result = resolveWriteTextFileTarget({
			inputPath: "",
			location: "context",
			project: null,
		});
		expect(result.ok).toBe(false);
	});

	it("rejects missing extension", () => {
		const result = resolveWriteTextFileTarget({
			inputPath: "README",
			location: "context",
			project: null,
		});
		expect(result.ok).toBe(false);
		expect(result.error).toContain("extension");
	});

	it("rejects unsupported extension", () => {
		const result = resolveWriteTextFileTarget({
			inputPath: "script.sh",
			location: "context",
			project: null,
		});
		expect(result.ok).toBe(false);
		expect(result.error).toContain("Unsupported");
	});

	it("scopes to project context dir when project is provided", () => {
		const projectDir = path.join(tempDir, "projects", "myproj");
		const contextDir = path.join(projectDir, "context");
		fs.mkdirSync(contextDir, { recursive: true });
		const project: Project = {
			slug: "myproj",
			name: "My Project",
			dir: projectDir,
			contextDir,
			outputsDir: path.join(projectDir, "outputs"),
			skills: [],
			integrations: [],
		};
		const result = resolveWriteTextFileTarget({
			inputPath: "notes.md",
			location: "context",
			project,
		});
		expect(result.ok).toBe(true);
		expect(result.absPath).toBe(path.join(contextDir, "notes.md"));
		expect(result.baseLabel).toContain("My Project");
	});

	it("scopes to project outputs dir when location=outputs", () => {
		const projectDir = path.join(tempDir, "projects", "myproj");
		const outputsDir = path.join(projectDir, "outputs");
		fs.mkdirSync(outputsDir, { recursive: true });
		const project: Project = {
			slug: "myproj",
			name: "My Project",
			dir: projectDir,
			contextDir: path.join(projectDir, "context"),
			outputsDir,
			skills: [],
			integrations: [],
		};
		const result = resolveWriteTextFileTarget({
			inputPath: "report.md",
			location: "outputs",
			project,
		});
		expect(result.ok).toBe(true);
		expect(result.absPath).toBe(path.join(outputsDir, "report.md"));
		expect(result.baseLabel).toContain("outputs");
	});

	it("defaults to outputs when location is undefined and project is active", () => {
		const projectDir = path.join(tempDir, "projects", "myproj");
		const outputsDir = path.join(projectDir, "outputs");
		fs.mkdirSync(outputsDir, { recursive: true });
		const project: Project = {
			slug: "myproj",
			name: "My Project",
			dir: projectDir,
			contextDir: path.join(projectDir, "context"),
			outputsDir,
			skills: [],
			integrations: [],
		};
		const result = resolveWriteTextFileTarget({
			inputPath: "report.md",
			location: "outputs",
			project,
		});
		expect(result.ok).toBe(true);
		expect(result.absPath).toBe(path.join(outputsDir, "report.md"));
	});

	it("allows supported extensions", () => {
		for (const ext of [
			".md",
			".txt",
			".json",
			".yaml",
			".yml",
			".csv",
			".html",
			".xml",
			".rst",
			".log",
			".tsv",
			".text",
			".markdown",
		]) {
			const result = resolveWriteTextFileTarget({
				inputPath: `file${ext}`,
				location: "context",
				project: null,
			});
			expect(result.ok).toBe(true);
		}
	});
});
