import type {
	ChatInboundStatus,
	DaemonProcessInfo,
	MemoryExplanation,
	MemoryItem,
	SessionSummary,
	SettingsItem,
	TranscriptEntry,
} from "@/types";
import type {
	ChatSessionSettings,
	CreateSessionRequest,
	CreateSessionResponse,
	ModuleListItem,
	PatchSessionRequest,
	PersonaListItem,
	PlanSummary,
} from "@toby/core/api/chat-api";

async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
	const res = await fetch(path, {
		...init,
		headers: {
			"Content-Type": "application/json",
			...init?.headers,
		},
	});
	if (!res.ok) {
		const body = (await res.json().catch(() => ({}))) as { error?: string };
		throw new Error(body.error ?? `Request failed (${res.status})`);
	}
	return res.json() as Promise<T>;
}

export const api = {
	health: () => apiFetch<{ ok: boolean }>("/api/health"),
	restartDaemon: () =>
		apiFetch<{ ok: boolean; restarting: boolean }>("/api/daemon/restart", {
			method: "POST",
		}),
	stopDaemon: () =>
		apiFetch<{ ok: boolean; stopping: boolean }>("/api/daemon/stop", {
			method: "POST",
		}),
	daemonStatus: () =>
		apiFetch<{
			process?: DaemonProcessInfo;
			chatInbound: ChatInboundStatus;
		}>("/api/daemon/status"),
	sessions: (limit = 50) =>
		apiFetch<{ sessions: SessionSummary[] }>(`/api/sessions?limit=${limit}`),
	session: (id: string) =>
		apiFetch<{
			id: string;
			name: string;
			transcript: TranscriptEntry[];
			messageCount: number;
			settings: ChatSessionSettings;
			activePlan: PlanSummary | null;
		}>(`/api/sessions/${encodeURIComponent(id)}`),
	createSession: (body: CreateSessionRequest = {}) =>
		apiFetch<CreateSessionResponse>("/api/sessions", {
			method: "POST",
			body: JSON.stringify(body),
		}),
	patchSession: (id: string, body: PatchSessionRequest) =>
		apiFetch<{
			id: string;
			name: string;
			settings: ChatSessionSettings;
		}>(`/api/sessions/${encodeURIComponent(id)}`, {
			method: "PATCH",
			body: JSON.stringify(body),
		}),
	personas: () => apiFetch<{ personas: PersonaListItem[] }>("/api/personas"),
	modules: () => apiFetch<{ modules: ModuleListItem[] }>("/api/modules"),
	memories: (q?: string) => {
		const params = new URLSearchParams();
		if (q) params.set("q", q);
		return apiFetch<{ memories: MemoryItem[] }>(`/api/memories?${params}`);
	},
	memoryExplain: (id: string) =>
		apiFetch<{ explanation: MemoryExplanation }>(
			`/api/memories/${encodeURIComponent(id)}/explain`,
		),
	configureTree: () =>
		apiFetch<{
			tree: SettingsItem;
			values: Record<string, string>;
			integrationLabels: Record<string, string>;
		}>("/api/configure/tree"),
	patchConfigure: (changes: Record<string, string>) =>
		apiFetch<{
			tree: SettingsItem;
			values: Record<string, string>;
			integrationLabels: Record<string, string>;
		}>("/api/configure/values", {
			method: "PATCH",
			body: JSON.stringify({ changes }),
		}),
	configureAction: (action: string, body: Record<string, string>) =>
		apiFetch<{ ok: boolean }>(`/api/configure/actions/${action}`, {
			method: "POST",
			body: JSON.stringify(body),
		}),
};
