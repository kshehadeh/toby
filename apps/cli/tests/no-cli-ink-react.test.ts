import { describe, expect, it } from "bun:test";
import fs from "node:fs";
import path from "node:path";

const cliSrc = path.resolve(import.meta.dirname, "../src");
const forbiddenImports = [
	'from "ink"',
	"from 'ink'",
	'from "ink-link"',
	"from 'ink-link'",
	'from "react"',
	"from 'react'",
	"react-ink-textarea",
] as const;

function walk(dir: string): string[] {
	const out: string[] = [];
	for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
		const fullPath = path.join(dir, entry.name);
		if (entry.isDirectory()) {
			out.push(...walk(fullPath));
		} else if (/\.[cm]?[jt]sx?$/.test(entry.name)) {
			out.push(fullPath);
		}
	}
	return out;
}

describe("CLI UI dependencies", () => {
	it("does not import Ink or React packages", () => {
		const offenders: string[] = [];
		for (const file of walk(cliSrc)) {
			const text = fs.readFileSync(file, "utf8");
			for (const forbidden of forbiddenImports) {
				if (text.includes(forbidden)) {
					offenders.push(`${path.relative(cliSrc, file)}: ${forbidden}`);
				}
			}
		}
		expect(offenders).toEqual([]);
	});
});
