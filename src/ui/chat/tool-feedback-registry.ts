export type ToolFeedbackFormatContext = {
	readonly toolName: string;
	readonly args: Record<string, unknown>;
	readonly result: unknown;
	readonly error?: unknown;
};

export type ToolFeedbackFormatter = (ctx: ToolFeedbackFormatContext) => string;

const registry = new Map<string, ToolFeedbackFormatter>();

/** Register a compact one-line formatter for a tool (integration-local or shared). */
export function registerToolFeedbackFormatter(
	toolName: string,
	formatter: ToolFeedbackFormatter,
): void {
	registry.set(toolName, formatter);
}

function sanitizeOneLine(s: string, maxLen = 200): string {
	return s.replace(/\r?\n/g, " ").trim().slice(0, maxLen);
}

function defaultToolFeedbackOutput(ctx: ToolFeedbackFormatContext): string {
	if (ctx.error !== undefined) {
		const msg =
			ctx.error instanceof Error ? ctx.error.message : String(ctx.error);
		return sanitizeOneLine(`Failed: ${msg}`);
	}
	const r = ctx.result;
	if (Array.isArray(r)) {
		return `Returned ${r.length} item(s).`;
	}
	if (r && typeof r === "object") {
		const o = r as Record<string, unknown>;
		if (Array.isArray(o.tasks)) {
			return `Found ${o.tasks.length} item(s).`;
		}
		if (Array.isArray(o.emails)) {
			return `Found ${o.emails.length} email(s).`;
		}
		if (Array.isArray(o.users)) {
			return `Found ${o.users.length} user(s).`;
		}
		if (Array.isArray(o.messageSummaries)) {
			const n = o.messageSummaries.length;
			const est = o.resultSizeEstimate;
			const more = o.hasMorePages === true ? " More pages available." : "";
			if (typeof est === "number" && est >= 0) {
				return sanitizeOneLine(
					`Inbox: ${n} on this page, ~${est} match(es).${more}`,
				);
			}
			return sanitizeOneLine(`Inbox: ${n} message(s) on this page.${more}`);
		}
		if (Array.isArray(o.labels)) {
			return `Found ${o.labels.length} label(s).`;
		}
		if (typeof o.message === "string" && o.message.trim().length > 0) {
			return sanitizeOneLine(o.message);
		}
		if (typeof o.summary === "string" && o.summary.trim().length > 0) {
			return sanitizeOneLine(o.summary);
		}
		if (o.success === true) {
			return "Done.";
		}
		if (o.dryRun === true && typeof o.message === "string") {
			return sanitizeOneLine(o.message);
		}
	}
	if (r === undefined || r === null) {
		return "Done.";
	}
	return "Done.";
}

/** Compact transcript line for tool output (per-tool formatter or default). */
export function formatToolFeedbackOutput(
	ctx: ToolFeedbackFormatContext,
): string {
	const fn = registry.get(ctx.toolName);
	if (fn) {
		try {
			const out = fn(ctx);
			if (typeof out === "string" && out.trim().length > 0) {
				return sanitizeOneLine(out);
			}
		} catch {
			// fall through to default
		}
	}
	return defaultToolFeedbackOutput(ctx);
}

function registerBuiltInToolFeedbackFormatters(): void {
	registerToolFeedbackFormatter("fetchOpenTasks", (ctx) => {
		const r = ctx.result as {
			tasks?: unknown[];
			dryRun?: boolean;
			message?: string;
		} | null;
		if (r?.dryRun && typeof r.message === "string") {
			return sanitizeOneLine(r.message);
		}
		if (r && Array.isArray(r.tasks)) {
			return `Found ${r.tasks.length} open task(s).`;
		}
		return defaultToolFeedbackOutput(ctx);
	});

	registerToolFeedbackFormatter("fetchCompletedTasks", (ctx) => {
		const r = ctx.result as {
			tasks?: unknown[];
			dryRun?: boolean;
			message?: string;
		} | null;
		if (r?.dryRun && typeof r.message === "string") {
			return sanitizeOneLine(r.message);
		}
		if (r && Array.isArray(r.tasks)) {
			return `Found ${r.tasks.length} completed task(s).`;
		}
		return defaultToolFeedbackOutput(ctx);
	});

	registerToolFeedbackFormatter("listProjectNames", (ctx) => {
		const r = ctx.result as {
			projectNames?: unknown[];
			dryRun?: boolean;
			message?: string;
		} | null;
		if (r?.dryRun && typeof r.message === "string") {
			return sanitizeOneLine(r.message);
		}
		if (r && Array.isArray(r.projectNames)) {
			return `Found ${r.projectNames.length} project name(s).`;
		}
		return defaultToolFeedbackOutput(ctx);
	});

	registerToolFeedbackFormatter("getProjectNameById", (ctx) => {
		const r = ctx.result as {
			projectName?: unknown;
			found?: boolean;
			dryRun?: boolean;
			message?: string;
		} | null;
		if (r?.dryRun && typeof r.message === "string") {
			return sanitizeOneLine(r.message);
		}
		if (r?.found === true && typeof r.projectName === "string") {
			return `Project: ${sanitizeOneLine(r.projectName, 120)}`;
		}
		if (r?.found === false) {
			return "No matching project found for that project ID.";
		}
		return defaultToolFeedbackOutput(ctx);
	});

	registerToolFeedbackFormatter("updateTask", (ctx) => {
		const r = ctx.result as {
			success?: boolean;
			dryRun?: boolean;
			message?: string;
		} | null;
		if (r?.dryRun && typeof r.message === "string") {
			return sanitizeOneLine(r.message);
		}
		if (r?.success === true) {
			return "Updated task.";
		}
		return defaultToolFeedbackOutput(ctx);
	});

	registerToolFeedbackFormatter("completeTask", (ctx) => {
		const r = ctx.result as {
			success?: boolean;
			dryRun?: boolean;
			message?: string;
		} | null;
		if (r?.dryRun && typeof r.message === "string") {
			return sanitizeOneLine(r.message);
		}
		if (r?.success === true) {
			return "Completed task.";
		}
		return defaultToolFeedbackOutput(ctx);
	});

	registerToolFeedbackFormatter("askUser", (ctx) => {
		const r = ctx.result as {
			selectedLabel?: string;
			error?: string;
		} | null;
		if (r?.error) {
			return sanitizeOneLine(r.error);
		}
		if (typeof r?.selectedLabel === "string" && r.selectedLabel.trim()) {
			return `Chose: ${sanitizeOneLine(r.selectedLabel, 120)}`;
		}
		return defaultToolFeedbackOutput(ctx);
	});
}

registerBuiltInToolFeedbackFormatters();
