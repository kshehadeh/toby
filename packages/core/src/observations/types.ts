import { z } from "zod";

/**
 * Standard tool any plugin can tag to feed the observation ledger.
 *
 * Input: {@link ActivityRecentInput}. Output: {@link ActivityRecentResult}
 * in the `result` field of `tools execute`. The core calls every connected
 * plugin that tags a tool with this id (not just the default provider).
 */
export const ACTIVITY_RECENT_STANDARD_TOOL = "activity.recent";

export const EXCERPT_MAX_BYTES = 2000;

export const observationActorSchema = z.object({
	role: z.enum([
		"from",
		"to",
		"cc",
		"attendee",
		"organizer",
		"mentioned",
		"author",
	]),
	name: z.string().max(200).optional(),
	/** Email address when known; used as the stable person key. */
	email: z.string().max(320).optional(),
	/** Provider user id (e.g. Slack `U123`) when there is no email. */
	handle: z.string().max(200).optional(),
	/** Provider workspace/team id that scopes `handle`. */
	scope: z.string().max(200).optional(),
});

export const observationInputSchema = z.object({
	/** Stable within the source (message id, event id, …). */
	externalId: z.string().min(1).max(500),
	/** e.g. email.message, calendar.event, chat.message; plugins may add `<category>.<thing>`. */
	kind: z
		.string()
		.regex(/^[a-z][a-z0-9_]*\.[a-z][a-z0-9_]*$/)
		.max(80),
	/** Conversation the item belongs to (email thread root, chat thread, …). */
	threadId: z.string().max(500).optional(),
	/** From the user's point of view. */
	direction: z.enum(["inbound", "outbound"]).optional(),
	occurredAt: z.string().datetime({ offset: true }),
	title: z.string().max(1000),
	excerpt: z.string().optional(),
	url: z.string().max(2000).optional(),
	actors: z.array(observationActorSchema).max(100).default([]),
	/** Small typed facts (bulk, direct, allDay, …) for pre-filters. */
	facts: z
		.record(z.union([z.string().max(500), z.number(), z.boolean()]))
		.optional(),
});

export const activityRecentResultSchema = z.object({
	observations: z.array(observationInputSchema).max(1000),
	/** The user's own identities on this source, so direction and "direct" can be judged. */
	self: z
		.object({
			emails: z.array(z.string()).max(50).optional(),
			handles: z.array(z.string()).max(50).optional(),
		})
		.optional(),
});

export type ObservationActor = z.infer<typeof observationActorSchema>;
export type ObservationInput = z.infer<typeof observationInputSchema>;
export type ActivityRecentResult = z.infer<typeof activityRecentResultSchema>;

export interface ActivityRecentInput {
	/** ISO 8601; return items that occurred at or after this time. */
	readonly since: string;
	readonly limit?: number;
}

export interface Observation extends Omit<ObservationInput, "facts"> {
	readonly id: string;
	/** Graph node id for this observation. */
	readonly nodeId: string;
	readonly sourceId: string;
	readonly threadKey?: string;
	readonly contentHash: string;
	readonly ingestedAt: string;
	readonly facts: Record<string, string | number | boolean>;
}
