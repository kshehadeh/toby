import { execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { getSkillsDir } from "../config/index";
import { parseSkillFrontmatterAndBody } from "./index";

export function deleteSkill(dirName: string): void {
	const skillDir = path.join(getSkillsDir(), dirName);
	if (!fs.existsSync(skillDir)) {
		throw new Error(`Skill directory not found: ${skillDir}`);
	}
	fs.rmSync(skillDir, { recursive: true, force: true });
}

export function openSkillInEditor(dirName: string): void {
	const skillPath = path.join(getSkillsDir(), dirName, "SKILL.md");
	if (!fs.existsSync(skillPath)) {
		throw new Error(`Skill file not found: ${skillPath}`);
	}
	execSync(`open -t "${skillPath}"`, { stdio: "ignore" });
}

export interface SkillFrontmatterUpdates {
	readonly name?: string;
	readonly description?: string;
	readonly summary?: string;
}

function encodeFrontmatterValue(value: string): string {
	const normalized = value.replaceAll(/\r\n/g, "\n").trim();
	if (!normalized.includes("\n")) {
		return normalized;
	}
	const lines = normalized.split("\n");
	const [first, ...rest] = lines;
	return [first, ...rest.map((line) => `  ${line}`)].join("\n");
}

export function updateSkillFrontmatter(
	dirName: string,
	updates: SkillFrontmatterUpdates,
	skillsRoot?: string,
): void {
	const skillPath = path.join(
		skillsRoot ?? getSkillsDir(),
		dirName,
		"SKILL.md",
	);
	if (!fs.existsSync(skillPath)) {
		throw new Error(`Skill file not found: ${skillPath}`);
	}

	const raw = fs.readFileSync(skillPath, "utf-8");
	const parsed = parseSkillFrontmatterAndBody(raw);
	if (!parsed) {
		throw new Error(`Invalid SKILL.md frontmatter: ${skillPath}`);
	}

	const bodyMatch = /^---\r?\n[\s\S]*?\r?\n---\r?\n([\s\S]*)$/.exec(
		raw.replace(/^\uFEFF/, ""),
	);
	const bodyRaw = bodyMatch?.[1] ?? "";

	const frontmatter: Record<string, string | undefined> = {
		...parsed.frontmatter,
	};
	if (updates.name !== undefined) {
		frontmatter.name = updates.name.trim();
	}
	if (updates.description !== undefined) {
		frontmatter.description = updates.description.trim();
	}
	if (updates.summary !== undefined) {
		const summary = updates.summary.trim();
		if (summary) {
			frontmatter.summary = summary;
		} else {
			frontmatter.summary = undefined;
		}
	}

	if (!frontmatter.name) {
		throw new Error("Skill name cannot be empty.");
	}
	if (!frontmatter.description) {
		throw new Error("Skill description cannot be empty.");
	}

	const lines: string[] = [];
	const reserved = new Set(["name", "description", "summary"]);
	for (const key of ["name", "description", "summary"] as const) {
		const value = frontmatter[key];
		if (value !== undefined) {
			lines.push(`${key}: ${encodeFrontmatterValue(value)}`);
		}
	}
	for (const [key, value] of Object.entries(frontmatter)) {
		if (reserved.has(key) || value === undefined) {
			continue;
		}
		lines.push(`${key}: ${encodeFrontmatterValue(value)}`);
	}

	const next = `---\n${lines.join("\n")}\n---\n${bodyRaw}`;
	fs.writeFileSync(skillPath, next, "utf-8");
}
