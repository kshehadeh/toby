import { afterEach, describe, expect, it } from "bun:test";
import { createHash } from "node:crypto";
import { OpenRouterOAuthSessions } from "@toby/core/ai/provider-setup/openrouter-oauth";
import { handleOpenRouterOAuth } from "@toby/core/web/handlers/ai-provider-oauth";

const managers: OpenRouterOAuthSessions[] = [];
function manager(
	options: ConstructorParameters<typeof OpenRouterOAuthSessions>[0] = {},
) {
	const sessions = new OpenRouterOAuthSessions(options);
	managers.push(sessions);
	return sessions;
}
afterEach(() => {
	for (const sessions of managers.splice(0)) sessions.close();
});
function callback(authorizationUrl: string, code = "test-code") {
	const url = new URL(
		new URL(authorizationUrl).searchParams.get("callback_url") ?? "",
	);
	url.searchParams.set("code", code);
	return url;
}
async function waitForState(
	sessions: OpenRouterOAuthSessions,
	id: string,
	state: string,
) {
	for (let i = 0; i < 100; i++) {
		if (sessions.get(id).state === state) return;
		await Bun.sleep(5);
	}
	expect(sessions.get(id).state).toBe(state);
}
const successfulSetup = async () => ({
	ok: true as const,
	providerId: "openrouter",
	details: { testResponse: "Ready" },
});

describe("OpenRouter OAuth", () => {
	it("uses S256, exchanges once, keeps secrets server-side, and commits only on finish", async () => {
		let exchangeBody: Record<string, string> = {};
		let exchanges = 0;
		let commits = 0;
		const sessions = manager({
			fetch: (async (url, init) => {
				expect(String(url)).toBe("https://openrouter.ai/api/v1/auth/keys");
				exchangeBody = JSON.parse(String(init?.body));
				exchanges++;
				return Response.json({ key: "private-issued-key" });
			}) as typeof fetch,
			setup: async (request) => {
				expect(request.fields.apiKey).toBe("private-issued-key");
				expect(request.testConnection).toBe(true);
				commits++;
				return successfulSetup();
			},
		});
		const session = sessions.start();
		const auth = new URL(session.authorizationUrl);
		expect(auth.origin).toBe("https://openrouter.ai");
		expect(auth.searchParams.get("code_challenge_method")).toBe("S256");
		expect(auth.searchParams.get("key_label")).toBe("Toby");
		const response = await fetch(callback(session.authorizationUrl));
		expect(response.status).toBe(200);
		expect(response.headers.get("Referrer-Policy")).toBe("no-referrer");
		await waitForState(sessions, session.id, "authorized");
		expect(exchangeBody.code).toBe("test-code");
		expect(
			createHash("sha256")
				.update(exchangeBody.code_verifier)
				.digest("base64url"),
		).toBe(auth.searchParams.get("code_challenge"));
		expect(JSON.stringify(sessions.get(session.id))).not.toContain(
			"private-issued-key",
		);
		expect(JSON.stringify(sessions.get(session.id))).not.toContain(
			exchangeBody.code_verifier,
		);
		expect(commits).toBe(0);
		expect((await sessions.finish(session.id)).ok).toBe(true);
		expect((await sessions.finish(session.id)).ok).toBe(true);
		expect(commits).toBe(1);
		expect(exchanges).toBe(1);
	});

	it("rejects wrong callback paths, missing codes, and repeat callbacks", async () => {
		let resolveExchange!: (response: Response) => void;
		const sessions = manager({
			fetch: (() =>
				new Promise<Response>((resolve) => {
					resolveExchange = resolve;
				})) as typeof fetch,
		});
		const session = sessions.start();
		const url = callback(session.authorizationUrl);
		const wrong = new URL(url);
		wrong.pathname = "/callback/wrong";
		expect((await fetch(wrong)).status).toBe(404);
		const missing = new URL(url);
		missing.search = "";
		expect((await fetch(missing)).status).toBe(400);
		expect((await fetch(url, { method: "POST" })).status).toBe(405);
		expect((await fetch(url)).status).toBe(200);
		expect((await fetch(url)).status).toBe(409);
		sessions.cancel(session.id);
		resolveExchange(Response.json({ key: "late-key" }));
		await Bun.sleep(10);
		expect(() => sessions.get(session.id)).toThrow("expired");
		await expect(fetch(url)).rejects.toThrow();
	});

	it("allows retry after a credit failure without another browser exchange", async () => {
		let attempts = 0;
		const sessions = manager({
			fetch: (async () => Response.json({ key: "issued-key" })) as typeof fetch,
			setup: async () =>
				++attempts === 1
					? { ok: false, error: "Add credits.", status: 400 }
					: successfulSetup(),
		});
		const session = sessions.start();
		await fetch(callback(session.authorizationUrl));
		await waitForState(sessions, session.id, "authorized");
		expect((await sessions.finish(session.id)).ok).toBe(false);
		expect(sessions.get(session.id).state).toBe("authorized");
		expect((await sessions.finish(session.id)).ok).toBe(true);
	});

	it("expires sessions and closes callback listeners", async () => {
		const sessions = manager({ ttlMs: 40 });
		const session = sessions.start();
		await waitForState(sessions, session.id, "error");
		expect(sessions.get(session.id).error).toContain("expired");
		await expect(fetch(callback(session.authorizationUrl))).rejects.toThrow();
		await expect(sessions.finish(session.id)).rejects.toThrow();
	});

	it("reports denied and failed exchanges without exposing provider messages", async () => {
		const sessions = manager({
			fetch: (async () =>
				Response.json(
					{ error: "private-provider-message" },
					{ status: 403 },
				)) as typeof fetch,
		});
		const denied = sessions.start();
		const deniedURL = callback(denied.authorizationUrl);
		deniedURL.search = "?error=access_denied";
		expect((await fetch(deniedURL)).status).toBe(200);
		expect(sessions.get(denied.id).state).toBe("error");
		const failed = sessions.start();
		await fetch(callback(failed.authorizationUrl));
		await waitForState(sessions, failed.id, "error");
		expect(JSON.stringify(sessions.get(failed.id))).not.toContain(
			"private-provider-message",
		);
	});

	it("prevents concurrent commits and cancellation during a commit", async () => {
		let resolveSetup!: (
			value: Awaited<ReturnType<typeof successfulSetup>>,
		) => void;
		const sessions = manager({
			fetch: (async () => Response.json({ key: "key" })) as typeof fetch,
			setup: () =>
				new Promise((resolve) => {
					resolveSetup = resolve;
				}),
		});
		const session = sessions.start();
		await fetch(callback(session.authorizationUrl));
		await waitForState(sessions, session.id, "authorized");
		const finishing = sessions.finish(session.id);
		await expect(sessions.finish(session.id)).rejects.toThrow();
		expect(() => sessions.cancel(session.id)).toThrow("finishing");
		resolveSetup(await successfulSetup());
		expect((await finishing).ok).toBe(true);
	});

	it("redacts a key echoed in an upstream validation failure", async () => {
		const sessions = manager({
			fetch: (async () =>
				Response.json({ key: "issued-private-key" })) as typeof fetch,
			setup: async () => ({ ok: false, error: "Rejected issued-private-key" }),
		});
		const session = sessions.start();
		await fetch(callback(session.authorizationUrl));
		await waitForState(sessions, session.id, "authorized");
		expect(JSON.stringify(await sessions.finish(session.id))).not.toContain(
			"issued-private-key",
		);
	});

	it("daemon shutdown aborts an in-flight setup and discards the session", async () => {
		let signal: AbortSignal | undefined;
		const sessions = manager({
			fetch: (async () => Response.json({ key: "issued-key" })) as typeof fetch,
			setup: (request) =>
				new Promise((resolve) => {
					signal = request.signal;
					signal?.addEventListener(
						"abort",
						() => resolve({ ok: false, error: "Cancelled" }),
						{ once: true },
					);
				}),
		});
		const session = sessions.start();
		await fetch(callback(session.authorizationUrl));
		await waitForState(sessions, session.id, "authorized");
		const finishing = sessions.finish(session.id);
		sessions.close();
		expect(signal?.aborted).toBe(true);
		expect((await finishing).ok).toBe(false);
		expect(() => sessions.get(session.id)).toThrow("expired");
	});

	it("rejects web origins and supports native start/status/cancel without secrets", async () => {
		const url = "http://127.0.0.1:3000/api/ai/providers/openrouter/oauth";
		expect(
			(
				await handleOpenRouterOAuth(
					new Request(url, {
						method: "POST",
						headers: { Origin: "https://example.com" },
					}),
				)
			).status,
		).toBe(403);
		const started = await handleOpenRouterOAuth(
			new Request(url, { method: "POST" }),
		);
		expect(started.headers.get("Cache-Control")).toBe("no-store");
		const session = (await started.json()) as { id: string };
		try {
			const status = await handleOpenRouterOAuth(new Request(url), session.id);
			expect(((await status.json()) as { state: string }).state).toBe(
				"waiting",
			);
		} finally {
			expect(
				(
					await handleOpenRouterOAuth(
						new Request(url, { method: "DELETE" }),
						session.id,
					)
				).status,
			).toBe(200);
		}
		expect(
			(await handleOpenRouterOAuth(new Request(url), session.id)).status,
		).toBe(410);
	});
});
