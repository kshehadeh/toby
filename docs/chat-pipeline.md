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
- `src/ai/pretreatment.ts`: optional fast pretreatment (`generateText` + structured output) before the main turn; see **Pretreatment** below.
- `src/ui/chat/prepare-messages.ts`: initial message construction for a session.
- `src/ui/chat/run-turn.ts`: integration selection and model execution.
- `src/ai/chat.ts`: shared wrapper around AI SDK `streamText` / `generateText`.

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

Before the main model turn, `ChatSessionApp` may run a **small, fast** OpenAI call that extracts a structured intent spec (goal, must/must-not, assumptions, open questions, likely integrations) and **prepends** it to the `role: "user"` content sent to the main model. The Ink transcript still shows the **verbatim** user line.

- **When**: first user prompt in a session always; later prompts only when [`shouldPretreat`](../src/ai/pretreatment.ts) flags the text as ambiguous (short follow-ups, pronouns without a recent assistant reply, multi-clause requests, etc.).
- **Model**: defaults to **`gpt-4.1-mini`**. Override with `TOBY_PRETREAT_MODEL`. Disable entirely with `TOBY_DISABLE_PRETREATMENT=1`.
- **Debug**: `TOBY_DEBUG_PREP=1` appends a short `meta` transcript line when a spec was attached.
- **Caching**: pretreatment uses its own short system prompt and is **not** included in the main `promptCacheKey` merge. The wrapped user text remains dynamic user-role content, so the stable-prefix caching strategy for the main turn is unchanged.

## Turn execution (tools + streaming)

For each user submission:
1. `ChatSessionApp` may run pretreatment, then appends a `role: "user"` message (verbatim + optional spec block) to the in-memory history.
2. It calls `runIntegrationChatTurn(...)` with the full `messages` array.
3. `runIntegrationChatTurn` selects integration(s) and tools, then calls `chatWithTools(...)`.
4. `chatWithTools` uses:
   - `streamText(...)` when the Ink UI wants incremental tokens, or
   - `generateText(...)` in non-streaming contexts.
5. Tool lifecycle hooks (`onToolCallStart` / `onToolCallComplete`) are implemented by wrapping each tool’s `execute` in [`src/ai/chat.ts`](../src/ai/chat.ts), so the Ink UI can append structured transcript rows without relying on SDK-only streaming events.
6. The SDK returns `response.messages` (assistant + tool result messages), which are appended to history for the next turn.

## OpenAI prompt caching configuration (current)

`toby` enables OpenAI prompt caching hints for `toby chat` by setting:
- `providerOptions.openai.promptCacheKey`

This is plumbed through:
- `src/ui/chat/run-turn.ts` → `applyChatPromptCaching(...)`
- `src/ai/cache-hints.ts` → builds a stable cache key and merges it into `ChatWithToolsOptions.providerOptions`
- `src/ai/chat.ts` → forwards `providerOptions` to `streamText` / `generateText`

### Cache key strategy

The key is designed to be:
- **stable** across sessions when the same persona/model/integration set is used
- **independent of user text** (to maximize prefix reuse)
- sensitive to persona changes via a short hash of persona settings

Intentionally excluded from the key:
- user prompt text
- any dynamic integration context (e.g. task snapshots)
- any per-turn state

If you change the “prompt schema” (for example, you substantially restructure the stable system prompt), bump the schema version constant in `src/ai/cache-hints.ts`.

## Cache telemetry (how to tell it’s working)

The AI SDK exposes normalized token usage, including cache reads/writes:
- `usage.inputTokenDetails.cacheReadTokens`
- `usage.inputTokenDetails.cacheWriteTokens`
- `usage.inputTokenDetails.noCacheTokens`

`toby chat` can display this in the transcript when:
- `TOBY_DEBUG_CACHE=1`

This is rendered as a meta line in `src/ui/chat/chat-session-app.tsx`.

Expected behavior:
- First qualifying request “warms” the cache (higher `cacheWriteTokens`, low/zero `cacheReadTokens`).
- Subsequent turns (with the same cached prefix) show increased `cacheReadTokens` and decreased `noCacheTokens`.

## Extending to Anthropic (future)

Anthropic supports message-level cache control hints (via message `providerOptions`). The design here keeps a single “cache hints” module (`src/ai/cache-hints.ts`) so we can add:
- message-level cache control breakpoints for Anthropic, without rewriting the turn runner or the AI wrapper.

