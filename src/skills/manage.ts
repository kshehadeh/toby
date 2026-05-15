import { execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { getSkillsDir } from "../config/index";

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
