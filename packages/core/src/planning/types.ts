export type PlanPhaseStatus =
	| "pending"
	| "in_progress"
	| "completed"
	| "skipped"
	| "failed";

export type PlanStatus =
	| "pending"
	| "in_progress"
	| "completed"
	| "failed"
	| "interrupted";

export type PlanPhase = {
	readonly id: string;
	readonly label: string;
	readonly description: string;
	readonly status: PlanPhaseStatus;
	readonly order: number;
	readonly addedAt: string;
};

export type Plan = {
	readonly id: string;
	readonly sessionId: string;
	readonly goal: string;
	readonly phases: PlanPhase[];
	readonly status: PlanStatus;
	readonly createdAt: string;
	readonly updatedAt: string;
};
