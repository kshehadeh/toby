# Agents (named pipelines)

Agents are **named, code-defined pipelines**: an ordered sequence of **nodes**
with explicit **inputs** and **outputs**. They power non-chat workflows that need
a fixed sequence of steps (today: home dashboard AI blurbs).

Agents are **not** the chat turn pipeline. They have no pretreatment, message
compaction, multi-step tool loops, session transcript, or SQLite chat history.

| | Chat pipeline | Agents |
| --- | --- | --- |
| Location | `packages/core/src/chat-pipeline/` | `packages/core/src/agents/` |
| Purpose | Interactive / headless chat turns | Named reusable workflows |
| Graph | Fixed six stages (init → … → persist) | Author-defined node list |
| LLM | Tool-calling multi-step loop | Optional **LLM Prompter** (structured + free-form fallback) |
| Tools | Model chooses tools | **Tool Executor** runs one tool deterministically |
| Docs | [chat-pipeline.md](chat-pipeline.md) | This file |

## Mental model

```
AgentDefinition (registered by name)
  persona binding
  nodes: [ Node₁, Node₂, … Nodeₙ ]

runAgent(name, options)
  → resolve persona
  → context bag = { …initial inputs }
  → for each node:
        resolve inputs from bag / consts
        run node
        write outputs into bag
  → AgentResult { ok, outputs, nodeTrace, … }
```

The **context bag** is a mutable `Record<string, unknown>`. Nodes do not call
each other by name; the definition **wires** ports via `inputs` / `outputs`.

## Concepts

| Concept | Meaning |
| --- | --- |
| **Agent** | Named list of nodes + optional persona binding |
| **Node** | One step: currently `tool_executor` or `llm_prompter` |
| **Context bag** | Intermediate values during a run |
| **Input source** | How a node parameter is filled (`const` or `from` bag key) |
| **Output map** | Which bag keys get which fields of the node result |
| **Persona** | Model + instructions used by every LLM Prompter in that run |

## Persona resolution

For each run, the effective persona is:

1. `personaOverride` on `runAgent` options  
2. `personaName` on the agent definition  
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

Implementation: `packages/core/src/agents/nodes/tool-executor.ts`,
`packages/core/src/agents/tool-resolve.ts`.

### LLM Prompter

Calls the agent persona’s model once with **structured** output (Zod →
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

- `persona` — resolved agent persona  
- `bag` — full context bag  
- `inputs` — resolved inputs for this node  

**Node result:** `{ object: <parsed schema> }`.  
**Default outputs:** `{ object: "object" }`.

For schemas richer than a single `markdown` string field, tries structured
`Output.object` first (short timeout), then free-form. For **`{ markdown:
string }`** (all dashboard agents), skips structured output and generates
free-form markdown directly — many gateway models (e.g. DeepSeek) fail
structured mode and previously burned the shared timeout so free-form was
aborted (`Delay was aborted`). Free-form always gets a **fresh full**
timeout budget and is coerced into the schema (JSON parse or wrap as
`{ markdown }`).

Callers may further sanitize string fields after the run (dashboard uses
`extractDashboardSummaryText`).

Implementation: `packages/core/src/agents/nodes/llm-prompter.ts`.

## Input / output wiring

### Inputs

| Source | Meaning |
| --- | --- |
| `{ const: value }` | Literal parameter value |
| `{ from: "key" }` | Whole value at bag key `key` |
| `{ from: "key", path: "items" }` | Dot-path into that value (`a.b.c`) |

Missing bag keys or paths throw `AgentNodeError` and fail the run.

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

Implementation: `packages/core/src/agents/resolve-inputs.ts`.

## Runtime API

```ts
import {
  registerAgent,
  getAgent,
  listAgents,
  runAgent,
  runAgentDefinition,
  type AgentDefinition,
  type AgentResult,
} from "@toby/core/agents";

const result: AgentResult = await runAgent("dashboard.email.summary", {
  personaOverride, // optional Persona
  inputs: { /* optional seed bag */ },
  abortSignal,
});

if (result.ok) {
  // result.outputs — final context bag
  // result.persona — persona used
  // result.nodeTrace — per-node ok / durationMs / error
} else {
  // result.error, result.failedNodeId, partial result.outputs
}
```

| Function | Role |
| --- | --- |
| `registerAgent(def)` | Register (or replace) by `def.name` |
| `getAgent(name)` | Lookup |
| `listAgents()` | All definitions, name-sorted |
| `runAgent(name, opts?)` | Run from registry |
| `runAgentDefinition(def, opts?)` | Run without requiring registration |
| `clearAgentRegistry()` | Tests only |

Definitions live under `packages/core/src/agents/definitions/` and register at
import time. Public entry: `packages/core/src/agents/index.ts`.

## Package layout

| Path | Role |
| --- | --- |
| `agents/types.ts` | Definition + result types, `AgentNodeError` |
| `agents/registry.ts` | Register / get / list |
| `agents/runner.ts` | Sequential driver |
| `agents/resolve-inputs.ts` | `const` / `from` / path + apply outputs |
| `agents/tool-resolve.ts` | standardTool / named tool resolve + execute |
| `agents/nodes/tool-executor.ts` | Tool Executor node |
| `agents/nodes/llm-prompter.ts` | LLM Prompter node |
| `agents/definitions/*.ts` | Built-in agents (side-effect `registerAgent`) |
| `agents/index.ts` | Public exports + import definitions |

Tests: `apps/cli/tests/agents.test.ts`.

## Built-in consumers: dashboard AI summaries

The home dashboard keeps **two independent paths** per card category:

| Path | API | What it is |
| --- | --- | --- |
| Deterministic | `GET /api/dashboard/:category` | Aggregator → standard tools → badge + item list |
| AI prose | `GET /api/dashboard/:category/summary` | Agent pipeline → markdown blurb |

Full card lifecycle, caching, and plugins: [dashboard.md](dashboard.md).

### Agent map

| Category | Agent name | Tool Executor standard tool | Context bag key for tool result |
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

### How the summarizer invokes agents

`getDashboardCategorySummary` in
`packages/core/src/dashboard/summarizer.ts`:

1. Ensures category has a known prompt and non-empty deterministic data
   (`getDashboardCategory`, limit 50) for **cache keying** and empty-state.  
2. Checks in-memory (5 min) + disk (`~/.toby/dashboard-summaries.json`) caches.  
3. On miss: `runAgent("dashboard.<category>.summary", { personaOverride })`.  
4. Maps `outputs.summary.markdown` → `DashboardCategoryAiSummary.text` (after
   `extractDashboardSummaryText` CoT strip).  
5. Fills `count` / `launchUrls` from the agent tool result when present,
   else from the deterministic category snapshot.

The agent’s Tool Executor **re-fetches** list data for the LLM (single
active/default provider). The card’s badge/list still come from the multi-provider
aggregator on the deterministic API. That split is intentional for v1.

### Definition files

| Agent | File |
| --- | --- |
| Email | `packages/core/src/agents/definitions/dashboard-email-summary.ts` |
| Tasks | `packages/core/src/agents/definitions/dashboard-tasks-summary.ts` |
| Calendar | `packages/core/src/agents/definitions/dashboard-calendar-summary.ts` |
| Shared item helpers | `packages/core/src/agents/definitions/dashboard-shared.ts` |
| Category prompts | `packages/core/src/dashboard/prompts.ts` |

## Adding an agent

1. Create `packages/core/src/agents/definitions/<name>.ts`.  
2. Build an `AgentDefinition` and call `registerAgent(...)`.  
3. Side-effect import it from `packages/core/src/agents/index.ts` (and from any
   module that must load before the first `runAgent`, e.g. the dashboard
   summarizer).  
4. Call `runAgent("<name>")` from the consumer.  
5. Add tests under `apps/cli/tests/` and document here (and in consumer docs if
   user-visible).

### Example skeleton

```ts
import { z } from "zod";
import { registerAgent } from "../registry";
import type { AgentDefinition } from "../types";

export const myAgent: AgentDefinition = {
  name: "example.my-agent",
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

registerAgent(myAgent);
```

## Failure behavior

- Unknown agent name → `ok: false`, error message, empty trace.  
- Missing input / output path → `AgentNodeError`, run stops, prior bag kept.  
- Tool exec failure → node fails with plugin error string.  
- LLM structured output null / timeout / abort → node fails.  
- `nodeTrace` always lists completed and failed nodes with `durationMs`.

## Non-goals (v1)

- UI / visual pipeline editor  
- User-authored agent files on disk  
- Branching, conditionals, or DAGs  
- Parallel node execution  
- HTTP `POST /api/agents/...` or CLI `toby agents`  
- Multi-step tool loops inside LLM Prompter (use chat or
  `delegateToSubAgent` for that)  
- Session transcript / SQLite persistence of agent runs  

## Related docs

- [dashboard.md](dashboard.md) — widget load path, caches, plugins, AI agent wiring  
- [dashboard-standard-tools-plan.md](dashboard-standard-tools-plan.md) — standard tool contract  
- [chat-pipeline.md](chat-pipeline.md) — interactive chat turn nodes  
- [plugin-protocol.md](plugin-protocol.md) — `tools list` / `tools execute`  
- [integrations.md](integrations.md) — `IntegrationModule` and discovery  
