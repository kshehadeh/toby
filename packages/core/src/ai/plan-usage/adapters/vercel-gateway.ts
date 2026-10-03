import { resolveVercelGatewayAuthToken } from "../credentials";
import { periodUsageFields } from "../format";
import type { AIProviderPlanUsage, PlanUsageAdapter } from "../types";

const CREDITS_URL = "https://ai-gateway.vercel.sh/v1/credits";
const REPORT_URL = "https://ai-gateway.vercel.sh/v1/report";

function parseUsdAmount(value: unknown): number | undefined {
	if (typeof value === "number" && Number.isFinite(value)) {
		return value;
	}
	if (typeof value === "string" && value.trim()) {
		const parsed = Number.parseFloat(value);
		return Number.isFinite(parsed) ? parsed : undefined;
	}
	return undefined;
}

function formatUsd(amount: number): string {
	return `$${amount.toFixed(2)}`;
}

function utcIsoDate(date: Date): string {
	return date.toISOString().slice(0, 10);
}

function shiftUtcDays(iso: string, days: number): string {
	const [year, month, day] = iso.split("-").map(Number);
	const date = new Date(Date.UTC(year, month - 1, day));
	date.setUTCDate(date.getUTCDate() + days);
	return utcIsoDate(date);
}

/** Monday of the UTC week that contains `iso` (`YYYY-MM-DD`). */
export function utcWeekStartMonday(iso: string): string {
	const [year, month, day] = iso.split("-").map(Number);
	const weekday = new Date(Date.UTC(year, month - 1, day)).getUTCDay();
	const sinceMonday = weekday === 0 ? 6 : weekday - 1;
	return shiftUtcDays(iso, -sinceMonday);
}

/**
 * Inclusive UTC range covering the current month and any earlier days of the
 * current week, so a week that starts last month still sums completely.
 */
export function gatewayReportWindow(todayIso: string): {
	start: string;
	end: string;
} {
	const monthStart = `${todayIso.slice(0, 8)}01`;
	const weekStart = utcWeekStartMonday(todayIso);
	return {
		start: weekStart < monthStart ? weekStart : monthStart,
		end: todayIso,
	};
}

export type GatewaySpendRow = {
	day?: unknown;
	total_cost?: unknown;
};

/**
 * Sum day-grouped report rows into today, this UTC week, and this UTC month.
 * A window with no rows stays undefined so the UI can show a dash. A row whose
 * cost is zero is reported spend, not a missing value.
 */
export function sumGatewaySpendByPeriod(
	rows: readonly GatewaySpendRow[],
	todayIso: string,
): { daily?: number; weekly?: number; monthly?: number } {
	const weekStart = utcWeekStartMonday(todayIso);
	const monthStart = `${todayIso.slice(0, 8)}01`;
	let daily: number | undefined;
	let weekly: number | undefined;
	let monthly: number | undefined;

	const add = (current: number | undefined, cost: number) =>
		(current ?? 0) + cost;

	for (const row of rows) {
		if (typeof row.day !== "string") continue;
		const cost = parseUsdAmount(row.total_cost);
		if (cost === undefined) continue;
		if (row.day === todayIso) daily = add(daily, cost);
		if (row.day >= weekStart && row.day <= todayIso) weekly = add(weekly, cost);
		if (row.day >= monthStart && row.day <= todayIso) {
			monthly = add(monthly, cost);
		}
	}

	return { daily, weekly, monthly };
}

async function fetchGatewayPeriodSpend(
	token: string,
	todayIso: string,
): Promise<{ daily?: number; weekly?: number; monthly?: number } | undefined> {
	const window = gatewayReportWindow(todayIso);
	const url = new URL(REPORT_URL);
	url.searchParams.set("start_date", window.start);
	url.searchParams.set("end_date", window.end);
	url.searchParams.set("group_by", "day");

	let response: Response;
	try {
		response = await fetch(url, {
			method: "GET",
			headers: {
				Authorization: `Bearer ${token}`,
				"Content-Type": "application/json",
			},
		});
	} catch {
		return undefined;
	}

	if (!response.ok) {
		return undefined;
	}

	try {
		const body = (await response.json()) as { results?: unknown };
		if (!Array.isArray(body.results)) {
			return undefined;
		}
		return sumGatewaySpendByPeriod(body.results, todayIso);
	} catch {
		return undefined;
	}
}

export const vercelGatewayPlanUsageAdapter: PlanUsageAdapter = {
	providerId: "vercel",

	async fetchPlanUsage(): Promise<AIProviderPlanUsage> {
		const fetchedAt = new Date().toISOString();
		const token = resolveVercelGatewayAuthToken();
		if (!token) {
			return {
				providerId: "vercel",
				supported: true,
				unavailableReason:
					"Vercel AI Gateway API key not configured. Run `toby configure` to set it, or set AI_GATEWAY_API_KEY.",
				totalSpentLabel: "N/A",
				remainingLabel: "N/A",
				fetchedAt,
			};
		}

		let response: Response;
		try {
			response = await fetch(CREDITS_URL, {
				method: "GET",
				headers: {
					Authorization: `Bearer ${token}`,
					"Content-Type": "application/json",
				},
			});
		} catch (error) {
			const msg = error instanceof Error ? error.message : String(error);
			return {
				providerId: "vercel",
				supported: true,
				unavailableReason: `Failed to reach Vercel AI Gateway credits API: ${msg}`,
				totalSpentLabel: "N/A",
				remainingLabel: "N/A",
				fetchedAt,
			};
		}

		if (!response.ok) {
			let detail = response.statusText;
			try {
				const body = (await response.json()) as {
					error?: { message?: string };
				};
				if (body.error?.message) {
					detail = body.error.message;
				}
			} catch {
				// ignore parse errors
			}
			return {
				providerId: "vercel",
				supported: true,
				unavailableReason: `Vercel AI Gateway credits API returned ${response.status}: ${detail}`,
				totalSpentLabel: "N/A",
				remainingLabel: "N/A",
				fetchedAt,
			};
		}

		const body = (await response.json()) as {
			balance?: unknown;
			total_used?: unknown;
		};

		const remaining = parseUsdAmount(body.balance);
		const totalSpent = parseUsdAmount(body.total_used);
		const todayIso = utcIsoDate(new Date());
		const periods = await fetchGatewayPeriodSpend(token, todayIso);

		return {
			providerId: "vercel",
			supported: true,
			currency: "USD",
			remaining,
			totalSpent,
			totalSpentLabel: totalSpent !== undefined ? formatUsd(totalSpent) : "N/A",
			remainingLabel: remaining !== undefined ? formatUsd(remaining) : "N/A",
			...(periods
				? periodUsageFields({
						daily: periods.daily,
						weekly: periods.weekly,
						monthly: periods.monthly,
					})
				: {}),
			fetchedAt,
		};
	},
};
