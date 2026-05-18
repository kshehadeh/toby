# Chat pipeline (and prompt caching)

This document describes how `toby chat` prepares messages, runs a model turn, and (optionally) takes advantage of provider prompt caching to reduce repeated prompt tokens.

## High-level flow

```mermaid
flowchart LR
pretreat[pretreatment_optional] --> prepare[prepareChatSessionMessages]
prepare --> messages[ModelMessages_history]
messages --> runTurn[runIntegrationChatTurn]
runTurn --> chatWithTools[chatWithTools]
chatWithTools --> modelCall[streamText_or_generateText]
modelCall --> responseMsgs[response.messages]
responseMsgs --> store[append_to_session_history]
```



Key files:

- `src/ui/chat/chat-session-app.tsx`: Ink TUI, transcript, message history, turn loop.
- `src/chat-pipeline/chat-events.ts`: shared UI-agnostic chat pipeline event types.
- `src/ai/pretreatment.ts`: optional fast pretreatment (`generateText` + structured output) before the main turn; see **Pretreatment** below.
- `src/skills/index.ts`: loads optional local skills from `~/.toby/skills/<name>/SKILL.md` (frontmatter `name` + `description`) for pretreatment selection and injection; see **Local skills** below.
- `src/ui/chat/prepare-messages.ts`: initial message construction for a session.
- `src/chat-pipeline/run-turn.ts`: shared integration turn runner (`runIntegrationChatTurn`, `runSharedChatTurn`). `src/ui/chat/run-turn.ts` re-exports from this module.
- `src/ai/chat.ts`: shared wrapper around AI SDK `streamText` / `generateText`, tool cache injection, lifecycle hooks, and abort signal propagation.

## Message construction (stable prefix vs dynamic content)

The chat pipeline intentionally keeps the **system message** as stable as possible, and pushes per-session/per-turn content into **user messages**.

Why:

- Providers that support prompt caching cache a **prefix** of the prompt. The more stable the prefix is across calls, the higher your cache hit rate.
- Any user/session-specific text inside the system prompt tends to break prefix similarity across sessions.

Where this is implemented:

- Gmail system prompt is static policy + tool strategy in `src/integrations/gmail/prompts/chat.ts` (`buildGmailChatSystemMessage`).
- Todoist system prompt is static policy + tool rules in `src/integrations/todoist/prompts/chat.ts` (`buildTodoistChatSystemMessage`).
- Multi-integration system prompt is assembled in `src/ui/chat/prepare-messages.ts` and does **not** embed the user request.
- The actual user request (and dynamic context like task snapshots) is always provided via `role: "user"` messages.

## Pretreatment (optional)

Before the main model turn, `ChatSessionApp` may run a **small, fast** LLM call that extracts a structured intent spec (goal, must/must-not, assumptions, open questions, likely integrations, **relevant local skills**) and **prepends** it to the `role: "user"` content sent to the main model. The Ink transcript still shows the **verbatim** user line.

- **When**: first user prompt in a session always; later prompts only when `[shouldPretreat](../src/ai/pretreatment.ts)` flags the text as ambiguous (short follow-ups, pronouns without a recent assistant reply, multi-clause requests, etc.).
- **Provider**: uses the active persona’s AI provider (OpenAI direct or Vercel AI Gateway via [`model-factory.ts`](../src/ai/model-factory.ts)).
- **Model**: defaults to `gpt-4.1-mini` for OpenAI, or `openai/gpt-4.1-mini` for Vercel gateway. Override with `TOBY_PRETREAT_MODEL` (bare id for OpenAI, or a full `provider/model` slug for gateway). Disable entirely with `TOBY_DISABLE_PRETREATMENT=1`.
- **Debug**: `TOBY_DEBUG_PREP=1` adjusts the **prompt preparation** transcript box detail when a spec was attached (no separate `meta` line).
- **Caching**:
  - Pretreatment uses its own short system prompt and is **not** included in the main `promptCacheKey` merge. The wrapped user text remains dynamic user-role content, so the stable-prefix caching strategy for the main turn is unchanged.
  - Toby also keeps a small **local SQLite cache** of successful pretreatment results (global across sessions) so repeated prompts can **skip the pretreatment model call** entirely.
    - **Keying**: derived from normalized user text + normalized integration labels + pretreat model id + a digest of the available skill catalog + a pretreat cache schema version.
    - **Storage**: stored in `chat.sqlite` (see `src/ui/chat/session-store.ts`).
    - **Invalidation**: bumping the pretreat cache schema version (or changing model id / prompt construction inputs / local skill catalog) naturally produces new keys.
  - **Policy**: success-only (failed/timeout pretreatments are not cached).

## Local skills (optional)

Markdown skills in `~/.toby/skills/<skill-folder>/SKILL.md` use YAML frontmatter with at least `name` and `description`. When pretreatment runs, the small model may set `relevantSkills` to exact names from that catalog. For each turn:

- The **user** message includes a short “Selected skills” summary (names + descriptions).
- The **system** message gains an appendix with the full markdown body of each selected skill (replacing any prior appendix from an earlier turn).

If pretreatment is skipped (`shouldPretreat` false) or disabled (`TOBY_DISABLE_PRETREATMENT=1`), no skills are selected automatically.

To author a new skill from chat, the global tool **`createLocalSkill`** (see [`src/ai/global-chat-tools.ts`](../src/ai/global-chat-tools.ts)) drafts a full `SKILL.md` with the persona model and saves it under `~/.toby/skills/`.

## Turn execution (tools + streaming)

For each user submission:

1. `ChatSessionApp` may run pretreatment, then appends a `role: "user"` message (verbatim + optional spec block) to the in-memory history.
2. It calls `runIntegrationChatTurn(...)` with the full `messages` array (wiring an `AbortSignal` so the user can cancel with Escape).
3. `runIntegrationChatTurn` resolves integration modules by name, then delegates to `runSharedChatTurn` which merges their tools, adds global tools, applies prompt caching, and calls `chatWithTools(...)`.
4. `chatWithTools` applies `injectToolCache` (read-only tool result cache) then `injectToolLifecycleHooks` (events, callbacks, abort checks), and uses:
  - `streamText(...)` when the Ink UI wants incremental tokens, or
  - `generateText(...)` in non-streaming contexts.
5. Tool lifecycle hooks (`onToolCallStart` / `onToolCallComplete`) and abort-signal checks are implemented by wrapping each tool’s `execute` in `[src/ai/chat.ts](../src/ai/chat.ts)`. The `abortSignal` on `ChatWithToolsOptions` is propagated to `streamText`/`generateText` and checked before each tool execution. Optional `**onChatEvent**` emits UI-agnostic `[ChatEvent](../src/chat-pipeline/chat-events.ts)` values (assistant segments at tool boundaries, tool start/complete, `prep_*`, `lifecycle_*` milestones, etc.). The Ink session maps those events to transcript rows via `[src/ui/chat/chat-event-reducer.ts](../src/ui/chat/chat-event-reducer.ts)` (prep and lifecycle render as boxed pipeline steps in the TUI transcript).
6. The SDK returns `response.messages` (assistant + tool result messages), which are appended to history for the next turn.

### Tool result cache (read-only tools)

`toby chat` also has a short-lived in-memory cache for select read-only chat tools:

- **TTL**: 5 minutes
- **Key**: `toolName + stable serialized args`
- **Scope**: SQLite-backed (`chat.sqlite`) so cache survives process restarts until TTL expiry
- **Eligibility**: read-only tool allowlist only (mutating tools and `askUser` are excluded)

Implementation paths:

- Cache implementation: `src/chat-pipeline/tool-result-cache.ts`
- Cache lookup/store hook: `src/ai/chat.ts` (`injectToolCache` wraps read-only tools; `injectToolLifecycleHooks` emits cache-hit events)
- UI marker: tool transcript rows append `[cache]` when a cached result is used

To clear cached tool results in chat, run:

- `/clear-tool-cache`

### Abort signal

`ChatWithToolsOptions` accepts an optional `abortSignal` (standard `AbortSignal`). When provided:

- The signal is forwarded to `streamText` / `generateText`, so the provider request can be cancelled mid-flight.
- Before each tool execution, the signal is checked; if already aborted the tool throws instead of running.
- The Ink TUI wires an `AbortController` per turn and aborts it when the user presses **Escape** during a loading state.

## AI prompt caching

Provider-specific prompt caching (OpenAI direct, Vercel AI Gateway, stable cache keys, status-line `cache=` / `cacheW=` telemetry, and adding new adapters) is documented in **[ai-caching.md](ai-caching.md)**.

Wiring in this pipeline:

- `src/chat-pipeline/run-turn.ts` → `applyChatPromptCaching(...)` from `src/ai/caching`
- `src/ai/chat.ts` → forwards merged `providerOptions` to `streamText` / `generateText`

