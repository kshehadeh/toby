# Email plugin

Generic IMAP/SMTP email integration with a local SQLite cache.

## Standard tools

- `getUnreadSummary` — `email.unreadSummary`, for Home.
- `archiveDashboardItem` — `email.archiveItem`, for Home item actions.
- `markDashboardItemRead` — `email.markItemRead`, for Home item actions.
- `getRecentActivity` — `activity.recent`, for the observation ledger. Accepts
  `since` (ISO 8601) and optional `limit` (default 200, max 1000). Reads INBOX
  and the special-use Sent mailbox (or a common Sent folder name), returns
  deduplicated messages newest first, and includes the user's email identities.
  Snippets fetch at most 8 KiB of an inline text part; attachments are not fetched.

## Tests

Run `bun run test` from this directory.
