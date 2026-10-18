# Library of indexed file assets

Library is a **global file catalog**: Toby copies a document or image into
`$TOBY_DIR/library/`, stores searchable metadata in `chat.sqlite`, and
summarizes it with a configurable small model. It is not a project, not
memory, and chat never dumps the catalog into the system prompt.

Implementation lives in [`packages/core/src/library/`](../packages/core/src/library/).
The native UI is `apps/toby-app/Sources/TobyApp/Features/Library/`.

## Product rules

- The library is the catalog of files Toby has seen: added in the Library,
  attached to a chat, or saved into a project.
- Summarized types: **text, Markdown, PDF, and images** (PNG, JPEG, WebP, GIF).
  Text-like project files (JSON, CSV, HTML, source, and similar) are indexed as
  text. Other types are stored so they can be browsed, without a model summary.
  Manual add still rejects types outside text, Markdown, PDF, and images.
- Each item is a real file Toby owns plus a short description. The same bytes
  stay one item. Each place the file was seen is a separate reference.
- Dedup is SHA-256 of the bytes.
- Project instructions (`AGENTS.md`) and skill files are not copied into the
  library. They already have their own screens.
- Chat uses four built-in tools. `find_in_library` is always available (same
  role as `memorySearch`). Catalog rows are **not** injected into assemble-messages.
  List and search results include a `from` array (`kind`, `label`, `detail`).
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
| `chat.sqlite` `library_references` | Where the file was seen: Library, a chat, or a project |
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
| `source` | First ingest channel: `ui` \| `chat` \| `tool` \| `project` |
| `created_at` / `updated_at` | ISO timestamps |

### `library_references`

One row per place a file was seen. Deleting the library item deletes its references. The chat transcript and the project file are left in place.

| Column | Description |
| ------ | ----------- |
| `id` | UUID |
| `item_id` | Library item |
| `kind` | `manual` (added in the Library) \| `chat` \| `project` |
| `session_id` | Chat, when `kind` is `chat` |
| `project_id` | Project, when `kind` is `project` |
| `label` | Session title, project name, or `Library` |
| `detail` | Attachment filename, or project-relative path |
| `created_at` | When Toby recorded that place |

## Ingest

Opening the library starts a background scan of existing chat attachments and project files. Later attachments and project writes are recorded as they happen. Unchanged files are skipped. Files larger than the library size cap are skipped.

On add:

1. Copy bytes into the library folder (never leave a security-scoped original as the source of truth).
2. Insert `status=pending`.
3. Extract: UTF-8 for text/markdown; `unpdf` for PDFs (same 80k char cap as `readPdf`); skip text for images.
4. Summarize/caption with the **Library small model** (`config.library.provider` + `config.library.model`, defaulting to the default persona’s provider and `resolveAuxiliaryModelId`). Images without vision fall back to filename + mime + pixel size.
5. Embed `title + description + extracted excerpt` with the same embedder as memory (the default persona’s provider: OpenAI `text-embedding-3-small`, Vercel or OpenRouter `openai/text-embedding-3-small`, or Ollama `nomic-embed-text`). Chutes has no embedding model, so those items stay keyword-only.
6. `status=ready` (or `failed` with `error`). Ready items that are still missing a vector are embedded in the background the next time the library is listed.

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
