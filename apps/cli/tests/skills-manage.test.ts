import { afterEach, describe, expect, it } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
	createSkill,
	resetSkillIcon,
	resolveSkillIconPath,
	updateSkillBody,
	updateSkillFrontmatter,
	updateSkillIcon,
} from "@toby/core/skills/manage";

describe("updateSkillFrontmatter", () => {
	let tmp: string | undefined;

	afterEach(() => {
		if (tmp !== undefined && fs.existsSync(tmp)) {
			fs.rmSync(tmp, { recursive: true, force: true });
		}
		tmp = undefined;
	});

	it("writes an edited summary to description and removes the legacy summary key", () => {
		tmp = fs.mkdtempSync(path.join(os.tmpdir(), "toby-skill-manage-"));
		const skillDir = path.join(tmp, "demo-skill");
		fs.mkdirSync(skillDir, { recursive: true });
		const skillPath = path.join(skillDir, "SKILL.md");
		fs.writeFileSync(
			skillPath,
			`---
name: demo-skill
description: Initial description.
summary: Old summary.
---

## Body

Keep this body.
`,
			"utf-8",
		);

		updateSkillFrontmatter(
			"demo-skill",
			{
				name: "renamed-skill",
				summary: "Updated summary.",
			},
			tmp,
		);

		const next = fs.readFileSync(skillPath, "utf-8");
		expect(next).toContain("name: renamed-skill");
		expect(next).toContain("description: Updated summary.");
		expect(next).not.toContain("summary:");
		expect(next).toContain("## Body");
		expect(next).toContain("Keep this body.");
	});

	it("preserves legacy summary metadata during unrelated edits", () => {
		tmp = fs.mkdtempSync(path.join(os.tmpdir(), "toby-skill-manage-"));
		const skillDir = path.join(tmp, "demo-skill");
		fs.mkdirSync(skillDir, { recursive: true });
		const skillPath = path.join(skillDir, "SKILL.md");
		fs.writeFileSync(
			skillPath,
			`---
name: demo-skill
description: Initial description.
summary: Legacy summary.
---

Body.
`,
			"utf-8",
		);

		updateSkillFrontmatter("demo-skill", { enabled: false }, tmp);

		const next = fs.readFileSync(skillPath, "utf-8");
		expect(next).toContain("description: Initial description.");
		expect(next).toContain("summary: Legacy summary.");
		expect(next).toContain("enabled: false");
	});

	it("rejects an empty summary", () => {
		tmp = fs.mkdtempSync(path.join(os.tmpdir(), "toby-skill-manage-"));
		const skillDir = path.join(tmp, "demo-skill");
		fs.mkdirSync(skillDir, { recursive: true });
		fs.writeFileSync(
			path.join(skillDir, "SKILL.md"),
			`---
name: demo-skill
description: Initial description.
---

Body.
`,
			"utf-8",
		);

		expect(() =>
			updateSkillFrontmatter("demo-skill", { summary: "  " }, tmp),
		).toThrow("Skill summary cannot be empty.");
	});
});

describe("createSkill", () => {
	let tmp: string | undefined;

	afterEach(() => {
		if (tmp !== undefined && fs.existsSync(tmp)) {
			fs.rmSync(tmp, { recursive: true, force: true });
		}
		tmp = undefined;
	});

	it("creates a new skill directory with a default SKILL.md", () => {
		tmp = fs.mkdtempSync(path.join(os.tmpdir(), "toby-skill-create-"));
		const { dirName } = createSkill(tmp);

		expect(fs.existsSync(path.join(tmp, dirName, "SKILL.md"))).toBe(true);
		const content = fs.readFileSync(
			path.join(tmp, dirName, "SKILL.md"),
			"utf-8",
		);
		expect(content).toContain("name: New Skill");
		expect(content).toContain(
			"description: Describe what this skill does and when Toby should use it.",
		);
	});

	it("picks a unique folder name when new-skill already exists", () => {
		tmp = fs.mkdtempSync(path.join(os.tmpdir(), "toby-skill-create-"));
		fs.mkdirSync(path.join(tmp, "new-skill"), { recursive: true });

		const { dirName } = createSkill(tmp);
		expect(dirName).not.toBe("new-skill");
		expect(dirName.startsWith("new-skill")).toBe(true);
	});
});

describe("updateSkillBody", () => {
	let tmp: string | undefined;

	afterEach(() => {
		if (tmp !== undefined && fs.existsSync(tmp)) {
			fs.rmSync(tmp, { recursive: true, force: true });
		}
		tmp = undefined;
	});

	it("updates the body while keeping the frontmatter intact", () => {
		tmp = fs.mkdtempSync(path.join(os.tmpdir(), "toby-skill-body-"));
		const skillDir = path.join(tmp, "demo-skill");
		fs.mkdirSync(skillDir, { recursive: true });
		const skillPath = path.join(skillDir, "SKILL.md");
		fs.writeFileSync(
			skillPath,
			`---
name: demo-skill
description: Initial description.
---

Old body.
`,
			"utf-8",
		);

		updateSkillBody("demo-skill", "New body content.", tmp);
		const next = fs.readFileSync(skillPath, "utf-8");
		expect(next).toContain("name: demo-skill");
		expect(next).toContain("description: Initial description.");
		expect(next).toContain("New body content.");
		expect(next).not.toContain("Old body.");
	});
});

describe("updateSkillFrontmatter metadata", () => {
	let tmp: string | undefined;

	afterEach(() => {
		if (tmp !== undefined && fs.existsSync(tmp)) {
			fs.rmSync(tmp, { recursive: true, force: true });
		}
		tmp = undefined;
	});

	it("writes the summary through description and keeps the body", () => {
		tmp = fs.mkdtempSync(path.join(os.tmpdir(), "toby-skill-meta-"));
		const skillDir = path.join(tmp, "demo-skill");
		fs.mkdirSync(skillDir, { recursive: true });
		const skillPath = path.join(skillDir, "SKILL.md");
		fs.writeFileSync(
			skillPath,
			`---
name: demo-skill
description: Initial description.
---

## Body
`,
			"utf-8",
		);

		updateSkillFrontmatter(
			"demo-skill",
			{ summary: "Shown in the picker.", enabled: false },
			tmp,
		);

		const next = fs.readFileSync(skillPath, "utf-8");
		expect(next).toContain("description: Shown in the picker.");
		expect(next).not.toContain("summary:");
		expect(next).toContain("enabled: false");
		expect(next).toContain("## Body");
	});
});

describe("skill icons", () => {
	let tmp: string | undefined;

	afterEach(() => {
		if (tmp !== undefined && fs.existsSync(tmp)) {
			fs.rmSync(tmp, { recursive: true, force: true });
		}
		tmp = undefined;
	});

	it("stores and clears a custom icon", () => {
		tmp = fs.mkdtempSync(path.join(os.tmpdir(), "toby-skill-icon-"));
		const skillDir = path.join(tmp, "demo-skill");
		fs.mkdirSync(skillDir, { recursive: true });
		fs.writeFileSync(
			path.join(skillDir, "SKILL.md"),
			`---
name: demo-skill
description: Initial description.
---

Body.
`,
			"utf-8",
		);

		expect(resolveSkillIconPath("demo-skill", tmp)).toBeNull();

		updateSkillIcon("demo-skill", Buffer.from([1, 2, 3, 4]), ".png", tmp);
		const iconPath = resolveSkillIconPath("demo-skill", tmp);
		expect(iconPath).not.toBeNull();
		expect(fs.existsSync(iconPath ?? "")).toBe(true);
		expect(fs.readFileSync(path.join(skillDir, "SKILL.md"), "utf-8")).toContain(
			"icon: icon.png",
		);

		resetSkillIcon("demo-skill", tmp);
		expect(resolveSkillIconPath("demo-skill", tmp)).toBeNull();
		expect(
			fs.readFileSync(path.join(skillDir, "SKILL.md"), "utf-8"),
		).not.toContain("icon: icon.png");
	});
});
