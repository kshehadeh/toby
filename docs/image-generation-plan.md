# Image generation (capability-gated) — implementation plan

Status: **not implemented**. Saved 2026-08-29 for a future pass.

This is the design for adding a `generateImage` global chat tool when the
active persona’s AI provider can generate images, plus a prompt-dock
indicator. It is **not** shipped behavior.

Add a `generateImage` global chat tool when the active persona’s AI **provider** can generate images, and show a small indicator in the chat prompt dock so users know they can ask for one.

## Product intent

Chat models in Toby are language models. Image generation is a **companion image model** billed to the same provider key — the same pattern as `webSearch` (a separate Gateway call) rather than switching the user’s selected chat model.

When image generation is available, asking “draw a logo for my project” should make Toby call `generateImage`, save the file, and show the picture in the reply. When it is not (Ollama, Chutes, missing credentials), the tool is absent and the dock shows no indicator.

## Capability (when it is on)

Extend [`packages/core/src/ai/model-capabilities.ts`](../packages/core/src/ai/model-capabilities.ts) with `resolveImageGenerationCapability(persona)`:

| Persona provider | Supported | Companion image model |
| --- | --- | --- |
| `openai` | Yes, if OpenAI token is configured | `gpt-image-1` via `createOpenAI().image()` |
| `vercel` | Yes, if Gateway key / OIDC is configured | `openai/gpt-image-1` via `createGateway().image()` |
| `ollama`, `chutes`, `openrouter` | No | — |

Return `{ supported, reason?, imageModel }` so `/api/status` and the Swift dock can render the same truth the tool uses.

OpenRouter is out of scope for v1 (possible later with the same tool). Availability is automatic — no Settings toggle.

## Chat tool

New module [`packages/core/src/ai/image-generation-global-tools.ts`](../packages/core/src/ai/image-generation-global-tools.ts), following `web-search-global-tools.ts` / `weather-global-tools.ts`.

- Register `generateImage` from `createGlobalChatTools` only when `supported`.
- **Not** in `ALWAYS_INCLUDED_TOOLS` — pretreatment / semantic routing selects it when the user asks to draw, illustrate, or generate an image (same as `webSearch` / `getWeather`).
- Prompt section in `globalChatToolsPromptSection`: only mention the tool when it is available; tell the model to include the returned markdown image in the reply.

Tool inputs:

- `prompt` (required) — image description
- `aspectRatio` optional: `1:1` \| `16:9` \| `9:16` \| `4:3`
- `filename` optional — relative name such as `logo.png`

Behavior:

1. Dry-run: return a preview, do not call the provider.
2. Call AI SDK `generateImage({ model, prompt, aspectRatio, abortSignal })`.
3. Write PNG/JPEG/WebP under `~/.toby/generated-files/` (reuse the path-safety rules from `resolveWriteTextFileTarget`: relative path, no traversal). Default name `image-<timestamp>.png`.
4. If a project is active, also write to project `outputs/` (same default as `writeTextFile`).
5. Return `{ ok, path, imageUrl, markdown, mediaType }` where `imageUrl` is `http://127.0.0.1:<web.port>/api/generated-files/<basename>` (`getWebConfig().port`, default 7847). `markdown` is `![prompt](imageUrl)` so existing transcript markdown image rendering picks it up.

Factory: add `createImageModelForPersona(persona)` next to `createModelForPersona` in [`model-factory.ts`](../packages/core/src/ai/model-factory.ts). Inject `generateImage` in tests.

Do not cache this tool (`READ_ONLY_CHAT_TOOLS` stays unchanged).

## Serving generated files

Add `GET /api/generated-files/:filename` in [`packages/core/src/web/routes.ts`](../packages/core/src/web/routes.ts), same safety as persona images (`path.basename` only, file must exist under `getGeneratedFilesDir()`). Content-Type from extension (`png` / `jpeg` / `webp`).

Markdown already accepts `http://` image URLs ([`MarkdownParser.httpOrHttpsURL`](../apps/toby-app/Sources/TobyApp/UI/Markdown/MarkdownParser.swift)), so no Swift markdown parser change is required if the tool returns an absolute localhost URL.

## Prompt-box indicator

When `imageGenerationCapability.supported` is true, show a non-interactive photo glyph in [`InputDock`](../apps/toby-app/Sources/TobyApp/UI/Primitives/InputDock.swift) on the right-hand control row, **left of the attach (+) button**:

- SF Symbol `photo`
- Caption size, `AppTheme.secondaryText`
- Tooltip / accessibility: “This model can generate images. Ask Toby to create one.”
- `accessibilityIdentifier("chat-image-generation-indicator")`
- Hidden entirely when unsupported (do not show a disabled icon)

Wire through:

- `ChatStatusResponse.imageGenerationCapability` in [`chat-api.ts`](../packages/core/src/api/chat-api.ts)
- `GET /api/status` in [`handlers/chat.ts`](../packages/core/src/web/handlers/chat.ts)
- Swift `AppStatus` + `ChatStore.canGenerateImages` (same pattern as `canAttachFiles`)
- Both `EmptyChatWorkspace` and `ActiveChatWorkspace` `InputDock` call sites

Also add `generateImage` → `photo` in [`ToolDisplayLabels.swift`](../apps/toby-app/Sources/TobyApp/Utilities/ToolDisplayLabels.swift).

## Tests

- Capability: OpenAI + Vercel supported; Ollama/Chutes/OpenRouter false; missing credentials false.
- Tool: dry-run; mocked `generateImage` writes a file and returns markdown URL; rejects path traversal; omitted from `createGlobalChatTools` when unsupported.
- `GET /api/status` includes `imageGenerationCapability`.
- `GET /api/generated-files/:filename` serves a fixture and 404s traversal.
- Swift `InputDockTests`: indicator present when `canGenerateImages: true`, absent otherwise.

## Docs (toby-docs)

New pages plus small cross-links (when implementing):

- `docs/image-generation.md` — capability table, tool, file paths, HTTP route
- `apps/help-site/docs/configuration/image-generation.md` — user-facing “ask Toby to generate an image”; note the prompt-box photo icon
- Indexes: `docs/README.md`, `Agents.md`
- `docs/server-api.md` — status field + generated-files route
- `docs/chat-pipeline.md` — mention `generateImage` as a conditional global tool
- `apps/help-site/docs/getting-started/first-chat.md` and `toby-app.md` — one sentence on the dock indicator and asking for images

No screenshot refresh unless wanted after the dock change.

## Out of scope

- Native multimodal image output from Gemini “image” chat models (no `modalities: ['text','image']` on the language turn)
- Image editing / inpainting / reference images
- OpenRouter / Ollama image models
- Settings toggle or picking a custom image model
- Storing generated image bytes in the SQLite transcript (files on disk + URL in the reply)
