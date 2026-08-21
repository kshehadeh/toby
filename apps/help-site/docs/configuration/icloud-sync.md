---
sidebar_position: 8
title: Settings sync
---

# Settings sync

Share Toby **settings and secrets** across your Macs through **iCloud Drive** or
a **folder you already sync** (Dropbox, Google Drive, OneDrive, NAS, Syncthing).
The remote file is encrypted with a password you choose. The storage provider
does not see your API keys.

This is separate from [password-protected backup files](../security#backup-and-restore)
(`.tbybak`). Keep backups for offline copies; use sync for day-to-day multi-Mac
use.

iCloud Drive is the default when it is turned on. Use a folder when iCloud
Drive is off, blocked, or you prefer another service.

## What is shared

| Shared | Stays on each Mac |
| ------ | ----------------- |
| Settings (personas, connected integrations, AI and tool preferences) | Chat history |
| Secrets (AI keys, Email / Slack / Notion tokens, and other plugin credentials) | Memories, recordings, schedules, flows |
| | Skills, installed plugins, theme / menu bar / home directory |

## Set up with iCloud Drive

1. Sign in to iCloud and turn on **iCloud Drive** in System Settings.
2. Open **Toby.app → Settings → Sync**.
3. Leave **iCloud Drive** selected, enter a sync password twice, and choose
   **Enable sync**.
4. Toby writes an encrypted vault to **iCloud Drive → Toby → config-sync**.

Choose a password you will remember. It is required on every Mac that joins, and
Toby cannot recover it from the vault.

## If iCloud Drive is not available

Use a folder that already appears on each Mac (Dropbox, Google Drive, a NAS
share, Syncthing, and so on).

1. Open **Settings → Sync**.
2. Choose **Folder**, then **Choose…** and pick a **private** folder you
   already sync.
3. Enter the same kind of sync password and choose **Enable sync**.
4. On the other Mac, pick the matching folder (the path can differ), enter the
   **same** password, and **Join vault**.

Toby writes `Toby/config-sync/vault.json` inside the folder you picked, not at
the root of Dropbox or Drive. If the folder is unmounted later, sync stays on
and retries; it does not delete your local settings.

CLI equivalent: `toby config sync enable --dir /path/to/folder`.

## Set up a second Mac (iCloud)

1. Install Toby and sign in to the **same** Apple ID with iCloud Drive on.
2. Open **Settings → Sync**. Toby should see the existing vault.
3. Enter the **same** sync password and choose **Join vault**.
4. This Mac downloads the snapshot and re-encrypts secrets for its own Keychain.

## After it is enabled

Toby uploads a new snapshot a few seconds after you change settings, and pulls
updates when the app/daemon is running. Last write wins. Previous snapshots are
kept in History (last 10) so you can restore a bad overwrite.

Use **Sync now** / **Pull now** on the Sync settings tab if you do not want to
wait. CLI equivalents: `toby config sync push` and `toby config sync pull --yes`.

To change between iCloud Drive and a folder, disable sync on this Mac and enable
again with the other transport.

## If two Macs change settings at once

The later snapshot replaces the earlier one. Restore an older snapshot from
**History** if you lost a change. Field-by-field merge is not supported yet.

## Inbound Slack

Sharing Slack tokens is the point of sync. Run the **inbound listener on only
one Mac**. Two daemons should not both listen with the same Socket Mode app.

## Forgot the password

The vault cannot be decrypted without it. On a Mac that still has your
settings, disable and enable again with a new password (that replaces the
remote vault), or restore a `.tbybak` backup. Other Macs then join with the new
password.

## Related

- [Security](../security) — encryption and backups
- [Configuration overview](./overview)
- [Toby Mac App](../toby-app)
