# iCloud settings sync

Encrypted snapshots of `config.json` + credentials, stored in the user’s
**iCloud Drive** folder so multiple Macs can share the same Toby settings
without giving Apple plaintext secrets.

Implementation lives under [`packages/core/src/config/sync*.ts`](../packages/core/src/config/)
with coordinated file I/O in
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

## Layout

**iCloud Drive** (Finder: iCloud Drive → Toby → config-sync):

```
~/Library/Mobile Documents/com~apple~CloudDocs/Toby/config-sync/
  vault.json
  history/<utc>-l<lamport>.json   # last 10 previous vaults
```

Override the vault directory with `TOBY_SYNC_DIR` (tests / debugging).

**Local only:** `~/.toby/sync-state.json` (device id, last-acked hash/lamport,
errors). Never put `deviceId` in `config.json`.

## Protocol

Last-write-wins using a lamport clock, then UTC, then `deviceId`. Identical
`contentHash` is a no-op (prevents pull→write→push loops). Local writes set a
dirty flag; the daemon debounces ~5s then pushes. Pull runs on daemon start and
about once a second when not dirty (cheap no-op when hashes match).

Enable:

- No remote vault → **create** (push this Mac)
- Remote vault exists → **join** (pull; trial-decrypt first)
- **replace** overwrites the cloud copy; refused if this Mac looks empty

Wrong password fails closed and does not wipe local config.

## Surfaces

| Surface | Entry |
| ------- | ----- |
| Toby.app | Settings → **iCloud** |
| CLI | `toby config sync …` (see [commands.md](commands.md)) |
| Daemon API | `/api/config/sync*` (see [server-api.md](server-api.md)) |
| Native API | `/api/native/icloud/*` coordinated I/O (see [native-helpers.md](native-helpers.md)) |

The daemon prefers native coordinated I/O when Toby.app is already running
(`launch: false` so ticks never auto-open the app). Otherwise it writes the
CloudDocs path directly.

## Tests

- `apps/cli/tests/config-sync-*.test.ts` — crypto, engine, HTTP (fake
  `TOBY_SYNC_DIR`, memory passphrase)
- `apps/toby-app/Tests/TobyAppTests/ICloudSyncSettingsTests.swift` — Settings tab
  + native handler with an injected directory
