import type { LanguageModelUsage } from "ai";
import type { AIContextWindowInfo } from "../ai/context-window";
import type { ChatAttachmentCapability } from "../ai/model-capabilities";
import type { ChatAttachment } from "../chat-pipeline/attachments";
import type { ChatEvent } from "../chat-pipeline/chat-events";
import type { TranscriptEntry } from "../chat-pipeline/transcript-types";
import type { Plan, PlanPhaseStatus } from "../planning/types";

/** Per-session settings persisted in SQLite and honored by the turn runtime. */
export type ChatSessionSettings = {
	readonly persona?: string;
	readonly modules?: readonly string[];
	readonly dryRun?: boolean;
	readonly debug?: boolean;
	readonly projectId?: string;
};

export type CreateSessionRequest = {
	readonly name?: string;
	readonly persona?: string;
	readonly modules?: readonly string[];
	readonly dryRun?: boolean;
	readonly debug?: boolean;
	readonly projectId?: string;
	/** Run assemble-only pipeline to seed system messages (no model call). */
	readonly bootstrap?: boolean;
};

export type CreateSessionResponse = {
	readonly id: string;
	readonly name: string;
	readonly settings: ChatSessionSettings;
};

export type SessionSummary = {
	readonly id: string;
	readonly name: string;
	readonly createdAt: string;
	readonly updatedAt: string;
};

export type SessionDetailResponse = {
	readonly id: string;
	readonly name: string;
	readonly transcript: readonly TranscriptEntry[];
	readonly messageCount: number;
	readonly settings: ChatSessionSettings;
	readonly contextWindow?: AIContextWindowInfo;
	readonly activePlan: PlanSummary | null;
	readonly integration?: string | null;
	readonly externalKey?: string | null;
};

export type PlanSummary = {
	readonly id: string;
	readonly goal: string;
	readonly status: Plan["status"];
	readonly phases: readonly {
		readonly id: string;
		readonly label: string;
		readonly status: PlanPhaseStatus;
	}[];
};

export type PatchSessionRequest = Partial<{
	readonly name: string;
	readonly persona: string;
	readonly modules: readonly string[];
	readonly dryRun: boolean;
	readonly debug: boolean;
	readonly projectId: string;
}>;

export type TurnRequestBody = {
	readonly text: string;
	readonly attachments?: readonly ChatAttachment[];
	readonly persona?: string;
	readonly modules?: readonly string[];
	readonly dryRun?: boolean;
	/** Client idempotency / correlation (optional). */
	readonly clientTurnId?: string;
	/** Submit while another turn is active; cancels in-flight turn first. */
	readonly steering?: boolean;
	/** First-turn plan generation (multi-step prompts). */
	readonly generatePlan?: boolean;
	readonly projectId?: string;
	/** Allow attachments to be preserved by a project-only tool, even when the model cannot read them. */
	readonly saveAttachmentsToProject?: boolean;
};

export type TurnDonePayload = {
	readonly turnId: string;
	readonly text: string;
	readonly appliedActions: readonly string[];
	readonly sessionName?: string;
	readonly usage?: LanguageModelUsage;
	readonly contextWindow?: AIContextWindowInfo;
	readonly warnings?: readonly string[];
};

export type TurnErrorPayload = {
	readonly turnId?: string;
	readonly error: string;
};

export type AskUserPromptPayload = {
	readonly requestId: string;
	readonly query: string;
	readonly options: readonly string[];
};

export type AskUserAnswerRequest = {
	readonly selectedIndex: number;
	readonly selectedLabel: string;
	readonly rawInput?: string;
	readonly error?: string;
};

export type AskUserAnswerResponse = {
	readonly ok: boolean;
};

export type CancelTurnResponse = {
	readonly ok: boolean;
	readonly cancelled: boolean;
};

export type ChatStatusResponse = {
	readonly version: string;
	readonly persona: string;
	readonly model: string;
	readonly hasConfiguredAIProvider: boolean;
	readonly tobyDir: string;
	readonly contextWindow?: AIContextWindowInfo;
	readonly attachmentCapability: ChatAttachmentCapability;
	readonly connectedIntegrations: readonly string[];
	readonly personaCount: number;
	readonly skillCount: number;
};

export type ListenApiStatus =
	| "idle"
	| "starting"
	| "recording"
	| "stopping"
	| "error";

export type ListenStatusResponse = {
	readonly status: ListenApiStatus;
	readonly session?: {
		readonly id: string;
		readonly startedAt: string;
		readonly sources: {
			readonly mic: boolean;
			readonly system: boolean;
		};
	};
	readonly outputDir?: string;
	readonly message?: string;
	readonly error?: string;
};

export type ListenStartResponse = ListenStatusResponse;

export type ListenStopRequest = Record<string, never>;

export type ListenStopResponse = ListenStatusResponse & {
	readonly outputDir?: string;
	readonly transcript?: string;
	readonly transcriptionError?: string;
};

export type ListenRecordingSummaryResponse = {
	readonly id: string;
	readonly dir: string;
	readonly name?: string;
	readonly description?: string;
	readonly createdAt: string;
	readonly startedAt: string;
	readonly stoppedAt?: string;
	readonly durationMs?: number;
	readonly sources: {
		readonly mic: boolean;
		readonly system: boolean;
	};
	readonly hasAudio: boolean;
	readonly hasTranscript: boolean;
};

export type ListenRecordingsListResponse = {
	readonly recordings: readonly ListenRecordingSummaryResponse[];
};

export type PersonaListItem = {
	readonly name: string;
	readonly label: string;
	readonly imagePath?: string;
	readonly imageUrl?: string;
};

export type ModuleListItem = {
	readonly name: string;
	readonly displayName: string;
	readonly connected: boolean;
};

export type SkillListItem = {
	readonly name: string;
	readonly description: string;
};

export type SessionUsageResponse = {
	readonly sessionId: string;
	readonly inputTokens: number;
	readonly outputTokens: number;
	readonly cacheReadTokens: number;
	readonly cacheWriteTokens: number;
};

export type PlanSkipRequest = {
	readonly planId: string;
	readonly phaseId: string;
};

export type PlanCancelRequest = {
	readonly planId: string;
};

/** Named SSE terminal events (in addition to default `data:` ChatEvent lines). */
export type ChatSseTerminalEvent = "done" | "error" | "ask_user_prompt";

export type { ChatEvent, TranscriptEntry };
