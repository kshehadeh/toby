# Flows (named pipelines)

Flows are **named pipelines**: an ordered sequence of **nodes** with explicit
**inputs** and **outputs**. They power non-chat workflows that need a fixed
sequence of steps: home dashboard card **bodies**, custom macros, and
**scheduled runs**.

**Definitions** are stored in SQLite (`flows` table in `~/.toby/chat.sqlite`) as
JSON documents. A custom definition may include an `icon` (one of Toby's
curated SF Symbol names) and a `color` (one of `FLOW_TILE_COLORS`: teal,
blue, green, orange, purple, pink, red, gray; default teal) used by Home
Actions tiles. Built-in dashboard flows are seeded from code on first lookup
if missing. **Executions** are stored separately (`flow_runs` / `flow_run_nodes`).

Flows are **not** the chat turn pipeline. They have no pretreatment, message
compaction, multi-step tool loops, or session transcript.

| | Chat pipeline | Flows |
| --- | --- | --- |
| Location | `packages/core/src/chat-pipeline/` | `packages/core/src/flows/` |
| Purpose | Interactive / headless chat turns | Named reusable workflows |
| Graph | Fixed six stages (init → … → persist) | Author-defined node list |
| LLM | Tool-calling multi-step loop | Optional **LLM Prompter** (structured + free-form fallback) |
| Tools | Model chooses tools | **Tool Executor** runs one tool deterministically |
| Docs | [chat-pipeline.md](chat-pipeline.md) | This file |

## Build a flow from chat

The shipped `flow-builder` skill guides natural-language requests into custom
flows. Chat tools `listFlowAuthoringCatalog` and `createFlow` inspect available
steps and save a validated definition respectively. Creation uses generated
`flow.<uuid>` IDs and the existing user-flow store/validator, with no execution
or delivery. The tools support constants, automation-event references, earlier output references, a markdown or structured LLM step, conditional subsequent actions, result pointers, personas, and destinations. They do not update
existing flows or create Script Tools. A Home action uses
`{ "type": "dashboard", "variant": "runner" }` alongside an optional modal.

The native editor preserves standard-tool references, node output mappings,
result pointers, typed constants, and LLM settings when changing destinations
or prompts. Flow create/update requests with malformed steps return validation
errors rather than silently dropping those steps. Dashboard refresh runs the
stored definition; it does not rewrite it.

The editor shows each tool step's prompt references and offers **Insert step
output** on the LLM step. These references use output bag keys, not node IDs.
For example, `outputs: { jiraIssues: "result" }` is read with
`{{json bag.jiraIssues}}`. Repeated keys refer to the last step that wrote them.
Custom-flow validation rejects a declared `result.from` that no step emits;
an LLM writing `outputs: { summary: "object" }` needs
`result: { from: "summary", path: "markdown" }`, or an omitted result for inference.

## Mental model

```
FlowDocument (SQLite flows table, id = stable key)
  persona spec (default | named | dashboard)
  nodes: [ Node₁, Node₂, … Nodeₙ ]   // JSON-serializable

getFlow(id) / runFlow(id)
  → load row (seed built-in if missing)
  → hydrate → runtime FlowDefinition (Zod + prompt fns)
  → resolve persona
  → context bag = { …initial inputs }
  → for each node:
        resolve inputs from bag / consts
        run node
        write outputs into bag
  → FlowResult { ok, outputs, nodeTrace, … }
```

The **context bag** is a mutable `Record<string, unknown>`. Nodes do not call
each other by name; the definition **wires** ports via `inputs` / `outputs`.

## Concepts

| Concept | Meaning |
| --- | --- |
| **Flow document** | JSON definition in SQLite (`id`, persona, nodes) |
| **Flow** | Hydrated runtime form: node list + persona binding |
| **Node** | One step: currently `tool_executor` or `llm_prompter` |
| **Context bag** | Intermediate values during a run |
| **Input source** | How a node parameter is filled (`const` or `from` bag key) |
| **Output map** | Which bag keys get which fields of the node result |
| **Persona** | Model + instructions used by every LLM Prompter in that run |
| **Declared result** | Bag pointer destinations and the result sheet consume |
| **Destination** | What to do after a successful run (`modal`, `email`, `slack`, `dashboard`) |

## Persona resolution

Stored documents use a serializable **persona spec**:

| Spec | Runtime behavior |
| --- | --- |
| `{ source: "dashboard" }` | `resolveDashboardPersona()` (Settings → Home) |
| `{ source: "named", name }` | `resolvePersona(name)`, then default |
| `{ source: "default" }` or omitted | Default persona |

For each run, the effective persona is:

1. `personaOverride` on `runFlow` options  
2. Named persona from the hydrated definition  
3. `resolvePersona()` on the definition (dashboard source)  
4. Default persona  

All **LLM Prompter** nodes use `createModelForPersona` for that persona (not the
cheaper auxiliary model used by chat pretreatment).

## Node types (v1)

### Tool Executor

Runs **one** plugin tool **without** LLM intervention.

```ts
{
  id: "fetch-unread",
  type: "tool_executor",
  tool: { standardTool: "email.unreadSummary" },
  // or: { moduleName: "email", toolName: "getUnreadSummary" },
  inputs: { limit: { const: 50 } },
  outputs: { unread: "result" }, // bag key ← path into node result
}
```

**Node result shape:**

```ts
{
  result: unknown;       // plugin tools execute `result` field
  moduleName: string;
  toolName: string;
  standardTool?: string;
}
```

**Default outputs** if omitted: `{ result: "result" }` (bag key `result` gets
the tool payload).

#### Tool reference

| Form | Resolution |
| --- | --- |
| `{ standardTool: "…" }` | Prefer category modules, then default provider, then first connected module that tags the tool |
| `{ moduleName, toolName }` | Named module + tool (defs checked when available) |
| `{ userToolId }` | Shared user-authored TypeScript or AppleScript tool, resolved by stable ID |

Plugin tool execution uses the same plugin envelope as chat/dashboard hooks: credentials
config, integration state, `dataDir`, and `pluginToolsExecuteAsync`.

### User script tools

The Flows sidebar opens a Script Tools library. Each tool has a stable
`tool.<uuid>` ID, name, language (`typescript` or `applescript`), ordered input
names, output kind (`text` or `json`), and source. Tool metadata is in
`user_tools`; immutable source revisions are in `user_tool_revisions`. A flow
stores `{ userToolId }` in its Tool Executor node. Editing a tool changes the
revision used by all referencing flows. A flow run records the revision in its
tool call detail. Deletion is blocked while a custom flow references the tool.

TypeScript source exports a default async function taking an input object and
returning a text or JSON value. It runs in a separate Bun process using the
bundled runtime resolver. AppleScript source uses `on run argv`, receiving the
declared inputs as strings in order. It runs through `/usr/bin/osascript` and
returns text, or JSON text when JSON output is selected. Scripts run with the
current user's local permissions. The runner supplies a minimal environment,
limits input to 256 KB, execution to 30 seconds, and output to 1 MB, and removes its temporary
files after execution. These limits do not isolate a script from the user's
files, network, or macOS automation permissions.

Script tools are available in flows and their own test action. The editor's
**Run Test** executes the current draft source and inputs without saving a tool
or creating a revision. They are not added to chat's model-selected tool set.

**Edit with AI** sends the latest instruction plus the draft name, description,
language, ordered input names, output kind, current source, and recent successful
requests to the configured default persona's AI model. The language-specific
generation guide describes Toby's Bun or `osascript` runner contract. The
current source remains authoritative if the user makes manual edits or a later
request supersedes an earlier one. A successful response replaces only the
editor's draft source and adds the request to an in-memory history for that
editor session. The history is cleared when the user starts editing another
tool; only the latest eight requests, up to 12,000 characters total, are sent
to the model. Source above 20,000 characters is rejected rather than truncated.
Generation does not execute or persist the returned code.

Toby.app edits inputs as individual named strings and builds the test input
object from matching fields. The script editor uses CodeEditorView with
line numbers and lexical highlighting for TypeScript and AppleScript. AppleScript
keywords, strings, numbers, `--` and `#` line comments, and nested `(* … *)` comments
use the shared code theme. A tool's selected list row uses the shared feature-browser
selection style.

**Naming note:** IDs like `email.unreadSummary` mean “dashboard **list/count**
shape,” not an LLM summary of the whole inbox. The tool returns structured
metadata (subjects, from, dates, etc.). Prose is produced only by an
**LLM Prompter** node downstream.

Implementation: `packages/core/src/flows/nodes/tool-executor.ts`,
`packages/core/src/flows/tool-resolve.ts`.

### LLM Prompter

Calls the flow persona’s model once with **structured** output (Zod →
`Output.object`). No tool-calling loop.

**Stored document form** (SQLite / `FlowDocument`):

```ts
{
  id: "summarize",
  type: "llm_prompter",
  schema: { kind: "markdown" }, // default → z.object({ markdown: z.string() })
  schemaName: "EmailDashboardSummary",
  systemPrompt: "You are …",   // template string
  userPrompt: "Here are the items:\n\n{{dashboardItems bag.unread}}",
  promptHelpers: {
    composePersona: true,        // wrap with persona instructions
    appendSkillsCatalog: false,  // dashboard seeds omit skills (avoids meta leak)
    appendCurrentDateTime: true, // append local date/time + timezone (per run)
  },
  inputs: { data: { from: "unread" } },
  outputs: { summary: "object" },
  temperature: 0.3,       // default 0.3
  maxOutputTokens: 3000,  // default 3000
  timeoutMs: 45_000,      // default 45s
}
```

### Prompt templates

| Token | Meaning |
| --- | --- |
| `{{bag.<key>}}` | Compact JSON (or string) of bag value |
| `{{json bag.<key>}}` | Pretty-printed JSON |
| `{{dashboardItems bag.<key>}}` | Format dashboard tool-result items for the model |
| `{{inputs.<name>}}` | Resolved node input value |

After template render, optional **promptHelpers** apply persona composition,
skills catalog, and a current date/time + timezone section (same behavior
dashboard summaries used when prompts were code). `appendCurrentDateTime`
renders per run and appends the user's local timezone so models can write
wall-clock times instead of echoing the UTC ISO timestamps carried by
dashboard items (item `when:` lines are already pre-formatted to local time
by `{{dashboardItems ...}}` / `formatItemsForPrompt`).

Hydration turns templates into runtime prompt functions. **Node result:**
`{ object: <parsed schema> }`. **Default outputs:** `{ object: "object" }`.

For the markdown schema preset, free-form generation is preferred (many gateway
models fail structured mode). Free-form gets a full timeout budget and is
coerced into `{ markdown }`. Callers may further sanitize (dashboard uses
`extractDashboardSummaryText`).

Implementation: `packages/core/src/flows/nodes/llm-prompter.ts`,
`prompt-template.ts`, `schema-presets.ts`, `hydrate.ts`.

## Input / output wiring

### Structured decisions and conditional actions

LLM nodes also accept a flat required-field schema:

```json
{
  "kind": "object",
  "fields": {
    "shouldNotify": { "type": "boolean", "description": "A meeting starts within the next ten minutes" },
    "title": { "type": "string" },
    "description": { "type": "string" }
  }
}
```

Supported field types are `string`, `boolean`, and `number`; all 1–32 fields are required. Names must start with a letter and contain only ASCII letters, digits, and underscores; prototype traversal names are rejected. The schema is converted to a strict Zod object. Both structured provider output and the JSON text fallback must validate before outputs reach subsequent steps. The editor exposes this as **Answer format → Named fields**.

For an LLM with `outputs: { decision: "object" }`, a notification step can declare:

```json
{
  "id": "notify",
  "type": "tool_executor",
  "tool": { "moduleName": "macos", "toolName": "macNotificationShow" },
  "when": { "from": "decision", "path": "shouldNotify" },
  "inputs": {
    "title": { "from": "decision", "path": "title" },
    "description": { "from": "decision", "path": "description" }
  }
}
```

The editor adds `when` from a step's **Only run when…** menu item and shows it as an "Only runs when" row. The reference must point to an earlier output or automation context. The runner evaluates it before resolving action arguments: boolean `true` executes, `false` records `skipped` without calling a tool or emitting outputs, and missing/non-boolean values fail the run. Skipped nodes retain their reason and evaluated reference in history; the overall run succeeds unless a later step fails. Referencing an output that a skipped step did not emit fails when no earlier value exists under that key. Use distinct output keys to avoid referring to an older value from another step.

Conditions apply to tool actions, not LLM nodes or result destinations. Trigger completion notifications are optional; when enabled they also report successful runs whose conditional action was skipped. Email/Slack destinations still deliver after a successful run; gate a send tool as an action when delivery should be conditional. A declared result pointer continues to control the result; if the final action is skipped and the result was inferred, the result reports the skip instead of an older value under the same key.

### Inputs

| Source | Meaning |
| --- | --- |
| `{ const: value }` | Literal parameter value |
| `{ from: "key" }` | Whole value at bag key `key` |
| `{ from: "key", path: "items" }` | Dot-path into that value (`a.b.c`) |

Missing bag keys or paths throw `FlowNodeError` and fail the run.

User-authored tool inputs accept `{ const }`, automation context references, or references to outputs from earlier steps. The native editor builds each parameter's control from the tool schema (`enum` with optional `enumNames`, `default`, `minimum`/`maximum`, `title`), keeps unset optional parameters under **More options**, and links a parameter to a named trigger value (for example **The new file** for `event.payload.changes.0.path`) or an earlier output through a per-field link menu. Custom trigger paths and output field paths stay available there, and references are preserved when editing. Use `{ from: "object", path: "markdown" }` to pass the default LLM answer into a later action. Named LLM outputs work the same way (for example `{ from: "summary", path: "markdown" }`). Only outputs emitted before the consuming step are accepted; unsafe prototype paths are rejected. Missing paths fail the run before the action executes. LLM prompts may interpolate bag values (`{{json bag.<key>}}`). The editor places actions following the AI step in an Acts phase. Manual runs without automation context fail before
the affected tool executes. Paths containing prototype traversal keys are rejected.

### Outputs

Map **bag key → path into node result**. Path `"."` (or empty) means the entire
node result.

```ts
// Tool executor node result: { result, moduleName, toolName }
outputs: {
  unread: "result",      // bag.unread = tool payload
  provider: "moduleName", // bag.provider = "email"
}
```

Implementation: `packages/core/src/flows/resolve-inputs.ts`.

## Declared result and destinations

The context bag and `flow_runs.final_outputs_json` remain the store for every
run. Destinations do not replace that history.

A document may name **one result** (`result.from` / optional `path`) and a
list of **destinations**:

| Destination | Who delivers | Notes |
| --- | --- | --- |
| `modal` | Toby.app | Interactive **Run now** opens a result sheet |
| `email` | Daemon via `email.sendEmail` | `to` + `subject` are author-time constants; body is the result text |
| `slack` | Daemon via `slack.postToChannel` | `channel` is an author-time constant |
| `dashboard` | Toby.app home screen | Registers a home card **or** an Actions rail tile. `variant` is `informational` (last-run body + refresh) or `runner` (colored icon tile in the Actions rail). Informational cards take `refresh`: `asNeeded` (default; soft-refresh like built-ins) or `manual` (card/toolbar refresh only). At most one dashboard destination per flow. |

If `result` is omitted, the last LLM node’s markdown (or the last tool’s
`appliedActions` / payload) is used. New user flows default to
`[{ type: "modal" }]`. A failed email/slack destination fails the run.
Modal and dashboard destinations are registration-only (they never fail the
run). Built-in dashboard flows declare informational Home placement; their category
rendering still reads the summary bag in code.

### Custom flow home cards

A custom flow with `{ type: "dashboard", variant, refresh?, color? }` appears on the home
dashboard. Discovery: `listFlowDashboardBlocks()` /
`GET /api/dashboard/flow-blocks` (includes resolved `refresh` and optional
`dashboardColor`). Dashboard output `color` selects the default Home appearance
from the existing eight-color palette or `neutral`; omission preserves the
existing appearance. Edit Home can override it locally without changing the
flow. See [Home block colors](dashboard.md#home-block-colors). Card body:
`GET /api/dashboard/:flowId/content`.

| Variant | Home UI | Soft load | Force refresh / click |
| --- | --- | --- | --- |
| `informational` + `asNeeded` (default) | Same size as built-ins; body is last successful run output | Last success if younger than 5 min; stale last success returned immediately plus a background rerun; never-run awaits a run | `runUserFlowById` with `deliverDestinations: false` |
| `informational` + `manual` | Same card chrome | Last success only (no rerun) | Same force path as as-needed |
| `runner` | Compact **Actions** rail tile (colored card, flow SF Symbol, play glyph, and name; hover 1s shows title and description). Hidden when no runners are visible. | Never runs; no body | Click is `POST /api/flows/:id/run` with `source: "home.action"`. Toolbar / card refresh does **not** run it. The button disables and shows a spinner while the run is in flight. |

`showsResultSheet` is true when the flow also has a `modal` destination. **Run
Now** then opens the result sheet. Combining dashboard + email/slack is
allowed; email/Slack still fire on **Run now** and triggered runs, **not** on
dashboard card generation.

## Storage model

All of the following live in **`~/.toby/chat.sqlite`**:

| Table | Role |
| --- | --- |
| `flows` | Flow **definitions** (JSON documents) |
| `flow_runs` / `flow_run_nodes` | Execution **history** |
| `user_tools` / `user_tool_revisions` | Shared script definitions and immutable source revisions |

### Definition table (`flows`)

| Column | Purpose |
| --- | --- |
| `id` | Stable key (e.g. `dashboard.email.summary`) |
| `name` | Display name (often same as `id`) |
| `description` | Optional text |
| `persona_json` | Persona spec JSON |
| `definition_json` | Full `FlowDocument` JSON |
| `builtin` | `1` for seeded built-ins |
| `created_at` / `updated_at` | ISO timestamps |

### Built-in seed-on-miss

Dashboard (and future) built-ins are defined as seed `FlowDocument`s in
`packages/core/src/flows/builtins.ts`.

- `getFlow(id)` / `getFlowRecord(id)`: if no row and `id` is a known built-in,
  **insert the seed once** and return it.
- `listFlows()`: ensures **all** built-ins exist, then lists every row.
- Existing dashboard rows still marked built-in are refreshed when the shipped seed changes. Custom rows are preserved.

Built-in dashboard summaries declare one enabled `dashboard.refresh` trigger
(`dashboard-refresh`, "Home refresh"). Home owns execution and cache invalidation:
soft requests reuse fresh summaries for five minutes and can return persisted
content while regenerating in the background; force refresh bypasses caches.
Disconnected or empty categories do not run the flow. Concurrent refreshes share
an in-flight run. Custom flows can also choose this source. It requires a dashboard informational
destination and cannot coexist with `home.action`. Saving an informational Home
destination adds the matching trigger. Disabled refresh triggers retain their card
but suppress both soft and force runs. Home controls freshness through the
destination’s `refresh` setting, rather than schedule/native cooldown policies.
It is not polled by the schedule/native trigger supervisor.
Actual summary runs record `dashboard.refresh:<category>` in run history.

### Runtime API

```ts
import {
  getFlow,
  listFlows,
  saveFlowDocument,
  runFlow,
  runFlowDefinition,
  type FlowDocument,
  type FlowResult,
} from "@toby/core/flows";

const result: FlowResult = await runFlow("dashboard.email.summary", {
  personaOverride, // optional Persona
  inputs: { /* optional seed bag */ },
  abortSignal,
  trigger: "dashboard.refresh:email", // optional label for history
  record: true, // default; set false to skip chat.sqlite run writes
});

if (result.ok) {
  // result.outputs — final context bag
  // result.persona / provider / model
  // result.runId — history row id when recorded
  // result.startedAt / completedAt / durationMs
  // result.nodeTrace — per-node inputs, outputs, detail, duration
} else {
  // result.error, result.failedNodeId, partial result.outputs
}
```

| Function | Role |
| --- | --- |
| `getFlow(id)` | Load + hydrate (seed built-in on miss) |
| `listFlows()` | All stored definitions (seeds built-ins first) |
| `saveFlowDocument(doc)` | Insert or replace a serializable document |
| `removeFlowDocument(id)` | Delete a definition row |
| `runFlow(id, opts?)` | Run by id from the store (records history by default) |
| `runFlowDefinition(def, opts?)` | Run an in-memory runtime definition (no store write of def) |
| `listFlowRuns` / `getFlowRun` | Read execution history |
| `pruneFlowRuns({ olderThanIso })` | Delete completed runs with `started_at` before a date |

Public entry: `packages/core/src/flows/index.ts`.

## Execution history

Every flow **run** is persisted to **`~/.toby/chat.sqlite`** (tables `flow_runs`,
`flow_run_nodes`) unless `record: false`.

### Run record (`flow_runs`)

| Field | Purpose |
| --- | --- |
| `id` | UUID for detail API / UI |
| `flow_name` | Flow id |
| `status` | `running` \| `success` \| `error` |
| `persona_name`, `provider`, `model` | Resolved persona / model |
| `trigger` | Caller label (e.g. `dashboard.refresh:calendar`) |
| `definition_snapshot_json` | Graph metadata for UI (node list, wiring) |
| `initial_inputs_json` / `final_outputs_json` | Seed bag and final bag |
| **`started_at`** / **`completed_at`** | ISO timestamps for the execution window |
| **`duration_ms`** | Wall-clock duration |
| `error`, `failed_node_id` | Failure info |

Timestamps enable listing by recency and **purging old runs**:

```ts
import { pruneFlowRuns } from "@toby/core/flows";

// Delete completed runs started before a cutoff (running rows kept)
pruneFlowRuns({ olderThanIso: "2026-01-01T00:00:00.000Z" });
pruneFlowRuns({ olderThanIso: cutoff, flowName: "dashboard.email.summary" });
```

### Node records (`flow_run_nodes`)

Per node: resolved **inputs**, bag **outputs**, **duration_ms**,
**started_at** / **completed_at**, status, and **detail_json**:

- **tool_executor** — tool ref, resolved module/tool, `toolCalls[]` (args, result, timing)
- **llm_prompter** — provider/model, persona, mode (structured/freeform), prompts, usage

### HTTP (daemon)

| Method | Path | Purpose |
| --- | --- | --- |
| `GET` | `/api/flows` | Flow list for the app UI (`id`, `name`, `description`, `icon`, `color`, `builtin`, `persona`, node graph snapshot with a best-effort `display` on tool steps, `result`, `destinations`, timestamps); seeds built-ins |
| `POST` | `/api/flows` | Create a custom flow (server mints `flow.<uuid>`) |
| `GET` | `/api/flows/catalog` | Connected plugin tools including `inputSchema` |
| `GET` | `/api/flows/:id` | List item + stored `document` (prompts, destinations) |
| `PUT` | `/api/flows/:id` | Replace a custom flow (403 for built-ins) |
| `DELETE` | `/api/flows/:id` | Delete a custom flow (403 for built-ins) |
| `POST` | `/api/flows/:id/run` | Run now, extract declared result, deliver email/slack destinations |
| `GET` | `/api/flows/runs` | Run summaries (`?flowName=&limit=&offset=`) |
| `GET` | `/api/flows/runs/:id` | Full run + ordered nodes + destination results |
| `GET` / `POST` | `/api/user-tools` | List or create script tools |
| `GET` / `PUT` / `DELETE` | `/api/user-tools/:id` | Inspect, edit, or delete a script tool |
| `POST` | `/api/user-tools/test` | Execute a draft with `language`, `inputNames`, `outputKind`, `source`, and `input` without saving |
| `POST` | `/api/user-tools/generate` | Generate replacement `source` from an `instruction`, optional `previousRequests`, and current draft settings without saving |
| `POST` | `/api/user-tools/:id/test` | Execute a saved revision with `{ input: {...} }` |

List responses omit heavy node I/O; use `GET /api/flows/:id` or a run detail
route for click-through.

User-authored documents are validated by `validateUserFlowDocument`:

- Tool executor inputs may be constants, automation context references, or earlier output references
- Required tool fields must be filled when the plugin is installed
- At most one LLM Prompter is supported; it uses the markdown preset or a flat object schema and may be followed by tool actions
- Action conditions reference earlier outputs or automation context; strict boolean evaluation occurs at run time
- Destinations are `modal`, `email` (`to`, `subject`), `slack` (`channel`), or `dashboard` (`variant`, optional informational `refresh`, optional Home `color`)
- Email/Slack destinations require that integration to be connected

`runUserFlowById` extracts the declared result (or infers it from the last
node) and delivers non-modal destinations via `sendEmail` / `postToChannel`.
Modal is UI-only: the run response includes `result` for the app to display.

### Toby.app UI

The main window **Flows** surface (`DetailRoute.flows`) lists flows in a second
column and opens inspect-only detail with node steps and
recent runs. **New flow** or **Edit** opens a step-list editor in a sheet.
Cancel and Save sit in the sheet toolbar. The editor covers name, curated SF
Symbol icon, tile color, tool picker, const inputs, optional last LLM,
destinations, including the Home color default. The icon follows the flow onto
Home. Home color overrides the flow-level tile color for Actions and supplies
the informational card appearance; Edit Home can override it on this Mac. Documents without
an icon or color retain the existing category-derived / generic icon fallback
and the default teal tile. When serializing edits, the native editor omits a result pointer whose output
bag key no longer exists after step removal or replacement. Runtime inference
then selects the final step’s result; valid explicit pointers remain unchanged.
Custom flows can be edited, deleted, and
**Run now**. Built-in flows stay read-only. A successful interactive run with a
modal destination opens a result sheet.

## Package layout

| Path | Role |
| --- | --- |
| `flows/types.ts` | Runtime definition + result + history types |
| `flows/document-types.ts` | Serializable `FlowDocument` / stored node types |
| `flows/builtins.ts` | Built-in seed documents (dashboard summaries) |
| `flows/definition-store.ts` | SQLite CRUD + seed-on-miss |
| `flows/hydrate.ts` | Document → runtime `FlowDefinition` |
| `flows/prompt-template.ts` | Template render + persona/skills helpers |
| `flows/schema-presets.ts` | Schema kind → Zod |
| `flows/registry.ts` | `getFlow` / `listFlows` / `saveFlowDocument` |
| `flows/runner.ts` | Sequential driver + history instrumentation |
| `flows/store.ts` | Run history persistence, list/get/prune |
| `flows/definition-snapshot.ts` | Serializable graph for UI / run snapshots |
| `flows/resolve-inputs.ts` | `const` / `from` / path + apply outputs |
| `flows/tool-resolve.ts` | standardTool / named tool resolve + execute |
| `flows/nodes/tool-executor.ts` | Tool Executor node |
| `flows/nodes/llm-prompter.ts` | LLM Prompter node |
| `flows/dashboard-items.ts` | Dashboard tool-result item helpers |
| `flows/validate-user-flow.ts` | Policy for user-authored documents |
| `flows/extract-result.ts` | Declared / inferred result text |
| `flows/catalog.ts` | Connected tool catalog for the editor |
| `flows/deliver-destinations.ts` | Email / Slack / modal / dashboard sinks |
| `flows/run-user-flow.ts` | Run + extract + deliver |
| `flows/index.ts` | Public exports |

Tests: `apps/cli/tests/flows.test.ts`, `flows-history.test.ts`, `user-flows.test.ts`, `user-flows-api.test.ts`, `flow-destinations.test.ts`, `flow-dashboard-blocks.test.ts`.

## Built-in consumers: dashboard card content

Home cards use a **single content path**. The card **definition** owns the
static header; the body is **flow output** only. See [dashboard.md](dashboard.md).

| API | Role |
| --- | --- |
| `GET /api/dashboard/flow-blocks` | Custom flows opted onto the home screen |
| `GET /api/dashboard/:category/content` | Block content (preferred; `:category` may be a custom flow id) |
| `GET /api/dashboard/:category/summary` | Alias of `/content` |

Optional `?fresh=1` bypasses soft caches and **awaits** a new flow run.
Toby.app force-refreshes on toolbar / per-card refresh; soft-loads on home
appear when the daemon is ready. Custom informational cards with
`refresh: "manual"` skip the soft rerun; force refresh still awaits a run.

### Flow map

| Category | Flow name | Tool Executor standard tool | Context bag key for tool result |
| --- | --- | --- | --- |
| Email | `dashboard.email.summary` | `email.unreadSummary` | `unread` |
| Tasks | `dashboard.tasks.summary` | `tasks.openSummary` | `openTasks` |
| Calendar | `dashboard.calendar.summary` | `calendar.upcomingSummary` | `upcoming` |

Shared pipeline shape for each category:

```
Tool Executor (standard tool, limit 50)
        ↓ bag.<key>
LLM Prompter → { markdown: string }
        ↓ bag.summary
```

Persona: Settings → Home (`config.dashboard.persona`) via
`resolveDashboardPersona()` in `packages/core/src/dashboard/prompts.ts`.

### How content generation invokes flows

`getDashboardBlockContent` in
`packages/core/src/dashboard/summarizer.ts`:

1. Loads category data server-side (`getDashboardCategory`, limit 50) for
   empty-state, cache keying, and seed.  
2. If `count === 0`, returns empty content (no flow/LLM).  
3. Soft path: in-memory (5 min) + disk (`~/.toby/dashboard-summaries.json`).  
4. On miss / force: `runFlow("dashboard.<category>.summary", { personaOverride })`.  
5. Maps `outputs.summary.markdown` → `DashboardBlockContent.text` (after
   `extractDashboardSummaryText` CoT strip).  
6. Fills `count` / `launchUrls` / `sources` from tool + aggregator data.

The aggregator HTTP routes remain available for debug; home cards do not call
them.

### Seed source

| Flow | Seed |
| --- | --- |
| All three dashboard content flows | `packages/core/src/flows/builtins.ts` |
| Category prompt text | `CATEGORY_PROMPTS` in `dashboard/prompts.ts` (inlined into seed system prompts) |
| Item formatting helper | `packages/core/src/flows/dashboard-items.ts` |

## Adding a built-in flow

1. Add a `FlowDocument` to `packages/core/src/flows/builtins.ts` and
   `BUILTIN_FLOWS`.  
2. Use serializable nodes only (string prompt templates, a markdown preset or flat object schema).
3. Call `runFlow("<id>")` from the consumer (`getFlow` seeds on first miss).  
4. Add tests under `apps/cli/tests/` and document here.

### Example document skeleton

```ts
import { saveFlowDocument, type FlowDocument } from "@toby/core/flows";

const myFlow: FlowDocument = {
  id: "example.my-flow",
  name: "example.my-flow",
  description: "…",
  persona: { source: "default" },
  // or: { source: "named", name: "Toby" }
  // or: { source: "dashboard" }
  nodes: [
    {
      id: "fetch",
      type: "tool_executor",
      tool: { standardTool: "tasks.openSummary" },
      inputs: { limit: { const: 20 } },
      outputs: { data: "result" },
    },
    {
      id: "draft",
      type: "llm_prompter",
      schema: { kind: "markdown" },
      systemPrompt: "Summarize the data. Reply with markdown only.",
      userPrompt: "Data:\n\n{{json bag.data}}",
      promptHelpers: { composePersona: true },
      outputs: { summary: "object" },
    },
  ],
};

saveFlowDocument(myFlow);
```

For one-off tests without persisting a definition, build a runtime
`FlowDefinition` and call `runFlowDefinition(def, { record: false })`.

## Triggers

A custom Flow owns zero or more triggers; a new definition defaults to an enabled
manual trigger. There are no separate Schedule or Automation entities, endpoints,
or CLI commands. Existing legacy records are not migrated or executed.

Each trigger has a stable ID, name, enabled flag, source, conditions (IANA timezone,
optional weekdays/time window), policy (cooldown seconds/once per day), initial
inputs, event input mappings, and optional completion notification.
Sources are `manual`, `home.action` (Home Screen Action), `dashboard.refresh` (Home refresh), `schedule` (cron and `missedRuns: latest | skip`),
`macos.didWake`, `macos.userReturned`, and `macos.fileChanges`.
`latest` runs only the latest missed cron occurrence since flow creation;
`skip` ignores occurrences more than 60 seconds late. Cron uses the trigger's
explicit timezone. Native events require Toby.app and are not replayed after downtime.

Definitions and revisions live in `flows`. The daemon's
`flows/triggers/supervisor.ts` polls cron and native events, records durable
claims in `flow_trigger_decisions`, and executes the captured Flow definition
through `runUserFlow`. Run Now uses the same queue and requires an enabled
manual trigger. Manual and Home action runs bypass automatic cooldown/day/window conditions.
At most two runs execute globally, with one active run per Flow. Non-file
triggers allow one queued occurrence per binding; file batches queue up to the
global pending limit of 100. Native events expire after 120 seconds. Disabling
or deleting a trigger cancels queued work. Edits preserve already queued
snapshots. Restart marks pending/running decisions interrupted without retrying
possible external effects. Occurrence IDs prevent duplicate delivery on polling.
Cooldown and daily limits are consumed when queued, including eventual failures.

Folder sources accept optional `runPerFile: true`. Ingestion splits each native
batch into single-change events, preserving the native event ID and watch revision.
Separate occurrence IDs deduplicate each file on repeated polls. Steps can read
`trigger.event.payload.changes.0.path` as a scalar path. Runs remain serialized
per Flow and subject to queue limits, freshness, cooldown, and daily limits.
The default is one run per batch. Watcher startup and edits establish a new
baseline rather than replaying existing files.

All runs share `flow_runs`, node traces, result extraction, and destinations.
Background runs do not open modal windows. Trigger activity displays the latest
100 decisions, including skips, errors, and links to run traces. Completion
notifications are opt-in per trigger.

Steps read `{ from: "trigger", path: "event.payload.changes" }`, or templates
such as `{{json bag.trigger}}`. Initial inputs and event mappings populate
the same input bag. `trigger` is reserved and cannot be overwritten by step outputs.

### Home Screen Action

The `home.action` trigger is the Home Actions entry point. Selecting it forces
one `{ type: "dashboard", variant: "runner" }` destination, preserving its
Home color and other destinations. The native editor locks removal and variant
changes for this location while any Home Screen Action trigger exists, even if
it is disabled. Removing/changing the last such trigger restores an editable
informational Home card. Choosing an Actions button as a destination adds a
matching enabled Home Screen Action trigger. Validation and persistence enforce
the pair for definitions authored through chat or the API as well.

Only enabled Home action triggers register an Actions button. A Home click calls
`POST /api/flows/:id/run` with `{ "source": "home.action" }`; ordinary Run Now
uses the default `manual` source. Both use the same queue/history, but each
selects its own trigger inputs and event context. A Flow can have either or both
entry points; Home-only Flows do not require a manual trigger.

### Agent Task

An `agent_task` node runs a noninteractive, tool-using prompt with the selected
persona, skills, memory, and optional Flow `projectId`. It accepts `userPrompt`,
optional `systemPrompt`, and output mappings, returning `{ object: { markdown } }`.
Use `outputs: { summary: "object" }` and result `{ from: "summary", path: "markdown" }`.
A scheduled prompt is simply a Flow containing this node and a schedule trigger.
A Flow supports at most one AI node: `agent_task` or `llm_prompter`.
The latter keeps fixed structured generation without a tool-calling loop.

## Failure behavior

- Unknown flow id → `ok: false`, error message, empty trace.  
- Missing input / output path → `FlowNodeError`, run stops, prior bag kept.  
- Tool exec failure → node fails with plugin error string.  
- LLM structured output null / timeout / abort → node fails.  
- `nodeTrace` always lists completed and failed nodes with `durationMs`.

## Non-goals (current)

- Visual canvas / DAG editor (the editor is a vertical step list)
- Multi-step tool loops inside LLM Prompter (use an Agent Task)
- Alternate branches, conditional LLM nodes/destinations, parallel nodes
- Running a flow from the command palette
- Overwriting existing built-in rows when seed content changes
- Nested objects, arrays, and optional structured output fields
- CLI `toby flows`

## Related docs

- [dashboard.md](dashboard.md) — widget load path, caches, plugins, AI flow wiring  
- [dashboard-standard-tools-plan.md](dashboard-standard-tools-plan.md) — standard tool contract  
- [chat-pipeline.md](chat-pipeline.md) — interactive chat turn nodes  
- [plugin-protocol.md](plugin-protocol.md) — `tools list` / `tools execute`  
- [integrations.md](integrations.md) — `IntegrationModule` and discovery  

## Native event triggers

See [native event triggers](automations.md) for source requirements and file watching.
