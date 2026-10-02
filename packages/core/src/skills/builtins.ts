/// <reference path="./text-assets.d.ts" />
import fs from "node:fs";
import path from "node:path";
import flowBuilder from "./builtins/flow-builder/SKILL.md" with {
	type: "text",
};

/** Install editable defaults once; preserve edits, disabled state, and deletion. */
export function ensureBuiltinSkills(skillsRoot: string): void {
	const markerDir = path.join(skillsRoot, ".builtin-seeds");
	const marker = path.join(markerDir, "flow-builder");
	if (fs.existsSync(marker)) return;
	const skillDir = path.join(skillsRoot, "flow-builder");
	fs.mkdirSync(skillDir, { recursive: true });
	try {
		fs.writeFileSync(path.join(skillDir, "SKILL.md"), flowBuilder, {
			encoding: "utf-8",
			flag: "wx",
		});
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
	}
	fs.mkdirSync(markerDir, { recursive: true });
	fs.writeFileSync(marker, "1\n");
}
