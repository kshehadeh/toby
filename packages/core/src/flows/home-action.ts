import type { FlowDestination, FlowDocument } from "./document-types";
import {
	dashboardRefreshTrigger,
	homeActionTrigger,
	parseFlowTriggers,
} from "./triggers/types";

/** Keep the Home entry point and its Actions placement as one configuration. */
export function normalizeHomeActionFlow(document: FlowDocument): FlowDocument {
	const triggers = parseFlowTriggers(document.triggers);
	const destinations = [...(document.destinations ?? [])];
	const homeIndex = destinations.findIndex((d) => d.type === "dashboard");
	const hasHomeTrigger = triggers.some((t) => t.source.type === "home.action");
	const hasRefreshTrigger = triggers.some(
		(t) => t.source.type === "dashboard.refresh",
	);
	if (hasHomeTrigger && hasRefreshTrigger)
		throw new Error(
			"Choose either Home Screen Action or Home refresh for this flow",
		);
	const home = destinations[homeIndex];
	if (hasHomeTrigger) {
		const destination: FlowDestination = {
			type: "dashboard",
			variant: "runner",
			...(home?.type === "dashboard" && home.color
				? { color: home.color }
				: {}),
		};
		if (homeIndex < 0) destinations.push(destination);
		else destinations[homeIndex] = destination;
	} else if (hasRefreshTrigger) {
		const destination: FlowDestination = {
			type: "dashboard",
			variant: "informational",
			...(home?.type === "dashboard"
				? { color: home.color, refresh: home.refresh }
				: {}),
		};
		if (homeIndex < 0) destinations.push(destination);
		else destinations[homeIndex] = destination;
	} else if (home?.type === "dashboard" && home.variant === "runner") {
		let id = "home-action";
		let suffix = 2;
		while (triggers.some((trigger) => trigger.id === id))
			id = `home-action-${suffix++}`;
		triggers.push(homeActionTrigger(id));
	} else if (home?.type === "dashboard") {
		const trigger = dashboardRefreshTrigger();
		let suffix = 2;
		while (triggers.some((t) => t.id === trigger.id))
			trigger.id = `dashboard-refresh-${suffix++}`;
		triggers.push(trigger);
	}
	return {
		...document,
		triggers: parseFlowTriggers(triggers),
		...(document.destinations !== undefined ||
		hasHomeTrigger ||
		hasRefreshTrigger
			? { destinations }
			: {}),
	};
}
