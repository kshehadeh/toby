---
sidebar_position: 9
title: Apple Contacts
---

# <span class="docs-brand-title"><span class="docs-brand-icon-emoji" aria-hidden="true">👤</span>Apple Contacts</span>

Connect Toby to **Contacts.app** on your Mac to search people and look up contact details.

The Apple Contacts plugin ships with Toby.app under `~/.toby/plugins/`.

:::info[Platform]

**macOS only.** Contact tools require Contacts.app on a Mac.

:::

## Prerequisites

- macOS with **Contacts.app** and at least some contacts (iCloud, Exchange, Google via CardDAV, local, etc.)
- **Toby.app** installed and launched (the plugin auto-launches it when not running)
- Contacts permission granted to **Toby.app** in System Settings → Privacy & Security → Contacts

## Configure

Open **Toby.app → Integrations → Apple Contacts**. Optional **Notes** are for your own reference only. Save.

## Connect

Click **Connect** on the Apple Contacts detail page. Toby runs a Contacts.app health check (and may prompt for permission) and stores a connected flag.

The plugin delegates all contact operations to Toby.app's native API server,
which uses **Contacts.framework** (`CNContactStore`). When Toby.app is not
running, the plugin auto-launches it in the background. Contacts permission is
granted to Toby.app, not the plugin itself.

## Verify

Return to **Integrations** in the sidebar. Apple Contacts should show as connected. The first time you use contact tools, macOS may prompt you to grant Contacts access to Toby.app.

If permission was denied, enable it in **System Settings → Privacy & Security → Contacts**, then connect again.

## Disconnect

Open the Apple Contacts detail page and click **Disconnect**. This clears Toby's connection flag; it does not modify your address book.

## What you can do in chat

| Capability | Examples |
| ---------- | -------- |
| Search | Find people by name, organization, email, phone, URL, or address text |
| Detail | Open a full contact by identifier from a search result |

The integration is **read-only**. It does not create, update, or delete contacts.

## Example chat prompts

- “Look up Jane Doe in my contacts.”
- “Find contact emails for people at Acme.”
- “Who do I have with the phone number ending in 1234?”

## Tips

- Prefer **identifiers** returned from search when asking for full details.
- Empty search lists contacts up to a limit (default 25, max 100).
- Apple Contacts is a **Contact List Provider**. If you connect more than one contacts source later, set a default under **Settings → Default Providers**.

## Related

- [Integrations overview](overview)
- [Apple Calendar](apple-calendar)
- [Apple Reminders](apple-reminders)
- [Native API](../api/native-api) — `/api/native/contacts/*`
- [Toby.app](../toby-app)
- [Configure and connect](../getting-started/configure-and-status)
