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
	daemonStatus: () =>
		apiFetch<{ chatInbound: import("@/types").ChatInboundStatus }>(
			"/api/daemon/status",
		),
	sessions: (limit = 50) =>
		apiFetch<{ sessions: import("@/types").SessionSummary[] }>(
			`/api/sessions?limit=${limit}`,
		),
	session: (id: string) =>
		apiFetch<{
			id: string;
			name: string;
			transcript: import("@/types").TranscriptEntry[];
			messageCount: number;
		}>(`/api/sessions/${encodeURIComponent(id)}`),
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
		}>("/api/configure/tree"),
	patchConfigure: (changes: Record<string, string>) =>
		apiFetch<{
			tree: import("@/types").SettingsItem;
			values: Record<string, string>;
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
