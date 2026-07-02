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

export function createSkill(skillsRoot?: string): { dirName: string } {
	const skillsDir = skillsRoot ?? getSkillsDir();
	fs.mkdirSync(skillsDir, { recursive: true });

	let index = 1;
	let dirName = "new-skill";
	while (fs.existsSync(path.join(skillsDir, dirName))) {
		dirName = `new-skill-${index}`;
		index += 1;
	}

	const skillDir = path.join(skillsDir, dirName);
	fs.mkdirSync(skillDir, { recursive: true });
	const skillPath = path.join(skillDir, "SKILL.md");
	const content =
		"---\nname: New Skill\ndescription: Describe what this skill does.\n---\n\n";
	fs.writeFileSync(skillPath, content, "utf-8");

	return { dirName };
}

export interface SkillFrontmatterUpdates {
	readonly name?: string;
	readonly description?: string;
	readonly summary?: string;
	readonly enabled?: boolean;
	readonly icon?: string | null;
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
		const value = updates.summary.trim();
		frontmatter.summary = value ? value : undefined;
	}
	if (updates.enabled !== undefined) {
		frontmatter.enabled = updates.enabled ? "true" : "false";
	}
	if (updates.icon !== undefined) {
		const value = updates.icon?.trim();
		frontmatter.icon = value ? value : undefined;
	}

	if (!frontmatter.name) {
		throw new Error("Skill name cannot be empty.");
	}
	if (!frontmatter.description) {
		throw new Error("Skill description cannot be empty.");
	}

	const lines: string[] = [];
	const reserved = new Set([
		"name",
		"description",
		"summary",
		"enabled",
		"icon",
	]);
	for (const key of [
		"name",
		"description",
		"summary",
		"enabled",
		"icon",
	] as const) {
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

export function updateSkillBody(
	dirName: string,
	bodyMarkdown: string,
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

	const raw = fs.readFileSync(skillPath, "utf-8").replace(/^\uFEFF/, "");
	const match = /^(---\r?\n[\s\S]*?\r?\n---\r?\n)/.exec(raw);
	const frontmatterBlock = match?.[1] ?? "";
	const normalizedBody = bodyMarkdown.replace(/^\uFEFF/, "");
	const next = frontmatterBlock
		? `${frontmatterBlock}${normalizedBody}`
		: `---\nname: ${dirName}\ndescription: ${dirName}\n---\n${normalizedBody}`;
	fs.writeFileSync(skillPath, next, "utf-8");
}

const SKILL_ICON_STEM = "icon";
const SKILL_ICON_EXTENSIONS = [".png", ".jpg", ".jpeg", ".gif", ".webp"];

/** Resolve the absolute path to an existing custom skill icon, if any. */
export function resolveSkillIconPath(
	dirName: string,
	skillsRoot?: string,
): string | null {
	const skillDir = path.join(skillsRoot ?? getSkillsDir(), dirName);
	for (const ext of SKILL_ICON_EXTENSIONS) {
		const candidate = path.join(skillDir, `${SKILL_ICON_STEM}${ext}`);
		if (fs.existsSync(candidate)) {
			return candidate;
		}
	}
	return null;
}

/** Store a custom skill icon inside the skill directory and record it in frontmatter. */
export function updateSkillIcon(
	dirName: string,
	buffer: Buffer,
	extension: string,
	skillsRoot?: string,
): { iconFilename: string } {
	const root = skillsRoot ?? getSkillsDir();
	const skillDir = path.join(root, dirName);
	if (!fs.existsSync(skillDir)) {
		throw new Error(`Skill directory not found: ${skillDir}`);
	}
	const normalizedExt = extension.startsWith(".")
		? extension.toLowerCase()
		: `.${extension.toLowerCase()}`;
	const ext = SKILL_ICON_EXTENSIONS.includes(normalizedExt)
		? normalizedExt
		: ".png";

	// Remove any prior icon files so only one custom icon exists.
	for (const existing of SKILL_ICON_EXTENSIONS) {
		const prior = path.join(skillDir, `${SKILL_ICON_STEM}${existing}`);
		if (fs.existsSync(prior)) {
			fs.rmSync(prior, { force: true });
		}
	}

	const iconFilename = `${SKILL_ICON_STEM}${ext}`;
	fs.writeFileSync(path.join(skillDir, iconFilename), buffer);
	updateSkillFrontmatter(dirName, { icon: iconFilename }, root);
	return { iconFilename };
}

/** Remove a custom skill icon and clear the frontmatter reference. */
export function resetSkillIcon(dirName: string, skillsRoot?: string): void {
	const root = skillsRoot ?? getSkillsDir();
	const skillDir = path.join(root, dirName);
	for (const ext of SKILL_ICON_EXTENSIONS) {
		const prior = path.join(skillDir, `${SKILL_ICON_STEM}${ext}`);
		if (fs.existsSync(prior)) {
			fs.rmSync(prior, { force: true });
		}
	}
	if (fs.existsSync(path.join(skillDir, "SKILL.md"))) {
		updateSkillFrontmatter(dirName, { icon: null }, root);
	}
}
