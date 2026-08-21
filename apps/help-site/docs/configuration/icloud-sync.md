---
sidebar_position: 8
title: iCloud sync
---

# iCloud sync

Share Toby **settings and secrets** across your Macs through **iCloud Drive**.
The file in iCloud is encrypted with a password you choose. Apple does not see
your API keys.

This is separate from [password-protected backup files](../security#backup-and-restore)
(`.tbybak`). Keep backups for offline copies; use iCloud sync for day-to-day
multi-Mac use.

## What is shared

| Shared | Stays on each Mac |
| ------ | ----------------- |
| Settings (personas, connected integrations, AI and tool preferences) | Chat history |
| Secrets (AI keys, Email / Slack / Notion tokens, and other plugin credentials) | Memories, recordings, schedules, flows |
| | Skills, installed plugins, theme / menu bar / home directory |

## Set up the first Mac

1. Sign in to iCloud and turn on **iCloud Drive** in System Settings.
2. Open **Toby.app → Settings → iCloud**.
3. Enter a sync password twice and choose **Enable iCloud sync**.
4. Toby writes an encrypted vault to **iCloud Drive → Toby → config-sync**.

Choose a password you will remember. It is required on every Mac that joins, and
Toby cannot recover it from iCloud.

## Set up a second Mac

1. Install Toby and sign in to the **same** Apple ID with iCloud Drive on.
2. Open **Settings → iCloud**. Toby should see the existing vault.
3. Enter the **same** sync password and choose **Join iCloud vault**.
4. This Mac downloads the snapshot and re-encrypts secrets for its own Keychain.

## After it is enabled

Toby uploads a new snapshot a few seconds after you change settings, and pulls
updates when the app/daemon is running. Last write wins. Previous snapshots are
kept in History (last 10) so you can restore a bad overwrite.

Use **Sync now** / **Pull now** on the iCloud settings tab if you do not want to
wait. CLI equivalents: `toby config sync push` and `toby config sync pull --yes`.

## If two Macs change settings at once

The later snapshot replaces the earlier one. Restore an older snapshot from
**History** if you lost a change. Field-by-field merge is not supported yet.

## Inbound Slack

Sharing Slack tokens is the point of sync. Run the **inbound listener on only
one Mac**. Two daemons should not both listen with the same Socket Mode app.

## Forgot the password

The iCloud vault cannot be decrypted without it. On a Mac that still has your
settings, disable and enable again with a new password (that replaces the cloud
vault), or restore a `.tbybak` backup. Other Macs then join with the new
password.

## Related

- [Security](../security) — encryption and backups
- [Configuration overview](./overview)
- [Toby Mac App](../toby-app)
