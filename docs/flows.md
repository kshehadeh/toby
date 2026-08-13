# Flows (named pipelines)

Flows are **named pipelines**: an ordered sequence of **nodes** with explicit
**inputs** and **outputs**. They power non-chat workflows that need a fixed
sequence of steps (today: home dashboard card **bodies**).

**Definitions** are stored in SQLite (`flows` table in `~/.toby/chat.sqlite`) as
JSON documents. Built-in dashboard flows are seeded from code on first lookup
if missing. **Executions** are stored separately (`flow_runs` /
`flow_run_nodes`).

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

## Persona resolution

Stored documents use a serializable **persona spec**:

| Spec | Runtime behavior |
| --- | --- |
| `{ source: "dashboard" }` | `resolveDashboardPersona()` (Settings → Dashboard) |
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

Execution uses the same plugin envelope as chat/dashboard hooks: credentials
config, integration state, `dataDir`, and `pluginToolsExecuteAsync`.

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
  schema: { kind: "markdown" }, // only preset today → z.object({ markdown: z.string() })
  schemaName: "EmailDashboardSummary",
  systemPrompt: "You are …",   // template string
  userPrompt: "Here are the items:\n\n{{dashboardItems bag.unread}}",
  promptHelpers: {
    composePersona: true,       // wrap with persona instructions
    appendSkillsCatalog: false, // dashboard seeds omit skills (avoids meta leak)
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

After template render, optional **promptHelpers** apply persona composition and
skills catalog (same behavior dashboard summaries used when prompts were code).

Hydration turns templates into runtime prompt functions. **Node result:**
`{ object: <parsed schema> }`. **Default outputs:** `{ object: "object" }`.

For the markdown schema preset, free-form generation is preferred (many gateway
models fail structured mode). Free-form gets a full timeout budget and is
coerced into `{ markdown }`. Callers may further sanitize (dashboard uses
`extractDashboardSummaryText`).

Implementation: `packages/core/src/flows/nodes/llm-prompter.ts`,
`prompt-template.ts`, `schema-presets.ts`, `hydrate.ts`.

## Input / output wiring

### Inputs

| Source | Meaning |
| --- | --- |
| `{ const: value }` | Literal parameter value |
| `{ from: "key" }` | Whole value at bag key `key` |
| `{ from: "key", path: "items" }` | Dot-path into that value (`a.b.c`) |

Missing bag keys or paths throw `FlowNodeError` and fail the run.

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

## Storage model

All of the following live in **`~/.toby/chat.sqlite`**:

| Table | Role |
| --- | --- |
| `flows` | Flow **definitions** (JSON documents) |
| `flow_runs` / `flow_run_nodes` | Execution **history** |

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
- Existing rows are **never overwritten** by seed (preserves future user edits).

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
  trigger: "dashboard.summary:email", // optional label for history
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
| `trigger` | Caller label (e.g. `dashboard.summary:calendar`) |
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
| `GET` | `/api/flows` | Flow list for the app UI (`id`, `name`, `description`, `builtin`, `persona`, node graph snapshot, timestamps); seeds built-ins |
| `GET` | `/api/flows/runs` | Run summaries (`?flowName=&limit=&offset=`) |
| `GET` | `/api/flows/runs/:id` | Full run + ordered nodes for the interactive graph UI |

List responses omit heavy node I/O; use the detail route for click-through.
There is no write API yet (user create/edit is future work).

### Toby.app UI

The main window **Flows** surface (`DetailRoute.flows`) lists definitions in the
sidebar, shows a card home for all flows, and opens a read-only detail with
node steps and recent runs. Built-in flows are labeled and cannot be deleted;
custom flow edit/delete is reserved for a later release.

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
| `flows/index.ts` | Public exports |

Tests: `apps/cli/tests/flows.test.ts`, `flows-history.test.ts`.

## Built-in consumers: dashboard card content

Home cards use a **single content path**. The card **definition** owns the
static header; the body is **flow output** only. See [dashboard.md](dashboard.md).

| API | Role |
| --- | --- |
| `GET /api/dashboard/:category/content` | Block content (preferred) |
| `GET /api/dashboard/:category/summary` | Alias of `/content` |

Optional `?fresh=1` bypasses soft caches and **awaits** a new flow run.
Toby.app force-refreshes on toolbar / per-card refresh; soft-loads on home
appear when the daemon is ready.

### Flow map

| Category | Flow name | Tool Executor standard tool | Context bag key for tool result |
| --- | --- | --- | --- |
| Email | `dashboard.email.summary` | `email.unreadSummary` | `unread` |
| Tasks | `dashboard.tasks.summary` | `tasks.openSummary` | `openTasks` |
| Calendar | `dashboard.calendar.summary` | `calendar.upcomingSummary` | `upcoming` |

Shared pipeline shape for all three:

```
Tool Executor (standard tool, limit 50)
        ↓ bag.<key>
LLM Prompter → { markdown: string }
        ↓ bag.summary
```

Persona: Settings → Dashboard (`config.dashboard.persona`) via
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
2. Use serializable nodes only (string prompt templates, schema `{ kind:
   "markdown" }` for now).  
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

## Failure behavior

- Unknown flow id → `ok: false`, error message, empty trace.  
- Missing input / output path → `FlowNodeError`, run stops, prior bag kept.  
- Tool exec failure → node fails with plugin error string.  
- LLM structured output null / timeout / abort → node fails.  
- `nodeTrace` always lists completed and failed nodes with `durationMs`.

## Non-goals (current)

- UI / visual pipeline editor  
- HTTP `POST` create/update or CLI `toby flows`  
- Overwriting existing built-in rows when seed content changes  
- Branching, conditionals, or DAGs  
- Parallel node execution  
- Multi-step tool loops inside LLM Prompter (use chat or
  `delegateToSubAgent` for that)  
- Schema presets beyond `{ kind: "markdown" }`

## Related docs

- [dashboard.md](dashboard.md) — widget load path, caches, plugins, AI flow wiring  
- [dashboard-standard-tools-plan.md](dashboard-standard-tools-plan.md) — standard tool contract  
- [chat-pipeline.md](chat-pipeline.md) — interactive chat turn nodes  
- [plugin-protocol.md](plugin-protocol.md) — `tools list` / `tools execute`  
- [integrations.md](integrations.md) — `IntegrationModule` and discovery  
