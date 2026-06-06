---
sidebar_position: 6
title: Apple Mail
---

# Apple Mail

Connect Toby to the **Mail.app** mailbox on your Mac. Toby searches local mail and can create or update drafts via automation—no cloud API keys.

**CLI name:** `applemail`

:::info[Platform]

**macOS only.** On Linux or Windows you can configure the integration, but chat tools require Mail.app on a Mac.

:::

## Prerequisites

- macOS with **Mail.app** configured (at least one account)
- Permission for your terminal to control Mail (macOS Automation prompt on first use)

## Configure

```bash
toby config
```

Go to **Integrations → Apple Mail**. Optional **Notes** are for your own reference only—no API keys are required. Save.

## Connect

```bash
toby connect applemail
```

Toby runs a quick Mail.app health check and stores a connected flag in `~/.toby/config.json`.

On first automation, approve **System Settings → Privacy & Security → Automation** for your terminal (or IDE) controlling Mail.

## Verify

```bash
toby status integration -i applemail
```

## Disconnect

```bash
toby disconnect applemail
```

This clears Toby’s connection flag only; it does not remove mail from Mail.app.

## Example chat prompts

- “Search my unread mail from the last three days in the Work account.”
- “Draft a reply to the latest message from Sam thanking them for the update.”

## Limitations

- Large mailbox searches work best with filters (unread, date range, mailbox name).
- Message IDs are Mail.app numeric IDs returned by search tools—not RFC Message-IDs.

## Related

- [Integrations overview](overview)
- [Configure and connect](../getting-started/configure-and-status)
