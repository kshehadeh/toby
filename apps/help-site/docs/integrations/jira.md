---
sidebar_position: 9
title: Jira
---

# Jira

Connect Toby to Atlassian Jira to search and read issues, comments, and projects from chat.

**CLI name:** `jira`

Shipped as **`toby-plugin-jira`** (TypeScript bun-package). Release installs place it in `~/.toby/plugins/`; from source run `toby plugins install ./apps/plugin-jira`.

## Prerequisites

- An Atlassian account with access to your Jira site
- Your Jira site domain, such as `your-company.atlassian.net`
- An Atlassian API token for that account

## Get an API token

1. Open [Atlassian API tokens](https://id.atlassian.com/manage-profile/security/api-tokens).
2. Choose **Create API token** (classic, without scopes — simplest for Toby).
3. Give the token a name such as `Toby`.
4. Copy the token and keep it safe until you paste it into Toby.

If your organization requires a **scoped API token** instead, Toby automatically retries via the Atlassian gateway (`api.atlassian.com/ex/jira/{cloudId}`) when the site URL rejects authentication. The token still needs Jira read scopes (for example `read:jira-work`).

Do not commit the token to git. Toby stores it in `~/.toby/credentials.json` and masks it in the configure UI.

## Configure

```bash
toby config
```

Go to **Integrations → Jira** and enter:

| Field | Description |
| ----- | ----------- |
| Atlassian Domain | Your Jira site domain, for example `your-company.atlassian.net` |
| Email | The Atlassian account email for the API token |
| API Token | The Atlassian API token |

Save the configuration.

## Connect

```bash
toby connect jira
```

Toby validates the domain, email, and API token, then marks Jira as connected.

## Verify

```bash
toby status integration -i jira
```

Status can validate the Jira API and the read-only tools.

## Chat capabilities

Jira tools are read-only. Toby can:

- Search issues with JQL (`searchJiraIssues`)
- Fetch full issue details (`getJiraIssue`)
- Read issue comments (`getJiraIssueComments`)
- List accessible projects (`listJiraProjects`)

Example prompts:

- “Find my unresolved Jira issues updated this week.”
- “Show details and recent comments for PROJ-123.”
- “List Jira projects I can access.”
- “Search Jira for bugs in the current sprint ordered by priority.”

You can scope chat to Jira explicitly:

```bash
toby chat --integration jira "Find unresolved issues assigned to me"
```

or:

```text
jira find unresolved issues assigned to me
```

## JQL examples

Useful JQL patterns:

```text
assignee = currentUser() AND resolution = Unresolved ORDER BY updated DESC
project = PROJ AND status != Done
key = PROJ-123
type = Bug AND sprint in openSprints()
```

Search and comment results are paginated; Toby requests up to 100 items at a time when needed.

## Disconnect

```bash
toby disconnect jira
```

## Related

- [Integrations overview](overview)
- [Configure and connect](../getting-started/configure-and-status)
