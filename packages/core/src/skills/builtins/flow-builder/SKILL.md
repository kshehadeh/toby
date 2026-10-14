---
name: flow-builder
description: Build a Toby flow or Home action from a natural-language description. Choose available tools, fixed inputs, an optional LLM step and subsequent actions, and result destinations.
tools: listFlowAuthoringCatalog, inspectFlow, createFlow, updateFlow, inspectFlowFolder, askUser
---

# Build a Toby flow

Turn the user's description into a reusable flow. A request to build or add a
flow authorizes saving its definition, but does not authorize running it or
sending its output. For brainstorming or a request for a plan, present the
design without saving.

## Choose a workable recipe

Call `listFlowAuthoringCatalog` to inspect actual plugin tool names, input
schemas, connection states, existing Script Tools, icons, and colors. Use that
catalog rather than chat tool names or invented integrations. Prefer connected
providers and preserve the user's provider choice. Explain missing connections.

Translate the description into ordered steps and a clear result. Ask only for
missing information needed to build it, such as a required tool argument or an
external recipient. Use reasonable defaults for presentation: default persona,
modal result, and a dashboard runner destination when the user wants a Home
action. An informational dashboard destination is a card, not an action tile.

Current custom-flow constraints:

- A `tool_executor` calls one plugin tool or an existing Script Tool. Inputs may be constants, trigger context references, or earlier output references (`{ "from": "summary", "path": "markdown" }`). References must point to outputs already emitted; never reference later steps.
- The native editor supports one `llm_prompter` followed by actions. It returns either a markdown object or a flat structured object, with no tool-calling loop. For structured decisions use `schema: { "kind": "object", "fields": { "shouldNotify": { "type": "boolean" }, "title": { "type": "string" }, "description": { "type": "string" } } }`. All 1–32 fields are required; supported types are string, boolean, and number. Pass the corresponding output fields to later tool inputs. Gate an action with `when: { "from": "summary", "path": "shouldNotify" }`: true executes, false skips, missing/non-boolean fails. Ungated actions and result destinations run normally.
- Tool outputs map bag keys to result paths, for example
  `outputs: { "events": "result" }`. Use distinct bag keys across steps.
  The LLM can read them with `{{json bag.events}}` or `{{bag.events}}`.
  Its usual output mapping is `outputs: { "summary": "object" }`,
  with flow result `{ "from": "summary", "path": "markdown" }` so the result
  retains markdown formatting.
- `result.from` names an output bag key, not the step ID. Before saving,
  check it against the actual `outputs` mappings (for example `summary`, even
  when the LLM step's ID is `recommendation`). Omit `result` to infer it from
  the final step if no explicit pointer is needed.
- There are no branching, looping, interactive per-run inputs, or automatic
  review steps in a flow. Do not promise those behaviors.

If the requested recipe needs unsupported wiring, explain the specific limit
and offer a simpler flow or chat workflow that preserves the goal. Do not save
a partial substitute as though it implements the original request.

## Script steps

Reuse existing Script Tools by their catalog `userToolId`. If a new script is
needed, draft its source and guide the user to Flows → Script Tools to save it;
chat has no Script Tool creation tool. Then refresh the catalog before saving
a flow that references it. TypeScript exports a default async function taking
an input object and returning text or JSON. AppleScript uses `on run argv`,
with named inputs passed as strings in their declared order; JSON output must
be JSON text. Scripts have a 30-second timeout and run with the user's local
permissions. Do not execute a script to test a design without a request to run it.

## Save and hand off

Call `createFlow` with the complete definition once required details are known.
Use the tool's validation issues to correct the recipe. Stop and ask when the
fix needs a user choice. Do not repeatedly create the same flow after success.
For edits, call `inspectFlow` and use `updateFlow` with the current revision and complete definition.

Report the saved name, ordered steps, result destination, and any setup still
needed. Tell the user where to find it in Flows and, if configured, Home Actions.
Never claim the flow was run: creation validates and saves only. Adding email
or Slack delivery must reflect the user's requested destination and recipients.

## Triggers and Agent Tasks

Flows own their triggers. Do not create a separate schedule or automation.
Use `listFlowAuthoringCatalog` for available trigger types and existing flows.
A new flow defaults to one enabled manual trigger. Each trigger has a stable
unique `id`, `name`, `enabled`, `source`, `conditions`, `policy`, `inputs`,
`eventInputMappings`, and `notifyOnCompletion`.

For timed work use `source: { "type": "schedule", "cron": "0 8 * * 1-5",
"missedRuns": "latest" }` and `conditions: { "timezone": "America/New_York" }`.
`latest` catches up the latest occurrence after downtime; `skip` ignores
occurrences more than a minute late. Choose the user's timezone.
Native sources include `macos.didWake`, `macos.userReturned` with
`minimumIdleSeconds`, and `macos.fileChanges`. Conditions support weekdays
(Sunday = 0), an IANA timezone, and a 24-hour time window. Policy supports
`cooldownSeconds` and `oncePerDay`. Keep a manual trigger for Run Now. Use `home.action` for a Home Screen Action
button; it automatically requires a dashboard runner destination. Selecting a
runner destination also adds this trigger. Home-only flows do not need manual.
Home action and manual inputs are independent; both run only when clicked.
Use `dashboard.refresh` for a Home card that updates with Home. It requires an
informational dashboard destination, whose `refresh` is `asNeeded` or `manual`.
Saving either the card or trigger configures both. Home action and refresh cannot
coexist on one flow. Home controls cache freshness; schedule/native conditions and
cooldowns do not apply to Home refresh. Disabling it pauses card updates.

Enable automatic triggers only when the user requested automatic execution
and the actions/delivery targets are clear. Saving an enabled trigger authorizes
future runs, although saving itself does not execute the flow immediately.
Otherwise save it disabled. Never create duplicates after a successful save.
For folder tools that take a scalar file path, set `source.runPerFile: true`
and bind the tool input to `trigger.event.payload.changes.0.path`. Without this
option the changes are a batch; using only the first item drops other files.
Specify conversion output formats explicitly and inspect supported input formats.

Use one `agent_task` step for a scheduled prompt that needs model-selected tools,
skills, memory, or project context: `userPrompt`, optional `systemPrompt`, and
`outputs: { "summary": "object" }`; result is `summary.markdown`. Set the flow's
`projectId` when needed. Agent Tasks cannot ask interactive questions. A flow
may mix AI steps (`llm_prompter` or `agent_task`) and tool steps in any order;
give every step a unique output key so later steps can read each one. Use
`llm_prompter` for fixed structured output without tool calling.

The event is available as `{{json bag.trigger}}` or a tool reference
`{ "from": "trigger", "path": "event.payload.changes" }`. Trigger input mappings
map input names to event paths (for example `payload.changes`). Step outputs
must not overwrite `trigger`. Do not promise alternate branches, parallel
nodes, nested structured schemas, or interactive per-run inputs.

For file triggers, use `inspectFlowFolder` first. Select folder, recursion,
extensions, exclusions, change kinds, and quiet interval. Narrow a warned
folder or obtain explicit acceptance before setting `allowLargeFolder=true`.
Use zero cooldown unless skipping later batches is intended. Map the whole
changes array to a tool that accepts batches; changes.0.path processes only
one file. Deleted files may have no contents. Exclude generated output folders
to prevent loops.

Toby.app must remain running for native events. Idle is no input, not proof of
absence; wake does not imply unlock. Missed native events and interrupted runs
are not replayed. Trigger activity explains skipped/failed runs and links to
Flow run traces. Completion notifications are optional per trigger.
