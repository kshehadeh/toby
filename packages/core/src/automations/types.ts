import { z } from "zod";

export const eventTypes = ["macos.userReturned", "macos.didWake"] as const;
const safeInputs = z
	.record(z.string(), z.unknown())
	.refine(
		(v) =>
			!Object.keys(v).some((k) =>
				["automation", "__proto__", "constructor", "prototype"].includes(k),
			),
		"Reserved input key",
	);
const time = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/);
export const automationDraftSchema = z
	.object({
		name: z.string().trim().min(1).max(200),
		enabled: z.boolean().default(false),
		trigger: z.discriminatedUnion("type", [
			z
				.object({
					type: z.literal("macos.userReturned"),
					minimumIdleSeconds: z
						.number()
						.int()
						.min(10)
						.max(604800)
						.default(1800),
				})
				.strict(),
			z.object({ type: z.literal("macos.didWake") }).strict(),
		]),
		conditions: z
			.object({
				timezone: z.string().refine((s) => {
					try {
						new Intl.DateTimeFormat("en", { timeZone: s });
						return true;
					} catch {
						return false;
					}
				}, "Invalid timezone"),
				weekdays: z.array(z.number().int().min(0).max(6)).min(1).optional(),
				timeWindow: z
					.object({ start: time, end: time })
					.refine(
						(v) => v.start !== v.end,
						"Time window must have different start and end",
					)
					.optional(),
			})
			.strict(),
		action: z
			.object({
				type: z.literal("flow"),
				flowId: z.string().min(1),
				inputs: safeInputs.default({}),
				eventInputMappings: z
					.record(
						z.string(),
						z.enum(["id", "type", "occurredAt", "payload.idleSeconds"]),
					)
					.default({})
					.refine(
						(v) =>
							!Object.keys(v).some((k) =>
								[
									"automation",
									"__proto__",
									"constructor",
									"prototype",
								].includes(k),
							),
						"Reserved input key",
					),
			})
			.strict(),
		policy: z
			.object({
				cooldownSeconds: z.number().int().min(0).max(604800).default(300),
				oncePerDay: z.boolean().default(false),
			})
			.strict(),
		notifyOnCompletion: z.boolean().default(false),
	})
	.strict();
export type AutomationDraft = z.infer<typeof automationDraftSchema>;
export type Automation = AutomationDraft & {
	id: string;
	revision: number;
	createdAt: string;
	updatedAt: string;
};
const eventBase = {
	version: z.literal(1),
	id: z.string().max(200),
	source: z.literal("macos"),
	occurredAt: z.string().datetime(),
	observationSessionId: z.string().uuid(),
	sequence: z.number().int().positive(),
};
export const automationEventSchema = z
	.discriminatedUnion("type", [
		z
			.object({
				...eventBase,
				type: z.literal("macos.userReturned"),
				payload: z
					.object({
						idleSeconds: z.number().finite().nonnegative().max(31536000),
					})
					.strict(),
			})
			.strict(),
		z
			.object({
				...eventBase,
				type: z.literal("macos.didWake"),
				payload: z.object({}).strict(),
			})
			.strict(),
	])
	.refine(
		(e) => e.id === `${e.observationSessionId}:${e.sequence}`,
		"Invalid event identity",
	);
export type AutomationEvent = z.infer<typeof automationEventSchema>;
export type AutomationRun = {
	id: string;
	automationId: string;
	eventId: string;
	definition: Automation;
	event: AutomationEvent;
	status: string;
	reason: string | null;
	flowRunId: string | null;
	output: string | null;
	createdAt: string;
	completedAt: string | null;
};
export const automationCatalog = {
	triggers: [
		{
			type: eventTypes[0],
			name: "Return after idle",
			minimumIdleSeconds: 1800,
		},
		{ type: eventTypes[1], name: "Mac wakes" },
	],
	requiresApp: true,
	samplingSeconds: 5,
	freshnessSeconds: 120,
};
