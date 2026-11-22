import { z } from "zod";

export const FOLLOWUP_KINDS = [
	"owe_reply",
	"awaiting_reply",
	"commitment",
] as const;
export type FollowupKind = (typeof FOLLOWUP_KINDS)[number];
export type FollowupStatus = "open" | "resolved" | "dismissed" | "expired";

export interface FollowupLoop {
	readonly loopId: string;
	readonly kind: FollowupKind;
	readonly status: FollowupStatus;
	readonly fingerprint: string;
	readonly title: string;
	readonly counterpart?: string;
	readonly dueAt?: string;
	readonly confidence: number;
	readonly todoId?: string;
	readonly resolutionRejected: boolean;
	readonly reopenedAt?: string;
	readonly lastEvaluatedHash?: string;
	readonly lastActivityAt: string;
	readonly createdAt: string;
	readonly updatedAt: string;
}

export interface FollowupUnit {
	readonly unitId: string;
	readonly hash: string;
	readonly evidenceHash: string;
	readonly nodeIds: readonly string[];
	readonly loopIds: readonly string[];
	readonly waitingReplyEligible: boolean;
	readonly promptContext: string;
	readonly sourceText: string;
	readonly evaluatedAt: string;
}

export const followupEvaluationSchema = z.object({
	units: z.array(
		z.object({
			unitId: z.string(),
			open: z.array(
				z.object({
					kind: z.enum(FOLLOWUP_KINDS),
					title: z.string().trim().min(1).max(200),
					counterpart: z.string().max(200).optional(),
					due: z.string().datetime({ offset: true }).optional(),
					confidence: z.number().min(0).max(1),
					evidenceIds: z.array(z.string()).min(1).max(5),
				}),
			),
			close: z.array(
				z.object({
					loopId: z.string(),
					confidence: z.number().min(0).max(1),
					evidenceId: z.string(),
					reason: z.string().trim().min(1).max(500),
				}),
			),
		}),
	),
});

export type FollowupEvaluation = z.infer<typeof followupEvaluationSchema>;
