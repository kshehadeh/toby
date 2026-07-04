#!/usr/bin/env node
/**
 * Analyze chat turn timing from ~/.toby/logs/toby.log (unified log, source="chat").
 *
 * Parses stage_timing, turn_start, and turn_end log entries and prints
 * a per-turn breakdown of init / expand / assemble / run / persist durations.
 *
 * Usage:
 *   node scripts/analyze-turn-timing.mjs              # last 10 turns
 *   node scripts/analyze-turn-timing.mjs --limit 5    # last 5 turns
 *   node scripts/analyze-turn-timing.mjs --all        # all turns in log
 *   TOBY_DIR=/custom/dir node scripts/analyze-turn-timing.mjs
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

function resolveTobyDir() {
	return process.env.TOBY_DIR?.trim() || path.join(os.homedir(), ".toby");
}

function getLogPath() {
	return path.join(resolveTobyDir(), "logs", "toby.log");
}

function parseLogEntries(logPath) {
	if (!fs.existsSync(logPath)) return [];
	const content = fs.readFileSync(logPath, "utf-8");
	return content
		.split("\n")
		.filter(Boolean)
		.map((line) => {
			try {
				return JSON.parse(line);
			} catch {
				return null;
			}
		})
		.filter(Boolean)
		.filter((e) => e.source === "chat");
}

/**
 * Group log entries into turns. Each turn consists of:
 * - stage_timing entries (init, expand, assemble come before turn_start)
 * - turn_start entry
 * - turn_end entry
 * - stage_timing entries (run, persist come after turn_end)
 *
 * Turns without stage_timing (old code) are still included with zero durations.
 * Each turn inherits the sessionId from its turn_start or stage_timing entries.
 */
function groupTurns(entries) {
	const turns = [];
	let current = null;

	for (const e of entries) {
		if (e.type === "stage_timing") {
			if (!current || current.end) {
				// Start a new turn when we see init after a completed turn
				if (e.data?.stage === "init") {
					current = { stages: {}, start: null, end: null, sessionId: null };
					turns.push(current);
				}
			}
			if (current) {
				current.stages[e.data?.stage] = {
					durationMs: e.data?.durationMs ?? 0,
					elapsedMs: e.data?.elapsedMs ?? 0,
					ts: e.ts,
				};
				if (e.sessionId) current.sessionId = e.sessionId;
			}
		} else if (e.type === "turn_start") {
			if (!current || current.end) {
				current = { stages: {}, start: null, end: null, sessionId: null };
				turns.push(current);
			}
			current.start = e;
			if (e.sessionId) current.sessionId = e.sessionId;
		} else if (e.type === "turn_end") {
			if (!current) {
				current = { stages: {}, start: null, end: null, sessionId: null };
				turns.push(current);
			}
			current.end = e;
			if (e.sessionId) current.sessionId = e.sessionId;
		} else if (
			e.type === "routing_index_rebuilt" &&
			current &&
			!current.start
		) {
			current.routingRebuilt = e;
		}
	}

	return turns.filter(
		(t) => t.start || t.end || Object.keys(t.stages).length > 0,
	);
}

/**
 * Group turns by sessionId. Turns without a sessionId are grouped under
 * the label "(unknown)" — typically from before sessionId instrumentation.
 */
function groupBySession(turns) {
	const sessions = new Map();
	for (const turn of turns) {
		const sid = turn.sessionId ?? "(unknown)";
		if (!sessions.has(sid)) sessions.set(sid, []);
		sessions.get(sid).push(turn);
	}
	return [...sessions.entries()].map(([sid, sessionTurns]) => ({
		sessionId: sid,
		turns: sessionTurns,
	}));
}

function formatMs(ms) {
	if (ms === 0) return "0ms";
	if (ms < 1000) return `${ms}ms`;
	return `${(ms / 1000).toFixed(1)}s`;
}

function pct(part, whole) {
	if (whole === 0) return "0%";
	return `${Math.round((part / whole) * 100)}%`;
}

function shortSid(sid) {
	if (!sid || sid === "(unknown)") return "(unknown)";
	return sid.slice(0, 8);
}

function printTurn(turn, idx) {
	const start = turn.start;
	const end = turn.end;
	const stages = turn.stages;

	const initMs = stages.init?.durationMs ?? 0;
	const expandMs = stages.expand?.durationMs ?? 0;
	const assembleMs = stages.assemble?.durationMs ?? 0;
	const runMs = stages.run?.durationMs ?? 0;
	const persistMs = stages.persist?.durationMs ?? 0;
	const prepTotal = initMs + expandMs + assembleMs;
	const grandTotal = prepTotal + runMs + persistMs;

	const hasTiming = Object.keys(stages).length > 0;
	const ts = start?.ts?.slice(11, 19) ?? end?.ts?.slice(11, 19) ?? "?";
	const date = start?.ts?.slice(0, 10) ?? end?.ts?.slice(0, 10) ?? "";

	const mods = start?.data?.modules?.length ?? 0;
	const modNames = start?.data?.modules ?? [];
	const tools = start?.data?.toolCount ?? 0;
	const totalTools = start?.data?.totalToolsAvailable ?? 0;
	const relevant = start?.data?.relevantTools?.length ?? 0;
	const model = start?.data?.model ?? "?";
	const tokIn = end?.data?.inputTokens ?? 0;
	const tokOut = end?.data?.outputTokens ?? 0;
	const toolCalls = end?.data?.toolCallCount ?? 0;
	const toolsUsed = end?.data?.toolsUsed ?? [];
	const modelDuration = end?.data?.durationMs ?? 0;

	// Prompt size metrics (may be absent on older log entries)
	const systemChars = start?.data?.systemChars;
	const totalChars = start?.data?.totalChars;
	const estPromptTokens = start?.data?.estimatedPromptTokens;

	console.log(
		`  ┌─ Turn ${idx + 1}  ${date} ${ts}  session: ${shortSid(turn.sessionId)}${hasTiming ? "" : "  (no stage timing)"}`,
	);
	console.log(`  │  modules:    ${mods} (${modNames.join(", ")})`);
	console.log(
		`  │  tools:      ${tools}/${totalTools} selected  (relevant: ${relevant})`,
	);
	console.log(`  │  model:      ${model}`);
	if (totalChars !== undefined) {
		const fmtChars = (n) =>
			n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n);
		console.log(
			`  │  prompt:     ${fmtChars(totalChars)} chars  (system=${fmtChars(systemChars ?? 0)}, ~${estPromptTokens ?? 0} tokens est.)`,
		);
	}
	console.log(
		`  │  tokens:     in=${tokIn.toLocaleString()}  out=${tokOut.toLocaleString()}`,
	);
	console.log(
		`  │  tool calls: ${toolCalls}  (${toolsUsed.join(", ") || "none"})`,
	);

	if (hasTiming) {
		console.log("  │");
		console.log(
			`  │  ┌ init       ${formatMs(initMs).padStart(8)}   skills + tool catalog + routing index`,
		);
		console.log(
			`  │  ├ expand     ${formatMs(expandMs).padStart(8)}   pretreatment / semantic routing`,
		);
		console.log(
			`  │  ├ assemble   ${formatMs(assembleMs).padStart(8)}   system prompt + integration context`,
		);
		console.log(
			`  │  ├ PREP TOTAL ${formatMs(prepTotal).padStart(8)}   ${pct(prepTotal, grandTotal)} of total`,
		);
		console.log(
			`  │  ├ run        ${formatMs(runMs).padStart(8)}   model turn + tool execution  ${pct(runMs, grandTotal)}`,
		);
		console.log(`  │  ├ persist    ${formatMs(persistMs).padStart(8)}`);
		console.log(`  │  └ TOTAL      ${formatMs(grandTotal).padStart(8)}`);
	} else {
		console.log(
			`  │  model duration: ${formatMs(modelDuration)} (no stage breakdown available)`,
		);
	}

	if (turn.routingRebuilt) {
		console.log(
			`  │  ⚠ routing index rebuilt: ${turn.routingRebuilt.data?.toolCount} tools, ${turn.routingRebuilt.data?.skillCount} skills`,
		);
	}

	console.log("  └");
	console.log();
}

function printSummary(turns) {
	const timed = turns.filter((t) => Object.keys(t.stages).length > 0);
	if (timed.length === 0) {
		console.log(
			"  (no stage timing data found — restart the daemon to pick up instrumentation)",
		);
		return;
	}

	const initMs = timed.map((t) => t.stages.init?.durationMs ?? 0);
	const expandMs = timed.map((t) => t.stages.expand?.durationMs ?? 0);
	const assembleMs = timed.map((t) => t.stages.assemble?.durationMs ?? 0);
	const runMs = timed.map((t) => t.stages.run?.durationMs ?? 0);
	const totals = timed.map((t) => {
		const prep =
			(t.stages.init?.durationMs ?? 0) +
			(t.stages.expand?.durationMs ?? 0) +
			(t.stages.assemble?.durationMs ?? 0);
		const run = t.stages.run?.durationMs ?? 0;
		const persist = t.stages.persist?.durationMs ?? 0;
		return prep + run + persist;
	});
	const tokIn = timed.map((t) => t.end?.data?.inputTokens ?? 0);
	const toolCounts = timed.map((t) => t.start?.data?.toolCount ?? 0);
	const promptChars = timed
		.map((t) => t.start?.data?.totalChars ?? 0)
		.filter((n) => n > 0);
	const systemChars = timed
		.map((t) => t.start?.data?.systemChars ?? 0)
		.filter((n) => n > 0);
	const estTokens = timed
		.map((t) => t.start?.data?.estimatedPromptTokens ?? 0)
		.filter((n) => n > 0);

	const median = (arr) => {
		const sorted = [...arr].sort((a, b) => a - b);
		const mid = Math.floor(sorted.length / 2);
		return sorted[mid] ?? 0;
	};
	const avg = (arr) => arr.reduce((a, b) => a + b, 0) / (arr.length || 1);

	console.log("  ┌─ Summary (stage-timed turns only)");
	console.log(`  │  turns analyzed:     ${timed.length}`);
	console.log(`  │  median init:        ${formatMs(median(initMs))}`);
	console.log(`  │  median expand:      ${formatMs(median(expandMs))}`);
	console.log(`  │  median assemble:    ${formatMs(median(assembleMs))}`);
	console.log(`  │  median run:         ${formatMs(median(runMs))}`);
	console.log(`  │  median total:       ${formatMs(median(totals))}`);
	console.log(
		`  │  median input tokens:${Math.round(median(tokIn)).toLocaleString()}`,
	);
	console.log(`  │  median tools:       ${median(toolCounts)}`);
	if (promptChars.length > 0) {
		const fmtK = (n) => `${(n / 1000).toFixed(1)}k`;
		console.log(
			`  │  median prompt chars:${fmtK(median(promptChars))}  (system: ${fmtK(median(systemChars))})`,
		);
		console.log(
			`  │  median est tokens:  ${Math.round(median(estTokens)).toLocaleString()} (chars/4)`,
		);
	}
	console.log(`  │  avg init:           ${formatMs(Math.round(avg(initMs)))}`);
	console.log(
		`  │  avg expand:         ${formatMs(Math.round(avg(expandMs)))}`,
	);
	console.log(`  │  avg total:          ${formatMs(Math.round(avg(totals)))}`);
	console.log("  └");
}

// --- Main ---

const args = process.argv.slice(2);
let limit = 10;
let showAll = false;
let sessionFilter = null;
for (let i = 0; i < args.length; i++) {
	if (args[i] === "--all") showAll = true;
	if (args[i] === "--limit" && args[i + 1]) {
		limit = Number.parseInt(args[i + 1], 10) || 10;
	}
	if (args[i] === "--session" && args[i + 1]) {
		sessionFilter = args[i + 1];
	}
}

const logPath = getLogPath();
const entries = parseLogEntries(logPath);

if (entries.length === 0) {
	console.error(`No log entries found at ${logPath}`);
	process.exit(1);
}

const allTurns = groupTurns(entries);

// Filter to a specific session if requested
let turns = allTurns;
if (sessionFilter) {
	turns = allTurns.filter((t) => t.sessionId?.startsWith(sessionFilter));
}

const sessions = groupBySession(turns);
const toShow = showAll ? turns : turns.slice(-limit);

console.log();
console.log("  Toby Turn Timing Analysis");
console.log(`  Log: ${logPath}`);
console.log(
	`  Turns in log: ${allTurns.length}  |  Sessions: ${sessions.length}  |  Showing: ${toShow.length}`,
);
if (sessionFilter)
	console.log(`  Filter: session starts with "${sessionFilter}"`);
console.log();

// Group the turns to show by session for readability
const showBySession = groupBySession(toShow);
let turnCounter = allTurns.length - toShow.length;

for (const session of showBySession) {
	const sid = session.sessionId;
	const sessionTurns = session.turns;
	const firstTs =
		sessionTurns[0]?.start?.ts?.slice(0, 19) ??
		sessionTurns[0]?.end?.ts?.slice(0, 19) ??
		"?";
	const lastTs =
		sessionTurns[sessionTurns.length - 1]?.end?.ts?.slice(11, 19) ?? "?";

	console.log(`  ═══ Session ${shortSid(sid)} ═══`);
	console.log(
		`      ${sessionTurns.length} turn(s)  |  ${firstTs.slice(0, 10)} ${firstTs.slice(11, 19)} → ${lastTs}`,
	);
	console.log();

	for (const turn of sessionTurns) {
		printTurn(turn, turnCounter);
		turnCounter++;
	}
}

printSummary(turns);
