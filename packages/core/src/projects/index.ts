import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import {
	clearActiveProjectSlug,
	getActiveProjectSlug,
	getProjectsDir,
	setActiveProjectSlug,
} from "../config/index";
import { getDb } from "../session-store";
import { type LocalSkill, loadLocalSkills } from "../skills/index";

export interface Project {
	/** Stable SQLite id. */
	readonly id: string;
	/** Stable folder-friendly identifier. */
	readonly slug: string;
	/** Human-friendly display name. */
	readonly name: string;
	/** Short project description used in project chat system context. */
	readonly summary: string;
	/** Optional project-default persona name. */
	readonly personaName: string | null;
	/** Absolute path to the project canvas directory. */
	readonly folderPath: string;
	/** Absolute path to the project canvas directory. Kept for old callers. */
	readonly dir: string;
	/** Legacy context directory path. New project prompt context does not scan it automatically. */
	readonly contextDir: string;
	/** Absolute path to generated project artifacts. */
	readonly outputsDir: string;
	/** Canonical project-local skills directory. */
	readonly skillsDir: string;
	/** Legacy project-local skills directory. */
	readonly legacySkillsDir: string;
	/** Legacy pinned global skill names. */
	readonly skills: readonly string[];
	/** Legacy context integration names. */
	readonly integrations: readonly string[];
	readonly createdAt: string;
	readonly updatedAt: string;
}

export interface ProjectContextDoc {
	readonly relativePath: string;
	readonly content: string;
}

export interface ProjectTreeEntry {
	readonly name: string;
	readonly relativePath: string;
	readonly kind: "file" | "directory";
	readonly children?: readonly ProjectTreeEntry[];
}

const LEGACY_PROJECT_METADATA_FILENAME = "project.json";
const LEGACY_CONTEXT_DIRNAME = "context";
const OUTPUTS_DIRNAME = "outputs";
const AGENT_DIRNAME = ".agent";
const SKILLS_DIRNAME = "skills";
const AGENTS_FILENAME = "AGENTS.md";
const MAX_GUIDANCE_FILE_BYTES = 96 * 1024;
const MAX_TREE_DEPTH = 8;
const MAX_TREE_ENTRIES = 500;

interface ProjectRow {
	readonly id: string;
	readonly slug: string;
	readonly name: string;
	readonly summary: string | null;
	readonly folderPath: string;
	readonly personaName: string | null;
	readonly createdAt: string;
	readonly updatedAt: string;
}

interface LegacyProjectMetadataFile {
	readonly name?: string;
	readonly slug?: string;
	readonly skills?: readonly string[];
	readonly integrations?: readonly string[];
}

let legacyMigrationAttempted = false;

function nowIso(): string {
	return new Date().toISOString();
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

function canonicalSkillsDir(folderPath: string): string {
	return path.join(folderPath, AGENT_DIRNAME, SKILLS_DIRNAME);
}

function legacySkillsDir(folderPath: string): string {
	return path.join(folderPath, SKILLS_DIRNAME);
}

function toProject(row: ProjectRow): Project {
	const folderPath = path.resolve(row.folderPath);
	return {
		id: row.id,
		slug: row.slug,
		name: row.name,
		summary: row.summary ?? "",
		personaName: row.personaName ?? null,
		folderPath,
		dir: folderPath,
		contextDir: path.join(folderPath, LEGACY_CONTEXT_DIRNAME),
		outputsDir: path.join(folderPath, OUTPUTS_DIRNAME),
		skillsDir: canonicalSkillsDir(folderPath),
		legacySkillsDir: legacySkillsDir(folderPath),
		skills: [],
		integrations: [],
		createdAt: row.createdAt,
		updatedAt: row.updatedAt,
	};
}

function projectSelectSql(): string {
	return `SELECT id, slug, name, summary, folder_path as folderPath,
            persona_name as personaName, created_at as createdAt, updated_at as updatedAt
          FROM projects`;
}

function dbProjectCount(): number {
	const db = getDb();
	const row = db.query("SELECT COUNT(*) as count FROM projects").get() as
		| { count: number }
		| undefined;
	return Number(row?.count ?? 0);
}

function readLegacyMetadata(dir: string): LegacyProjectMetadataFile | null {
	const file = path.join(dir, LEGACY_PROJECT_METADATA_FILENAME);
	if (!fs.existsSync(file)) return null;
	try {
		return JSON.parse(
			fs.readFileSync(file, "utf-8"),
		) as LegacyProjectMetadataFile;
	} catch {
		return null;
	}
}

function allocateUniqueSlug(base: string): string {
	const db = getDb();
	const fallback = base || "project";
	let candidate = fallback;
	let i = 2;
	while (
		db
			.query("SELECT id FROM projects WHERE slug = $slug")
			.get({ $slug: candidate })
	) {
		candidate = `${fallback}-${i}`;
		i += 1;
	}
	return candidate;
}

function ensureProjectFolders(folderPath: string): void {
	fs.mkdirSync(folderPath, { recursive: true });
	fs.mkdirSync(path.join(folderPath, OUTPUTS_DIRNAME), { recursive: true });
	fs.mkdirSync(canonicalSkillsDir(folderPath), { recursive: true });
	const agentsPath = path.join(folderPath, AGENTS_FILENAME);
	if (!fs.existsSync(agentsPath)) {
		fs.writeFileSync(
			agentsPath,
			"# Project Instructions\n\nAdd guidance for Toby project chats here.\n",
			"utf-8",
		);
	}
}

function migrateLegacyProjectsOnce(): void {
	if (legacyMigrationAttempted) return;
	legacyMigrationAttempted = true;

	const root = getProjectsDir();
	if (!fs.existsSync(root)) return;
	let entries: fs.Dirent[];
	try {
		entries = fs.readdirSync(root, { withFileTypes: true });
	} catch {
		return;
	}

	for (const ent of entries) {
		if (!ent.isDirectory() || ent.name.startsWith(".")) continue;
		const dir = path.join(root, ent.name);
		const meta = readLegacyMetadata(dir);
		if (!meta) continue;
		const slug = slugifyProjectName(meta.slug ?? ent.name) || ent.name;
		const existing = resolveProject(slug);
		if (existing) continue;
		const name = meta.name?.trim() || slug;
		createProject({
			name,
			folderPath: dir,
			slug,
			initializeFolders: true,
		});
	}
}

export interface CreateProjectParams {
	readonly name?: string;
	readonly prompt?: string;
	readonly summary?: string;
	readonly folderPath?: string;
	readonly personaName?: string | null;
	readonly slug?: string;
	readonly skills?: readonly string[];
	readonly integrations?: readonly string[];
	readonly initializeFolders?: boolean;
}

export function createProject(params: CreateProjectParams = {}): Project {
	const existingCount = dbProjectCount();
	const id = randomUUID();
	const name =
		params.name?.trim() ||
		generateProjectNameFromPrompt(params.prompt ?? "", existingCount + 1);
	const baseSlug =
		slugifyProjectName(params.slug ?? name) || `project-${existingCount + 1}`;
	const slug = allocateUniqueSlug(baseSlug);
	const folderPath = path.resolve(
		params.folderPath?.trim() || path.join(getProjectsDir(), id),
	);
	ensureProjectFolders(folderPath);

	const db = getDb();
	const ts = nowIso();
	db.query(
		`INSERT INTO projects (
       id, slug, name, summary, folder_path, persona_name, created_at, updated_at
     ) VALUES (
       $id, $slug, $name, $summary, $folder_path, $persona_name, $created_at, $updated_at
     )`,
	).run({
		$id: id,
		$slug: slug,
		$name: name,
		$summary: params.summary?.trim() ?? "",
		$folder_path: folderPath,
		$persona_name: params.personaName?.trim() || null,
		$created_at: ts,
		$updated_at: ts,
	});
	return resolveProject(id) as Project;
}

export function listProjects(): Project[] {
	migrateLegacyProjectsOnce();
	const db = getDb();
	const rows = db
		.query(`${projectSelectSql()} ORDER BY name COLLATE NOCASE ASC`)
		.all() as ProjectRow[];
	return rows.map(toProject);
}

export function resolveProject(idOrSlug: string): Project | null {
	migrateLegacyProjectsOnce();
	const key = idOrSlug.trim();
	if (!key) return null;
	const db = getDb();
	const row = db
		.query(`${projectSelectSql()} WHERE id = $key OR slug = $key LIMIT 1`)
		.get({ $key: key }) as ProjectRow | undefined;
	return row ? toProject(row) : null;
}

export function resolveActiveProject(): Project | null {
	const slug = getActiveProjectSlug();
	if (!slug) return null;
	return resolveProject(slug);
}

export interface ProjectMetadataUpdate {
	readonly name?: string;
	readonly summary?: string;
	readonly folderPath?: string;
	readonly personaName?: string | null;
	readonly skills?: readonly string[];
	readonly integrations?: readonly string[];
}

export function updateProjectMetadata(
	idOrSlug: string,
	updates: ProjectMetadataUpdate,
): Project {
	const project = resolveProject(idOrSlug);
	if (!project) {
		throw new Error(`Project not found: ${idOrSlug}`);
	}
	const nextFolder = updates.folderPath?.trim()
		? path.resolve(updates.folderPath.trim())
		: project.folderPath;
	if (updates.folderPath?.trim()) {
		ensureProjectFolders(nextFolder);
	}
	const db = getDb();
	db.query(
		`UPDATE projects
     SET name = $name, summary = $summary, folder_path = $folder_path,
         persona_name = $persona_name, updated_at = $updated_at
     WHERE id = $id`,
	).run({
		$id: project.id,
		$name: updates.name?.trim() || project.name,
		$summary: updates.summary !== undefined ? updates.summary : project.summary,
		$folder_path: nextFolder,
		$persona_name:
			updates.personaName !== undefined
				? updates.personaName?.trim() || null
				: project.personaName,
		$updated_at: nowIso(),
	});
	return resolveProject(project.id) as Project;
}

export function deleteProject(idOrSlug: string): void {
	const project = resolveProject(idOrSlug);
	if (!project) return;
	const db = getDb();
	db.query(
		"UPDATE chat_sessions SET project_id = NULL WHERE project_id = $id",
	).run({ $id: project.id });
	db.query("UPDATE schedules SET project_id = NULL WHERE project_id = $id").run(
		{
			$id: project.id,
		},
	);
	db.query("DELETE FROM projects WHERE id = $id").run({ $id: project.id });
	if (getActiveProjectSlug() === project.slug) {
		clearActiveProjectSlug();
	}
}

export function loadProjectSkills(project: Project): LocalSkill[] {
	const canonical = loadLocalSkills(project.skillsDir);
	const legacy =
		project.legacySkillsDir !== project.skillsDir
			? loadLocalSkills(project.legacySkillsDir)
			: [];
	const seen = new Set<string>();
	const out: LocalSkill[] = [];
	for (const skill of [...canonical, ...legacy]) {
		const key = skill.name.trim().toLowerCase();
		if (seen.has(key)) continue;
		seen.add(key);
		out.push(skill);
	}
	return out;
}

export function loadProjectContextDocuments(
	project: Project,
): ProjectContextDoc[] {
	const agentsPath = path.join(project.folderPath, AGENTS_FILENAME);
	if (!fs.existsSync(agentsPath)) return [];
	let stat: fs.Stats;
	try {
		stat = fs.statSync(agentsPath);
	} catch {
		return [];
	}
	if (!stat.isFile() || stat.size > MAX_GUIDANCE_FILE_BYTES) return [];
	try {
		const content = fs.readFileSync(agentsPath, "utf-8");
		if (content.includes("\u0000")) return [];
		return [{ relativePath: AGENTS_FILENAME, content }];
	} catch {
		return [];
	}
}

function listFilesInDir(dir: string): string[] {
	if (!fs.existsSync(dir)) return [];
	const files: string[] = [];
	function walk(d: string, depth: number): void {
		if (depth > MAX_TREE_DEPTH) return;
		let entries: fs.Dirent[];
		try {
			entries = fs.readdirSync(d, { withFileTypes: true });
		} catch {
			return;
		}
		for (const ent of entries) {
			if (ent.name.startsWith(".") && ent.name !== AGENT_DIRNAME) continue;
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

export function listProjectContextFiles(project: Project): string[] {
	return listFilesInDir(project.folderPath);
}

export function listProjectOutputFiles(project: Project): string[] {
	return listFilesInDir(project.outputsDir);
}

export function listProjectTree(project: Project): ProjectTreeEntry[] {
	let count = 0;
	function walk(dir: string, depth: number): ProjectTreeEntry[] {
		if (depth > MAX_TREE_DEPTH || count >= MAX_TREE_ENTRIES) return [];
		let entries: fs.Dirent[];
		try {
			entries = fs.readdirSync(dir, { withFileTypes: true });
		} catch {
			return [];
		}
		return entries
			.filter((ent) => !ent.name.startsWith(".") || ent.name === AGENT_DIRNAME)
			.filter((ent) => !ent.isSymbolicLink())
			.sort((a, b) => {
				if (a.isDirectory() !== b.isDirectory())
					return a.isDirectory() ? -1 : 1;
				return a.name.localeCompare(b.name);
			})
			.flatMap((ent): ProjectTreeEntry[] => {
				if (count >= MAX_TREE_ENTRIES) return [];
				const full = path.join(dir, ent.name);
				const relativePath = path
					.relative(project.folderPath, full)
					.split(path.sep)
					.join("/");
				count += 1;
				if (ent.isDirectory()) {
					return [
						{
							name: ent.name,
							relativePath,
							kind: "directory",
							children: walk(full, depth + 1),
						},
					];
				}
				if (!ent.isFile()) return [];
				return [{ name: ent.name, relativePath, kind: "file" }];
			});
	}
	return walk(project.folderPath, 0);
}

export const PROJECT_CONTEXT_APPENDIX_START =
	"\n\n---\n\n## Project guidance\n\n";

export function formatProjectContextForPrompt(
	project: Project,
	docs: readonly ProjectContextDoc[],
): string {
	const parts = [
		`Active project: **${project.name}**.`,
		`Project folder: \`${project.folderPath}\`.`,
		project.summary.trim() ? `Project summary: ${project.summary.trim()}` : "",
		"Generated artifacts should be written to the project's outputs folder using `writeTextFile`.",
	]
		.filter(Boolean)
		.join("\n");
	const blocks = docs
		.map((d) => `### ${d.relativePath}\n\n${d.content.trim()}`)
		.filter(Boolean)
		.join("\n\n---\n\n");
	return `${PROJECT_CONTEXT_APPENDIX_START}${parts}${blocks ? `\n\n${blocks}` : ""}`;
}

export { getActiveProjectSlug, setActiveProjectSlug, clearActiveProjectSlug };
