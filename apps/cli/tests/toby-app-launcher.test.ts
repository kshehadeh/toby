import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "bun:test";
import {
	buildTobyAppIfNeeded,
	resolveBundledTobyAppSource,
} from "../src/ui/chat/toby-app-launcher";

describe("toby-app-launcher", () => {
	const tempDirs: string[] = [];

	afterEach(() => {
		for (const dir of tempDirs.splice(0)) {
			fs.rmSync(dir, { recursive: true, force: true });
		}
	});

	it("finds Toby.app next to the running toby binary", () => {
		const installDir = fs.mkdtempSync(path.join(os.tmpdir(), "toby-install-"));
		tempDirs.push(installDir);
		const appPath = path.join(installDir, "Toby.app");
		fs.mkdirSync(path.join(appPath, "Contents", "MacOS"), { recursive: true });
		fs.writeFileSync(path.join(appPath, "Contents", "MacOS", "toby-app"), "");

		const previousExecPath = process.execPath;
		Object.defineProperty(process, "execPath", {
			value: path.join(installDir, "toby"),
			configurable: true,
		});
		try {
			expect(resolveBundledTobyAppSource()).toBe(appPath);
			expect(buildTobyAppIfNeeded().ok).toBe(true);
		} finally {
			Object.defineProperty(process, "execPath", {
				value: previousExecPath,
				configurable: true,
			});
		}
	});
});
