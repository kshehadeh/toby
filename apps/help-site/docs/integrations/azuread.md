---
sidebar_position: 99
title: Azure AD (removed)
unlisted: true
---

# Azure AD (removed)

The **Azure AD** integration (`azuread` / `toby-plugin-azuread`) is **no longer
shipped** with Toby.

If you previously connected Azure AD:

- Remove or ignore any leftover `azuread` entries under
  `~/.toby/credentials.json` and `~/.toby/config.json`
- Uninstall a leftover plugin directory if present:
  `toby plugins uninstall azuread`

For Microsoft 365-style workflows today, use the integrations that are still
supported—for example [Email](./email) for mailbox access, [Slack](./slack)
for chat, or other providers listed in the
[Integrations overview](./overview).

See also [Creating a plugin](../plugins/creating-a-plugin) if you want to build
a custom Microsoft Graph integration for your own use.
