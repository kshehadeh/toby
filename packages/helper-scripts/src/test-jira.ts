/**
 * Standalone Jira SDK diagnostic script.
 * Run: bun run test:jira --filter @toby/helper-scripts
 *
 * Reads credentials from ~/.toby/credentials.json (jira.domain, jira.email, jira.apiToken).
 * Tests each API call individually and prints detailed error info.
 */

import { getIntegrationCredential, readCredentials } from "@toby/cli/config";
import { Version3Client } from "jira.js/version3";

function getCredentials() {
	const creds = readCredentials();
	const domain = getIntegrationCredential(creds, "jira", "domain");
	const email = getIntegrationCredential(creds, "jira", "email");
	const apiToken = getIntegrationCredential(creds, "jira", "apiToken");
	if (!domain || !email || !apiToken) {
		console.error(
			"Missing Jira credentials. Set jira.domain, jira.email, jira.apiToken in ~/.toby/credentials.json",
		);
		process.exit(1);
	}
	return { domain, email, apiToken };
}

async function main() {
	const { domain, email, apiToken } = getCredentials();
	const host = `https://${domain}.atlassian.net`;

	console.log("=== Jira SDK Diagnostic ===");
	console.log(`Domain:  ${domain}`);
	console.log(`Email:   ${email}`);
	console.log(`API Key: ${apiToken.slice(0, 8)}...`);
	console.log(`Host:    ${host}`);
	console.log();

	const client = new Version3Client({
		host,
		authentication: {
			basic: {
				email,
				apiToken,
			},
		},
	});

	// Test 1: Get current user
	console.log("--- Test 1: myself.getCurrentUser() ---");
	try {
		const user = await client.myself.getCurrentUser();
		console.log("OK:", JSON.stringify(user, null, 2));
	} catch (err: unknown) {
		printError(err);
	}
	console.log();

	// Test 2: Search issues using the enhanced search endpoint
	console.log(
		"--- Test 2: issueSearch.searchForIssuesUsingJqlEnhancedSearch() ---",
	);
	try {
		const result =
			await client.issueSearch.searchForIssuesUsingJqlEnhancedSearch({
				jql: "assignee = currentUser() ORDER BY updated DESC",
				maxResults: 2,
				fields: [
					"summary",
					"status",
					"assignee",
					"priority",
					"issuetype",
					"project",
					"updated",
					"labels",
					"created",
				],
				fieldsByKeys: true,
			});
		console.log("Raw result keys:", Object.keys(result));
		const firstIssue = result.issues?.[0];
		if (firstIssue) {
			console.log("First issue keys:", Object.keys(firstIssue));
			console.log(
				"First issue (raw):",
				JSON.stringify(firstIssue, null, 2).slice(0, 3000),
			);
		} else {
			console.log(
				"No issues returned. Full response:",
				JSON.stringify(result, null, 2).slice(0, 2000),
			);
		}
	} catch (err: unknown) {
		printError(err);
	}
	console.log();

	// Test 3: Search issues with POST enhanced search
	console.log(
		"--- Test 3: issueSearch.searchForIssuesUsingJqlEnhancedSearchPost() ---",
	);
	try {
		const result =
			await client.issueSearch.searchForIssuesUsingJqlEnhancedSearchPost({
				jql: "assignee = currentUser() ORDER BY updated DESC",
				maxResults: 2,
				fields: [
					"summary",
					"status",
					"assignee",
					"priority",
					"issuetype",
					"project",
					"updated",
				],
				fieldsByKeys: true,
			});
		console.log("OK: issues count =", result.issues?.length ?? 0);
		const firstIssue = result.issues?.[0];
		if (firstIssue) {
			const f = firstIssue.fields as Record<string, unknown>;
			console.log("  First issue:", firstIssue.key, f?.summary);
		}
	} catch (err: unknown) {
		printError(err);
	}
	console.log();

	// Test 4: List projects
	console.log("--- Test 4: projects.searchProjects() ---");
	try {
		const result = await client.projects.searchProjects({
			maxResults: 5,
		});
		console.log("OK: total =", result.total, "values =", result.values?.length);
		for (const p of result.values ?? []) {
			console.log(`  ${p.key} - ${p.name} (type: ${p.projectTypeKey})`);
		}
	} catch (err: unknown) {
		printError(err);
	}
	console.log();

	// Test 5: Get a specific issue
	console.log("--- Test 5: issues.getIssue() ---");
	try {
		const searchResult =
			await client.issueSearch.searchForIssuesUsingJqlEnhancedSearch({
				jql: "assignee = currentUser() ORDER BY updated DESC",
				maxResults: 1,
				fields: ["summary"],
				fieldsByKeys: true,
			});
		const firstIssue = searchResult.issues?.[0];
		if (firstIssue?.key) {
			console.log(`  Fetching issue ${firstIssue.key}...`);
			const issue = await client.issues.getIssue({
				issueIdOrKey: firstIssue.key,
			});
			console.log(
				"OK:",
				issue.key,
				(issue.fields as Record<string, unknown>)?.summary,
			);
		} else {
			console.log("SKIP: No issues found to test with");
		}
	} catch (err: unknown) {
		printError(err);
	}
	console.log();

	// Test 6: Get issue comments
	console.log("--- Test 6: issueComments.getComments() ---");
	try {
		const searchResult =
			await client.issueSearch.searchForIssuesUsingJqlEnhancedSearch({
				jql: "assignee = currentUser() ORDER BY updated DESC",
				maxResults: 1,
				fields: ["summary"],
				fieldsByKeys: true,
			});
		const firstIssue = searchResult.issues?.[0];
		if (firstIssue?.key) {
			console.log(`  Fetching comments for ${firstIssue.key}...`);
			const comments = await client.issueComments.getComments({
				issueIdOrKey: firstIssue.key,
				maxResults: 5,
			});
			console.log(
				"OK: total =",
				comments.total,
				"returned =",
				comments.comments?.length,
			);
		} else {
			console.log("SKIP: No issues found to test with");
		}
	} catch (err: unknown) {
		printError(err);
	}

	console.log();
	console.log("=== Diagnostic complete ===");
}

function printError(err: unknown) {
	if (err instanceof Error) {
		console.error("FAILED:", err.message);
		// The jira.js SDK wraps HTTP errors with useful details
		if ("response" in err) {
			const withResponse = err as Error & { response?: Response };
			if (withResponse.response) {
				console.error(
					"  HTTP status:",
					withResponse.response.status,
					withResponse.response.statusText,
				);
			}
		}
		// Try to extract the response body from the error
		const anyErr = err as Record<string, unknown>;
		if (anyErr.response) {
			const resp = anyErr.response as Record<string, unknown>;
			console.error("  Response details:", JSON.stringify(resp, null, 2));
		}
		// Show the full error object for debugging
		console.error("  Full error:", JSON.stringify(err, null, 2));
	} else {
		console.error("FAILED:", err);
	}
}

main().catch((err) => {
	console.error("Fatal error:", err);
	process.exit(1);
});
