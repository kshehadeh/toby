import type { AskUserHandler } from "../ai/ask-user-tool";
import type { CoreMessage } from "../ai/chat";
import {
	shouldPretreat,
	wrapUserPromptWithPretreatment,
} from "../ai/pretreatment";
import type {
	ChatInboundProvider,
	InboundConversation,
} from "../chat-inbound/types";
import type { Persona } from "../config/index";
import type { IntegrationModule } from "../integrations/types";
import { daemonLog } from "../logging/daemon-log";
import { loadLocalSkills } from "../skills/index";
import {
	injectSkillBodiesIntoFirstSystemMessage,
	prepareChatSessionMessages,
} from "../ui/chat/prepare-messages";
import { appendMessageBatch, loadChatSession } from "../ui/chat/session-store";
import { resolveHeadlessChatModules } from "./resolve-chat-modules";
import {
	buildToolsCatalogForPretreatment,
	runIntegrationChatTurn,
} from "./run-turn";

const INBOUND_PERSONA_APPENDIX_BASE = `

---

## Inbound chat policy

You are replying in an external chat thread (not the Toby terminal). The user cannot see plain-text multiple-choice questions—use the **askUser** tool when you need a decision. When posting to the same thread, prefer the integration's reply-in-thread tool with the channel and thread identifiers from context. Complete the request without asking unnecessary follow-up questions in prose alone.
`;

export type HeadlessTurnResult = {
	readonly responseMessages: CoreMessage[];
	readonly text: string;
	readonly appliedActions: readonly string[];
	readonly deliveredViaTools: boolean;
};

function buildInboundPersona(
	persona: Persona,
	provider: ChatInboundProvider | undefined,
	conversation: InboundConversation | undefined,
): Persona {
	let appendix = INBOUND_PERSONA_APPENDIX_BASE;
	if (provider && conversation && provider.buildInboundPersonaAppendix) {
		appendix += provider.buildInboundPersonaAppendix(conversation);
	}
	return {
		...persona,
		instructions: persona.instructions + appendix,
	};
}

function appliedActionsIndicateReply(
	appliedActions: readonly string[],
): boolean {
	return appliedActions.some(
		(a) =>
			/Posted message to Slack/i.test(a) ||
			/Replied in Slack thread/i.test(a) ||
			/\[DRY RUN\] Would (post|reply)/i.test(a),
	);
}

export async function runHeadlessChatTurn(params: {
	readonly inboundModule: IntegrationModule;
	readonly sessionId: string;
	readonly userText: string;
	readonly persona: Persona;
	readonly dryRun: boolean;
	readonly askUser?: AskUserHandler;
	readonly provider?: ChatInboundProvider;
	readonly conversation?: InboundConversation;
}): Promise<HeadlessTurnResult> {
	const {
		inboundModule,
		sessionId,
		userText,
		persona,
		dryRun,
		askUser,
		provider,
		conversation,
	} = params;

	const { modules, warnings } = await resolveHeadlessChatModules(
		userText,
		inboundModule,
	);
	if (warnings.length > 0) {
		daemonLog("warn", "turn", "headless_module_warnings", {
			modules: modules.map((m) => m.name),
			warnings,
		});
	}
	daemonLog("debug", "turn", "headless_modules", {
		modules: modules.map((m) => m.name),
	});

	const loaded = loadChatSession(sessionId);
	const priorMessages = loaded?.messages ?? [];
	const isFirstTurn = priorMessages.length === 0;
	const inboundPersona = buildInboundPersona(persona, provider, conversation);
	const skills = loadLocalSkills();
	const integrationLabel = modules.map((m) => m.displayName).join(", ");
	const moduleNames = modules.map((m) => m.name);

	let effectiveText = userText;
	let spec: Awaited<ReturnType<typeof wrapUserPromptWithPretreatment>>["spec"] =
		null;

	if (shouldPretreat(priorMessages, userText, isFirstTurn)) {
		const toolCatalog = await buildToolsCatalogForPretreatment(modules, {
			dryRun,
			persona: inboundPersona,
		});
		const wrapResult = await wrapUserPromptWithPretreatment({
			priorMessages: isFirstTurn ? null : priorMessages,
			rawUserText: userText,
			integrationLabels: integrationLabel,
			isFirstTurn,
			persona: inboundPersona,
			skillsCatalog: skills,
			toolsCatalogText: toolCatalog.catalogText,
			allowedToolNamesLower: toolCatalog.allowedToolNamesLower,
		});
		effectiveText = wrapResult.content;
		spec = wrapResult.spec;
	}

	let messages: CoreMessage[];
	if (isFirstTurn) {
		messages = await prepareChatSessionMessages(
			modules,
			inboundPersona,
			effectiveText,
		);
	} else {
		messages = [...priorMessages, { role: "user", content: effectiveText }];
	}

	messages = injectSkillBodiesIntoFirstSystemMessage(
		messages,
		spec?.relevantSkills ?? [],
		skills,
	);

	const startIdx = priorMessages.length;
	const result = await runIntegrationChatTurn(moduleNames, messages, {
		persona: inboundPersona,
		dryRun,
		askUser,
		relevantTools: spec?.relevantTools,
	});

	const next = [...messages, ...result.responseMessages];
	appendMessageBatch(sessionId, startIdx, next.slice(startIdx));

	return {
		responseMessages: result.responseMessages,
		text: result.text?.trim() ?? "",
		appliedActions: result.appliedActions,
		deliveredViaTools: appliedActionsIndicateReply(result.appliedActions),
	};
}
