# Apple Mail integration

First-party integration id: **`applemail`**.

## Platform

- **macOS only.** Toby drives the local **Mail.app** via AppleScript (`osascript`). On Linux or Windows the module stays registered for configuration/tests but is **not usable** in chat until you are on a Mac.

## Setup

1. Use a Mac with Mail.app configured (at least one account).
2. Run **`toby connect applemail`** once. This stores a small “connected” flag under `~/.toby/config.json` after a quick Mail.app health check.
3. On first real automation, macOS may prompt to allow **Automation** (your terminal or Cursor controlling Mail). Approve it in **System Settings → Privacy & Security → Automation**.

No API keys are stored; optional notes can be saved under **Configure** as `applemail.info`.

## Chat tools

| Tool | Purpose |
| ---- | ------- |
| `listMailAccounts` | List Mail.app account names (and primary email when available); use exact names for the `account` filter. |
| `searchEmails` | Search local mailboxes with optional filters (text, sender, subject, mailbox, account, unread, dates, limit). |
| `createDraft` | Create an unsent draft; returns a numeric **message id**. |
| `updateDraft` | Update subject/body/recipients for a draft identified by that **message id** (only messages in Drafts-like mailboxes). |

Message ids are **Mail.app numeric ids**, not RFC Message-IDs. Prefer ids returned from `searchEmails` or `createDraft`.

## Limitations

- Heavy searches on huge mailboxes can time out; prefer filters (unread, date range, mailbox).
- Draft updates intentionally target mailboxes whose names look like Drafts folders.
- Smart Mailboxes are not exposed via the same AppleScript surface Mail uses for standard folders.

## Disconnect

`toby disconnect applemail` clears the integration flag from `config.json` (it does not remove mail data).
