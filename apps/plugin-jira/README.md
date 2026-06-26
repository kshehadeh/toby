# toby-plugin-jira

TypeScript (bun-package) installable Toby plugin for Atlassian Jira (protocol v1). Provides read-only chat tools for JQL issue search, issue details, comments, and project lists.

## Build

From the repo root:

```bash
bun run build:plugin:jira
```

This is a bun-package plugin — no compilation step is needed. The build script stages the directory into `dist/toby-plugin-jira/`.

## Install (dev)

```bash
toby plugins install ./apps/plugin-jira --link --force
toby plugins doctor
toby connect jira
```

## Credentials

Configure in `toby configure` under Jira:

| Field | Description |
| ----- | ----------- |
| Atlassian Domain | Site subdomain (`acme`) or full host (`acme.atlassian.net`) |
| Email | Atlassian account email |
| API Token | API token from Atlassian account settings |
