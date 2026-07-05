export interface Schedule {
	readonly id: string;
	readonly name: string;
	readonly prompt: string;
	readonly personaName: string;
	readonly cronExpression: string;
	readonly projectId: string | null;
	readonly enabled: boolean;
	readonly lastRunAt: string | null;
	readonly createdAt: string;
	readonly updatedAt: string;
}

export type ScheduleRunStatus = "pending" | "running" | "success" | "error";

export interface ScheduleRun {
	readonly id: string;
	readonly scheduleId: string;
	readonly personaName: string;
	readonly prompt: string;
	readonly output: string | null;
	readonly transcript: string | null;
	readonly status: ScheduleRunStatus;
	readonly error: string | null;
	readonly startedAt: string;
	readonly completedAt: string | null;
}

export interface CreateScheduleParams {
	readonly name: string;
	readonly prompt: string;
	readonly personaName: string;
	readonly cronExpression: string;
	readonly projectId?: string | null;
	readonly enabled?: boolean;
}

export interface UpdateScheduleParams {
	readonly name?: string;
	readonly prompt?: string;
	readonly personaName?: string;
	readonly cronExpression?: string;
	readonly projectId?: string | null;
	readonly enabled?: boolean;
}
