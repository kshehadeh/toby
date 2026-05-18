import { generateText } from "ai";
import { Cron } from "croner";
import { createModelForAuxiliary } from "../ai/model-factory";

const NL_TO_CRON_MODEL = "gpt-4.1-mini";

const NL_TO_CRON_SYSTEM = `You convert natural language schedule descriptions into standard 5-field cron expressions (minute hour day-of-month month day-of-week).

Rules:
- Return ONLY the cron expression, nothing else. No explanation, no backticks, no quotes.
- Use 24-hour time (0-23 for hours).
- Common examples:
  - "every weekday at 9am" → 0 9 * * 1-5
  - "every hour on mondays only" → 0 * * * 1
  - "every 15 minutes" → */15 * * * *
  - "twice a day at 9am and 5pm" → 0 9,17 * * *
  - "first of every month at noon" → 0 12 1 * *
  - "every weekday at 8:30am" → 30 8 * * 1-5
  - "every 6 hours" → 0 */6 * * *
  - "every monday wednesday friday at 10am" → 0 10 * * 1,3,5`;

export async function naturalLanguageToCron(input: string): Promise<string> {
	const model = createModelForAuxiliary({ modelId: NL_TO_CRON_MODEL });
	const result = await generateText({
		model,
		system: NL_TO_CRON_SYSTEM,
		prompt: input.trim(),
		maxOutputTokens: 20,
		temperature: 0,
	});

	const candidate = result.text.trim().split(/\s+/).slice(0, 5).join(" ");
	if (isValidCronExpression(candidate)) {
		return candidate;
	}

	throw new Error(
		`AI returned an invalid cron expression "${candidate}" for "${input}". Try rephrasing or use a standard cron expression like "0 9 * * *".`,
	);
}

export function isValidCronExpression(expression: string): boolean {
	try {
		new Cron(expression);
		return true;
	} catch {
		return false;
	}
}

export function getNextRunTime(
	cronExpression: string,
	after?: Date,
): Date | null {
	try {
		const cron = new Cron(cronExpression);
		const next = cron.nextRun(after ?? new Date());
		return next ?? null;
	} catch {
		return null;
	}
}

export function shouldRun(
	cronExpression: string,
	lastRunAt: string | null,
): boolean {
	try {
		const now = new Date();
		const cron = new Cron(cronExpression);
		const lastRun = lastRunAt ? new Date(lastRunAt) : null;

		const previousRuns = cron.previousRuns(1, now);
		const previousRun = previousRuns[0] ?? null;
		if (!previousRun) {
			return lastRunAt === null;
		}

		if (!lastRun) {
			return true;
		}

		return previousRun.getTime() > lastRun.getTime();
	} catch {
		return false;
	}
}

interface HumanReadablePattern {
	readonly pattern: RegExp;
	readonly toCron: (match: RegExpMatchArray) => string;
	readonly label: string;
}

const PATTERNS: HumanReadablePattern[] = [
	{
		pattern: /^every\s+weekday\s+at\s+(\d{1,2})(?::(\d{2}))?\s*(am|pm)?$/i,
		toCron: (m) => {
			const hour = parseHour(m[1], m[3]);
			const minute = m[2] ? Number.parseInt(m[2], 10) : 0;
			return `${minute} ${hour} * * 1-5`;
		},
		label: "every weekday at HH:MM",
	},
	{
		pattern: /^every\s+day\s+at\s+(\d{1,2})(?::(\d{2}))?\s*(am|pm)?$/i,
		toCron: (m) => {
			const hour = parseHour(m[1], m[3]);
			const minute = m[2] ? Number.parseInt(m[2], 10) : 0;
			return `${minute} ${hour} * * *`;
		},
		label: "every day at HH:MM",
	},
	{
		pattern: /^every\s+(\d+)\s*(min(?:ute)?s?|h(?:ou)?r?s?)$/i,
		toCron: (m) => {
			const n = Number.parseInt(m[1], 10);
			const unit = m[2].toLowerCase();
			if (unit.startsWith("min")) {
				return `*/${n} * * * *`;
			}
			return `0 */${n} * * *`;
		},
		label: "every N minutes/hours",
	},
	{
		pattern: /^every\s+hour$/i,
		toCron: () => "0 * * * *",
		label: "every hour",
	},
	{
		pattern: /^every\s+minute$/i,
		toCron: () => "* * * * *",
		label: "every minute",
	},
	{
		pattern: /^hourly$/i,
		toCron: () => "0 * * * *",
		label: "hourly",
	},
	{
		pattern: /^daily$/i,
		toCron: () => "0 9 * * *",
		label: "daily (9am)",
	},
	{
		pattern: /^weekly$/i,
		toCron: () => "0 9 * * 1",
		label: "weekly (Monday 9am)",
	},
	{
		pattern: /^monthly$/i,
		toCron: () => "0 9 1 * *",
		label: "monthly (1st 9am)",
	},
];

function parseHour(raw: string, ampm?: string | null): number {
	let hour = Number.parseInt(raw, 10);
	if (ampm) {
		const lower = ampm.toLowerCase();
		if (lower === "pm" && hour < 12) {
			hour += 12;
		} else if (lower === "am" && hour === 12) {
			hour = 0;
		}
	}
	return hour;
}

export function humanToCron(input: string): string {
	const trimmed = input.trim();

	if (isValidCronExpression(trimmed)) {
		return trimmed;
	}

	for (const { pattern, toCron } of PATTERNS) {
		const match = trimmed.match(pattern);
		if (match) {
			return toCron(match);
		}
	}

	throw new Error(
		`Unrecognized schedule expression: "${input}". Use a cron expression (e.g. "0 9 * * *") or natural language (e.g. "every weekday at 9am", "every hour on mondays only").`,
	);
}

export async function humanToCronAsync(input: string): Promise<string> {
	const trimmed = input.trim();

	if (isValidCronExpression(trimmed)) {
		return trimmed;
	}

	for (const { pattern, toCron } of PATTERNS) {
		const match = trimmed.match(pattern);
		if (match) {
			return toCron(match);
		}
	}

	return naturalLanguageToCron(trimmed);
}

export function cronToHuman(cronExpression: string): string {
	const common: Record<string, string> = {
		"* * * * *": "every minute",
		"*/5 * * * *": "every 5 minutes",
		"*/15 * * * *": "every 15 minutes",
		"*/30 * * * *": "every 30 minutes",
		"0 * * * *": "every hour",
		"0 */2 * * *": "every 2 hours",
		"0 */6 * * *": "every 6 hours",
		"0 9 * * *": "every day at 9am",
		"0 9 * * 1-5": "every weekday at 9am",
		"0 9 * * 1": "every Monday at 9am",
		"0 9 1 * *": "monthly on the 1st at 9am",
	};

	const human = common[cronExpression.trim()];
	if (human) {
		return human;
	}

	try {
		const cron = new Cron(cronExpression);
		const next = cron.nextRun();
		if (next) {
			return `${cronExpression} (next: ${next.toLocaleString()})`;
		}
	} catch {
		// fall through
	}

	return cronExpression;
}
