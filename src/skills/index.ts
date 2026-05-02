import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { getSkillsDir } from "../config/index";

export interface LocalSkill {
	readonly dirName: string;
	readonly name: string;
	readonly description: string;
	readonly bodyMarkdown: string;
}

const SKILL_FILENAME = "SKILL.md";

function normalizeWs(input: string): string {
	return input.trim().replaceAll(/\s+/g, " ");
}

/**
 * Minimal YAML-ish frontmatter parser for Cursor-style SKILL.md files.
 * Supports `key: value` lines; values may span lines when continuation lines are indented.
 */
export function parseSkillFrontmatterAndBody(raw: string): {
	readonly frontmatter: Record<string, string>;
	readonly body: string;
} | null {
	const text = raw.replace(/^\uFEFF/, "");
	const fence = /^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/;
	const m = fence.exec(text);
	if (!m) {
		return null;
	}
	const fmRaw = m[1] ?? "";
	const body = (m[2] ?? "").trim();

	const frontmatter: Record<string, string> = {};
	const lines = fmRaw.split(/\r?\n/);
	let currentKey: string | null = null;
	let buffer: string[] = [];

	const flush = () => {
		if (!currentKey) {
			return;
		}
		frontmatter[currentKey] = buffer.join("\n").trim();
		currentKey = null;
		buffer = [];
	};

	for (const line of lines) {
		const kv = /^(\w+)\s*:\s*(.*)$/.exec(line);
		if (kv && !line.startsWith(" ") && !line.startsWith("\t")) {
			flush();
			const key = kv[1];
			const rest = kv[2] ?? "";
			if (key) {
				currentKey = key;
				buffer = [rest.trimEnd()];
			}
			continue;
		}
		if (currentKey && (/^\s+/.test(line) || line.trim() === "")) {
			buffer.push(line.replace(/^\s+/, "").trimEnd());
		}
	}
	flush();

	return { frontmatter, body };
}

export function parseSkillFileContent(
	dirName: string,
	raw: string,
): LocalSkill | null {
	const parsed = parseSkillFrontmatterAndBody(raw);
	if (!parsed) {
		return null;
	}
	const name = parsed.frontmatter.name?.trim();
	const description = parsed.frontmatter.description?.trim();
	if (!name || !description) {
		return null;
	}
	return {
		dirName,
		name,
		description,
		bodyMarkdown: parsed.body.trim(),
	};
}

export function loadLocalSkills(skillsRoot?: string): LocalSkill[] {
	const root = skillsRoot ?? getSkillsDir();
	if (!fs.existsSync(root)) {
		return [];
	}
	let entries: fs.Dirent[];
	try {
		entries = fs.readdirSync(root, { withFileTypes: true });
	} catch {
		return [];
	}

	const skills: LocalSkill[] = [];
	for (const ent of entries) {
		if (!ent.isDirectory()) {
			continue;
		}
		const dirName = ent.name;
		if (dirName.startsWith(".")) {
			continue;
		}
		const skillPath = path.join(root, dirName, SKILL_FILENAME);
		if (!fs.existsSync(skillPath)) {
			continue;
		}
		let raw: string;
		try {
			raw = fs.readFileSync(skillPath, "utf-8");
		} catch {
			continue;
		}
		const skill = parseSkillFileContent(dirName, raw);
		if (skill) {
			skills.push(skill);
		}
	}

	skills.sort((a, b) => a.name.localeCompare(b.name));
	return skills;
}

/** Compact catalog for the pretreatment model (name + description only). */
export function formatSkillsCatalogForPrompt(
	skills: readonly LocalSkill[],
): string {
	if (skills.length === 0) {
		return "(none)";
	}
	return skills
		.map((s) => `- ${s.name}: ${normalizeWs(s.description)}`)
		.join("\n");
}

function stableCatalogPayload(skills: readonly LocalSkill[]): string {
	const rows = skills.map((s) => ({
		name: s.name,
		description: normalizeWs(s.description),
	}));
	return JSON.stringify(rows);
}

/**
 * Stable digest for pretreatment cache invalidation when ~/.toby/skills changes.
 */
export function computeSkillCatalogSignature(
	skills: readonly LocalSkill[],
): string {
	const payload = stableCatalogPayload(skills);
	return crypto.createHash("sha256").update(payload).digest("hex").slice(0, 16);
}

export function resolveSkillsByNames(
	skills: readonly LocalSkill[],
	names: readonly string[],
): LocalSkill[] {
	if (names.length === 0) {
		return [];
	}
	const lower = new Map(skills.map((s) => [s.name.toLowerCase(), s] as const));
	const out: LocalSkill[] = [];
	const seen = new Set<string>();
	for (const n of names) {
		const key = n.trim().toLowerCase();
		if (!key || seen.has(key)) {
			continue;
		}
		const hit = lower.get(key);
		if (hit) {
			seen.add(key);
			out.push(hit);
		}
	}
	return out;
}

const SKILL_MATCH_STOPWORDS = new Set([
	"the",
	"a",
	"an",
	"and",
	"or",
	"but",
	"in",
	"on",
	"at",
	"to",
	"for",
	"of",
	"as",
	"is",
	"are",
	"was",
	"were",
	"be",
	"been",
	"being",
	"have",
	"has",
	"had",
	"do",
	"does",
	"did",
	"will",
	"would",
	"could",
	"should",
	"may",
	"might",
	"must",
	"shall",
	"can",
	"need",
	"please",
	"you",
	"your",
	"yours",
	"me",
	"my",
	"we",
	"our",
	"ours",
	"they",
	"their",
	"what",
	"which",
	"who",
	"whom",
	"this",
	"that",
	"these",
	"those",
	"from",
	"with",
	"without",
	"how",
	"when",
	"where",
	"why",
	"just",
	"any",
	"some",
	"all",
	"each",
	"every",
	"both",
	"few",
	"more",
	"most",
	"other",
	"such",
	"only",
	"own",
	"same",
	"so",
	"than",
	"too",
	"very",
	"about",
	"into",
	"through",
	"during",
	"before",
	"after",
	"above",
	"below",
	"up",
	"down",
	"out",
	"off",
	"over",
	"under",
	"again",
	"then",
	"once",
	"here",
	"there",
	"tell",
	"want",
	"know",
	"like",
	"get",
	"use",
	"make",
	"let",
	"ask",
	"say",
	"see",
	"come",
	"go",
	"give",
	"take",
	"think",
	"look",
	"seem",
	"try",
	"leave",
	"call",
	"keep",
	"bring",
	"work",
	"play",
	"run",
	"move",
	"put",
	"turn",
]);

function tokenizeForSkillMatch(text: string): Set<string> {
	const raw = text
		.toLowerCase()
		.split(/[^a-z0-9]+/)
		.filter(Boolean);
	const out = new Set<string>();
	for (const t of raw) {
		if (t.length < 3 || SKILL_MATCH_STOPWORDS.has(t)) {
			continue;
		}
		out.add(t);
		if (t.length > 4 && t.endsWith("s")) {
			out.add(t.slice(0, -1));
		}
		if (t.length > 3 && !t.endsWith("s")) {
			out.add(`${t}s`);
		}
	}
	return out;
}

function skillMatchTokenSet(skill: LocalSkill): Set<string> {
	const out = tokenizeForSkillMatch(skill.description);
	for (const part of skill.name.toLowerCase().split("-")) {
		if (part.length >= 3 && !SKILL_MATCH_STOPWORDS.has(part)) {
			out.add(part);
			if (part.length > 4 && part.endsWith("s")) {
				out.add(part.slice(0, -1));
			}
		}
	}
	return out;
}

function overlapCount(a: Set<string>, b: Set<string>): number {
	let n = 0;
	for (const t of a) {
		if (b.has(t)) {
			n += 1;
		}
	}
	return n;
}

/**
 * When preflight does not return skills (or returns no spec), pick likely skills by
 * token overlap between the user message and each skill's name + description.
 * Conservative: at least two overlapping tokens, or a single-token match only when unambiguous.
 */
export function inferRelevantSkillsFromUserPrompt(
	userText: string,
	skills: readonly LocalSkill[],
): string[] {
	if (skills.length === 0 || !userText.trim()) {
		return [];
	}
	const userTok = tokenizeForSkillMatch(userText);
	if (userTok.size === 0) {
		return [];
	}

	const scored = skills.map((s) => ({
		name: s.name,
		score: overlapCount(userTok, skillMatchTokenSet(s)),
	}));
	scored.sort((a, b) => b.score - a.score);
	const top = scored[0];
	if (!top || top.score < 1) {
		return [];
	}
	const second = scored[1];
	if (top.score >= 2) {
		return scored
			.filter((s) => s.score >= 2)
			.slice(0, 2)
			.map((s) => s.name);
	}
	if (top.score === 1 && (!second || second.score < 1)) {
		return [top.name];
	}
	return [];
}
