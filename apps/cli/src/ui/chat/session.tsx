import { render } from "ink";
import React from "react";
import type { Persona } from "../../config/index";
import type { IntegrationModule } from "../../integrations/types";
import {
	type LaunchContext,
	captureLaunchContext,
} from "../../toby-launch-context";
import { detectTerminalProfile, resolveKittyKeyboardMode } from "../shared";
import { ChatSessionApp } from "./chat-session-app";
import {
	registerInkRenderFlush,
	unregisterInkRenderFlush,
} from "./yield-to-renderer";

export async function runChatSessionInk(params: {
	readonly modules: readonly IntegrationModule[];
	readonly persona: Persona;
	readonly dryRun: boolean;
	readonly initialUserPrompt: string;
	readonly debug?: boolean;
	readonly launchContext?: LaunchContext;
}): Promise<void> {
	const launchContext = params.launchContext ?? captureLaunchContext();
	const profile = detectTerminalProfile();
	const instance = render(
		<ChatSessionApp
			initialModules={params.modules}
			persona={params.persona}
			dryRun={params.dryRun}
			debug={params.debug ?? false}
			initialUserPrompt={params.initialUserPrompt}
			launchContext={launchContext}
		/>,
		{
			kittyKeyboard: {
				mode: resolveKittyKeyboardMode(profile),
				flags: ["disambiguateEscapeCodes"],
			},
		},
	);
	registerInkRenderFlush(() => instance.waitUntilRenderFlush());
	try {
		await instance.waitUntilExit();
	} finally {
		unregisterInkRenderFlush();
	}
}
