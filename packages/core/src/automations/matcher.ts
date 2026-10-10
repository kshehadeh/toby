import { getByPath } from "../flows/resolve-inputs";
import type { Automation, AutomationEvent } from "./types";

export function localParts(date: Date, timezone: string) {
	const parts = new Intl.DateTimeFormat("en-US", {
		timeZone: timezone,
		year: "numeric",
		month: "2-digit",
		day: "2-digit",
		weekday: "short",
		hour: "2-digit",
		minute: "2-digit",
		hourCycle: "h23",
	}).formatToParts(date);
	const get = (key: string) => parts.find((p) => p.type === key)?.value ?? "";
	return {
		day: `${get("year")}-${get("month")}-${get("day")}`,
		weekday: ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(
			get("weekday"),
		),
		time: `${get("hour")}:${get("minute")}`,
	};
}
export function matchReason(
	a: Automation,
	e: AutomationEvent,
	now: Date,
	state: { lastClaimAt?: string | null; claimedDay?: string | null } = {},
): string | null {
	if (!a.enabled) return "disabled";
	if (a.trigger.type !== e.type) return "trigger_mismatch";
	if (
		e.type === "macos.fileChanges" &&
		e.payload.watchId !== `${a.id}:${a.revision}`
	)
		return "watch_mismatch";
	const age = now.getTime() - Date.parse(e.occurredAt);
	if (age > 120000 || age < -5000) return "stale_event";
	if (
		a.trigger.type === "macos.userReturned" &&
		e.type === "macos.userReturned" &&
		e.payload.idleSeconds < a.trigger.minimumIdleSeconds
	)
		return "idle_threshold";
	const local = localParts(new Date(e.occurredAt), a.conditions.timezone);
	if (a.conditions.weekdays && !a.conditions.weekdays.includes(local.weekday))
		return "weekday";
	const window = a.conditions.timeWindow;
	if (
		window &&
		!(window.start < window.end
			? local.time >= window.start && local.time < window.end
			: local.time >= window.start || local.time < window.end)
	)
		return "time_window";
	if (
		a.policy.oncePerDay &&
		state.claimedDay === localParts(now, a.conditions.timezone).day
	)
		return "daily_limit";
	if (
		state.lastClaimAt &&
		now.getTime() - Date.parse(state.lastClaimAt) <
			a.policy.cooldownSeconds * 1000
	)
		return "cooldown";
	return null;
}
export function automationInputs(
	a: Automation,
	e: AutomationEvent,
	runId: string,
) {
	const inputs: Record<string, unknown> = { ...a.action.inputs };
	for (const [key, path] of Object.entries(a.action.eventInputMappings)) {
		const value = getByPath(e, path);
		if (value === undefined) throw new Error(`Event has no field ${path}`);
		inputs[key] = value;
	}
	inputs.automation = { id: a.id, runId, event: e };
	return inputs;
}
