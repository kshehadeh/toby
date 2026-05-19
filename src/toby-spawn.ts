const ENTRY_SCRIPT_EXTENSIONS = [".js", ".ts", ".mjs", ".cjs"] as const;

/** Script path passed to the runtime (bun/node), or null for a compiled binary. */
export function getTobyEntryScriptArgv(): string | null {
	const candidate = process.argv[1];
	if (!candidate) {
		return null;
	}
	const lower = candidate.toLowerCase();
	if (ENTRY_SCRIPT_EXTENSIONS.some((ext) => lower.endsWith(ext))) {
		return candidate;
	}
	return null;
}

/** CLI args for `spawn(execPath, …)` — omits the script path when running as a compiled binary. */
export function buildTobySpawnArgs(...cliArgs: string[]): string[] {
	const entry = getTobyEntryScriptArgv();
	return entry ? [entry, ...cliArgs] : cliArgs;
}

export function getTobyExecPath(): string {
	return process.execPath;
}
