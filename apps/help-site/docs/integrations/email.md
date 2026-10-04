---
sidebar_position: 2
title: Email
---

# <span class="docs-brand-title"><img class="docs-brand-icon" src="/img/integrations/email.png" alt="" width="40" height="40" />Email</span>

Connect Toby to any IMAP/SMTP mailbox to read, search, and organize email from chat.

Email ships as a plugin bundled with Toby.app installs and updates under `~/.toby/plugins/`.

## Prerequisites

- An email account that supports **IMAP** (for reading mail) and **SMTP** (for sending mail)
- Your IMAP **host**, **port**, **username**, and **password**
- Your SMTP **host**, **port**, **username**, and **password**

:::tip[Use guided setup in Toby.app]
Open **Toby.app → Settings → Integrations → Email** and click **Start setup**. Enter your email address and Toby looks up the IMAP and SMTP servers for that domain. Confirm the servers, add your password (often an app password), and connect.

**Setup Guide** on the same page remains available when you already know the server settings and want to enter them yourself.
:::

## How IMAP/SMTP credentials work

The Email plugin uses standard IMAP and SMTP credentials instead of OAuth. You provide:

- **IMAP host** and **port** (e.g. `imap.gmail.com:993` for Gmail, `imap.fastmail.com:993` for Fastmail, `outlook.office365.com:993` for Outlook/Microsoft 365)
- **IMAP username** (usually your email address) and **password** (use an **App Password** if your provider requires one — see below)
- **SMTP host** and **port** (e.g. `smtp.gmail.com:465` for Gmail, `smtp.fastmail.com:465` for Fastmail, `smtp.office365.com:587` for Outlook/Microsoft 365)
- **SMTP username** and **password** (often the same as your IMAP credentials)

Use **port 993** with **SSL/TLS** for IMAP (recommended) or port 143 with STARTTLS. For SMTP, use **port 465** with **SSL/TLS** or port 587 with STARTTLS.

### App passwords

Many providers (Gmail, Yahoo, iCloud, Fastmail, and others) require an **App Password** instead of your regular account password when IMAP/SMTP access is enabled. Create one in your provider's security or account settings and use that password in the configure fields below.

## Configure

Open **Toby.app → Settings → Integrations → Email** and fill in the **Incoming mail (IMAP)**, **Outgoing mail (SMTP)** and **Sender** sections:

| Section | Field | Description |
| ------- | ----- | ----------- |
| Incoming mail (IMAP) | Server | IMAP server hostname (e.g. `imap.gmail.com`) |
| Incoming mail (IMAP) | Port | IMAP server port (default `993`) |
| Incoming mail (IMAP) | Use TLS | On for port 993 |
| Incoming mail (IMAP) | Username | Your email address or IMAP login |
| Incoming mail (IMAP) | Password | Account password or App Password (shown as **Saved** once stored) |
| Outgoing mail (SMTP) | Server | SMTP server hostname (e.g. `smtp.gmail.com`) |
| Outgoing mail (SMTP) | Port | SMTP server port (`587` for STARTTLS, `465` for TLS) |
| Outgoing mail (SMTP) | Use TLS | On for port 465, off for STARTTLS on 587 |
| Outgoing mail (SMTP) | Username | Your email address or SMTP login |
| Outgoing mail (SMTP) | Password | Account password or App Password |
| Sender | Email address, Name | What recipients see on messages Toby sends |

Save the configuration.

## Connect

Click **Connect** on the Email detail page. Toby validates your IMAP and SMTP credentials and marks the integration connected.

## Verify

Return to **Settings → Integrations**. Email should show as connected and healthy. You can also open the Email detail page to confirm status text from Toby.

## Disconnect

Select Email in **Settings → Integrations** and click **Disconnect**. This clears Toby's connection flag — it does not delete your mail at the provider.

## Example chat prompts

Switch to the built-in [**Mailman** persona](../personas#mailman) for inbox triage (Needs attention / Worth noting / Ignore, plus category labels).

- "Summarize my unread email from today and list anything that needs a reply."
- "Find threads about the Q2 launch and suggest archive or label actions."
- "Search my inbox for messages from alice@example.com from last week."

## Related

- [Integrations overview](overview)
- [Personas](../personas)
- [Configure and connect](../getting-started/configure-and-status)
