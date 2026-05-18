---
sidebar_position: 5
title: Azure AD
---

# Azure AD

Connect Toby to Microsoft Graph (Azure AD) for directory and contact-related chat tools.

**CLI name:** `azuread`

## Prerequisites

- An Azure AD / Microsoft Entra tenant
- An app registration with appropriate Graph permissions for your use case

## Configure

```bash
toby config
```

Go to **Integrations → Azure AD** and choose an **Auth Method**:

### OAuth (PKCE) — default

| Field | Description |
| ----- | ----------- |
| Tenant ID | Your Azure AD tenant ID |
| Client ID | Application (client) ID |
| OAuth Redirect URI (optional) | Localhost callback if omitted |

### Client credentials

| Field | Description |
| ----- | ----------- |
| Tenant ID | Your Azure AD tenant ID |
| Client ID | Application (client) ID |
| Client Secret | App secret for client-credentials flow |

Save the configuration.

## Connect

```bash
toby connect azuread
```

- **OAuth (PKCE):** Complete sign-in in the browser.
- **Client credentials:** Connect validates credentials and marks the integration connected.

## Verify

```bash
toby status integration -i azuread
```

## Disconnect

```bash
toby disconnect azuread
```

## Example chat prompts

- “Look up contact details for people named Jordan in my organization.”
- “Who is the manager listed for this email address?”

## Related

- [Integrations overview](overview)
- [Configure and connect](../getting-started/configure-and-status)
