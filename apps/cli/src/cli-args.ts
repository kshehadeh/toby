const ROOT_OPTIONS = new Set(["--help", "-h", "--version", "-V"]);

function rewriteRootPromptFlag(args: readonly string[]): string[] {
	if (args[0] === "-p") {
		return ["--prompt", ...args.slice(1)];
	}
	return [...args];
}

/**
 * Default bare `toby` to `chat` without treating unknown positional tokens as prompts.
 * Root `-p` / `--prompt` maps to `chat --prompt` (chat keeps `-p` for `--persona`).
 */
export function normalizeRootCliArgs(rawArgs: readonly string[]): string[] {
	const args = [...rawArgs];
	const first = args[0];

	if (!first) {
		return ["chat"];
	}

	if (ROOT_OPTIONS.has(first)) {
		return args;
	}

	if (first === "-p" || first === "--prompt") {
		return ["chat", ...rewriteRootPromptFlag(args)];
	}

	if (first.startsWith("-")) {
		return ["chat", ...args];
	}

	return args;
}
