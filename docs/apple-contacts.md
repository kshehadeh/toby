# Apple Contacts

First-party integration id: **`applecontacts`**, shipped as the TypeScript bun-package plugin **`toby-plugin-applecontacts`** ([`apps/plugin-applecontacts/`](../apps/plugin-applecontacts/)). Release archives and `install-toby.sh` install it under `~/.toby/plugins/`.

## Setup

1. Install or upgrade Toby so the plugin is available.
2. Launch **Toby.app** once so its native API server is available.
3. Run **`toby connect applecontacts`** once. This requests Contacts permission from macOS and stores a connected flag after a quick Contacts.app health check.

If permission is denied, grant Contacts access to **Toby** in System Settings → Privacy & Security → Contacts, then connect again.

## Tools

| Tool | Purpose |
| ---- | ------- |
| `searchContacts` | Search local contacts by name, organization, email, phone, URL, or address text |
| `getContact` | Read full contact details by identifier |

The plugin is read-only. It does not create, update, or delete contacts.

## Native path

The plugin is a thin TypeScript protocol adapter that forwards all tool executions to Toby.app's native API server via HTTP (`/api/native/contacts/*` endpoints). The app's `NativeContactsHandler.swift` uses native **Contacts.framework** (`CNContactStore`) for permission, search, and detail lookup.

`toby disconnect applecontacts` clears the integration flag from `config.json` (it does not remove contact data).
