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
			process?: import("@/types").DaemonProcessInfo;
			chatInbound: import("@/types").ChatInboundStatus;
		}>("/api/daemon/status"),
	sessions: (limit = 50) =>
		apiFetch<{ sessions: import("@/types").SessionSummary[] }>(
			`/api/sessions?limit=${limit}`,
		),
	session: (id: string) =>
		apiFetch<{
			id: string;
			name: string;
			transcript: import("@toby/core/chat-pipeline/transcript-types").TranscriptEntry[];
			messageCount: number;
			settings: import("@toby/core/api/chat-api").ChatSessionSettings;
			activePlan: import("@toby/core/api/chat-api").PlanSummary | null;
		}>(`/api/sessions/${encodeURIComponent(id)}`),
	createSession: (body: import("@toby/core/api/chat-api").CreateSessionRequest = {}) =>
		apiFetch<import("@toby/core/api/chat-api").CreateSessionResponse>(
			"/api/sessions",
			{ method: "POST", body: JSON.stringify(body) },
		),
	patchSession: (
		id: string,
		body: import("@toby/core/api/chat-api").PatchSessionRequest,
	) =>
		apiFetch<{ id: string; name: string; settings: import("@toby/core/api/chat-api").ChatSessionSettings }>(
			`/api/sessions/${encodeURIComponent(id)}`,
			{ method: "PATCH", body: JSON.stringify(body) },
		),
	personas: () =>
		apiFetch<{ personas: import("@toby/core/api/chat-api").PersonaListItem[] }>(
			"/api/personas",
		),
	modules: () =>
		apiFetch<{ modules: import("@toby/core/api/chat-api").ModuleListItem[] }>(
			"/api/modules",
		),
	memories: (q?: string) => {
		const params = new URLSearchParams();
		if (q) params.set("q", q);
		return apiFetch<{ memories: import("@/types").MemoryItem[] }>(
			`/api/memories?${params}`,
		);
	},
	memoryExplain: (id: string) =>
		apiFetch<{ explanation: import("@/types").MemoryExplanation }>(
			`/api/memories/${encodeURIComponent(id)}/explain`,
		),
	configureTree: () =>
		apiFetch<{
			tree: import("@/types").SettingsItem;
			values: Record<string, string>;
			integrationLabels: Record<string, string>;
		}>("/api/configure/tree"),
	patchConfigure: (changes: Record<string, string>) =>
		apiFetch<{
			tree: import("@/types").SettingsItem;
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
