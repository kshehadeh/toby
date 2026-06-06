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
};

let snapshot: ChatInboundStatusSnapshot = {
	integration: null,
	status: "disabled",
	detail: null,
	updatedAt: new Date().toISOString(),
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
	};
}
