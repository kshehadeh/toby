export type ChatInboundConnectionStatus =
	| "disabled"
	| "idle"
	| "connecting"
	| "connected"
	| "error";

export type ChatInboundStatusSnapshot = {
	readonly integration: string | null;
	readonly status: ChatInboundConnectionStatus;
	readonly detail: string | null;
	readonly updatedAt: string;
	/** Provider-neutral display name of the conversation currently being processed. */
	readonly activeConversationName: string | null;
	/** When the current active conversation started processing (ISO 8601). */
	readonly activeSince: string | null;
	readonly activeKind: "turn" | null;
};

let snapshot: ChatInboundStatusSnapshot = {
	integration: null,
	status: "disabled",
	detail: null,
	updatedAt: new Date().toISOString(),
	activeConversationName: null,
	activeSince: null,
	activeKind: null,
};

export function getChatInboundStatus(): ChatInboundStatusSnapshot {
	return snapshot;
}

export function setChatInboundStatus(
	partial: Partial<ChatInboundStatusSnapshot>,
): void {
	snapshot = {
		...snapshot,
		...partial,
		updatedAt: new Date().toISOString(),
	};
}

export function resetChatInboundStatus(): void {
	snapshot = {
		integration: null,
		status: "disabled",
		detail: null,
		updatedAt: new Date().toISOString(),
		activeConversationName: null,
		activeSince: null,
		activeKind: null,
	};
}
