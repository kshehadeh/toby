---
sidebar_position: 3
title: Todoist
---

# Todoist

Connect Toby to Todoist to manage tasks and projects from chat.

Toby ships Todoist as a first-party plugin bundled with Toby.app under `~/.toby/plugins/`.

## Prerequisites

- A [Todoist](https://todoist.com) account
- A personal **API token** from Todoist’s Developer settings (see below)

## Get your API token

Toby authenticates with a **personal API token**, not OAuth. The token is tied to your Todoist account and lets Toby read and update your tasks and projects over the [Todoist REST API](https://developer.todoist.com/rest/v2/). You do **not** need to register an app in Todoist’s App Management Console for personal use.

### 1. Sign in to Todoist

1. Open the [Todoist web app](https://app.todoist.com/).
2. Sign in with the account you want Toby to use.

### 2. Open Developer settings

1. Click your **avatar** (top-left).
2. Select **Settings**.
3. Open the **Integrations** tab.
4. Select the **Developer** tab at the top.

You can also go directly to [Integrations settings](https://app.todoist.com/app/settings/integrations) and open **Developer**.

### 3. Copy your API token

1. Under **API token**, click **Copy API token**.
2. Paste it somewhere safe temporarily—you will enter it in Toby next.

The token is a long string (often 40 characters). Toby sends it as a Bearer token on each API request, same as other Todoist integrations.

### 4. Rotate the token (optional)

If a token was exposed or Connect fails with an auth error:

1. In the same **Developer** tab, click **Issue a new API token**.
2. Confirm with **Create**.
3. Copy the new token and update it in **Toby.app → Integrations → Todoist** (old tokens stop working immediately).

Do not commit your token to git. Toby stores it in `~/.toby/credentials.json` (masked in the UI).

## Configure

Open **Toby.app → Integrations → Todoist** and enter:

| Field | Description |
| ----- | ----------- |
| API Key | Your Todoist personal API token from the Developer tab |

Save the configuration.

## Connect

Click **Connect** on the Todoist detail page. Toby validates the API key and marks Todoist as connected.

## Verify

Return to **Integrations** in the sidebar. Todoist should show as connected and healthy.

## Disconnect

Open the Todoist detail page and click **Disconnect**.

## Example chat prompts

- “What tasks are due today across all projects?”
- “Add a task to follow up with Alex about the design review by Friday.”

## Related

- [Integrations overview](overview)
- [Configure and connect](../getting-started/configure-and-status)
