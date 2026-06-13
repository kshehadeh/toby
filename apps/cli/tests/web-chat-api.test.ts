import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { closeChatDbForTests } from "@toby/core/session-store";
import { handleWebRequest } from "@toby/core/web/routes";
import { afterEach, describe, expect, it } from "vitest";

function canUseBunSqlite(): boolean {
	try {
		// Runtime-only; vitest may execute under Node.
		// biome-ignore lint/suspicious/noExplicitAny: runtime probe
		require("bun:sqlite" as any);
		return true;
	} catch {
		return false;
	}
}

function withTempTobyDir(run: () => void | Promise<void>): Promise<void> {
	const previous = process.env.TOBY_DIR;
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), "toby-web-chat-test-"));
	process.env.TOBY_DIR = dir;
	return Promise.resolve()
		.then(run)
		.finally(() => {
			closeChatDbForTests();
			if (previous === undefined) {
				Reflect.deleteProperty(process.env, "TOBY_DIR");
			} else {
				process.env.TOBY_DIR = previous;
			}
			fs.rmSync(dir, { recursive: true, force: true });
		});
}

describe("web chat API routes", () => {
	afterEach(() => {
		closeChatDbForTests();
	});

	it("handles GET /api/status", async () => {
		await withTempTobyDir(async () => {
			const res = await handleWebRequest(
				new Request("http://127.0.0.1/api/status"),
				null,
			);
			expect(res.status).toBe(200);
			const body = (await res.json()) as {
				version: string;
				persona: string;
				model: string;
			};
			expect(body.version.length).toBeGreaterThan(0);
			expect(body.persona.length).toBeGreaterThan(0);
			expect(body.model.length).toBeGreaterThan(0);
		});
	});

	it.skipIf(!canUseBunSqlite())("handles POST /api/sessions", async () => {
		await withTempTobyDir(async () => {
			const res = await handleWebRequest(
				new Request("http://127.0.0.1/api/sessions", { method: "POST" }),
				null,
			);
			expect(res.status).toBe(201);
			const body = (await res.json()) as { id: string; name: string };
			expect(body.id).toMatch(
				/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
			);
			expect(body.name).toBe("New chat");
		});
	});

	it.skipIf(!canUseBunSqlite())(
		"rejects empty POST /api/sessions/:id/turn",
		async () => {
			await withTempTobyDir(async () => {
				const created = await handleWebRequest(
					new Request("http://127.0.0.1/api/sessions", { method: "POST" }),
					null,
				);
				const { id } = (await created.json()) as { id: string };
				const res = await handleWebRequest(
					new Request(`http://127.0.0.1/api/sessions/${id}/turn`, {
						method: "POST",
						headers: { "Content-Type": "application/json" },
						body: JSON.stringify({ text: "   " }),
					}),
					null,
				);
				expect(res.status).toBe(400);
			});
		},
	);
});
