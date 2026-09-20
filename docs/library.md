# Library of indexed file assets

Library is a **global file catalog**: Toby copies a document or image into
`$TOBY_DIR/library/`, stores searchable metadata in `chat.sqlite`, and
summarizes it with a configurable small model. It is not a project, not
memory, and chat never dumps the catalog into the system prompt.

Implementation lives in [`packages/core/src/library/`](../packages/core/src/library/).
The native UI is `apps/toby-app/Sources/TobyApp/Features/Library/`.

## Product rules

- v1 ingest types: **text, Markdown, PDF, and images** (PNG, JPEG, WebP, GIF).
  Other types are rejected with a clear error.
- Each item is a real file Toby owns plus a short description.
- Dedup is SHA-256 of the bytes: adding the same file returns the existing item.
- Chat uses four built-in tools. `find_in_library` is always available (same
  role as `memorySearch`). Catalog rows are **not** injected into assemble-messages.
- Live iCloud/folder sync remains settings + credentials only. Library files
  ride **backup/restore** like projects and recordings.

## Storage

Honor `TOBY_DIR`. Helpers: `getLibraryDir()` / `ensureLibraryDir()` in
[`packages/core/src/config/index.ts`](../packages/core/src/config/index.ts).

| Location | Role |
| -------- | ---- |
| `~/.toby/library/<uuid>/<filename>` | Copied original bytes |
| `~/.toby/library/<uuid>/extracted.txt` | Sidecar extracted text (UTF-8 / PDF). Not stored in SQLite. |
| `chat.sqlite` `library_items` | Metadata, description, status, content hash |
| `chat.sqlite` `library_embeddings` | One Float32 blob per item + model (same pattern as memory) |

### `library_items`

| Column | Description |
| ------ | ----------- |
| `id` | UUID |
| `title` | Display title (from filename unless updated) |
| `original_filename` | Name supplied at add |
| `relative_path` | Path under `library/` (`<id>/<filename>`) |
| `mime_type` | Normalized media type |
| `byte_size` | Copied file size |
| `content_hash` | SHA-256 of the bytes |
| `description` | Model summary or caption |
| `status` | `pending` \| `ready` \| `failed` |
| `error` | Failure message when indexing fails |
| `source` | `ui` \| `chat` \| `tool` |
| `created_at` / `updated_at` | ISO timestamps |

## Ingest

On add:

1. Copy bytes into the library folder (never leave a security-scoped original as the source of truth).
2. Insert `status=pending`.
3. Extract: UTF-8 for text/markdown; `unpdf` for PDFs (same 80k char cap as `readPdf`); skip text for images.
4. Summarize/caption with the **Library small model** (`config.library.provider` + `config.library.model`, defaulting to the default persona’s provider and `resolveAuxiliaryModelId`). Images without vision fall back to filename + mime + pixel size.
5. Embed `title + description + extracted excerpt` with the same embedder as memory.
6. `status=ready` (or `failed` with `error`).

UI add is **async** (the row appears immediately). Tool add **waits** for indexing so the model gets a description.

Size cap: `CHAT_ATTACHMENT_MAX_BYTES_PER_FILE` so Library files can still be attached to a turn.

## Chat tools

Registered in [`packages/core/src/library/tools.ts`](../packages/core/src/library/tools.ts) and merged in `mergeAuxiliaryChatTools` like memory tools.

| Tool | Behavior |
| ---- | -------- |
| `find_in_library` | List the catalog (omit query, or ask to list all), hybrid keyword + cosine search, or open by `id`. Documents return extracted text; images return original bytes as media. Always included. Images are included in list results even though they have no extracted text. |
| `add_to_library` | Current-turn attachment `filename` or UTF-8 `content` + `filename`. Copies, indexes, returns id + description. Pretreatment-selected. |
| `update_in_library` | Patch title/description and/or replace file bytes; re-summarize/re-embed when content changes. Pretreatment-selected. |
| `remove_from_library` | Delete DB row, embedding, and on-disk folder. Explicit user request only. |

## HTTP API

See [server-api.md](server-api.md#library). Swift `TobyClient` + `@Observable LibraryStore` drive the sidebar destination.

## Backup

`.tbybak` archives and opt-in data backups include `library-files`. Restore replaces `~/.toby/library/` from staging after the daemon restart. There is **no** live two-way library merge across Macs. See [icloud-sync.md](icloud-sync.md) and [security.md](security.md#backup-and-restore).

## Settings

**Settings → Library** chooses the provider and model used to summarize and caption items when they are added. Defaults to a small (auxiliary) model on the default persona’s provider.
