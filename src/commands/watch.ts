import parseDuration from "parse-duration";

interface WatchLoopOptions {
	readonly label?: string;
	readonly intervalMs: number;
	readonly runOnce: () => Promise<void>;
	/**
	 * Intended primarily for tests. When omitted, the loop runs until aborted.
	 */
	readonly maxCycles?: number;
	/**
	 * Inject a signal to allow external cancellation (tests / composition).
	 * If omitted, a new controller is created internally.
	 */
	readonly signal?: AbortSignal;
	/**
	 * Inject sleep implementation for tests.
	 */
	readonly sleep?: (ms: number, signal: AbortSignal) => Promise<void>;
}

export function parseWatchInterval(input: string): number {
	const normalized = normalizeWatchIntervalInput(input);
	const ms = parseDuration(normalized);
	if (ms == null || Number.isNaN(ms)) {
		throw new Error(
			`Invalid watch interval "${input}". Try e.g. "every hour", "30m", "5 minutes".`,
		);
	}
	if (ms <= 0) {
		throw new Error(
			`Watch interval must be greater than 0ms (got ${ms}ms from "${input}").`,
		);
	}
	return ms;
}

function normalizeWatchIntervalInput(input: string): string {
	let s = input.trim().toLowerCase();
	s = s.replace(/\s+/g, " ");

	// Allow "every X" phrasing (e.g. "every hour", "every 30m").
	if (s.startsWith("every ")) {
		s = s.slice("every ".length).trim();
	}

	// Handle common English cases that omit the leading number.
	if (s === "hour" || s === "an hour" || s === "a hour") return "1 hour";
	if (s === "minute" || s === "a minute" || s === "an minute")
		return "1 minute";
	if (s === "second" || s === "a second" || s === "an second")
		return "1 second";
	if (s === "day" || s === "a day" || s === "an day") return "1 day";

	return s;
}

export async function runWithWatch(options: WatchLoopOptions): Promise<void> {
	const sleep = options.sleep ?? sleepWithAbort;
	const controller = options.signal ? null : new AbortController();
	const signal = options.signal ?? controller?.signal;
	if (!signal) {
		throw new Error("runWithWatch: missing AbortSignal");
	}

	const labelPrefix = options.label ? `[${options.label}] ` : "";

	let stopRequested = false;
	const onStopSignal = () => {
		if (stopRequested) return;
		stopRequested = true;
		controller?.abort();
	};

	const handlersInstalled = installStopHandlers(onStopSignal);
	try {
		let cycles = 0;
		// Immediate first run by design.
		while (!signal.aborted) {
			cycles += 1;
			const cycleLabel = `${labelPrefix}cycle ${cycles}`;
			const startedAt = Date.now();
			try {
				// eslint-disable-next-line no-console
				console.log(`${cycleLabel}: start`);
				await options.runOnce();
				// eslint-disable-next-line no-console
				console.log(`${cycleLabel}: done (${Date.now() - startedAt}ms)`);
			} catch (error) {
				// eslint-disable-next-line no-console
				console.error(
					`${cycleLabel}: error: ${error instanceof Error ? error.message : String(error)}`,
				);
			}

			if (options.maxCycles != null && cycles >= options.maxCycles) {
				return;
			}
			if (signal.aborted) {
				return;
			}

			await sleep(options.intervalMs, signal);
		}
	} finally {
		handlersInstalled.dispose();
	}
}

async function sleepWithAbort(ms: number, signal: AbortSignal): Promise<void> {
	if (signal.aborted) return;
	await new Promise<void>((resolve) => {
		const t = setTimeout(resolve, ms);
		const onAbort = () => {
			clearTimeout(t);
			resolve();
		};
		signal.addEventListener("abort", onAbort, { once: true });
	});
}

function installStopHandlers(onStop: () => void): { dispose: () => void } {
	// Only process-level signals for CLI use; Bun/Node both support these.
	const sigintHandler = () => onStop();
	const sigtermHandler = () => onStop();

	process.on("SIGINT", sigintHandler);
	process.on("SIGTERM", sigtermHandler);

	return {
		dispose() {
			process.off("SIGINT", sigintHandler);
			process.off("SIGTERM", sigtermHandler);
		},
	};
}
