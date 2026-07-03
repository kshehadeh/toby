---
sidebar_position: 5
title: Azure AD
---

# Azure AD

Connect Toby to Microsoft Graph (Azure AD) for directory and contact-related chat tools.

**CLI name:** `azuread`

Azure AD ships as an installable plugin (`toby-plugin-azuread`). Release installs
and upgrades place it in `~/.toby/plugins/` automatically. When building from
source, run `bun run build:plugin:azuread` then
`toby plugins install ./dist/toby-plugin-azuread`.

## Prerequisites

- A Microsoft Entra ID (Azure AD) tenant
- An [app registration](#microsoft-entra-app-registration) with Microsoft Graph permissions for directory lookup

## Microsoft Entra app registration

Toby calls [Microsoft Graph](https://learn.microsoft.com/en-us/graph/) to search users and read profile fields. You need **Tenant ID**, **Client ID**, and (for client-credentials auth) a **Client Secret**.

Required Graph permissions (both auth methods):

- `User.Read.All`
- `User.ReadBasic.All`

OAuth (PKCE) also requests `openid`, `profile`, and `offline_access` during sign-in.

### 1. Register an application

1. Open the [Microsoft Entra admin center](https://entra.microsoft.com/) (or [Azure Portal → Microsoft Entra ID](https://portal.azure.com/#view/Microsoft_AAD_IAM/ActiveDirectoryMenuBlade/~/RegisteredApps)).
2. Go to **Applications → App registrations → New registration**.
3. Enter a name (for example `Toby`).
4. Choose **Supported account types** (single tenant is typical for org directory lookup).
5. For **Redirect URI**, choose **Public client/native (mobile & desktop)** and add:

   ```text
   http://localhost:9877/callback
   ```

   This matches Toby’s default OAuth callback. If you set a custom **OAuth Redirect URI** in configure, register that exact URL instead.

6. Click **Register**.
7. On the app **Overview** page, copy **Application (client) ID** and **Directory (tenant) ID**.

### 2. Allow public client flows (OAuth PKCE only)

If you use **OAuth (PKCE)** (Toby’s default):

1. Open **Authentication** for the app.
2. Under **Advanced settings**, set **Allow public client flows** to **Yes** (Toby exchanges the auth code with PKCE and does not send a client secret on that step).
3. Confirm **http://localhost:9877/callback** appears under redirect URIs.
4. Save.

### 3. Add Microsoft Graph API permissions

1. Open **API permissions → Add a permission → Microsoft Graph**.

**OAuth (PKCE) — delegated permissions**

Add these **Delegated** permissions:

| Permission | Purpose |
| ---------- | ------- |
| `User.Read.All` | Read all users’ full profiles |
| `User.ReadBasic.All` | Read basic profile for all users |
| `openid`, `profile`, `offline_access` | Sign-in and refresh tokens (often added automatically with user read scopes) |

**Client credentials — application permissions**

Add these **Application** permissions instead:

| Permission | Purpose |
| ---------- | ------- |
| `User.Read.All` | Read all users (app-only) |
| `User.ReadBasic.All` | Read basic profiles (app-only) |

2. Click **Grant admin consent** for your tenant if required (common for `User.Read.All`).

### 4. Create a client secret (client credentials only)

Skip this step for **OAuth (PKCE)** unless you also use client credentials elsewhere.

1. Open **Certificates & secrets → New client secret**.
2. Add a description and expiry, then create the secret.
3. Copy the **Value** immediately (Entra hides it later).

### 5. Copy values into Toby

Use **Tenant ID**, **Client ID**, and (for client credentials) **Client Secret** in the [Configure](#configure) section. Do not commit secrets to git; Toby stores them in `~/.toby/credentials.json`.

## Configure

Open **Toby.app → Integrations → Azure AD** and choose an **Auth Method**: (You can also run `toby config` in the terminal.)

### OAuth (PKCE) — default

| Field | Description |
| ----- | ----------- |
| Tenant ID | Your Azure AD tenant ID |
| Client ID | Application (client) ID |
| OAuth Redirect URI (optional) | Defaults to `http://localhost:9877/callback` if omitted |

### Client credentials

| Field | Description |
| ----- | ----------- |
| Tenant ID | Your Azure AD tenant ID |
| Client ID | Application (client) ID |
| Client Secret | App secret for client-credentials flow |

Save the configuration.

## Connect

Click **Connect** in Toby.app, or run:

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
