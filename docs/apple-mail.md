# Apple Mail integration

First-party integration id: **`applemail`**.

Shipped as a **Swift installable plugin** (`toby-plugin-applemail`) under `~/.toby/plugins/`. Release installs and upgrades install it automatically; when building from source, run `toby plugins install ./dist/toby-plugin-applemail`.

Implementation: [`apps/plugin-applemail/`](../apps/plugin-applemail/).

## Platform

- **macOS only.** The plugin drives local **Mail.app** via AppleScript (`osascript`). On non-macOS hosts the plugin is not usable in chat.

## Setup

1. Use a Mac with Mail.app configured (at least one account).
2. Ensure the plugin is installed (`toby plugins list` should show `applemail`, or run `toby plugins doctor`).
3. Run **`toby connect applemail`** once. This stores a small “connected” flag under `~/.toby/config.json` after a quick Mail.app health check.
4. On first real automation, macOS may prompt to allow **Automation** (your terminal or Cursor controlling Mail). Approve it in **System Settings → Privacy & Security → Automation**.

No API keys are stored.

## Chat tools

| Tool | Purpose |
| ---- | ------- |
| `listMailAccounts` | List Mail.app account names (and primary email when available); use exact names for the `account` filter. |
| `searchEmails` | Search local mailboxes with optional filters (text, sender, subject, mailbox, account, unread, dates, limit). |
| `listMailboxes` | List mailbox names per account. |
| `createDraft` | Create an unsent draft; returns a numeric **message id**. |
| `updateDraft` | Update subject/body/recipients for a draft identified by that **message id** (only messages in Drafts-like mailboxes). |
| `archiveMailMessage` | Move a message to an Archive-like mailbox on the same account. |
| `flagMailMessage` | Set or clear Mail’s flagged status. |
| `moveMailMessage` | Move a message to another mailbox on the same account. |

Message ids are **Mail.app numeric ids**, not RFC Message-IDs. Prefer ids returned from `searchEmails` or `createDraft`.

## Limitations

- Heavy searches on huge mailboxes can time out; prefer filters (unread, date range, mailbox).
- Draft updates intentionally target mailboxes whose names look like Drafts folders.
- Smart Mailboxes are not exposed via the same AppleScript surface Mail uses for standard folders.

## Disconnect

`toby disconnect applemail` clears the integration flag from `config.json` (it does not remove mail data).
