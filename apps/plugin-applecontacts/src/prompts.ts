import { isNativeAvailable } from "./native-client";
import { isConnected } from "./protocol";

type JsonRecord = Record<string, unknown>;

export function buildChatModelPrep(): JsonRecord {
	return {
		systemPromptSection: `### Apple Contacts
You assist with local Apple Contacts via Contacts.app. Use Apple Contacts tools to search contacts and read contact details by identifier. Contact data is read-only and comes from the user's local macOS Contacts database.`,
		singleSessionRules: `You are an Apple Contacts assistant. Contact data is read on this Mac via Contacts.app (local native API). Use the tools to search contacts and view details.

Tools:
- **searchContacts** — Find contacts by optional query text across name, organization, email, phone, URL, and address fields. Returns contact identifiers and summary fields.
- **getContact** — Get full details for a single contact by identifier. Use identifiers from searchContacts.
- **askUser** — For user choices; the CLI collects answers only through this tool.

Rules:
- Never invent contact information. Only report information returned by tools.
- For getContact, the identifier must come from searchContacts or prior user-provided context.
- If Contacts access is missing, explain that the user should grant Contacts access to Toby in System Settings → Privacy & Security → Contacts.
- Treat contact data as private. Return the minimum details needed for the user's request.`,
		singleSessionUserTemplate: `User request (Apple Contacts):
{{userPrompt}}`,
		multiUserContentTemplate: `## Apple Contacts
Use Apple Contacts tools for contact lookup on this Mac.

If you need a decision from the user, call **askUser** with options.

User request (may also mention other integrations):
{{userPrompt}}`,
	};
}

export function buildChatReadiness(state: JsonRecord): JsonRecord {
	if (!isNativeAvailable()) {
		return {
			ok: false,
			hint: "Toby.app is not running. Launch Toby.app to enable Apple Contacts tools.",
		};
	}
	if (isConnected(state)) {
		return { ok: true };
	}
	return {
		ok: false,
		hint: "Run `toby connect applecontacts` on this Mac to enable local Contacts.app tools.",
	};
}
