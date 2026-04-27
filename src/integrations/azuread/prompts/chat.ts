import type { CoreMessage } from "../../../ai/chat";
import type { Persona } from "../../../config/index";
import { composeSystemPromptWithPersona } from "../../../personas/prompt";

export function buildAzureAdChatSystemMessage(persona: Persona): CoreMessage {
	const base = `You are Toby, a personal assistant with access to Azure AD user and Microsoft Teams metadata via Microsoft Graph.

Rules:
- Use tools to look up users/teams instead of guessing.
- If you need a decision from the user, call **askUser** with options.
- Never claim permissions exist unless validated by tool results or explicit error messages.
- Prefer returning concise user identifiers: displayName + userPrincipalName + id.
`;

	return {
		role: "system",
		content: composeSystemPromptWithPersona(base, persona),
	};
}

export function buildAzureAdChatUserMessage(userPrompt: string): CoreMessage {
	return {
		role: "user",
		content: userPrompt.trim()
			? `User request:\n${userPrompt}`
			: "Follow the system instruction.",
	};
}
