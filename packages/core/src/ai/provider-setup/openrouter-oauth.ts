import { createHash, randomBytes } from "node:crypto";
import { openRouterProviderSetupAdapter } from "./adapters/openrouter";
import type { ProviderSetupResult } from "./types";

type State =
	| "waiting"
	| "exchanging"
	| "authorized"
	| "testing"
	| "completed"
	| "error";
type Session = {
	id: string;
	state: State;
	authorizationUrl: string;
	expiresAt: number;
	verifier: string;
	key?: string;
	error?: string;
	result?: ProviderSetupResult;
	server?: ReturnType<typeof Bun.serve>;
	timer?: ReturnType<typeof setTimeout>;
	controller: AbortController;
};

export class OAuthSessionError extends Error {
	constructor(
		message: string,
		readonly status: number,
	) {
		super(message);
	}
}

/** Ephemeral PKCE sessions. Neither keys nor authorization codes cross the app API. */
export class OpenRouterOAuthSessions {
	private readonly sessions = new Map<string, Session>();
	constructor(
		private readonly options: {
			fetch?: typeof fetch;
			setup?: typeof openRouterProviderSetupAdapter.setup;
			ttlMs?: number;
		} = {},
	) {}

	start() {
		if (this.sessions.size >= 8)
			throw new OAuthSessionError(
				"Too many sign-in attempts. Cancel an existing attempt or try again shortly.",
				429,
			);
		const id = randomBytes(32).toString("base64url");
		const callbackPath = `/callback/${randomBytes(32).toString("base64url")}`;
		const verifier = randomBytes(32).toString("base64url");
		const session: Session = {
			id,
			verifier,
			state: "waiting",
			authorizationUrl: "",
			expiresAt: Date.now() + (this.options.ttlMs ?? 10 * 60_000),
			controller: new AbortController(),
		};
		// An unguessable callback path binds the browser redirect to this attempt.
		// OpenRouter does not document an OAuth `state` parameter.
		session.server = Bun.serve({
			hostname: "127.0.0.1",
			port: 0,
			maxRequestBodySize: 1024,
			fetch: (request) => {
				const url = new URL(request.url);
				if (
					url.host !== `localhost:${session.server?.port}` ||
					url.pathname !== callbackPath
				)
					return new Response("Not found", { status: 404 });
				if (request.method !== "GET")
					return new Response("Method not allowed", { status: 405 });
				if (session.state !== "waiting" || Date.now() >= session.expiresAt)
					return this.page(
						"This sign-in has ended. Return to Toby to start again.",
						409,
					);
				if (url.searchParams.has("error")) {
					this.fail(
						session,
						"Sign-in wasn’t approved. You can try again or paste an existing key.",
						false,
					);
					return this.page("Sign-in wasn’t approved. You can return to Toby.");
				}
				const codes = url.searchParams.getAll("code");
				if (codes.length !== 1 || !codes[0] || codes[0].length > 4096)
					return this.page(
						"The sign-in response was incomplete. Return to Toby and try again.",
						400,
					);
				session.state = "exchanging";
				void this.exchange(session, codes[0]);
				return this.page(
					"Sign-in received. Return to Toby to finish connecting.",
				);
			},
		});
		const authorizationUrl = new URL("https://openrouter.ai/auth");
		authorizationUrl.searchParams.set(
			"callback_url",
			`http://localhost:${session.server.port}${callbackPath}`,
		);
		authorizationUrl.searchParams.set(
			"code_challenge",
			createHash("sha256").update(verifier).digest("base64url"),
		);
		authorizationUrl.searchParams.set("code_challenge_method", "S256");
		authorizationUrl.searchParams.set("key_label", "Toby");
		session.authorizationUrl = authorizationUrl.toString();
		this.sessions.set(id, session);
		this.armExpiry(session);
		return this.snapshot(session);
	}

	get(id: string) {
		return this.snapshot(this.require(id));
	}

	async finish(id: string): Promise<ProviderSetupResult> {
		const session = this.require(id);
		if (session.state === "completed" && session.result) return session.result;
		if (session.state !== "authorized" || !session.key)
			throw new OAuthSessionError(
				"Finish signing in before testing the connection.",
				409,
			);
		if (Date.now() >= session.expiresAt) {
			this.fail(session, "Sign-in expired. Connect your account again.");
			throw new OAuthSessionError(session.error ?? "Sign-in expired.", 410);
		}
		session.state = "testing";
		clearTimeout(session.timer);
		try {
			const result = await (
				this.options.setup ?? openRouterProviderSetupAdapter.setup
			)({
				fields: { apiKey: session.key },
				testConnection: true,
				signal: session.controller.signal,
			});
			if (session.controller.signal.aborted)
				return { ok: false, error: "Sign-in cancelled.", status: 410 };
			if (result.ok) {
				session.result = result;
				session.state = "completed";
				this.release(session);
				this.scheduleRemoval(session);
			} else {
				session.state = "authorized";
				this.armExpiry(session);
				return {
					...result,
					error: result.error.replaceAll(session.key ?? "", "[redacted]"),
				};
			}
			return result;
		} catch {
			if (session.controller.signal.aborted)
				return { ok: false, error: "Sign-in cancelled.", status: 410 };
			session.state = "authorized";
			this.armExpiry(session);
			// Never echo upstream errors that could contain a key or request headers.
			return {
				ok: false,
				error: "Toby couldn’t finish saving the connection. Try again.",
				status: 500,
			};
		}
	}

	cancel(id: string) {
		const session = this.sessions.get(id);
		if (!session) return;
		if (session.state === "testing")
			throw new OAuthSessionError(
				"The connection test is finishing. Please wait.",
				409,
			);
		this.release(session);
		this.sessions.delete(id);
	}

	close() {
		for (const session of this.sessions.values()) this.release(session);
		this.sessions.clear();
	}

	private require(id: string) {
		const session = this.sessions.get(id);
		if (!session)
			throw new OAuthSessionError(
				"This sign-in has expired. Connect your account again.",
				410,
			);
		return session;
	}
	private snapshot(session: Session) {
		return {
			id: session.id,
			state: session.state,
			authorizationUrl: session.authorizationUrl,
			expiresAt: session.expiresAt,
			...(session.error ? { error: session.error } : {}),
		};
	}
	private armExpiry(session: Session) {
		clearTimeout(session.timer);
		session.timer = setTimeout(
			() => this.fail(session, "Sign-in expired. Connect your account again."),
			Math.max(0, session.expiresAt - Date.now()),
		);
		session.timer.unref();
	}
	private scheduleRemoval(session: Session) {
		clearTimeout(session.timer);
		session.timer = setTimeout(() => this.sessions.delete(session.id), 60_000);
		session.timer.unref();
	}
	private release(session: Session, force = true) {
		clearTimeout(session.timer);
		session.controller.abort();
		session.server?.stop(force);
		session.server = undefined;
		session.key = undefined;
		session.verifier = "";
	}
	private fail(session: Session, message: string, force = true) {
		session.state = "error";
		session.error = message;
		this.release(session, force);
		this.scheduleRemoval(session);
	}
	private async exchange(session: Session, code: string) {
		try {
			const response = await (this.options.fetch ?? fetch)(
				"https://openrouter.ai/api/v1/auth/keys",
				{
					method: "POST",
					headers: { "Content-Type": "application/json" },
					body: JSON.stringify({
						code,
						code_verifier: session.verifier,
						code_challenge_method: "S256",
					}),
					signal: AbortSignal.any([
						session.controller.signal,
						AbortSignal.timeout(15_000),
					]),
					redirect: "error",
				},
			);
			if (!response.ok) throw new Error("Exchange rejected");
			const body = (await response.json()) as { key?: unknown };
			if (typeof body.key !== "string" || !body.key.trim())
				throw new Error("Missing key");
			if (
				session.controller.signal.aborted ||
				this.sessions.get(session.id) !== session
			)
				return;
			session.key = body.key.trim();
			session.verifier = "";
			session.state = "authorized";
			session.server?.stop(false);
			session.server = undefined;
		} catch {
			if (!session.controller.signal.aborted)
				this.fail(
					session,
					"Toby couldn’t complete sign-in. Connect your account again.",
					false,
				);
		}
	}
	private page(message: string, status = 200) {
		return new Response(
			`<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Connect Toby</title><body><h1>Connect Toby</h1><p>${message}</p><p>You can close this tab.</p></body></html>`,
			{
				status,
				headers: {
					"Content-Type": "text/html; charset=utf-8",
					"Cache-Control": "no-store",
					"Referrer-Policy": "no-referrer",
					Connection: "close",
					"Content-Security-Policy":
						"default-src 'none'; frame-ancestors 'none'; base-uri 'none'",
				},
			},
		);
	}
}

export const openRouterOAuthSessions = new OpenRouterOAuthSessions();
