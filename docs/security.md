# Security: credentials and backups

How Toby stores secrets on disk, encrypts them on macOS, exports them via
backup/restore, and syncs them across Macs through an **encrypted iCloud Drive
vault**. Implementation lives primarily under
[`packages/core/src/config/`](../packages/core/src/config/).

## Threat model (honest scope)

**Protects against:** casual reads of `~/.toby/credentials.json` (home-folder
browsing, accidental paste of the file, unencrypted disk snapshots of that path
without Keychain access).

**Does not protect against:** malware running as the same logged-in user after
Keychain unlock; memory dumps of the daemon; plugins receiving their own secrets
on stdin; root or unlocked-session attackers with Keychain access.

Toby is a personal local agent. The model matches many macOS CLI tools that use
Keychain-held keys.

## Separation of config vs credentials

| File | Contents | Encryption |
| ---- | -------- | ---------- |
| `~/.toby/config.json` | Non-secret preferences: personas, connection flags (`connectedAt`), defaults, web search, inbound chat, listen settings, etc. | None (mode `0o600` when written via core helpers) |
| `~/.toby/credentials.json` | Secrets: AI keys, integration tokens/passwords under `integrations.<name>`, transcription keys | **AES-256-GCM envelope on macOS**; Keychain holds the data key |

Plugin settings that are secrets (Email IMAP password, Notion API key, Slack
tokens, …) live under **`credentials.integrations.<plugin>`**, not only in
`config.json`. Connection state (e.g. `connectedAt`) lives in
`config.integrations.<plugin>`.

All production I/O for secrets should go through `readCredentials()` /
`writeCredentials()` in
[`packages/core/src/config/index.ts`](../packages/core/src/config/index.ts).
Plugins must not read `~/.toby` themselves; core injects config via the stdin
envelope (see [plugin-protocol.md](plugin-protocol.md)).

## Credentials at rest (macOS)

### Envelope format

On disk, `credentials.json` is **not** plaintext JSON after migration. It is a
versioned envelope:

```json
{
  "version": 1,
  "format": "toby.credentials.encrypted",
  "encryption": {
    "cipher": "aes-256-gcm",
    "keySource": "keychain",
    "keychainService": "dev.toby.credentials",
    "keychainAccount": "data-encryption-key",
    "iv": "<base64>",
    "authTag": "<base64>"
  },
  "ciphertext": "<base64 AES-GCM of UTF-8 CredentialsFile JSON>"
}
```

Code: [`credentials-crypto.ts`](../packages/core/src/config/credentials-crypto.ts).

### Debug: decrypt a credentials file

For local debugging only (prints secrets — never commit the output):

```bash
# Default: ~/.toby/credentials.json → stdout (metadata on stderr)
bun scripts/decrypt-credentials.ts

# Explicit path / write to a temp file (mode 0600)
bun scripts/decrypt-credentials.ts ~/.toby/credentials.json -o /tmp/creds.plain.json
```

Encrypted envelopes need the macOS Keychain DEK named in the file
(`dev.toby.credentials` / `data-encryption-key` by default). A file copied from
another Mac cannot be decrypted without that machine’s Keychain key.

### Keychain item

Toby stores a **32-byte data encryption key (DEK)** as a **generic password** in
the macOS Keychain:

| Field | Value |
| ----- | ----- |
| Service (`-s`) | `dev.toby.credentials` |
| Account (`-a`) | `data-encryption-key` |
| Password payload | Base64 encoding of the 32-byte DEK |

Access uses the `security` CLI (`find-generic-password` / `add-generic-password`
with `-U -A`) from
[`credentials-keychain.ts`](../packages/core/src/config/credentials-keychain.ts)
so the daemon and CLI work without Toby.app running and without native Node
addons.

Items are created with **allow-all apps** (`-A`) so headless daemon restarts can
read the DEK without interactive ACL prompts. First use may still prompt once
depending on Keychain policy.

### Read / write path

1. **Write:** `getOrCreateDataKey()` → AES-256-GCM encrypt JSON → atomic write
   with mode `0o600`. Key is verified readable after create.
2. **Read:** detect envelope → load DEK from Keychain → decrypt → parse
   `CredentialsFile`. Decrypt failure is **fail-closed** (error, not empty
   secrets).
3. **Legacy plaintext:** if the file is still a plain `CredentialsFile` object,
   it is returned and **eagerly re-encrypted** on successful Keychain access.
4. **In-process cache:** decrypted credentials may be cached by path + mtime
   until the next write.

### Backends (`TOBY_CREDENTIALS_KEY_BACKEND`)

| Value | Behavior |
| ----- | -------- |
| *(default on darwin)* | `keychain` |
| `keychain` | Force Keychain DEK |
| `memory` | Process-local DEK (**requires `TOBY_DIR`**). Without `TOBY_DIR`, treated as `plaintext` so tests cannot encrypt real `~/.toby` with a disposable key |
| `plaintext` | No encryption (legacy shape on disk) |
| *(non-darwin default)* | `plaintext` |

### Recovery notes

- Deleting the Keychain item while leaving an encrypted file makes secrets
  unreadable until a password backup is restored or secrets are re-entered.
- Copying only `credentials.json` to another Mac does **not** move the DEK;
  use [backup/restore](#backup-and-restore) or [settings sync](#settings-sync)
  instead.

## Settings sync

Multi-Mac sharing uses a **dumb blob store**: iCloud Drive by default, or a
user-picked folder (Dropbox, Google Drive, NAS, …) when Drive is unavailable.
The remote file is an AES-256-GCM + scrypt envelope
(`format: "toby.config.sync.encrypted"`). The storage provider never sees
plaintext secrets. After pull, credentials are re-wrapped with **this Mac’s**
Keychain DEK.

| Keychain field | Value |
| -------------- | ----- |
| Service | `dev.toby.sync` |
| Account | `vault-passphrase` |

Payload, clocks, history, denylist, and surfaces: [icloud-sync.md](icloud-sync.md).

**Does not protect against** someone who has both the vault file **and** the
sync password. Forgotten password cannot be recovered from the vault; re-enable
from a Mac that still has local secrets, or restore a `.tbybak`.

## Backup and restore

Password-protected archives (`.tbybak`) export settings, credentials, and
safe SQLite snapshots so a machine move does not depend on Keychain.

### What is included

| Included | Not included (today) |
| -------- | -------------------- |
| Full `config.json` object (`readConfigRaw`) | Recordings and audio/transcript artifacts |
| Full decrypted `CredentialsFile` (all `integrations.*`, AI, transcription) | Installed plugin packages under `plugins/` |
| `chat.sqlite` (chat sessions, projects, schedules, flows, run history) | Plugin local data under `plugins-data/` |
| `memory.sqlite` (memories, sources, proposals, audit data) | Skills directory bodies and persona image files |

### Crypto

- Outer backup file: AES-256-GCM + **scrypt** password KDF  
  (`format: "toby.config.backup.encrypted"`, version 2).  
  Code: [`backup-crypto.ts`](../packages/core/src/config/backup-crypto.ts),
  orchestration [`backup.ts`](../packages/core/src/config/backup.ts).
- Inner payload (version 2):

```ts
{
  version: 2,
  createdAt: string, // ISO
  config: Record<string, unknown>,
  credentials: CredentialsFile,
  databases: {
    version: 1,
    chat: { compression: "gzip-base64", data: string, sha256: string },
    memory: { compression: "gzip-base64", data: string, sha256: string }
  }
}
```

Legacy **unencrypted** payload JSON is still accepted on restore.

### Surfaces

| Surface | Entry |
| ------- | ----- |
| Toby.app | **File → Backup Toby Data…** / **Restore Toby Data…** |
| CLI | `toby config backup` / `toby config restore` |
| Daemon API | `POST /api/config/backup`, `POST /api/config/restore` (see [server-api.md](server-api.md)) |

App and CLI use the **same** core helpers and file format. The app never
reimplements Keychain decrypt; it asks the daemon, which calls
`readCredentials()`.

### Restore behavior

1. Parse file; if encrypted, require password.
2. Require explicit confirmation (`confirm: true` on API; prompt on CLI unless
   `--yes`).
3. `writeConfigRaw` + `writeCredentials` (credentials re-encrypted at rest on
   macOS with **this machine’s** Keychain DEK).
4. For complete v2 backups, validate and stage both SQLite databases, then
   restart the daemon so they replace local databases before either is opened.
   Legacy v1 settings-only backups remain supported.
4. Invalidate configure / model-list caches on the API path.

### Operational guidance

- Prefer `.tbybak` for machine moves and pre-upgrade safety.
- Do not commit `credentials.json` or `.tbybak` files to git.
- After restore, re-check Settings if connection flags exist but a secret was
  never in the backup (empty `integrations.<name>` blocks).

## Related docs

- [icloud-sync.md](icloud-sync.md) — encrypted settings snapshots (iCloud Drive or a shared folder)
- [architecture.md](architecture.md) — local data layout
- [commands.md](commands.md) — CLI backup/restore and `config sync` flags
- [server-api.md](server-api.md) — HTTP backup/restore and sync endpoints
- [plugin-protocol.md](plugin-protocol.md) — plugin credential envelope
- User help: [Security](../apps/help-site/docs/security.md) (product language)
