import {
	type CreateIssueInput,
	type IssueType,
	createGitHubIssue,
	resolveGitHubRepo,
} from "../../issues/github";
import { errorResponse, jsonResponse, readJsonBody } from "../http-utils";

export async function handleCreateIssue(req: Request): Promise<Response> {
	const body = await readJsonBody<Record<string, unknown>>(req);
	if (body === null) {
		return errorResponse("Invalid JSON body", 400);
	}

	const type = parseIssueType(body.type);
	if (!type) {
		return errorResponse("Expected type to be 'bug' or 'feature'", 400);
	}

	const details = typeof body.details === "string" ? body.details.trim() : "";
	if (!details) {
		return errorResponse("details is required", 400);
	}

	const source =
		typeof body.source === "string" &&
		(body.source === "tui" || body.source === "native-app")
			? body.source
			: undefined;

	const input: CreateIssueInput = {
		repo: typeof body.repo === "string" ? body.repo : resolveGitHubRepo(),
		type,
		details,
		metadata: {
			source,
		},
	};

	try {
		const result = await createGitHubIssue(input);
		if (result.ok) {
			return jsonResponse({ ok: true, url: result.url, number: result.number });
		}
		return jsonResponse({
			ok: false,
			fallbackUrl: result.fallbackUrl,
			reason: result.reason,
		});
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		return errorResponse(message, 500);
	}
}

function parseIssueType(value: unknown): IssueType | null {
	if (value === "bug" || value === "feature") {
		return value;
	}
	return null;
}
