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

	registerToolFeedbackFormatter("loadLocalSkillInstructions", (ctx) => {
		const r = ctx.result as {
			ok?: boolean;
			loaded?: Array<{ name?: unknown }>;
			missingNames?: unknown[];
			error?: string;
		} | null;
		if (r?.ok !== true || !Array.isArray(r.loaded) || r.loaded.length === 0) {
			if (typeof r?.error === "string" && r.error.trim().length > 0) {
				return sanitizeOneLine(`No skills loaded: ${r.error}`);
			}
			return "No skills loaded.";
		}
		const names = r.loaded
			.map((s) => (typeof s?.name === "string" ? s.name.trim() : ""))
			.filter((n) => n.length > 0);
		const listed = names.slice(0, 4).join(", ");
		const more = names.length > 4 ? ` (+${names.length - 4} more)` : "";
		const missing =
			Array.isArray(r.missingNames) && r.missingNames.length > 0
				? ` Missing: ${r.missingNames.length}.`
				: "";
		return `Loaded skills: ${listed}${more}.${missing}`;
	});

	// Memory tools
	registerToolFeedbackFormatter("memorySearch", (ctx) => {
		const r = ctx.result as {
			count?: number;
			memories?: unknown[];
			dryRun?: boolean;
			message?: string;
		} | null;
		if (r?.dryRun && typeof r.message === "string") {
			return sanitizeOneLine(r.message);
		}
		if (typeof r?.count === "number") {
			return r.count === 0
				? "No memories found."
				: `Found ${r.count} memory(ies).`;
		}
		return defaultToolFeedbackOutput(ctx);
	});

	registerToolFeedbackFormatter("memoryPropose", (ctx) => {
		const r = ctx.result as {
			status?: string;
			proposalId?: string;
			sensitivity?: string;
			message?: string;
			dryRun?: boolean;
		} | null;
		if (r?.dryRun && typeof r.message === "string") {
			return sanitizeOneLine(r.message);
		}
		if (r?.status === "accepted" && typeof r.message === "string") {
			return sanitizeOneLine(r.message);
		}
		if (r?.status === "pending") {
			return `Memory proposed (sensitivity: ${r.sensitivity ?? "unknown"}), awaiting confirmation.`;
		}
		return defaultToolFeedbackOutput(ctx);
	});

	registerToolFeedbackFormatter("memorySave", (ctx) => {
		const r = ctx.result as {
			ok?: boolean;
			memoryId?: string;
			message?: string;
			error?: string;
			dryRun?: boolean;
		} | null;
		if (r?.dryRun && typeof r.message === "string") {
			return sanitizeOneLine(r.message);
		}
		if (r?.ok === true && typeof r.message === "string") {
			return sanitizeOneLine(r.message);
		}
		if (r?.ok === false && typeof r.error === "string") {
			return sanitizeOneLine(`Save failed: ${r.error}`);
		}
		return defaultToolFeedbackOutput(ctx);
	});

	registerToolFeedbackFormatter("memoryForget", (ctx) => {
		const r = ctx.result as {
			ok?: boolean;
			message?: string;
			error?: string;
			dryRun?: boolean;
		} | null;
		if (r?.dryRun && typeof r.message === "string") {
			return sanitizeOneLine(r.message);
		}
		if (r?.ok === true) {
			return "Forgot memory.";
		}
		if (r?.ok === false && typeof r.error === "string") {
			return sanitizeOneLine(`Forget failed: ${r.error}`);
		}
		return defaultToolFeedbackOutput(ctx);
	});

	registerToolFeedbackFormatter("memoryExplain", (ctx) => {
		const r = ctx.result as {
			item?: { type?: string; subject?: string; value?: string };
			error?: string;
		} | null;
		if (typeof r?.error === "string") {
			return sanitizeOneLine(r.error);
		}
		if (r?.item) {
			const type = r.item.type ?? "unknown";
			const preview = r.item.subject ?? r.item.value?.slice(0, 60) ?? "";
			return `Explained memory (${type}): ${sanitizeOneLine(preview, 120)}`;
		}
		return defaultToolFeedbackOutput(ctx);
	});

	registerToolFeedbackFormatter("memoryRetrieveForTask", (ctx) => {
		const r = ctx.result as {
			summary?: string;
			memories?: unknown[];
			omitted?: { count?: number };
			dryRun?: boolean;
			message?: string;
		} | null;
		if (r?.dryRun && typeof r.message === "string") {
			return sanitizeOneLine(r.message);
		}
		if (Array.isArray(r?.memories)) {
			const n = r.memories.length;
			const omitted = r.omitted?.count ?? 0;
			const suffix = omitted > 0 ? ` (${omitted} omitted)` : "";
			return n === 0
				? `No relevant memories.${suffix}`
				: `Retrieved ${n} memory(ies)${suffix}.`;
		}
		return defaultToolFeedbackOutput(ctx);
	});

	// Reflect tools
	registerToolFeedbackFormatter("tobyListIntegrations", (ctx) => {
		const r = ctx.result as {
			integrations?: unknown[];
			dryRun?: boolean;
			message?: string;
		} | null;
		if (r?.dryRun && typeof r.message === "string") {
			return sanitizeOneLine(r.message);
		}
		if (Array.isArray(r?.integrations)) {
			return `Listed ${r.integrations.length} integration(s).`;
		}
		return defaultToolFeedbackOutput(ctx);
	});

	registerToolFeedbackFormatter("tobyGetIntegrationSetup", (ctx) => {
		const r = ctx.result as {
			ok?: boolean;
			name?: string;
			displayName?: string;
			connected?: boolean;
			error?: string;
			dryRun?: boolean;
			message?: string;
		} | null;
		if (r?.dryRun && typeof r.message === "string") {
			return sanitizeOneLine(r.message);
		}
		if (r?.ok === false && typeof r.error === "string") {
			return sanitizeOneLine(r.error);
		}
		if (r?.ok && typeof r.displayName === "string") {
			const status = r.connected ? "connected" : "not connected";
			return `Setup for ${r.displayName}: ${status}.`;
		}
		return defaultToolFeedbackOutput(ctx);
	});

	registerToolFeedbackFormatter("tobyListDefaults", (ctx) => {
		const r = ctx.result as {
			categories?: unknown[];
			dryRun?: boolean;
			message?: string;
		} | null;
		if (r?.dryRun && typeof r.message === "string") {
			return sanitizeOneLine(r.message);
		}
		if (Array.isArray(r?.categories)) {
			return `Listed defaults for ${r.categories.length} categor(y/ies).`;
		}
		return defaultToolFeedbackOutput(ctx);
	});

	registerToolFeedbackFormatter("tobyListTools", (ctx) => {
		const r = ctx.result as {
			byIntegration?: Record<string, unknown[]>;
			dryRun?: boolean;
			message?: string;
		} | null;
		if (r?.dryRun && typeof r.message === "string") {
			return sanitizeOneLine(r.message);
		}
		if (r?.byIntegration && typeof r.byIntegration === "object") {
			const integrations = Object.keys(r.byIntegration);
			const total = Object.values(r.byIntegration).reduce(
				(sum, arr) => sum + (Array.isArray(arr) ? arr.length : 0),
				0,
			);
			return `Listed ${total} tool(s) across ${integrations.length} integration(s).`;
		}
		return defaultToolFeedbackOutput(ctx);
	});

	registerToolFeedbackFormatter("tobyListSkills", (ctx) => {
		const r = ctx.result as {
			skills?: unknown[];
			dryRun?: boolean;
			message?: string;
		} | null;
		if (r?.dryRun && typeof r.message === "string") {
			return sanitizeOneLine(r.message);
		}
		if (Array.isArray(r?.skills)) {
			return r.skills.length === 0
				? "No local skills installed."
				: `Listed ${r.skills.length} skill(s).`;
		}
		return defaultToolFeedbackOutput(ctx);
	});
}

registerBuiltInToolFeedbackFormatters();
