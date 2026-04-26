import { render } from "ink";
import React from "react";
import type { Persona } from "../../config/index";
import type { IntegrationModule } from "../../integrations/types";
import { ChatSessionApp } from "./chat-session-app";

export async function runChatSessionInk(params: {
	readonly modules: readonly IntegrationModule[];
	readonly persona: Persona;
	readonly dryRun: boolean;
	readonly initialUserPrompt: string;
}): Promise<void> {
	const instance = render(
		<ChatSessionApp
			initialModules={params.modules}
			persona={params.persona}
			dryRun={params.dryRun}
			initialUserPrompt={params.initialUserPrompt}
		/>,
	);
	await instance.waitUntilExit();
}
