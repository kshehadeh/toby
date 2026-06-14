import { AssistantMarkdown } from "@/components/AssistantMarkdown";
import type { TranscriptEntry } from "@toby/core/chat-pipeline/transcript-types";
import { isHiddenLifecycleHeader } from "@toby/core/pipeline-footer";
import type { ReactNode } from "react";

const ACCENT = "text-amber-700 dark:text-amber-500";
const META_ACCENT = "text-cyan-700 dark:text-cyan-500";
const PLAN_ACCENT = "text-fuchsia-600 dark:text-fuchsia-400";

const ASSISTANT_GLYPH = "◇";
const PIPELINE_GLYPH = "›";
const META_GLYPH = "ℹ";

/** Same visibility rules as CLI `flattenTranscript` with debug off. */
export function filterVisibleEntries(
	entries: readonly TranscriptEntry[],
): TranscriptEntry[] {
	return entries.filter((e) => {
		if (e.kind === "meta") {
			return false;
		}
		if (e.kind === "boxed_step") {
			if (e.variant === "prep") {
				return false;
			}
			if (e.variant === "lifecycle" && isHiddenLifecycleHeader(e.header)) {
				return false;
			}
		}
		return true;
	});
}

function boxedStepGlyph(
	variant: Extract<TranscriptEntry, { kind: "boxed_step" }>["variant"],
): string {
	if (variant === "tool" || variant === "prep" || variant === "lifecycle") {
		return PIPELINE_GLYPH;
	}
	if (variant === "plan") {
		return "◆";
	}
	return ASSISTANT_GLYPH;
}

function boxedStepHeaderClass(
	variant: Extract<TranscriptEntry, { kind: "boxed_step" }>["variant"],
): string {
	if (variant === "plan") {
		return PLAN_ACCENT;
	}
	if (variant === "assistant") {
		return ACCENT;
	}
	return ACCENT;
}

function formatGroupedToolRuns(
	runs: readonly {
		header: string;
		body: string;
		cacheHit?: boolean;
	}[],
): string {
	const groups: {
		header: string;
		body: string;
		cacheHit?: boolean;
		count: number;
	}[] = [];
	for (const run of runs) {
		const body = run.body.trim();
		const existing = groups.find(
			(group) =>
				group.header === run.header &&
				group.body === body &&
				group.cacheHit === run.cacheHit,
		);
		if (existing) {
			existing.count += 1;
			continue;
		}
		groups.push({
			header: run.header,
			body,
			...(run.cacheHit !== undefined ? { cacheHit: run.cacheHit } : {}),
			count: 1,
		});
	}

	if (groups.length === 1) {
		const group = groups[0];
		if (group?.body) {
			return group.body;
		}
		if (group) {
			return `${group.header}${group.cacheHit ? " [cache]" : ""}`;
		}
	}

	const lines: string[] = [];
	for (let idx = 0; idx < groups.length; idx++) {
		const group = groups[idx];
		if (group === undefined) {
			continue;
		}
		const title = `${idx + 1}. ${group.header}${group.cacheHit ? " [cache]" : ""}${group.count > 1 ? ` (x${group.count})` : ""}`;
		lines.push(title);
		if (group.body.length > 0) {
			for (const line of group.body.split(/\r?\n/)) {
				lines.push(`   ${line}`);
			}
		}
		if (idx < groups.length - 1) {
			lines.push("");
		}
	}
	return lines.length > 0 ? lines.join("\n") : "";
}

function boxedStepBody(
	entry: Extract<TranscriptEntry, { kind: "boxed_step" }>,
): string {
	if (
		entry.variant === "tool" &&
		entry.toolRuns !== undefined &&
		entry.toolRuns.length > 1
	) {
		return formatGroupedToolRuns(entry.toolRuns);
	}
	return entry.body;
}

function PreBody({ text }: { readonly text: string }) {
	const lines = text.split(/\r?\n/);
	return (
		<div className="ml-4 text-muted-foreground whitespace-pre-wrap">
			{lines.map((line, j) => (
				<div key={`${j}-${line.slice(0, 24)}`}>
					{j === 0 ? "↳ " : "  "}
					{line.length > 0 ? line : " "}
				</div>
			))}
		</div>
	);
}

function UserLine({ text }: { readonly text: string }) {
	return (
		<div className="flex gap-1">
			<span className={ACCENT}>█</span>
			<span className="whitespace-pre-wrap">{text}</span>
		</div>
	);
}

function BoxedStepBlock({
	entry,
}: {
	readonly entry: Extract<TranscriptEntry, { kind: "boxed_step" }>;
}) {
	const glyph = boxedStepGlyph(entry.variant);
	const headerClass = boxedStepHeaderClass(entry.variant);
	const body = boxedStepBody(entry);
	const bodyDim = entry.variant !== "assistant";

	return (
		<div className="ml-2">
			<div>
				<span className={headerClass}>{glyph}</span>{" "}
				<span className={`font-semibold ${headerClass}`}>{entry.header}</span>
				{entry.variant === "tool" && entry.cacheHit ? (
					<span className="text-muted-foreground"> [cache]</span>
				) : null}
			</div>
			{body.trim().length > 0 ? (
				entry.variant === "assistant" ? (
					<AssistantMarkdown text={body} />
				) : (
					<PreBody text={body} />
				)
			) : bodyDim ? (
				<PreBody text="" />
			) : null}
		</div>
	);
}

function AssistantBlock({ text }: { readonly text: string }) {
	return (
		<div className="ml-4 rounded-md border border-border px-3 py-2">
			<div className="-ml-4">
				<AssistantMarkdown text={text} />
			</div>
		</div>
	);
}

function ToolFeedbackBlock({
	title,
	detail,
}: {
	readonly title: string;
	readonly detail: string;
}) {
	return (
		<div className="ml-2">
			<div className={`font-semibold ${ACCENT}`}>{`> ${title}`}</div>
			{detail.length > 0 ? (
				<div className="ml-6 text-muted-foreground whitespace-pre-wrap">
					{detail}
				</div>
			) : null}
		</div>
	);
}

function NoticeLine({
	text,
	tone,
}: {
	readonly text: string;
	readonly tone?: "info" | "success" | "error";
}) {
	const glyph = tone === "success" ? "✔︎" : tone === "error" ? "✗" : META_GLYPH;
	const colorClass =
		tone === "success"
			? "text-green-600 dark:text-green-400"
			: tone === "error"
				? "text-red-600 dark:text-red-400"
				: META_ACCENT;
	return (
		<div className={`ml-2 ${colorClass}`}>
			<span>{glyph}</span> <span>{text}</span>
		</div>
	);
}

function ErrorBlock({ text }: { readonly text: string }) {
	return (
		<div className="ml-2 text-red-600 dark:text-red-400">
			<div>✗ Session error</div>
			<div className="ml-4 whitespace-pre-wrap">↳ {text}</div>
		</div>
	);
}

function AskUserBlock({
	query,
	answer,
	error,
}: {
	readonly query: string;
	readonly answer: string;
	readonly error?: string;
}) {
	return (
		<div className="ml-2 rounded-md border border-border bg-muted/50 px-3 py-2 my-1">
			<div>
				<span className="text-blue-600 dark:text-blue-400">[Q] </span>
				<span className="font-semibold">{query}</span>
			</div>
			{error !== undefined && error.length > 0 ? (
				<div className="text-red-600 dark:text-red-400 whitespace-pre-wrap">
					{error}
				</div>
			) : (
				<div className="whitespace-pre-wrap">{answer}</div>
			)}
		</div>
	);
}

function TurnSpacer() {
	return <div className="h-3" aria-hidden />;
}

function shouldGapAfter(hasNext: boolean): boolean {
	return hasNext;
}

function renderEntry(
	entry: TranscriptEntry,
	visible: readonly TranscriptEntry[],
	index: number,
): { node: ReactNode; skip: number } {
	const key = `${entry.kind}-${index}`;

	if (entry.kind === "user") {
		return {
			node: (
				<div key={key}>
					<UserLine text={entry.text} />
					{shouldGapAfter(index < visible.length - 1) ? <TurnSpacer /> : null}
				</div>
			),
			skip: 0,
		};
	}

	if (entry.kind === "boxed_step") {
		return {
			node: (
				<div key={key}>
					<BoxedStepBlock entry={entry} />
					{shouldGapAfter(index < visible.length - 1) ? <TurnSpacer /> : null}
				</div>
			),
			skip: 0,
		};
	}

	if (entry.kind === "assistant") {
		return {
			node: (
				<div key={key}>
					<AssistantBlock text={entry.text} />
					{shouldGapAfter(index < visible.length - 1) ? <TurnSpacer /> : null}
				</div>
			),
			skip: 0,
		};
	}

	if (entry.kind === "tool_call") {
		const details: string[] = [];
		let skip = 0;
		for (let j = index + 1; j < visible.length; j++) {
			const next = visible[j];
			if (next?.kind === "tool_output" && next.blockKey === entry.blockKey) {
				details.push(next.detail);
				skip += 1;
			} else {
				break;
			}
		}
		return {
			node: (
				<div key={key}>
					<ToolFeedbackBlock title={entry.title} detail={details.join("\n")} />
					{shouldGapAfter(index + skip < visible.length - 1) ? (
						<TurnSpacer />
					) : null}
				</div>
			),
			skip,
		};
	}

	if (entry.kind === "tool_output") {
		return {
			node: (
				<div key={key}>
					<div className="ml-6 text-muted-foreground whitespace-pre-wrap">
						{entry.detail}
					</div>
					{shouldGapAfter(index < visible.length - 1) ? <TurnSpacer /> : null}
				</div>
			),
			skip: 0,
		};
	}

	if (entry.kind === "notice") {
		const noticeLines: Array<{
			key: string;
			text: string;
			tone?: "info" | "success" | "error";
		}> = [
			{
				key: `${key}-n-${index}`,
				text: entry.text,
				...(entry.tone !== undefined ? { tone: entry.tone } : {}),
			},
		];
		let groupEnd = index + 1;
		while (groupEnd < visible.length) {
			const next = visible[groupEnd];
			if (next?.kind !== "notice") {
				break;
			}
			noticeLines.push({
				key: `${key}-n-${groupEnd}`,
				text: next.text,
				...(next.tone !== undefined ? { tone: next.tone } : {}),
			});
			groupEnd += 1;
		}
		return {
			node: (
				<div key={key}>
					{noticeLines.map((line) => (
						<NoticeLine key={line.key} text={line.text} tone={line.tone} />
					))}
					{shouldGapAfter(groupEnd - 1 < visible.length - 1) ? (
						<TurnSpacer />
					) : null}
				</div>
			),
			skip: groupEnd - index - 1,
		};
	}

	if (entry.kind === "error") {
		return {
			node: (
				<div key={key}>
					<ErrorBlock text={entry.text} />
					{shouldGapAfter(index < visible.length - 1) ? <TurnSpacer /> : null}
				</div>
			),
			skip: 0,
		};
	}

	if (entry.kind === "ask_user_qa") {
		return {
			node: (
				<div key={key}>
					<AskUserBlock
						query={entry.query}
						answer={entry.answer}
						{...(entry.error !== undefined ? { error: entry.error } : {})}
					/>
					{shouldGapAfter(index < visible.length - 1) ? <TurnSpacer /> : null}
				</div>
			),
			skip: 0,
		};
	}

	return { node: null, skip: 0 };
}

export function SessionTranscript({
	entries,
}: {
	readonly entries: readonly TranscriptEntry[];
}) {
	const visible = filterVisibleEntries(entries);
	if (visible.length === 0) {
		return <p className="text-muted-foreground">Empty transcript</p>;
	}

	const nodes: ReactNode[] = [];
	let i = 0;
	while (i < visible.length) {
		const entry = visible[i];
		if (entry === undefined) {
			break;
		}
		const { node, skip } = renderEntry(entry, visible, i);
		if (node !== null) {
			nodes.push(node);
		}
		i += 1 + skip;
	}

	return (
		<div className="space-y-0 font-mono text-sm leading-relaxed">{nodes}</div>
	);
}
