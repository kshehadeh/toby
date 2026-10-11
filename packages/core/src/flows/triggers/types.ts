import { Cron } from "croner";
import { z } from "zod";
import { nativeRuleSchema } from "./native-types";

const fields = nativeRuleSchema.shape;
export const flowTriggerSchema = z
	.object({
		id: z
			.string()
			.regex(/^[a-zA-Z0-9_-]+$/)
			.max(100),
		name: z.string().trim().min(1).max(200),
		enabled: z.boolean().default(false),
		source: z.union([
			z.object({ type: z.literal("manual") }).strict(),
			z.object({ type: z.literal("home.action") }).strict(),
			// Home owns cache invalidation and execution for built-in summaries.
			z
				.object({ type: z.literal("dashboard.refresh") })
				.strict(),
			z
				.object({
					type: z.literal("schedule"),
					cron: z.string().refine((value) => {
						try {
							new Cron(value);
							return true;
						} catch {
							return false;
						}
					}, "Invalid cron expression"),
					missedRuns: z.enum(["skip", "latest"]).default("latest"),
				})
				.strict(),
			fields.trigger,
		]),
		conditions: fields.conditions,
		policy: fields.policy,
		inputs: fields.action.shape.inputs.refine(
			(v) => !Object.hasOwn(v, "trigger"),
			"Reserved trigger input",
		),
		eventInputMappings: fields.action.shape.eventInputMappings.refine(
			(v) => !Object.hasOwn(v, "trigger"),
			"Reserved trigger input",
		),
		notifyOnCompletion: fields.notifyOnCompletion,
	})
	.strict()
	.superRefine((value, ctx) => {
		for (const path of Object.values(value.eventInputMappings)) {
			if (
				(path === "payload.idleSeconds" &&
					value.source.type !== "macos.userReturned") ||
				((path === "payload.folder" || path === "payload.changes") &&
					value.source.type !== "macos.fileChanges")
			) {
				ctx.addIssue({
					code: "custom",
					message: `Trigger has no ${path} field`,
				});
			}
		}
	});
export type FlowTrigger = z.infer<typeof flowTriggerSchema>;
export const manualTrigger = (): FlowTrigger => ({
	id: "manual",
	name: "Manually",
	enabled: true,
	source: { type: "manual" },
	conditions: { timezone: Intl.DateTimeFormat().resolvedOptions().timeZone },
	policy: { cooldownSeconds: 0, oncePerDay: false },
	inputs: {},
	eventInputMappings: {},
	notifyOnCompletion: false,
});
export const homeActionTrigger = (id = "home-action"): FlowTrigger => ({
	...manualTrigger(),
	id,
	name: "Home Screen Action",
	source: { type: "home.action" },
});
export const dashboardRefreshTrigger = (): FlowTrigger => ({
	...manualTrigger(),
	id: "dashboard-refresh",
	name: "Home refresh",
	source: { type: "dashboard.refresh" },
});
export function isUserInvokedTrigger(type: string): boolean {
	return type === "manual" || type === "home.action";
}
export function parseFlowTriggers(value: unknown): FlowTrigger[] {
	const triggers = z
		.array(flowTriggerSchema)
		.max(32)
		.parse(value ?? [manualTrigger()]);
	if (new Set(triggers.map((t) => t.id)).size !== triggers.length)
		throw new Error("Trigger IDs must be unique within a flow");
	return triggers;
}
