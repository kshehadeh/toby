import os from "node:os";
import { formatPersonaAiLabel } from "@toby/core/ai/model-factory";
import { createReflectTools } from "@toby/core/ai/reflect-tools";
import { DEFAULT_CHAT_PERSONA } from "@toby/core/personas/index";
import { describe, expect, it } from "bun:test";

describe("tobyInstanceInfo", () => {
	it("returns hostname, pid, persona, and model for the active instance", async () => {
		const tools = createReflectTools({
			dryRun: true,
			persona: DEFAULT_CHAT_PERSONA,
		});
		const execute = tools.tobyInstanceInfo.execute;
		expect(execute).toBeTypeOf("function");
		if (!execute) {
			return;
		}
		const result = await execute({}, {} as never);

		expect(result.hostname).toBe(os.hostname());
		expect(typeof result.hostname).toBe("string");
		expect(result.hostname.length).toBeGreaterThan(0);
		expect(result.pid).toBe(process.pid);
		expect(result.persona).toEqual({
			name: DEFAULT_CHAT_PERSONA.name,
			promptMode: DEFAULT_CHAT_PERSONA.promptMode,
		});
		expect(result.model).toEqual({
			provider: DEFAULT_CHAT_PERSONA.ai.provider,
			model: DEFAULT_CHAT_PERSONA.ai.model,
			label: formatPersonaAiLabel(DEFAULT_CHAT_PERSONA),
		});
		expect(result.extras).toMatchObject({
			platform: process.platform,
			arch: os.arch(),
			cwd: process.cwd(),
		});
		expect(typeof result.extras.version).toBe("string");
		expect(typeof result.extras.compiled).toBe("boolean");
		expect(typeof result.extras.uptimeSeconds).toBe("number");
		expect(["bun", "node"]).toContain(result.extras.runtime);
	});
});
