import type { CoreMessage } from "../../../ai/chat";
import { globalChatToolsPromptSection } from "../../../ai/global-chat-tools";
import type { Persona } from "../../../config/index";
import { composeSystemPromptWithPersona } from "../../../personas/prompt";
import { listConversations, testSlackConnection } from "../client";

function buildSlackChatSystemPrompt(): string {
	return `You are a Slack workspace assistant. Use Slack tools to discover channels/users, post messages, reply in threads, and search messages.

Tools:
- searchUsers — find members by name, username, or email (use before DMing someone)
- searchChannels — find channels (public/private the workspace token can access)
- postToChannel — send a new message to a channel or DM
- replyToPost — reply in a thread (requires threadTs from the parent message)
- searchMessages — search workspace message history
- askUser — **required** for any user choice; the CLI only collects answers through this tool

Rules:
- Resolve people with searchUsers (especially by email); resolve channels with searchChannels when unsure.
- Never claim a message was posted unless postToChannel or replyToPost succeeded.
- For thread replies you need the parent message timestamp (thread_ts).
- If the request is fully answered, stop without dangling questions unless you call askUser.
${globalChatToolsPromptSection()}
`;
}

export function buildSlackChatSystemMessage(persona: Persona): CoreMessage {
	return {
		role: "system",
		content: composeSystemPromptWithPersona(
			buildSlackChatSystemPrompt(),
			persona,
		),
	};
}

export async function buildSlackChatUserMessage(
	userPrompt: string,
): Promise<CoreMessage> {
	let auth: { team?: string; user?: string } = {};
	let channelSummary: Array<{
		id: string;
		name: string;
		kind: string;
		isPrivate: boolean;
		isMember: boolean;
	}> = [];
	let connectionNote = "";

	try {
		const [authResult, conversations] = await Promise.all([
			testSlackConnection(),
			listConversations(40).catch(() => []),
		]);
		auth = authResult;
		channelSummary = conversations
			.filter((c) => c.kind !== "im" || c.isMember)
			.slice(0, 40)
			.map((c) => ({
				id: c.id,
				name: c.name,
				kind: c.kind,
				isPrivate: c.isPrivate,
				isMember: c.isMember,
			}));
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		connectionNote = `Slack is not reachable right now (${message}). Use Slack tools when the connection recovers, or ask the user to run \`toby connect slack\`.`;
	}

	return {
		role: "user",
		content: `Current Slack context (apply the system instruction):

${connectionNote ? `${connectionNote}\n\n` : ""}Workspace: ${auth.team ?? "(unknown)"} (user: ${auth.user ?? "unknown"})
Sample channels (${channelSummary.length}):
${JSON.stringify(channelSummary, null, 2)}

User request:
${userPrompt || "(no additional text — follow the system instruction.)"}`,
	};
}
