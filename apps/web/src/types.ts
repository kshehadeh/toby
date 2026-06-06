export interface SettingsItem {
	label: string;
	kind: string;
	key: string;
	navKey?: string;
	children?: SettingsItem[];
	masked?: boolean;
	multiline?: boolean;
	options?: string[];
	selectChoices?: { value: string; label: string }[];
	currentValue?: string;
	readOnly?: boolean;
}

export interface SessionSummary {
	id: string;
	name: string;
	createdAt: string;
	updatedAt: string;
}

export interface TranscriptEntry {
	kind: string;
	text: string;
}

export interface MemoryItem {
	id: string;
	type: string;
	subject?: string;
	value: string;
	confidence: number;
	sensitivity: string;
	visibility: string;
	createdAt: string;
	updatedAt: string;
}

export interface MemoryExplanation {
	item: MemoryItem;
	sources: Array<{ id: string; system: string; label?: string }>;
	auditTrail: Array<{ action: string; at: string; reason?: string }>;
}

export type ChatInboundConnectionStatus =
	| "disabled"
	| "idle"
	| "connecting"
	| "connected"
	| "error";

export interface ChatInboundStatus {
	enabled: boolean;
	integration: string | null;
	integrationLabel: string | null;
	status: ChatInboundConnectionStatus;
	detail: string | null;
	disabledReason: string | null;
	updatedAt: string;
}
