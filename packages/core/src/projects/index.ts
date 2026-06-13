import fs from "node:fs";
import path from "node:path";
import {
	clearActiveProjectSlug,
	getActiveProjectSlug,
	getProjectsDir,
	setActiveProjectSlug,
} from "../config/index";

export interface Project {
	/** Stable folder name under ~/.toby/projects. */
	readonly slug: string;
	/** Human-friendly display name. */
	readonly name: string;
	/** Absolute path to the project directory. */
	readonly dir: string;
	/** Absolute path to the project context document directory. */
	readonly contextDir: string;
	/** Absolute path to the project outputs directory (for generated artifacts). */
	readonly outputsDir: string;
	/** Global skill names pinned to this project. */
	readonly skills: readonly string[];
	/** Integration module names used as context sources. */
	readonly integrations: readonly string[];
}

export interface ProjectContextDoc {
	/** Path relative to the project context directory (POSIX separators). */
	readonly relativePath: string;
	readonly content: string;
}

const PROJECT_METADATA_FILENAME = "project.json";
const CONTEXT_DIRNAME = "context";
const OUTPUTS_DIRNAME = "outputs";

/** Extensions treated as readable text context. */
const CONTEXT_TEXT_EXTENSIONS: ReadonlySet<string> = new Set([
	".md",
	".markdown",
	".txt",
	".text",
	".json",
	".yaml",
	".yml",
	".csv",
	".tsv",
	".log",
	".xml",
	".html",
	".rst",
]);

/** Per-file cap when loading context documents (bytes). */
const MAX_CONTEXT_FILE_BYTES = 64 * 1024;
/** Aggregate cap across all loaded context documents (bytes). */
const MAX_CONTEXT_TOTAL_BYTES = 256 * 1024;
/** Maximum directory recursion depth when scanning context. */
const MAX_CONTEXT_DEPTH = 6;

interface ProjectMetadataFile {
	readonly name?: string;
	readonly slug?: string;
	readonly skills?: readonly string[];
	readonly integrations?: readonly string[];
}

/** Convert an arbitrary string into a safe kebab-case folder segment. */
export function slugifyProjectName(input: string): string {
	return input
		.trim()
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, "-")
		.replace(/^-+|-+$/g, "")
		.slice(0, 64);
}

/** Generate a display name from a prompt, falling back to a numbered default. */
export function generateProjectNameFromPrompt(
	prompt: string,
	fallbackIndex: number,
): string {
	const words = prompt
		.trim()
		.replace(/\s+/g, " ")
		.split(" ")
		.filter(Boolean)
		.slice(0, 6);
	if (words.length === 0) {
		return `Project ${fallbackIndex}`;
	}
	return words
		.map((w) => w.charAt(0).toUpperCase() + w.slice(1))
		.join(" ")
		.slice(0, 80);
}

function readProjectMetadata(dir: string): ProjectMetadataFile | null {
	const file = path.join(dir, PROJECT_METADATA_FILENAME);
	if (!fs.existsSync(file)) {
		return null;
	}
	try {
		const raw = fs.readFileSync(file, "utf-8");
		return JSON.parse(raw) as ProjectMetadataFile;
	} catch {
		return null;
	}
}

function toProject(slug: string, dir: string): Project {
	const meta = readProjectMetadata(dir);
	const skills = Array.isArray(meta?.skills)
		? meta.skills.filter((s): s is string => typeof s === "string")
		: [];
	const integrations = Array.isArray(meta?.integrations)
		? meta.integrations.filter((s): s is string => typeof s === "string")
		: [];
	return {
		slug,
		name: meta?.name?.trim() || slug,
		dir,
		contextDir: path.join(dir, CONTEXT_DIRNAME),
		outputsDir: path.join(dir, OUTPUTS_DIRNAME),
		skills,
		integrations,
	};
}

export function listProjects(): Project[] {
	const root = getProjectsDir();
	if (!fs.existsSync(root)) {
		return [];
	}
	let entries: fs.Dirent[];
	try {
		entries = fs.readdirSync(root, { withFileTypes: true });
	} catch {
		return [];
	}
	const projects: Project[] = [];
	for (const ent of entries) {
		if (!ent.isDirectory() || ent.name.startsWith(".")) {
			continue;
		}
		projects.push(toProject(ent.name, path.join(root, ent.name)));
	}
	projects.sort((a, b) => a.name.localeCompare(b.name));
	return projects;
}

export function resolveProject(slug: string): Project | null {
	const trimmed = slug.trim();
	if (!trimmed) {
		return null;
	}
	const dir = path.join(getProjectsDir(), trimmed);
	if (!fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) {
		return null;
	}
	return toProject(trimmed, dir);
}

export function resolveActiveProject(): Project | null {
	const slug = getActiveProjectSlug();
	if (!slug) {
		return null;
	}
	return resolveProject(slug);
}

function writeProjectMetadata(dir: string, meta: ProjectMetadataFile): void {
	fs.mkdirSync(dir, { recursive: true });
	fs.writeFileSync(
		path.join(dir, PROJECT_METADATA_FILENAME),
		`${JSON.stringify(meta, null, 2)}\n`,
		"utf-8",
	);
}

function allocateUniqueSlug(root: string, base: string): string {
	let candidate = base;
	let i = 2;
	while (fs.existsSync(path.join(root, candidate))) {
		candidate = `${base}-${i}`;
		i += 1;
	}
	return candidate;
}

export interface CreateProjectParams {
	readonly name?: string;
	readonly prompt?: string;
	readonly skills?: readonly string[];
	readonly integrations?: readonly string[];
}

export function createProject(params: CreateProjectParams = {}): Project {
	const root = getProjectsDir();
	fs.mkdirSync(root, { recursive: true });

	const existingCount = listProjects().length;
	const name =
		params.name?.trim() ||
		generateProjectNameFromPrompt(params.prompt ?? "", existingCount + 1);
	const baseSlug = slugifyProjectName(name) || `project-${existingCount + 1}`;
	const slug = allocateUniqueSlug(root, baseSlug);
	const dir = path.join(root, slug);

	writeProjectMetadata(dir, {
		name,
		slug,
		skills: params.skills ? [...params.skills] : [],
		integrations: params.integrations ? [...params.integrations] : [],
	});
	fs.mkdirSync(path.join(dir, CONTEXT_DIRNAME), { recursive: true });
	fs.mkdirSync(path.join(dir, OUTPUTS_DIRNAME), { recursive: true });

	return toProject(slug, dir);
}

export interface ProjectMetadataUpdate {
	readonly name?: string;
	readonly skills?: readonly string[];
	readonly integrations?: readonly string[];
}

export function updateProjectMetadata(
	slug: string,
	updates: ProjectMetadataUpdate,
): Project {
	const project = resolveProject(slug);
	if (!project) {
		throw new Error(`Project not found: ${slug}`);
	}
	writeProjectMetadata(project.dir, {
		name: updates.name?.trim() || project.name,
		slug: project.slug,
		skills: updates.skills ? [...updates.skills] : [...project.skills],
		integrations: updates.integrations
			? [...updates.integrations]
			: [...project.integrations],
	});
	return toProject(slug, project.dir);
}

export function deleteProject(slug: string): void {
	const project = resolveProject(slug);
	if (!project) {
		return;
	}
	fs.rmSync(project.dir, { recursive: true, force: true });
	if (getActiveProjectSlug() === slug) {
		clearActiveProjectSlug();
	}
}

export { getActiveProjectSlug, setActiveProjectSlug, clearActiveProjectSlug };

function collectContextFiles(
	root: string,
	dir: string,
	depth: number,
	out: string[],
): void {
	if (depth > MAX_CONTEXT_DEPTH) {
		return;
	}
	let entries: fs.Dirent[];
	try {
		entries = fs.readdirSync(dir, { withFileTypes: true });
	} catch {
		return;
	}
	for (const ent of entries) {
		if (ent.name.startsWith(".")) {
			continue;
		}
		const full = path.join(dir, ent.name);
		// Skip symlinks to avoid escaping the project directory.
		if (ent.isSymbolicLink()) {
			continue;
		}
		if (ent.isDirectory()) {
			collectContextFiles(root, full, depth + 1, out);
			continue;
		}
		if (!ent.isFile()) {
			continue;
		}
		const ext = path.extname(ent.name).toLowerCase();
		if (!CONTEXT_TEXT_EXTENSIONS.has(ext)) {
			continue;
		}
		out.push(full);
	}
}

/** Load text context documents for a project, applying size and type caps. */
export function loadProjectContextDocuments(
	project: Project,
): ProjectContextDoc[] {
	if (!fs.existsSync(project.contextDir)) {
		return [];
	}
	const files: string[] = [];
	collectContextFiles(project.contextDir, project.contextDir, 0, files);
	files.sort((a, b) => a.localeCompare(b));

	const docs: ProjectContextDoc[] = [];
	let total = 0;
	for (const file of files) {
		if (total >= MAX_CONTEXT_TOTAL_BYTES) {
			break;
		}
		let stat: fs.Stats;
		try {
			stat = fs.statSync(file);
		} catch {
			continue;
		}
		if (stat.size > MAX_CONTEXT_FILE_BYTES) {
			continue;
		}
		let content: string;
		try {
			content = fs.readFileSync(file, "utf-8");
		} catch {
			continue;
		}
		if (content.includes("\u0000")) {
			// Treat NUL-containing files as binary; skip.
			continue;
		}
		const remaining = MAX_CONTEXT_TOTAL_BYTES - total;
		const trimmed =
			content.length > remaining ? content.slice(0, remaining) : content;
		total += trimmed.length;
		docs.push({
			relativePath: path
				.relative(project.contextDir, file)
				.split(path.sep)
				.join("/"),
			content: trimmed,
		});
	}
	return docs;
}

/** List file paths (relative, POSIX separators) in a project directory. */
function listFilesInDir(dir: string): string[] {
	if (!fs.existsSync(dir)) {
		return [];
	}
	const files: string[] = [];
	function walk(d: string, depth: number) {
		if (depth > MAX_CONTEXT_DEPTH) return;
		let entries: fs.Dirent[];
		try {
			entries = fs.readdirSync(d, { withFileTypes: true });
		} catch {
			return;
		}
		for (const ent of entries) {
			if (ent.name.startsWith(".")) continue;
			const full = path.join(d, ent.name);
			if (ent.isSymbolicLink()) continue;
			if (ent.isDirectory()) {
				walk(full, depth + 1);
				continue;
			}
			if (!ent.isFile()) continue;
			files.push(path.relative(dir, full).split(path.sep).join("/"));
		}
	}
	walk(dir, 0);
	files.sort((a, b) => a.localeCompare(b));
	return files;
}

/** List file paths in the project context directory. */
export function listProjectContextFiles(project: Project): string[] {
	return listFilesInDir(project.contextDir);
}

/** List file paths in the project outputs directory. */
export function listProjectOutputFiles(project: Project): string[] {
	return listFilesInDir(project.outputsDir);
}

/** Marker bounding the project context appendix in the first system message. */
export const PROJECT_CONTEXT_APPENDIX_START =
	"\n\n---\n\n## Project context documents\n\n";

/** Render loaded project context documents into a prompt appendix string. */
export function formatProjectContextForPrompt(
	project: Project,
	docs: readonly ProjectContextDoc[],
): string {
	if (docs.length === 0) {
		return "";
	}
	const blocks = docs
		.map((d) => `### ${d.relativePath}\n\n${d.content.trim()}`)
		.join("\n\n---\n\n");
	return `${PROJECT_CONTEXT_APPENDIX_START}Active project: **${project.name}**. The following local documents are provided as reference context. Generated artifacts should be written to the project's outputs folder using \`writeTextFile\` (default location) — use \`location='context'\` only for reference documents the AI should read.\n\n${blocks}`;
}
