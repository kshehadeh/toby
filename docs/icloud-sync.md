# Settings sync

Encrypted snapshots of `config.json` + credentials, stored either in the user’s
**iCloud Drive** folder or in a **user-picked folder** they already replicate
(Dropbox, Google Drive, OneDrive, NAS, Syncthing). Multiple Macs can share the
same Toby settings without giving the storage provider plaintext secrets.

iCloud Drive is the default when it is available. Folder sync is for Macs where
iCloud Drive is off, blocked, or unused.

Implementation lives under [`packages/core/src/config/sync*.ts`](../packages/core/src/config/)
with coordinated iCloud file I/O in
[`NativeICloudHandler.swift`](../apps/toby-app/Sources/TobyApp/Native/NativeICloudHandler.swift).
Threat model and Keychain items: [security.md](security.md).

## What syncs

Same payload as [backup/restore](security.md#backup-and-restore):

| Included | Not included |
| -------- | ------------ |
| `config.json` (personas, connection flags, AI/listen/inbound/search/weather prefs) | `chat.sqlite` (sessions, **schedules**, **flows**) |
| Full credentials bag (AI keys, plugin tokens) | `memory.sqlite`, recordings, logs |
| | `~/.toby/skills/`, persona image files, plugin packages |
| | App `UserDefaults` (theme, menu bar, `TOBY_DIR`) |

Machine-local keys stripped from the snapshot and kept on pull:

- `activeProject` (project folders are per-Mac)
- `web` (bind port)

**Inbound Slack:** tokens are shared on purpose. Enable the inbound listener on
**one** Mac only; two daemons should not both Socket-Mode connect.

## Crypto

The per-Mac Keychain DEK that wraps `credentials.json` is **never** uploaded.
The vault uses the same AES-256-GCM + scrypt primitive as `.tbybak`, with a
distinct envelope:

```
format: "toby.config.sync.encrypted"
```

The wrapping passphrase is stored only in this Mac’s Keychain:

| Field | Value |
| ----- | ----- |
| Service | `dev.toby.sync` |
| Account | `vault-passphrase` |

`TOBY_CREDENTIALS_KEY_BACKEND=memory` keeps the passphrase in-process (tests).
`plaintext` writes `~/.toby/sync-passphrase` (mode `0o600`) — not used on
production macOS.

## Transports

The engine is a `SyncBlobStore`. iCloud Drive and a custom folder are two
backends of the same last-write-wins loop. Only one backend is active at a
time. Switching in v1 is **disable, then enable** on the other transport.

### iCloud Drive (default)

Finder: iCloud Drive → Toby → config-sync:

```
~/Library/Mobile Documents/com~apple~CloudDocs/Toby/config-sync/
  vault.json
  history/<utc>-l<lamport>.json   # last 10 previous vaults
```

The daemon prefers native coordinated I/O when Toby.app is already running
(`launch: false` so ticks never auto-open the app). Otherwise it writes the
CloudDocs path directly.

### Folder

The user picks a directory they already sync to other Macs. Toby writes a
nested vault (never `vault.json` at the root of Dropbox/Google Drive):

```
<picked>/Toby/config-sync/
  vault.json
  history/<utc>-l<lamport>.json
```

Each Mac stores its own absolute `folderPath` in `sync-state.json` (paths can
differ across machines). The folder must not be inside `~/.toby`. Pick a
**private** folder; the file is encrypted, but the share should still be yours.

If the folder is missing (unmounted NAS, paused Drive client), sync stays
**enabled**, records `lastError`, and retries on the next tick. It does not
wipe local config.

### Override

`TOBY_SYNC_DIR` still overrides the vault directory (tests / debugging) and
wins over both backends.

## Local state

**Local only:** `~/.toby/sync-state.json` (device id, last-acked hash/lamport,
errors, `backend`, `folderPath`). Never put `deviceId` or `folderPath` in
`config.json`.

| Field | Role |
| ----- | ---- |
| `backend` | `"icloud"` (default when omitted) or `"folder"` |
| `folderPath` | User-picked absolute folder; required when `backend` is `folder` |

## Protocol

Last-write-wins using a lamport clock, then UTC, then `deviceId`. Identical
`contentHash` is a no-op (prevents pull→write→push loops). Local writes set a
dirty flag; the daemon debounces ~5s then pushes. Pull runs on daemon start and
about once a minute when not dirty (cheap no-op when hashes match).

Enable:

- No remote vault → **create** (push this Mac)
- Remote vault exists → **join** (pull; trial-decrypt first)
- **replace** overwrites the remote copy; refused if this Mac looks empty

Wrong password fails closed and does not wipe local config. Enabling iCloud
when Drive is unavailable is refused; choose a folder instead.

## Surfaces

| Surface | Entry |
| ------- | ----- |
| Toby.app | Settings → **Sync** |
| CLI | `toby config sync …` (see [commands.md](commands.md)) |
| Daemon API | `/api/config/sync*` (see [server-api.md](server-api.md)) |
| Native API | `/api/native/icloud/*` coordinated I/O for the iCloud backend (see [native-helpers.md](native-helpers.md)) |

`POST /api/config/sync/enable` accepts optional `backend` (`icloud` \| `folder`)
and `folderPath` (required for folder). CLI: `toby config sync enable --dir <path>`.

## Tests

- `apps/cli/tests/config-sync-*.test.ts` — crypto, engine, HTTP (fake
  `TOBY_SYNC_DIR`, memory passphrase, folder backend)
- `apps/toby-app/Tests/TobyAppTests/ICloudSyncSettingsTests.swift` — Settings tab
  + native handler with an injected directory
