---
sidebar_position: 2
title: Gmail
---

# Gmail

Connect Toby to your Gmail account to read, search, and organize email from chat.

**CLI name:** `gmail`

## Prerequisites

- A Google Cloud project with the Gmail API enabled
- OAuth 2.0 **Client ID** and **Client Secret** from the [Google Cloud Console](https://console.cloud.google.com/)

## Google Cloud Console setup

Toby runs a local OAuth callback on **`http://localhost:9876/callback`** and requests Gmail **read** and **modify** scopes. Create credentials in a project you control (personal Gmail or Google Workspace).

### 1. Create or select a project

1. Open the [Google Cloud Console](https://console.cloud.google.com/).
2. Use the project picker (top bar) to **create a project** or select an existing one.

### 2. Enable the Gmail API

1. Go to **APIs & Services → Library**.
2. Search for **Gmail API** and open it.
3. Click **Enable**.

### 3. Configure the OAuth consent screen

1. Go to **APIs & Services → OAuth consent screen**.
2. Choose a **User type**:
   - **Internal** — only accounts in your Google Workspace organization (Workspace only).
   - **External** — personal Gmail or users outside your org.
3. Fill in the required app information (app name, support email, developer contact).
4. On **Scopes**, add (or confirm) these Gmail scopes:
   - `https://www.googleapis.com/auth/gmail.readonly`
   - `https://www.googleapis.com/auth/gmail.modify`
5. If the app is **External** and still in **Testing**, add your Google account under **Test users** so you can sign in during development.
6. Save through the consent-screen wizard.

Publishing to **Production** removes the test-user limit but may require Google verification if you use sensitive scopes at scale. For personal use, **Testing** with yourself as a test user is usually enough.

### 4. Create OAuth client credentials

1. Go to **APIs & Services → Credentials**.
2. Click **Create credentials → OAuth client ID**.
3. If prompted, finish the consent screen steps above first.
4. Choose an application type:

   **Desktop app (recommended)** — Toby opens a browser and completes OAuth on localhost. Google allows loopback redirects for desktop clients; no redirect URI field is required in the console.

   **Web application** — Use this only if you prefer a web client. Under **Authorized redirect URIs**, add exactly:

   ```text
   http://localhost:9876/callback
   ```

5. Click **Create**.
6. Copy the **Client ID** and **Client secret** (you need the secret once; Google may not show it again).

Use these values in the next section. Do not commit them to git; Toby stores them in `~/.toby/credentials.json` via configure.

## Configure

```bash
toby config
```

Go to **Integrations → Gmail** and enter:

| Field | Description |
| ----- | ----------- |
| Client ID | OAuth client ID from Google Cloud Console |
| Client Secret | OAuth client secret (stored masked) |

Save the configuration.

## Connect

```bash
toby connect gmail
```

Toby opens the Google OAuth flow. After you approve access, tokens are stored and Gmail is marked connected.

## Verify

```bash
toby status integration -i gmail
```

## Disconnect

```bash
toby disconnect gmail
```

## Example chat prompts

- “Summarize my unread email from today and list anything that needs a reply.”
- “Find threads about the Q2 launch and suggest labels or archive actions.”

## Related

- [Integrations overview](overview)
- [Configure and connect](../getting-started/configure-and-status)
