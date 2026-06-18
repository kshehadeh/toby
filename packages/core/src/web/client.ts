import type {
	AskUserAnswerRequest,
	AskUserPromptPayload,
	ChatStatusResponse,
	CreateSessionRequest,
	CreateSessionResponse,
	PatchSessionRequest,
	SessionDetailResponse,
	SessionSummary,
	TurnDonePayload,
	TurnRequestBody,
} from "../api/chat-api";
import type { ChatEvent } from "../chat-pipeline/chat-events";
import type { CreateIssueInput, CreateIssueResult } from "../issues/github";
import type { ServerEventLog } from "./server-event-log";

export type TobyClientOptions = {
	readonly baseUrl: string;
	readonly fetch?: typeof fetch;
	readonly eventLog?: ServerEventLog;
};

export type StreamTurnOptions = TurnRequestBody & {
	readonly sessionId: string;
	readonly onEvent: (event: ChatEvent) => void;
	readonly onAskUser?: (
		prompt: AskUserPromptPayload & { turnId: string },
	) => Promise<AskUserAnswerRequest>;
	readonly signal?: AbortSignal;
};

export class TobyDaemonClient {
	private readonly baseUrl: string;
	private readonly fetchFn: typeof fetch;
	private readonly eventLog: ServerEventLog | null;

	constructor(options: TobyClientOptions) {
		this.baseUrl = options.baseUrl.replace(/\/+$/, "");
		this.fetchFn = options.fetch ?? fetch;
		this.eventLog = options.eventLog ?? null;
	}

	private url(path: string): string {
		return `${this.baseUrl}${path.startsWith("/") ? path : `/${path}`}`;
	}

	private async json<T>(path: string, init?: RequestInit): Promise<T> {
		const url = this.url(path);
		const method = init?.method ?? "GET";
		const body = typeof init?.body === "string" ? init.body : undefined;
		this.eventLog?.logRequest(method, url, body);
		const res = await this.fetchFn(url, {
			...init,
			headers: {
				"Content-Type": "application/json",
				...init?.headers,
			},
		});
		this.eventLog?.logResponseStatus(res.status);
		if (!res.ok) {
			const errText = await res.text().catch(() => "");
			this.eventLog?.logResponseError(errText);
			let message = `HTTP ${res.status}`;
			try {
				const bodyJson = JSON.parse(errText) as { error?: string };
				if (bodyJson.error) {
					message = bodyJson.error;
				}
			} catch {
				// ignore
			}
			throw new Error(message);
		}
		return res.json() as Promise<T>;
	}

	async fetchStatus(): Promise<ChatStatusResponse> {
		return this.json<ChatStatusResponse>("/api/status");
	}

	async createIssue(input: CreateIssueInput): Promise<CreateIssueResult> {
		return this.json<CreateIssueResult>("/api/issues", {
			method: "POST",
			body: JSON.stringify(input),
		});
	}

	async listSessions(limit = 20): Promise<SessionSummary[]> {
		const payload = await this.json<{ sessions: SessionSummary[] }>(
			`/api/sessions?limit=${limit}`,
		);
		return payload.sessions;
	}

	async fetchSession(sessionId: string): Promise<SessionDetailResponse> {
		return this.json<SessionDetailResponse>(
			`/api/sessions/${encodeURIComponent(sessionId)}`,
		);
	}

	async createSession(
		body: CreateSessionRequest = {},
	): Promise<CreateSessionResponse> {
		return this.json<CreateSessionResponse>("/api/sessions", {
			method: "POST",
			body: JSON.stringify(body),
		});
	}

	async patchSession(
		sessionId: string,
		body: PatchSessionRequest,
	): Promise<{
		id: string;
		name: string;
		settings: CreateSessionResponse["settings"];
	}> {
		return this.json(`/api/sessions/${encodeURIComponent(sessionId)}`, {
			method: "PATCH",
			body: JSON.stringify(body),
		});
	}

	async deleteSession(sessionId: string): Promise<void> {
		await this.json(`/api/sessions/${encodeURIComponent(sessionId)}`, {
			method: "DELETE",
		});
	}

	async bootstrapSession(
		sessionId: string,
		body: { initialText?: string } = {},
	): Promise<{ messageCount: number }> {
		return this.json(
			`/api/sessions/${encodeURIComponent(sessionId)}/bootstrap`,
			{
				method: "POST",
				body: JSON.stringify(body),
			},
		);
	}

	async cancelTurn(sessionId: string, turnId: string): Promise<void> {
		await this.json(
			`/api/sessions/${encodeURIComponent(sessionId)}/turn/${encodeURIComponent(turnId)}/cancel`,
			{ method: "POST", body: "{}" },
		);
	}

	async answerAskUser(params: {
		readonly sessionId: string;
		readonly turnId: string;
		readonly requestId: string;
		readonly answer: AskUserAnswerRequest;
	}): Promise<void> {
		await this.json(
			`/api/sessions/${encodeURIComponent(params.sessionId)}/turn/${encodeURIComponent(params.turnId)}/ask-user/${encodeURIComponent(params.requestId)}`,
			{
				method: "POST",
				body: JSON.stringify(params.answer),
			},
		);
	}

	async skipPlanPhase(
		sessionId: string,
		planId: string,
		phaseId: string,
	): Promise<void> {
		await this.json(
			`/api/sessions/${encodeURIComponent(sessionId)}/plan/skip`,
			{
				method: "POST",
				body: JSON.stringify({ planId, phaseId }),
			},
		);
	}

	async cancelPlan(sessionId: string, planId: string): Promise<void> {
		await this.json(
			`/api/sessions/${encodeURIComponent(sessionId)}/plan/cancel`,
			{
				method: "POST",
				body: JSON.stringify({ planId }),
			},
		);
	}

	async streamTurn(options: StreamTurnOptions): Promise<TurnDonePayload> {
		const { sessionId, onEvent, onAskUser, signal, ...body } = options;
		const turnUrl = this.url(
			`/api/sessions/${encodeURIComponent(sessionId)}/turn`,
		);
		const requestBody = JSON.stringify(body);
		this.eventLog?.beginTurn({
			sessionId,
			text: body.text,
			url: turnUrl,
		});
		try {
			this.eventLog?.logRequest("POST", turnUrl, requestBody);
			const res = await this.fetchFn(turnUrl, {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: requestBody,
				signal,
			});
			this.eventLog?.logResponseStatus(res.status);
			if (!res.ok) {
				const errText = await res.text().catch(() => "");
				this.eventLog?.logResponseError(errText);
				let message = `HTTP ${res.status}`;
				try {
					const errBody = JSON.parse(errText) as { error?: string };
					if (errBody.error) {
						message = errBody.error;
					}
				} catch {
					// ignore
				}
				throw new Error(message);
			}
			if (!res.body) {
				throw new Error("Missing response body for SSE stream");
			}

			const reader = res.body.getReader();
			const decoder = new TextDecoder();
			let buffer = "";
			let pendingEvent: string | null = null;
			let donePayload: TurnDonePayload | null = null;

			while (true) {
				const { value, done } = await reader.read();
				if (done) break;
				buffer += decoder.decode(value, { stream: true });
				const lines = buffer.split("\n");
				buffer = lines.pop() ?? "";

				for (const line of lines) {
					this.eventLog?.logSseRaw(line);
					if (line.startsWith("event: ")) {
						pendingEvent = line.slice(7).trim();
						this.eventLog?.logSseEvent(pendingEvent);
						continue;
					}
					if (!line.startsWith("data: ")) {
						continue;
					}
					const payload = line.slice(6);
					if (!payload) continue;
					this.eventLog?.logSseData(pendingEvent ?? "message", payload);

					if (pendingEvent === "done") {
						donePayload = JSON.parse(payload) as TurnDonePayload;
						this.eventLog?.logMessage(
							`sse.done.decoded text.count=${donePayload.text.length}`,
						);
						pendingEvent = null;
						continue;
					}
					if (pendingEvent === "error") {
						const json = JSON.parse(payload) as { error?: string };
						pendingEvent = null;
						throw new Error(json.error ?? "Turn failed");
					}
					if (pendingEvent === "ask_user_prompt") {
						const prompt = JSON.parse(payload) as AskUserPromptPayload & {
							turnId: string;
						};
						if (onAskUser) {
							const answer = await onAskUser(prompt);
							await this.answerAskUser({
								sessionId,
								turnId: prompt.turnId,
								requestId: prompt.requestId,
								answer,
							});
						}
						pendingEvent = null;
						continue;
					}

					pendingEvent = null;
					const event = JSON.parse(payload) as ChatEvent;
					this.eventLog?.logMessage(`sse.message.decoded type=${event.type}`);
					onEvent(event);
				}
			}

			if (!donePayload) {
				this.eventLog?.logMessage("sse.streamEndedWithoutDone");
				return {
					turnId: "",
					text: "",
					appliedActions: [],
				};
			}
			return donePayload;
		} finally {
			this.eventLog?.endTurn();
		}
	}
}

export function resolveDaemonBaseUrl(port: number): string {
	return `http://127.0.0.1:${port}`;
}
