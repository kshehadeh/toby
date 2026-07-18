# Flows (named pipelines)

Flows are **named, code-defined pipelines**: an ordered sequence of **nodes**
with explicit **inputs** and **outputs**. They power non-chat workflows that need
a fixed sequence of steps (today: home dashboard AI blurbs).

Flows are **not** the chat turn pipeline. They have no pretreatment, message
compaction, multi-step tool loops, session transcript, or SQLite chat history.

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
FlowDefinition (registered by name)
  persona binding
  nodes: [ Node₁, Node₂, … Nodeₙ ]

runFlow(name, options)
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
| **Flow** | Named list of nodes + optional persona binding |
| **Node** | One step: currently `tool_executor` or `llm_prompter` |
| **Context bag** | Intermediate values during a run |
| **Input source** | How a node parameter is filled (`const` or `from` bag key) |
| **Output map** | Which bag keys get which fields of the node result |
| **Persona** | Model + instructions used by every LLM Prompter in that run |

## Persona resolution

For each run, the effective persona is:

1. `personaOverride` on `runFlow` options  
2. `personaName` on the flow definition  
3. `resolvePersona()` on the definition (e.g. dashboard settings)  
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

```ts
{
  id: "summarize",
  type: "llm_prompter",
  schema: z.object({ markdown: z.string() }),
  schemaName: "EmailDashboardSummary",
  systemPrompt: (ctx) => "…",
  userPrompt: (ctx) => "…",
  inputs: { data: { from: "unread" } },
  outputs: { summary: "object" },
  temperature: 0.3,       // default 0.3
  maxOutputTokens: 1500,  // default 1500
  timeoutMs: 30_000,      // default 30s
}
```

**Prompt context** (`ctx`):

- `persona` — resolved flow persona  
- `bag` — full context bag  
- `inputs` — resolved inputs for this node  

**Node result:** `{ object: <parsed schema> }`.  
**Default outputs:** `{ object: "object" }`.

For schemas richer than a single `markdown` string field, tries structured
`Output.object` first (short timeout), then free-form. For **`{ markdown:
string }`** (all dashboard flows), skips structured output and generates
free-form markdown directly — many gateway models (e.g. DeepSeek) fail
structured mode and previously burned the shared timeout so free-form was
aborted (`Delay was aborted`). Free-form always gets a **fresh full**
timeout budget and is coerced into the schema (JSON parse or wrap as
`{ markdown }`).

Callers may further sanitize string fields after the run (dashboard uses
`extractDashboardSummaryText`).

Implementation: `packages/core/src/flows/nodes/llm-prompter.ts`.

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

## Runtime API

```ts
import {
  registerFlow,
  getFlow,
  listFlows,
  runFlow,
  runFlowDefinition,
  type FlowDefinition,
  type FlowResult,
} from "@toby/core/flows";

const result: FlowResult = await runFlow("dashboard.email.summary", {
  personaOverride, // optional Persona
  inputs: { /* optional seed bag */ },
  abortSignal,
  trigger: "dashboard.summary:email", // optional label for history
  record: true, // default; set false to skip chat.sqlite writes
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
| `registerFlow(def)` | Register (or replace) by `def.name` |
| `getFlow(name)` | Lookup |
| `listFlows()` | All definitions, name-sorted |
| `runFlow(name, opts?)` | Run from registry (records history by default) |
| `runFlowDefinition(def, opts?)` | Run without requiring registration |
| `clearFlowRegistry()` | Tests only |
| `listFlowRuns` / `getFlowRun` | Read execution history |
| `pruneFlowRuns({ olderThanIso })` | Delete completed runs with `started_at` before a date |

Definitions live under `packages/core/src/flows/definitions/` and register at
import time. Public entry: `packages/core/src/flows/index.ts`.

## Execution history

Every flow run is persisted to **`~/.toby/chat.sqlite`** (tables `flow_runs`,
`flow_run_nodes`) unless `record: false`.

### Run record (`flow_runs`)

| Field | Purpose |
| --- | --- |
| `id` | UUID for detail API / UI |
| `flow_name` | Registered flow name |
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
| `GET` | `/api/flows` | Registered flow definition snapshots |
| `GET` | `/api/flows/runs` | Run summaries (`?flowName=&limit=&offset=`) |
| `GET` | `/api/flows/runs/:id` | Full run + ordered nodes for the interactive graph UI |

List responses omit heavy node I/O; use the detail route for click-through.

## Package layout

| Path | Role |
| --- | --- |
| `flows/types.ts` | Definition + result + history types, `FlowNodeError` |
| `flows/registry.ts` | Register / get / list |
| `flows/runner.ts` | Sequential driver + history instrumentation |
| `flows/store.ts` | SQLite persistence, list/get/prune |
| `flows/definition-snapshot.ts` | Serializable graph for UI |
| `flows/resolve-inputs.ts` | `const` / `from` / path + apply outputs |
| `flows/tool-resolve.ts` | standardTool / named tool resolve + execute |
| `flows/nodes/tool-executor.ts` | Tool Executor node |
| `flows/nodes/llm-prompter.ts` | LLM Prompter node |
| `flows/definitions/*.ts` | Built-in flows (side-effect `registerFlow`) |
| `flows/index.ts` | Public exports + import definitions |

Tests: `apps/cli/tests/flows.test.ts`.

## Built-in consumers: dashboard AI summaries

The home dashboard keeps **two independent paths** per card category:

| Path | API | What it is |
| --- | --- | --- |
| Deterministic | `GET /api/dashboard/:category` | Aggregator → standard tools → badge + item list |
| AI prose | `GET /api/dashboard/:category/summary` | Flow pipeline → markdown blurb |

Full card lifecycle, caching, and plugins: [dashboard.md](dashboard.md).

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

### How the summarizer invokes flows

`getDashboardCategorySummary` in
`packages/core/src/dashboard/summarizer.ts`:

1. Ensures category has a known prompt and non-empty deterministic data
   (`getDashboardCategory`, limit 50) for **cache keying** and empty-state.  
2. Checks in-memory (5 min) + disk (`~/.toby/dashboard-summaries.json`) caches.  
3. On miss: `runFlow("dashboard.<category>.summary", { personaOverride })`.  
4. Maps `outputs.summary.markdown` → `DashboardCategoryAiSummary.text` (after
   `extractDashboardSummaryText` CoT strip).  
5. Fills `count` / `launchUrls` from the flow tool result when present,
   else from the deterministic category snapshot.

The flow’s Tool Executor **re-fetches** list data for the LLM (single
active/default provider). The card’s badge/list still come from the multi-provider
aggregator on the deterministic API. That split is intentional for v1.

### Definition files

| Flow | File |
| --- | --- |
| Email | `packages/core/src/flows/definitions/dashboard-email-summary.ts` |
| Tasks | `packages/core/src/flows/definitions/dashboard-tasks-summary.ts` |
| Calendar | `packages/core/src/flows/definitions/dashboard-calendar-summary.ts` |
| Shared item helpers | `packages/core/src/flows/definitions/dashboard-shared.ts` |
| Category prompts | `packages/core/src/dashboard/prompts.ts` |

## Adding a flow

1. Create `packages/core/src/flows/definitions/<name>.ts`.  
2. Build an `FlowDefinition` and call `registerFlow(...)`.  
3. Side-effect import it from `packages/core/src/flows/index.ts` (and from any
   module that must load before the first `runFlow`, e.g. the dashboard
   summarizer).  
4. Call `runFlow("<name>")` from the consumer.  
5. Add tests under `apps/cli/tests/` and document here (and in consumer docs if
   user-visible).

### Example skeleton

```ts
import { z } from "zod";
import { registerFlow } from "../registry";
import type { FlowDefinition } from "../types";

export const myFlow: FlowDefinition = {
  name: "example.my-flow",
  description: "…",
  // personaName: "Toby",
  // resolvePersona: () => resolveDashboardPersona(),
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
      schema: z.object({ title: z.string(), body: z.string() }),
      systemPrompt: () => "You return structured fields only.",
      userPrompt: (ctx) => JSON.stringify(ctx.bag.data),
      outputs: { draft: "object" },
    },
  ],
};

registerFlow(myFlow);
```

## Failure behavior

- Unknown flow name → `ok: false`, error message, empty trace.  
- Missing input / output path → `FlowNodeError`, run stops, prior bag kept.  
- Tool exec failure → node fails with plugin error string.  
- LLM structured output null / timeout / abort → node fails.  
- `nodeTrace` always lists completed and failed nodes with `durationMs`.

## Non-goals (v1)

- UI / visual pipeline editor  
- User-authored flow files on disk  
- Branching, conditionals, or DAGs  
- Parallel node execution  
- HTTP `POST /api/flows/...` or CLI `toby flows`  
- Multi-step tool loops inside LLM Prompter (use chat or
  `delegateToSubAgent` for that)  
- Session transcript / SQLite persistence of flow runs  

## Related docs

- [dashboard.md](dashboard.md) — widget load path, caches, plugins, AI flow wiring  
- [dashboard-standard-tools-plan.md](dashboard-standard-tools-plan.md) — standard tool contract  
- [chat-pipeline.md](chat-pipeline.md) — interactive chat turn nodes  
- [plugin-protocol.md](plugin-protocol.md) — `tools list` / `tools execute`  
- [integrations.md](integrations.md) — `IntegrationModule` and discovery  
