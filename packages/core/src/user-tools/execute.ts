import { spawn } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { resolveBunRuntime } from "../integrations/plugins/runtime";
import { type UserTool, getUserTool } from "./store";

const TIMEOUT_MS = 30_000;
const MAX_OUTPUT_BYTES = 1024 * 1024;
const RESULT_MARKER = "__TOBY_RESULT__";

function runProcess(
	command: string,
	args: string[],
	cwd: string,
	input?: string,
): Promise<string> {
	return new Promise((resolve, reject) => {
		const child = spawn(command, args, {
			cwd,
			stdio: ["pipe", "pipe", "pipe"],
			env: {
				HOME: process.env.HOME,
				PATH: "/usr/bin:/bin:/usr/sbin:/sbin",
				TMPDIR: process.env.TMPDIR,
			},
		});
		let stdout = "";
		let stderr = "";
		let settled = false;
		const finish = (error?: Error) => {
			if (settled) return;
			settled = true;
			clearTimeout(timeout);
			if (error) reject(error);
			else resolve(stdout);
		};
		const timeout = setTimeout(() => {
			child.kill("SIGKILL");
			finish(new Error("Tool timed out after 30 seconds"));
		}, TIMEOUT_MS);
		child.stdout.on("data", (chunk: Buffer) => {
			stdout += chunk.toString();
			if (Buffer.byteLength(stdout) > MAX_OUTPUT_BYTES) {
				child.kill("SIGKILL");
				finish(new Error("Tool output exceeded 1 MB"));
			}
		});
		child.stderr.on("data", (chunk: Buffer) => {
			stderr += chunk.toString();
			if (Buffer.byteLength(stderr) > MAX_OUTPUT_BYTES) {
				child.kill("SIGKILL");
				finish(new Error("Tool error output exceeded 1 MB"));
			}
		});
		child.on("error", (error) => finish(error));
		child.on("close", (code) => {
			if (code !== 0)
				finish(new Error(stderr.trim() || `Tool exited with code ${code}`));
			else finish();
		});
		child.stdin.on("error", () => {});
		child.stdin.end(input);
	});
}

export async function executeUserTool(
	tool: Pick<UserTool, "inputNames" | "language" | "outputKind" | "source">,
	input: Record<string, unknown>,
): Promise<unknown> {
	for (const name of tool.inputNames) {
		if (!(name in input)) throw new Error(`Missing input "${name}"`);
	}
	const inputJson = JSON.stringify(input);
	if (Buffer.byteLength(inputJson) > 256 * 1024) {
		throw new Error("Tool input exceeded 256 KB");
	}
	const dir = await mkdtemp(path.join(os.tmpdir(), "toby-tool-"));
	try {
		let raw: string;
		if (tool.language === "typescript") {
			const bun = resolveBunRuntime();
			if (!bun.ok) throw new Error(bun.error);
			await writeFile(path.join(dir, "tool.ts"), tool.source, { mode: 0o600 });
			await writeFile(
				path.join(dir, "run.ts"),
				`import tool from "./tool.ts";\nconst input = JSON.parse(await Bun.stdin.text());\nconst result = await tool(input);\nprocess.stdout.write("${RESULT_MARKER}" + JSON.stringify(result) + "\\n");\n`,
				{ mode: 0o600 },
			);
			raw = await runProcess(bun.bunPath, ["run", "run.ts"], dir, inputJson);
			const markerAt = raw.lastIndexOf(RESULT_MARKER);
			if (markerAt < 0) throw new Error("Tool did not return a result");
			raw = raw.slice(markerAt + RESULT_MARKER.length).trim();
			const result = JSON.parse(raw) as unknown;
			if (tool.outputKind === "text") {
				if (typeof result !== "string")
					throw new Error("Tool must return text");
				return result;
			}
			return result;
		}
		await writeFile(path.join(dir, "tool.applescript"), tool.source, {
			mode: 0o600,
		});
		const args = tool.inputNames.map((name) => {
			const value = input[name];
			return typeof value === "string" ? value : JSON.stringify(value);
		});
		raw = await runProcess(
			"/usr/bin/osascript",
			["tool.applescript", ...args],
			dir,
		);
		return tool.outputKind === "json"
			? (JSON.parse(raw) as unknown)
			: raw.replace(/\r?\n$/, "");
	} finally {
		await rm(dir, { recursive: true, force: true });
	}
}

export async function executeUserToolById(
	id: string,
	input: Record<string, unknown>,
): Promise<{ result: unknown; revision: number }> {
	const tool = getUserTool(id);
	if (!tool) throw new Error(`Tool "${id}" was not found`);
	return {
		result: await executeUserTool(tool, input),
		revision: tool.currentRevision,
	};
}
