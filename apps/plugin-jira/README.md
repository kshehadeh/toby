# toby-plugin-jira

Swift installable Toby plugin for Atlassian Jira (protocol v1). Provides read-only chat tools for JQL issue search, issue details, comments, and project lists.

## Build

From the repo root:

```bash
bun run build:plugin:jira
```

Or directly:

```bash
swift build -c release --package-path apps/plugin-jira
```

Output: `dist/toby-plugin-jira` (via root script) or `.build/release/toby-plugin-jira`.

## Install (dev)

```bash
toby plugins install ./dist/toby-plugin-jira --link --force
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
