# ACP agent backends implementation plan

Status: proposed; no product behavior is implemented by this document.

## Objective

Let users choose direct model API access through Toby's existing harness or an
external agent through Agent Client Protocol (ACP). Support that choice for chat,
recording summaries, flow LLM nodes, dashboard summaries, library generation,
and text-based auxiliary tasks. Preserve the current native chat layout and
existing direct API configuration and behavior.

ACP is the host-to-agent protocol; MCP supplies Toby tools to the agent. These
are separate roles. External agents own their inference loop, agent history,
and compaction. Toby owns product records, orchestration, integration credentials,
tool policy, and the rendered transcript.

## Existing integration points

| Area | Current source / behavior |
| --- | --- |
| Configuration | `packages/core/src/config/index.ts`: personas have `ai.provider` / `ai.model`; AI settings configure providers. |
| Settings | `packages/core/src/configure/{tree,persistence}.ts`, `web/handlers/configure.ts`, Swift `AISettingsView`, `ConfigureStore`, and `PersonaEditorFormView`. AI is currently a provider catalog with pushed details. |
| Chat | `chat-pipeline/nodes/run-model-turn.ts` delegates to `chat-pipeline/run-turn.ts`, which builds integration/global tools and calls the AI SDK harness. |
| Chat rendering | `chat-pipeline/chat-events.ts`, transcript reducers, persisted session records, and the Swift transcript consume Toby events. |
| Recording summaries | `listen/summarizer.ts`: resolves `listen.summaryPersona`, then calls `generateText` directly. |
| Flow processing | `flows/nodes/llm-prompter.ts`: persona-based `generateText`, required Zod schema, structured/freeform attempts, timeout handling, usage/history. |
| Dashboard | Flow-backed summaries and the legacy generation path in `dashboard/summarizer.ts`. |
| Library | `library/summarize.ts`: explicit provider/model or auxiliary model; text summaries and image captions. |
| Other generation | Pretreatment, planning, cron parsing, user-tool generation, global chat helpers, delegated agents, and scheduled chat have direct model dependencies. |
| MCP | `integrations/mcp/` consumes external MCP servers today; exporting Toby tools requires a new server bridge. |

## Product configuration

Keep **Settings → AI** as the catalog. Group direct API providers and external
agents within it, reusing the existing navigation and grouped Form patterns.
Offer built-in Codex and Claude setup entries and an advanced custom ACP agent.
Use plain product names; protocol details belong in advanced configuration.

Agent detail includes install/location, adapter version, sign-in, connection
test, available model/config options, interactive permissions, background
permissions, and disconnect/remove. Represent installing, signing in, checking,
connected, unavailable, and error states with actionable recovery.

Add a backend selector to the persona Model pane. Direct API shows existing
provider/model controls; an external agent shows a configured agent connection
and its advertised model/options. Do not insert ACP agents into the raw model
provider registry or fabricate AI SDK language models around them.

Introduce shared AI routing defaults and optional task overrides:

| Task | Selection behavior |
| --- | --- |
| Chat | Persona override → global generation default. Existing personas retain their API selections. |
| Recording summary | Explicit task override → existing summary persona backend → global default. |
| Flow LLM node | Node override → flow/run override → flow persona backend → global default. |
| Dashboard summary | Task override → dashboard persona backend → global default. |
| Library summary / image caption | Task override → existing explicit library provider/model → global default. Require image support for captions. |
| Auxiliary text generation | Explicit auxiliary override → initiating backend, or global default outside a turn. |

Existing installations keep their effective routing until the user changes it.
An unset new default uses the legacy default persona. Define precedence in one
resolver rather than implementing it separately in each feature. A direct API
target includes provider/model; an ACP target includes connection/model/options.
Persona instructions remain independent of the selected backend.

Transcription, embeddings, and provider-specific search remain separately
configured capability services. Selecting ACP for generation does not provide
them automatically. Surface these requirements in setup and feature validation.
Never silently fall back to a different paid backend. Optional fallback must be
explicitly configured and recorded, and must not repeat a turn with side effects.

## Architecture

Create `packages/core/src/ai/backends/` with these boundaries:

- `types.ts`: discriminated targets, capabilities, execution requests/results,
  normalized events, errors, and execution identity.
- `resolve.ts`: routing precedence, legacy compatibility, supported task checks.
- `direct-api.ts`: existing AI SDK implementation, preserving current behavior.
- `acp/`: ACP TypeScript client, process manager, authentication, session manager,
  event adapter, capability mapping, and named agent presets.
- `tool-bridge/`: scoped MCP server exporting the existing Toby tool catalog and
  execution wrappers rather than duplicating integration implementations.

Expose two operations sharing routing, lifecycle, and observability:

- `runConversationTurn`: persistent conversation, streamed events, tools,
  attachments, cancellation, and optional human interaction.
- `runGenerationTask`: isolated instructions/input, optional validated output
  schema, deadline, cancellation, and an explicit tool/permission policy.

Results include final text/validated object, completion status, backend identity,
model where known, usage where reported, tool actions, and correlation IDs.
Unsupported controls such as temperature or output-token limits must be reported
or rejected when required; do not claim that an agent enforced ignored settings.
Token usage and monetary cost are optional, never invented or shown as zero.

Store non-secret agent definitions in config and secrets via
`readCredentials` / `writeCredentials`. Prefer agent-owned login for built-in
agents; do not copy their auth files into Toby. Treat executable paths as
machine-local and mark synced connections unavailable until revalidated.

## Runtime and session behavior

Use local stdio ACP initially. Pin tested adapter versions and negotiate protocol
and capabilities. Discover model/config options from the running agent; provide
a custom value only where supported. Built-in presets use maintained adapters:
`@agentclientprotocol/codex-acp` and
`@agentclientprotocol/claude-agent-acp`.

Run adapters through an explicit executable/argument array, never a shell string.
Validate Bun/runtime compatibility before choosing the launch strategy. Use
Toby-managed versioned adapter installation or a user-specified executable;
avoid downloading packages on each task. Keep installs, updates, and removal
separate from connection/login. Test packaged and development builds.

Chat gets a durable mapping of Toby session, connection, ACP session, workspace,
and backend/config fingerprint in `chat.sqlite`. Resume only when negotiated;
loading may replay history, which must not duplicate Toby transcript rows.
Send only the new turn after restoring agent history. For agents unable to
restore sessions, seed a fresh session with a bounded transcript summary and
clearly record the recovery. Do not replay historical tool calls as actions.

Changing backend, persona instructions, workspace, model, or tool policy requires
an explicit session reconfiguration or a new agent session with bounded context
transfer. Do not silently carry stale instructions or privileges forward.
Ordinary chats and generation jobs use dedicated workspace directories resolved
through Toby's data-path helpers; project sessions use the intended project root.
Working directory alone is not a security boundary.

Background generation gets a new session per task, or per bounded schema repair
sequence. It does not enter chat history. Close sessions when supported and
otherwise reclaim their owned process resources. Agent-owned persisted history
may still exist; document storage and deletion behavior for each preset.

Bound concurrent jobs, serialize prompts within a session, and reserve capacity
for interactive chat. Propagate cancellation through ACP, then terminate the
owned process tree after a grace period if it does not stop. Handle startup,
authentication, turn, and idle deadlines separately. A crash or timeout after a
write is an uncertain outcome, not a reason to automatically repeat the action.

## Chat compatibility and integration tools

Keep the existing composer, transcript, Markdown rendering, attachments, work
rows, and cancel flow. Map ACP text, tool status, errors, and agent-provided
reasoning summaries into Toby `ChatEvent`s with stable IDs and sequencing.
Do not promise access to hidden reasoning. Deduplicate MCP execution events and
ACP tool reports, and avoid interpreting every text chunk as a final answer.
Handle unknown updates without breaking the stream.

Add only the event/API controls needed for permissions and supported user
questions. Use existing inline interaction patterns; permission choices need
their own typed, turn-bound semantics rather than arbitrary approval text.
Use the shared normalized event contract for SSE and persistence. Adapt
AI-SDK-specific result fields where necessary instead of fabricating responses.

For ACP turns retain Toby context assembly: persona, selected skills, memory,
project guidance, current date, and relevant integration context. Delegate
conversation compaction to the agent; keep Toby's display transcript intact.
Remove any mandatory direct API pretreatment or planning call from this path:
use the shared generation operation or deterministic routing. Avoid two agents
both planning/executing the same turn, recursive backend delegation, and full
history reinjection. Resolve attachment support before sending a request.

The MCP bridge provides a per-execution allowlist and reuses connection routing,
input validation, dry-run behavior, tool caching where appropriate, applied
actions, and logging. Include eligible global, plugin, memory, library, project,
and user tools. Exclude orchestration helpers that would recursively start the
same harness unless explicitly supported. Skills are context, not MCP tools.

Prefer a loopback MCP endpoint authenticated by short-lived execution-scoped
tokens where the agent supports HTTP. Provide a stdio bridge for agents without
that capability. Reject stale/revoked tokens, tool calls after cancellation,
cross-session requests, and tools outside the execution scope. Never expose raw
integration credentials to the agent. Avoid recursive exports of the bridge
through Toby's own MCP connection manager.

Agent-native shell/file/network tools need separate controls: the Toby bridge
does not mediate them. Verify each preset can enforce the selected mode and
advertise only client filesystem/terminal capabilities Toby actually provides.
Dry-run turns must disable native writes or reject the unsupported mode.

## Background generation and structured flows

Summary and ordinary LLM nodes default to generation-only: no Toby integration
tools, no native shell/file mutations, and no interactive permission requests.
Require enforceable agent restrictions; prompt instructions alone are inadequate.
If an agent cannot enforce the required policy, mark it unavailable for that
task. A permission request during unattended execution returns a typed
`interaction_required` failure promptly rather than waiting indefinitely.

Flow tool nodes and destination delivery continue executing through Toby.
LLM nodes generate data; they do not repeat adjacent tool-node actions. Any
future agent-with-tools flow node must be a separate explicit node contract.

Direct API structured generation retains its existing supported schema path.
For ACP, send output instructions and the schema, parse the final answer, and
validate with the existing Zod schema. Permit one generation-only repair attempt
within the original deadline. Invalid output fails the node and prevents
dependent nodes/delivery. Keep permissive Markdown handling limited to schemas
that already allow it; never coerce arbitrary invalid JSON to success.

Audit all model-factory call sites, including scheduled/inbound turns, cron
interpretation, pretreatment, planning, delegated work, and tool-generation
helpers. Text-generation calls move to the shared executor or declare an explicit
service dependency. Validate dependencies up front so ACP-only generation setup
works without an API key, while unsupported transcription, embeddings, and search
give feature-specific configuration errors.

## Implementation sequence and completion gates

| Phase | Work | Completion gate |
| --- | --- | --- |
| 1. Compatibility spike | Test both pinned adapters under Bun and the packaged CLI: sign-in, generation-only restrictions, events, models/options, MCP transports, resume, cancel, schema results, and workspace guidance loading. | Capability matrix identifies supported configurations and any required runtime/package changes; both required presets can run chat and background generation. |
| 2. Config and executor foundation | Backend types/resolver, migration, direct API implementation, generation/conversation contracts, normalized errors/usage, and config API. | Legacy configurations round-trip and retain routing; direct API regression checks pass. |
| 3. ACP runtime and tool bridge | Process/session lifecycle, auth, capabilities, concurrency, scoped MCP export, policy enforcement, and persistence migrations. | Fake-agent contract tests pass; real Codex and Claude call an allowed Toby tool and are denied outside scope. |
| 4. Chat integration | Select execution path before direct-model-only setup; adapt streaming, context, persistence, attachments, permissions, cancel, and restart recovery. | Existing chat layout works with both agents; repeated/resumed turns have no duplicate transcript or actions. |
| 5. Background consumers | Recording summaries, flow LLM nodes, dashboard/library generation, schedules/inbound, and auxiliary call-site migration. | ACP-only text generation works; invalid flow output blocks delivery; tool nodes remain deterministic; no hidden mandatory API generation call. |
| 6. Native configuration | AI catalog groups and agent details, persona backend selector, task overrides, flow/node controls, and capability-aware status/error states. | A user can set up either agent, mix API/ACP selections, and run every scoped feature through Settings without editing config. |
| 7. Distribution and documentation | Adapter installation/versioning, packaged runtime checks, technical/help docs, screenshots, and diagnostics. | Clean-machine installation and packaged app end-to-end checks pass for both presets. |

Each phase should be independently reviewable. ACP background generation is part
of this implementation, not postponed as an unspecified later feature. Do not
enable the backend broadly until shared routing and dependency validation work.

## Validation

Use `bun:test` with a deterministic fake ACP subprocess for protocol failures,
capability negotiation, startup/auth deadlines, isolation, concurrency,
cancellation, replay deduplication, malformed/unknown updates, permission denial,
token scope, schema repair, and side-effect retry prevention. Cover migration,
routing precedence, config backup/sync, and direct API compatibility.

Add Swift tests for backend-dependent settings, unavailable connections/models,
task overrides, permission interaction, and existing transcript behavior. Verify
native controls, accessibility, light/dark appearances, and existing focus/scroll
behavior. Follow `DESIGN.md`, `toby-design`, `toby-native-window`, and applicable
Swift skills during implementation.

Run `bun run lint`, `bun run typecheck`, `bun run test`, and
`bun run test:swift` for substantive implementation changes. Build the native
app and verify packaged subprocess startup, install paths, cleanup, and signing
implications. Real-agent checks are explicit integration tests; normal automated
tests do not require a subscription, credentials, or billable generation.

Acceptance scenarios include an unchanged existing API user; ACP chat with
integration tools; multi-turn chat after daemon restart; denied and approved
interactive requests; background recording summary; freeform and structured
flows; invalid output stopping delivery; scheduled work without a UI; unavailable
agent/auth recovery; and cancellation without orphan processes or repeated writes.

## Documentation and diagnostics at implementation time

Update technical architecture, chat pipeline, server API, personas, flows,
listen, dashboard, library, security, and distribution docs where behavior
changes. Add a backend setup/reference page to both technical docs and the help
site; update AI-provider, persona, recording, flow, and configuration help.
Capture changed Settings/interaction screenshots. This proposal does not add
setup instructions claiming that an unimplemented feature exists.

Log execution/task IDs, connection/adapter versions, selected backend/model,
latency, completion reason, reported usage, schema failures, and permission
decisions. Redact secrets and avoid logging full task content by default.
Distinguish install, sign-in, capability, quota, protocol, and generation errors.

## Initial scope and remaining decisions

Initial scope is local stdio ACP, maintained Codex/Claude presets, and custom local
executables. Registry browsing/automatic discovery and remote ACP are subsequent
extensions. Resolve adapter installation/runtime packaging and enforceable native
tool restrictions in the spike before committing to distribution details. The
suggested default is manual adapter updates and no automatic cross-backend fallback.

## Primary references

- [ACP introduction](https://agentclientprotocol.com/get-started/introduction): local agents communicate over JSON-RPC/stdio; remote support is evolving.
- [ACP session setup](https://agentclientprotocol.com/protocol/v1/session-setup): initialize first, pass workspace/MCP configuration, and negotiate restoration capabilities.
- [ACP prompt turns](https://agentclientprotocol.com/protocol/v1/prompt-turn): streamed updates, tool interactions, and cancellation.
- [ACP TypeScript SDK](https://github.com/agentclientprotocol/typescript-sdk).
- [Codex ACP adapter](https://github.com/agentclientprotocol/codex-acp): translates ACP to Codex App Server, including auth, model configuration, events, and MCP integration.
- [Claude ACP adapter](https://github.com/agentclientprotocol/claude-agent-acp): uses the official Claude Agent SDK and supports client MCP tools and permission requests.
- [Codex App Server](https://learn.chatgpt.com/docs/app-server): native integration reference for capabilities not exposed by the ACP adapter.
