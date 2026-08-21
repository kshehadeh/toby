---
sidebar_position: 12
title: Security
---

# Security

How Toby keeps your API keys and integration secrets on your Mac, and how
backup and restore work.

## What Toby protects

Toby stores secrets **on your computer**. There is no Toby-hosted cloud for
credentials. Optional [iCloud sync](./configuration/icloud-sync) stores only an
**encrypted** snapshot in **your** iCloud Drive.

| Goal | How Toby handles it |
| ---- | ------------------- |
| Keep secrets out of plain text files | On macOS, `credentials.json` is **encrypted at rest** |
| Let you move settings between Macs | **Password-protected** backup files (`.tbybak`) and optional **iCloud sync** |
| Avoid leaking keys in the UI | Settings shows masked values (`••••••`) for secrets |

Toby does **not** replace full-disk encryption, a strong Mac login password, or
caution about malware running as your user. Treat your Mac login and Keychain as
part of your security boundary.

## Where data lives

| Location | What it holds |
| -------- | ------------- |
| `~/.toby/config.json` | Preferences that are **not** secrets (personas, which integrations are connected, defaults, web search, …) |
| `~/.toby/credentials.json` | **Secrets**: AI keys, Email/Notion/Slack tokens, and other integration credentials |
| Other `~/.toby/…` paths | Chat history, memories, recordings, skills — see [Configuration overview](./configuration/overview) |

Integration **passwords and API keys** live in credentials. “Connected”
status alone lives in config — so a backup only helps for secrets that were
actually saved when you created it.

## Credentials encryption (macOS)

On Mac, Toby encrypts the credentials file with **AES-256-GCM**. The
encryption key is stored in the **macOS Keychain**, not next to the file.

| Keychain field | Value |
| -------------- | ----- |
| Service | `dev.toby.credentials` |
| Account | `data-encryption-key` |

You may see a one-time prompt the first time Toby needs to use this Keychain
item. After that, Settings and plugins keep working as usual — encryption is
transparent while you use Toby.

### What this means in practice

- Opening `credentials.json` in a text editor shows ciphertext, not raw API
  keys.
- **Copying only** `credentials.json` to another computer does **not** unlock
  your secrets (the Keychain item does not travel with the file).
- If the Keychain item is deleted and you have no backup, Toby cannot decrypt
  the file — re-enter secrets in Settings, restore a `.tbybak` backup, or join
  [iCloud sync](./configuration/icloud-sync) from another Mac.

## iCloud sync

**Settings → iCloud** can keep an encrypted copy of settings and secrets in
iCloud Drive so your other Macs stay in sync. The wrapping password is stored in
this Mac’s Keychain (`dev.toby.sync`), not in iCloud. See
[iCloud sync](./configuration/icloud-sync) for setup, what is included, and
password recovery.

## Backup and restore

Use a **password-protected backup** when you want a portable copy of settings
and secrets (new Mac, reinstall, safety before a big change).

### From Toby.app

| Menu | Action |
| ---- | ------ |
| **File → Backup Settings…** | Choose a password, then a save location for a `.tbybak` file |
| **File → Restore Settings…** | Pick a `.tbybak` file, enter the password if asked, confirm replace |

### From Terminal

```sh
toby config backup
toby config backup ~/Desktop
toby config restore ~/Desktop/toby-config-backup-….tbybak
```

The app menus use the **same** `.tbybak` format as these CLI commands.

### What a backup includes

| Included | Not included |
| -------- | ------------ |
| Settings in `config.json` (personas, connection flags, defaults, …) | Chat history database |
| Secrets in credentials (AI keys, **Email, Notion, Slack, and other plugin credentials**, transcription keys) | Audio recordings |
| | Memories database |
| | Installed plugin packages |

The archive is encrypted with **your backup password** (separate from the
Keychain). Anyone with the file **and** that password can restore your
secrets — choose a strong password and store the file carefully.

### Restore notes

- Restore **replaces** current config and credentials for those files.
- After restore, Toby re-encrypts credentials for **this** Mac’s Keychain.
- Prefer restore over manually copying `credentials.json`.

## Tips

1. **Back up before major upgrades** or when changing machines.
2. **Never commit** `credentials.json` or `.tbybak` files to git.
3. If an integration looks “connected” but tools fail, open Settings and
   re-enter that integration’s secrets — connection flags and secrets are
   stored separately.
4. Full-disk encryption (FileVault) plus a locked Mac login still matter.

## Related

- [Configuration overview](./configuration/overview) — paths and Settings map
- [iCloud sync](./configuration/icloud-sync) — multi-Mac encrypted snapshots
- [Toby.app](./toby-app) — File menu backup/restore and Settings
- [Configure and connect](./getting-started/configure-and-status) — setting up integrations
