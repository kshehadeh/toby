# PDF reading

Built-in `readPdf` global chat tool. Extracts the searchable text layer from a
PDF and returns it as the tool result so it is in the current turn context. No
plugin, credentials, or Settings toggle.

Native multimodal models may still receive attached PDFs as file parts. Call
`readPdf` when the model needs the text layer (quoting, summarizing, or when
the persona cannot inspect files).

## How it works

`readPdf` is a **client-side function tool**. When the model calls it:

1. Resolve exactly one source (`filename`, `path`, or `url`).
2. Load bytes (current-turn attachment, project file, or HTTP(S) download).
3. Verify the `%PDF` magic header and extract text with **unpdf** (PDF.js).
4. Return page-marked text, optional title, page count, the page range that
   was read, and a `truncated` flag when the character budget was hit.

Scanned / image-only PDFs have no text layer. The tool returns an error;
**OCR is not supported**. Password-protected PDFs are rejected.

## Chat tool

| Tool | Purpose |
| ---- | ------- |
| `readPdf` | Extract PDF text into the turn. Inputs: exactly one of `filename` (current-turn attachment), `path` (project-relative, project chats only), `url` (`http`/`https`). Optional `startPage` / `endPage` (1-indexed, inclusive). If the user attached exactly one PDF, `filename` may be omitted. |

`readPdf` is **always registered** and is in the always-included tool set
(small schema; “summarize this” with an attached PDF should not depend on
semantic routing).

`fetchWebContent` also extracts PDF URLs (content-type `application/pdf`, or a
`.pdf` path whose body starts with `%PDF`) using the same helper.

## Sources

| Source | When to use |
| ------ | ----------- |
| Current-turn attachment | User attached a PDF in chat (`filename` must match exactly) |
| Project file | Active project; relative path such as `attachments/brief.pdf` |
| URL | Public `http`/`https` PDF. `file://` and other schemes are rejected |

Arbitrary local paths (`~/Downloads/…`) are out of scope: attach the file or
place it in a project.

Models that cannot inspect file parts (for example Ollama) can still attach
PDFs. Toby does not send native file parts in that case; the model should call
`readPdf` with the attached filename. Project chats can still attach any file
type for `saveProjectAttachment`.

## Limits

| Limit | Value |
| ----- | ----- |
| Attachment / project file | 20 MB (same as chat attachments) |
| URL download | 10 MB, 15s timeout |
| Extracted text | ~80,000 characters, page-budgeted; `truncated: true` when more remains |

## Architecture

| Layer | Location |
| ----- | -------- |
| Tool factory + extractor | [`packages/core/src/ai/pdf-read-tool.ts`](../packages/core/src/ai/pdf-read-tool.ts) |
| Registration | [`packages/core/src/ai/global-chat-tools.ts`](../packages/core/src/ai/global-chat-tools.ts) |
| Always-included set | [`packages/core/src/chat-pipeline/run-turn.ts`](../packages/core/src/chat-pipeline/run-turn.ts) |
| `fetchWebContent` PDF branch | [`packages/core/src/ai/web-fetch-tool.ts`](../packages/core/src/ai/web-fetch-tool.ts) |
