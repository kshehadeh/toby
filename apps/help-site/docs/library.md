---
sidebar_position: 5.6
title: Library
---

# Library

**Library** is Toby’s catalog of files you want to keep: notes, Markdown, PDFs, and images. Toby copies each file into its data folder, writes a short description, and lets chat search or open the file later.

Library is not a project folder and not a memory. Chat does not dump the whole catalog into every conversation. Ask Toby to find or add a file, or browse the list in the app.

## What you can add

- Plain text and Markdown
- PDF
- Images (PNG, JPEG, WebP, GIF)

Other types are rejected. Adding the same file twice keeps the existing item instead of creating a duplicate.

## In the app

Open **View → Library** (⌘0), click **Library** in the sidebar, or search for **Open Library** in the command palette (⌘K).

The workspace is a searchable list. Nothing is selected until you choose a row. A details bar at the bottom shows title, description, type, size, indexing status, and dates. Use **Add** to import files, **Refresh** to reload, **Quick Look** or **Reveal** for the stored copy, and **Delete** to remove the item and its file.

Rows that are still indexing show an outline while Toby writes the description. Failed items keep an error in the inspector.

## In chat

Ask naturally:

- “Keep this PDF in my library.”
- “What’s in my library?” / “List everything in my library.”
- “Find the lease in my library.”
- “Open that screenshot I saved last week.”
- “Remove the old draft from the library.”

Toby can **list the whole catalog** (documents and images) or **search** by keywords and meaning. Opening a document loads its extracted text; opening an image lets the model see the picture.

## Where files live

Copies are stored under `~/.toby/library/`. Catalog rows live in the same database as chats (`chat.sqlite`). Extracted text is a sidecar file next to the original, not a second copy of the document in the database.

## Summaries

When you add a file, Toby uses a **small model** to write a short description (or an image caption). Choose that model in **Settings → Library**. It defaults to a cheap model on your usual AI provider.

## Backup and sync

Library files are included in **File → Backup Toby Data…** and in optional **Settings → Sync → Data backups**. They are **not** live-synced across Macs with settings sync. Restoring a backup replaces this Mac’s library from the snapshot.

## Related

- [Memories](./memories) — durable facts, not files
- [Projects](./projects) — scoped folders with their own chats and files
- [Settings sync](./configuration/icloud-sync) — what is (and is not) mirrored live
