/**
 * Test preload: never let a test touch the real `~/.toby`.
 *
 * `scripts/test.sh` already sets `TOBY_DIR`, but a bare `bun test <file>` does
 * not, and many tests delete or overwrite paths from `resolveTobyDir()`. Point
 * both `TOBY_DIR` and `HOME` at a throwaway folder so the default (`~/.toby`)
 * is safe too — even after a test clears `TOBY_DIR` in its teardown.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), "toby-cli-test-home-"));
process.env.HOME = sandbox;
if (!process.env.TOBY_DIR?.trim()) {
	process.env.TOBY_DIR = path.join(sandbox, ".toby");
}
process.on("exit", () => {
	fs.rmSync(sandbox, { recursive: true, force: true });
});
