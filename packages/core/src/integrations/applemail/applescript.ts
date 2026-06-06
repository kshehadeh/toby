import { execSync, spawnSync } from "node:child_process";

const DEFAULT_TIMEOUT_MS = 30_000;
const DEFAULT_MAX_RETRIES = 1;
const DEFAULT_RETRY_DELAY_MS = 1000;

export interface AppleScriptOptions {
	readonly timeoutMs?: number;
	readonly maxRetries?: number;
	readonly retryDelayMs?: number;
}

export interface AppleScriptResult {
	readonly success: boolean;
	readonly output: string;
	readonly error?: string;
}

function escapeForShell(script: string): string {
	return script.replace(/'/g, "'\\''");
}

function isTimeoutError(error: unknown): boolean {
	if (error instanceof Error) {
		const execError = error as Error & { killed?: boolean; signal?: string };
		return execError.killed === true || execError.signal === "SIGTERM";
	}
	return false;
}

const RETRYABLE_ERROR_PATTERNS = [
	/timed? out/i,
	/not responding/i,
	/connection.*invalid/i,
	/lost connection/i,
	/busy/i,
];

function isRetryableError(errorMessage: string): boolean {
	return RETRYABLE_ERROR_PATTERNS.some((pattern) => pattern.test(errorMessage));
}

function sleep(ms: number): void {
	const seconds = ms / 1000;
	const result = spawnSync("sleep", [seconds.toString()], { stdio: "ignore" });
	if (result.error) {
		const end = Date.now() + ms;
		while (Date.now() < end) {
			/* busy wait fallback */
		}
	}
}

function parseErrorMessage(errorOutput: string): string {
	let coreError = errorOutput;
	const executionError = errorOutput.match(
		/execution error: (.+?)(?:\s*\(-?\d+\))?$/m,
	);
	if (executionError) {
		coreError = executionError[1]?.trim() ?? errorOutput;
	}

	if (/not authorized|not permitted|access.*denied/i.test(coreError)) {
		return "Automation permission denied. Grant Terminal/Cursor access to Mail in System Settings → Privacy & Security → Automation.";
	}
	if (/application isn't running|not running/i.test(coreError)) {
		return "Mail.app is not running or not responding.";
	}
	if (/connection is invalid|lost connection/i.test(coreError)) {
		return "Lost connection to Mail.app.";
	}

	const notFound = coreError.match(/Can't get (.+?)\./);
	if (notFound) {
		return `Not found: ${notFound[1]}`;
	}
	return coreError.trim() || "Unknown AppleScript error";
}

/**
 * Runs AppleScript via `osascript`. macOS only; callers should guard with `process.platform === "darwin"`.
 */
export function executeAppleScript(
	script: string,
	options: AppleScriptOptions = {},
): AppleScriptResult {
	if (process.platform !== "darwin") {
		return {
			success: false,
			output: "",
			error: "AppleScript is only available on macOS.",
		};
	}

	const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
	const maxRetries = options.maxRetries ?? DEFAULT_MAX_RETRIES;
	const retryDelayMs = options.retryDelayMs ?? DEFAULT_RETRY_DELAY_MS;

	if (!script?.trim()) {
		return {
			success: false,
			output: "",
			error: "Cannot execute empty AppleScript",
		};
	}

	const preparedScript = escapeForShell(script.trim());
	const command = `osascript -e '${preparedScript}'`;

	let lastError: AppleScriptResult | null = null;

	for (let attempt = 1; attempt <= maxRetries; attempt++) {
		try {
			const output = execSync(command, {
				encoding: "utf8",
				timeout: timeoutMs,
				stdio: ["pipe", "pipe", "pipe"],
			});
			return {
				success: true,
				output: output.trim(),
			};
		} catch (error: unknown) {
			let errorMessage: string;
			const isTimeout = isTimeoutError(error);

			if (isTimeout) {
				const timeoutSecs = Math.round(timeoutMs / 1000);
				errorMessage = `Operation timed out after ${timeoutSecs} seconds.`;
			} else if (error instanceof Error) {
				errorMessage = parseErrorMessage(error.message);
			} else if (typeof error === "string") {
				errorMessage = parseErrorMessage(error);
			} else {
				errorMessage = "AppleScript execution failed with unknown error";
			}

			lastError = {
				success: false,
				output: "",
				error: errorMessage,
			};

			const canRetry = isTimeout || isRetryableError(errorMessage);
			const hasAttemptsLeft = attempt < maxRetries;

			if (canRetry && hasAttemptsLeft) {
				const delayMs = retryDelayMs * 2 ** (attempt - 1);
				sleep(delayMs);
			} else {
				return lastError;
			}
		}
	}

	if (lastError) {
		return lastError;
	}
	return {
		success: false,
		output: "",
		error: "AppleScript failed after retries.",
	};
}
