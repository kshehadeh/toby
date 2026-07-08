# Toby Apple Contacts plugin

Installable integration plugin for local **Contacts.app** on macOS. Implements [plugin protocol v1](../../../docs/plugin-protocol.md) as a TypeScript bun-package that delegates all contact operations to Toby.app's native API server.

## Development

```bash
bun run build:plugin:applecontacts
toby plugins install ./dist/toby-plugin-applecontacts --link --force
toby connect applecontacts
```

## Tools

| Tool | Purpose |
| ---- | ------- |
| `searchContacts` | Search local contacts by name, organization, email, phone, URL, or address text |
| `getContact` | Read full details for one contact by identifier |

Toby.app uses Apple's **Contacts.framework** (`CNContactStore`) and owns the Contacts permission prompt. The plugin itself is a thin TypeScript protocol adapter.
