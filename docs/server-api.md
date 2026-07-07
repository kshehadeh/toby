# Toby Server API

The Toby daemon serves a localhost HTTP API for the SwiftUI app and the shared daemon client used by CLI chat flows. The router lives in [`packages/core/src/web/routes.ts`](../packages/core/src/web/routes.ts). Shared chat request and response types live in [`packages/core/src/api/chat-api.ts`](../packages/core/src/api/chat-api.ts), and the typed daemon client lives in [`packages/core/src/web/client.ts`](../packages/core/src/web/client.ts).

## Access Model

- Base URL: `http://127.0.0.1:<port>`, default `http://127.0.0.1:7847`.
- Binding: localhost only.
- Auth: none. This API assumes local trust and should not be exposed to other machines.
- Encoding: JSON for normal requests and responses; server-sent events (SSE) for chat turns.
- Error shape: non-2xx JSON responses use `{ "error": string }`.
- Unknown `/api/*` routes return `404`.

Configure the port or disable the server in `~/.toby/config.json`:

```json
{
  "web": {
    "enabled": true,
    "port": 7847
  }
}
```

## Common Types

```ts
type ChatSessionSettings = {
  persona?: string;
  modules?: readonly string[];
  dryRun?: boolean;
  debug?: boolean;
};

type SessionSummary = {
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
};

type PlanSummary = {
  id: string;
  goal: string;
  status: Plan["status"];
  phases: readonly {
    id: string;
    label: string;
    status: PlanPhaseStatus;
  }[];
};
```

`TranscriptEntry` and `ChatEvent` are exported from [`packages/core/src/chat-pipeline/transcript-types.ts`](../packages/core/src/chat-pipeline/transcript-types.ts) and [`packages/core/src/chat-pipeline/chat-events.ts`](../packages/core/src/chat-pipeline/chat-events.ts).

## Endpoint Index

| Method | Path | Purpose |
| --- | --- | --- |
| `ANY` | `/api/health` | Basic daemon health check. |
| `GET` | `/api/status` | Chat status: version, default persona, model, integrations, skills. |
| `GET` | `/api/daemon/status` | Daemon process and inbound chat status. |
| `POST` | `/api/daemon/restart` | Restart the background daemon. |
| `POST` | `/api/daemon/stop` | Stop the current daemon process. |
| `GET` | `/api/listen/status` | Get shared Listen manager state. |
| `POST` | `/api/listen/start` | Start helper-backed audio capture. |
| `POST` | `/api/listen/stop` | Stop and save or discard helper-backed capture. |
| `GET` | `/api/listen/recordings` | List saved recording summaries. |
| `GET` | `/api/listen/recordings/:id` | Fetch recording metadata, audio path, and transcript. |
| `DELETE` | `/api/listen/recordings/:id` | Delete a saved recording and its artifacts. |
| `POST` | `/api/listen/recordings/:id/transcribe` | Transcribe or retranscribe a saved recording. |
| `GET` | `/api/sessions` | List chat sessions. |
| `POST` | `/api/sessions` | Create a chat session. |
| `GET` | `/api/sessions/:id` | Fetch transcript, settings, and active plan for a session. |
| `PATCH` | `/api/sessions/:id` | Rename a session or update persisted session settings. |
| `DELETE` | `/api/sessions/:id` | Delete a session. |
| `POST` | `/api/sessions/:id/bootstrap` | Seed a session with assemble-only bootstrap messages. |
| `POST` | `/api/sessions/:id/turn` | Submit a chat turn and stream events over SSE. |
| `POST` | `/api/sessions/:id/turn/:turnId/cancel` | Cancel an in-flight turn. |
| `POST` | `/api/sessions/:id/turn/:turnId/ask-user/:requestId` | Answer an interactive `askUser` prompt. |
| `GET` | `/api/sessions/:id/plan` | Fetch the active plan summary for a session. |
| `POST` | `/api/sessions/:id/plan/skip` | Mark a plan phase as skipped. |
| `POST` | `/api/sessions/:id/plan/cancel` | Cancel the active plan. |
| `GET` | `/api/personas` | List persona picker options. |
| `GET` | `/api/modules` | List connected chat modules/integrations. |
| `GET` | `/api/skills` | List local skills. |
| `GET` | `/api/memories` | Search or page through stored memories. |
| `GET` | `/api/memories/:id` | Fetch one memory item. |
| `GET` | `/api/memories/:id/explain` | Fetch source/audit explanation for one memory. |
| `GET` | `/api/configure/tree` | Fetch configure UI schema and current values. |
| `GET` | `/api/configure/sections` | Fetch lightweight section structure for the native settings sidebar. |
| `GET` | `/api/configure/sections/:sectionKey` | Fetch full detail (fields + values) for one settings section. |
| `PATCH` | `/api/configure/values` | Persist configure value changes. |
| `POST` | `/api/configure/actions/:action` | Run configure actions such as create/delete persona, skill, or schedule. |

## Health And Status

### `ANY /api/health`

Returns `200` when the daemon HTTP server is reachable. Use `GET` from clients; the current router does not restrict this health route by method.

```json
{ "ok": true, "daemon": true }
```

### `GET /api/status`

Returns chat runtime metadata.

```ts
type ChatStatusResponse = {
  version: string;
  persona: string;
  model: string;
  connectedIntegrations: readonly string[];
  skillCount: number;
};
```

### `GET /api/daemon/status`

Returns process details plus inbound chat connection state.

```ts
type DaemonStatusResponse = {
  process: {
    pid: number;
    uptimeSeconds: number;
    startedAt: string;
    intervalSeconds: number | null;
    logPath: string;
    webPort: number | null;
  };
  chatInbound: {
    enabled: boolean;
    integration: string | null;
    integrationLabel: string | null;
    status: "disabled" | "idle" | "connecting" | "connected" | "error";
    detail: string | null;
    disabledReason: string | null;
    updatedAt: string;
  };
};
```

### `POST /api/daemon/restart`

Schedules a detached daemon restart after the response is flushed.

```json
{ "ok": true, "restarting": true }
```

### `POST /api/daemon/stop`

Schedules `SIGTERM` for the current daemon process after the response is flushed. The API will go offline once the process exits.

```json
{ "ok": true, "stopping": true }
```

## Listen And Recordings

These endpoints own the daemon-facing recording lifecycle. The native
Recordings window uses the list, detail, and delete endpoints; Toby.app also
uses the transcribe endpoint after capture. Toby.app's **capture** control uses
its separate native API because AVFoundation and ScreenCaptureKit permissions
belong to the app bundle, then returns to this daemon API for transcription and
browsing.

The native app also uses the recordings list endpoint during its shared
post-bootstrap preload so dashboard counts, global sidebars, and the command
palette have recording summaries before the Recordings view is opened.

### `GET /api/listen/status`

Returns the state of the shared helper-backed `ListenManager`:

```ts
type ListenManagerState = {
  status: "idle" | "starting" | "recording" | "stopping" | "error";
  session?: {
    id: string;
    startedAt: string;
    sources: { mic: boolean; system: boolean };
  };
  outputDir?: string;
  message?: string;
  error?: string;
};
```

This state is independent of Toby.app's in-process native capture state.

### `POST /api/listen/start`

Starts the shared macOS audio helper with the default microphone and system
audio sources. Returns `ListenManagerState`.

Errors:

- `409` when a helper-backed recording is already active.
- `500` when capture cannot start.

### `POST /api/listen/stop`

Stops the active helper-backed recording. The JSON body is optional; an empty
body or object saves by default. Use `{ "action": "discard" }` to discard.

On save, the manager finalizes metadata, transcribes combined audio when
available, and returns the output directory plus transcript or transcription
error.

Errors:

- `400` for invalid JSON.
- `409` when no helper-backed recording is active.
- `500` when finalization fails.

### `GET /api/listen/recordings`

Lists saved recording summaries, newest first:

```ts
type ListenRecordingsListResponse = {
  recordings: Array<{
    id: string;
    dir: string;
    name?: string;
    description?: string;
    createdAt: string;
    startedAt: string;
    stoppedAt?: string;
    durationMs?: number;
    sources: { mic: boolean; system: boolean };
    hasAudio: boolean;
    hasTranscript: boolean;
  }>;
};
```

### `GET /api/listen/recordings/:id`

Returns full metadata, the resolved playable `audioPath`, transcript text, and
optional structured-segment warnings. Audio resolution prefers
`combined.m4a`, then microphone WAV, then system WAV.

Errors:

- `404` when the recording does not exist.

### `DELETE /api/listen/recordings/:id`

Recursively removes the recording directory selected by its metadata id.

```json
{ "ok": true }
```

Errors:

- `404` when the recording does not exist.
- `500` when removal fails.

### `POST /api/listen/recordings/:id/transcribe`

Invokes the configured transcription plugin against the resolved audio file,
copies transcript artifacts into the recording directory, updates
`metadata.json`, and returns refreshed metadata and transcript detail.

Body (optional):

```json
{ "recordingsDir": "/path/to/recordings" }
```

Pass `recordingsDir` when the recording lives outside the default
`~/.toby/listen/recordings` directory. The endpoint uses this directory as the
search root for `:id`.

Errors:

- `400` when no readable combined, microphone, or system audio exists.
- `404` when the recording does not exist.
- `500` when plugin transcription fails. The error is also appended to the
  recording metadata.

## Sessions

### `GET /api/sessions`

Query parameters:

| Name | Default | Max | Description |
| --- | ---: | ---: | --- |
| `limit` | `50` | `500` | Maximum number of sessions to return. Invalid or values less than `1` fall back to the default. |

Response:

```ts
type SessionsListResponse = {
  sessions: SessionSummary[];
};
```

### `POST /api/sessions`

Creates a SQLite-backed chat session. Empty or missing body is accepted.

Request:

```ts
type CreateSessionRequest = {
  name?: string;
  persona?: string;
  modules?: readonly string[];
  dryRun?: boolean;
  debug?: boolean;
  bootstrap?: boolean;
};
```

- `name` defaults to `"New chat"` when omitted or blank.
- `persona`, `modules`, `dryRun`, and `debug` become persisted session settings.
- `bootstrap: true` runs the assemble-only bootstrap pipeline and avoids a model call.

Response status: `201`.

```ts
type CreateSessionResponse = {
  id: string;
  name: string;
  settings: ChatSessionSettings;
};
```

### `GET /api/sessions/:id`

Returns a session transcript and persisted settings.

```ts
type SessionDetailResponse = {
  id: string;
  name: string;
  transcript: readonly TranscriptEntry[];
  messageCount: number;
  settings: ChatSessionSettings;
  activePlan: PlanSummary | null;
};
```

Errors:

- `404` when the session does not exist.

### `PATCH /api/sessions/:id`

Renames a session and/or updates persisted session settings.

Request:

```ts
type PatchSessionRequest = Partial<{
  name: string;
  persona: string;
  modules: readonly string[];
  dryRun: boolean;
  debug: boolean;
}>;
```

- Blank `name` values are ignored.
- Settings are merged with existing session settings.

Response:

```ts
type PatchSessionResponse = {
  id: string;
  name: string;
  settings: ChatSessionSettings;
};
```

Errors:

- `400` for invalid JSON.
- `404` when the session does not exist.

### `DELETE /api/sessions/:id`

Deletes a session.

```json
{ "ok": true }
```

Errors:

- `404` when the session does not exist.

### `POST /api/sessions/:id/bootstrap`

Runs the session bootstrap path with the session's persisted `persona`, `modules`, and `dryRun` settings.

Request:

```ts
type BootstrapSessionRequest = {
  initialText?: string;
};
```

Response:

```ts
type BootstrapSessionResponse = {
  messageCount: number;
};
```

Errors:

- `404` when the session does not exist.
- `500` when bootstrap fails.

## Chat Turns

### `POST /api/sessions/:id/turn`

Submits a user turn and streams `ChatEvent` payloads as server-sent events. The response content type is `text/event-stream; charset=utf-8`.

Request:

```ts
type TurnRequestBody = {
  text: string;
  persona?: string;
  modules?: readonly string[];
  dryRun?: boolean;
  clientTurnId?: string;
  steering?: boolean;
  generatePlan?: boolean;
};
```

- `text` is required after trimming.
- `persona`, `modules`, and `dryRun` override the session settings for this turn.
- `clientTurnId` is an optional idempotency/correlation value.
- `steering: true` allows a new turn to cancel an active turn before submitting.
- `generatePlan` is part of the shared type but is not currently forwarded by the HTTP handler.

SSE stream format:

- Heartbeats are comments: `: keep-alive`.
- Default `data:` messages are serialized `ChatEvent` objects.
- Named terminal events use `event: done`, `event: error`, or `event: ask_user_prompt`.

`done` payload:

```ts
type TurnDonePayload = {
  turnId: string;
  text: string;
  appliedActions: readonly string[];
  sessionName?: string;
  usage?: LanguageModelUsage;
  warnings?: readonly string[];
};
```

`error` payload:

```ts
type TurnErrorPayload = {
  turnId?: string;
  error: string;
};
```

`ask_user_prompt` payload:

```ts
type AskUserPromptPayload = {
  turnId: string;
  requestId: string;
  query: string;
  options: readonly string[];
};
```

Errors before streaming begins:

- `400` for invalid JSON.
- `400` for missing or blank `text`.
- `404` when the session does not exist.

Runtime failures after streaming begins are emitted as `event: error` instead of changing the HTTP status.

### `POST /api/sessions/:id/turn/:turnId/cancel`

Cancels an in-flight turn by `turnId`.

Response:

```ts
type CancelTurnResponse = {
  ok: true;
  cancelled: true;
};
```

Errors:

- `404` when the turn is not found, already completed, or the session does not exist.

### `POST /api/sessions/:id/turn/:turnId/ask-user/:requestId`

Answers an interactive `askUser` prompt emitted during an SSE turn.

Request:

```ts
type AskUserAnswerRequest = {
  selectedIndex: number;
  selectedLabel: string;
  rawInput?: string;
};
```

Missing fields are normalized server-side to `selectedIndex: -1`, `selectedLabel: ""`, and `rawInput: ""`.

Response:

```json
{ "ok": true }
```

Errors:

- `400` for invalid JSON.
- `404` when the prompt is no longer pending or cannot be found.

## Plans

### `GET /api/sessions/:id/plan`

Returns the active plan summary for a session.

```ts
type SessionPlanResponse = {
  plan: PlanSummary | null;
};
```

Errors:

- `404` when the session does not exist.

### `POST /api/sessions/:id/plan/skip`

Marks one active plan phase as skipped.

Request:

```ts
type PlanSkipRequest = {
  planId: string;
  phaseId: string;
};
```

Response:

```json
{ "ok": true }
```

Errors:

- `400` when `planId` or `phaseId` is missing.
- `404` when the session does not exist or the active plan does not match `planId`.

### `POST /api/sessions/:id/plan/cancel`

Cancels the active plan.

Request:

```ts
type PlanCancelRequest = {
  planId: string;
};
```

Response:

```json
{ "ok": true }
```

Errors:

- `400` when `planId` is missing.
- `404` when the session does not exist or the active plan does not match `planId`.

## Metadata

### `GET /api/personas`

Returns persona picker options.

```ts
type PersonasResponse = {
  personas: readonly {
    name: string;
    label: string;
  }[];
};
```

### `GET /api/modules`

Returns connected chat-capable modules.

```ts
type ModulesResponse = {
  modules: readonly {
    name: string;
    displayName: string;
    connected: true;
  }[];
};
```

### `GET /api/skills`

Returns local skills.

Toby.app uses this list during shared post-bootstrap preload for dashboard
counts, the Skills sidebar, and command-palette search. Individual skill bodies
are fetched separately when a skill is selected.

```ts
type SkillsResponse = {
  skills: readonly {
    name: string;
    description: string;
  }[];
};
```

## Memories

The native app uses the memories list endpoint during shared post-bootstrap
preload for dashboard counts, global sidebars, and command-palette search.
Memory detail and explanation endpoints remain lazy and are fetched when a
specific memory is selected.

### `GET /api/memories`

Query parameters:

| Name | Default | Max | Description |
| --- | ---: | ---: | --- |
| `q` | none | n/a | Optional memory search query. |
| `limit` | `50` | `500` | Maximum number of memories to return. Invalid or values less than `1` fall back to the default. |
| `offset` | `0` | n/a | Number of memories to skip. Negative or invalid values become `0`. |

Response:

```ts
type MemoriesResponse = {
  memories: MemoryItem[];
  limit: number;
  offset: number;
};

type MemoryItem = {
  id: string;
  type: string;
  subject?: string;
  value: string;
  confidence: number;
  sensitivity: string;
  visibility: string;
  createdAt: string;
  updatedAt: string;
};
```

### `GET /api/memories/:id`

Returns one memory item.

```ts
type MemoryDetailResponse = {
  memory: MemoryItem;
};
```

Errors:

- `404` when the memory does not exist.

### `GET /api/memories/:id/explain`

Returns source and audit details for one memory.

```ts
type MemoryExplainResponse = {
  explanation: {
    item: MemoryItem;
    sources: Array<{ id: string; system: string; label?: string }>;
    auditTrail: Array<{ action: string; at: string; reason?: string }>;
  };
};
```

Errors:

- `404` when the memory does not exist.

## Configure

### `GET /api/configure/tree`

Returns the configure UI tree, redacted current values, and integration display labels.
Toby.app uses this endpoint for schedule summaries and integration sections in
the shared post-bootstrap preload; section/detail payloads remain lazy where a
more focused endpoint exists.

```ts
type ConfigureTreeResponse = {
  tree: SettingsItem;
  values: Record<string, string>;
  integrationLabels: Record<string, string>;
};

type SettingsItem = {
  label: string;
  kind: string;
  key: string;
  navKey?: string;
  children?: SettingsItem[];
  masked?: boolean;
  multiline?: boolean;
  options?: string[];
  selectChoices?: { value: string; label: string }[];
  currentValue?: string;
  readOnly?: boolean;
};
```

Secret values are redacted before being sent to clients. A saved secret appears as the placeholder `••••••`.

### `GET /api/configure/sections`

Returns lightweight section structure for the native settings sidebar. Only `kind: "section"` nodes are included (no field details or values). Limited to the four settings sections: `chatInbound`, `defaults`, `ai`, `projects`.

```ts
type ConfigureSectionsResponse = {
  sections: SettingsItem[]; // only section-type nodes, recursively stripped
};
```

### `GET /api/configure/sections/:sectionKey`

Returns the full section detail (all fields, values, options) for a specific section or sub-section. The `sectionKey` can be a top-level key (`chatInbound`, `defaults`, `ai`, `projects`) or a nested key (`ai.openai`, `projects.my-project`).

```ts
type ConfigureSectionDetailResponse = {
  section: SettingsItem;
  values: Record<string, string>;
  integrationLabels: Record<string, string>;
};
```

Errors:

- `404` when the section key is not found.

### `PATCH /api/configure/values`

Persists configure value changes and returns a refreshed configure tree.

Request:

```ts
type ConfigurePatchRequest = {
  changes: Record<string, string>;
};
```

Response: same shape as `GET /api/configure/tree`.

Errors:

- `400` when `changes` is missing or is not an object.
- `403` when the patch cannot be applied.

### `POST /api/configure/actions/:action`

Runs a named configure action. The request body is `Record<string, string>`.

Supported actions:

| Action | Request fields | Response |
| --- | --- | --- |
| `create-persona` | none | `{ "ok": true, "personaName": string }` |
| `delete-persona` | `personaName` | `{ "ok": true }` |
| `set-default-persona` | `personaName` | `{ "ok": true }` |
| `clear-default-persona` | none | `{ "ok": true }` |
| `update-skill-field` | `dirName`, `field`, `value` | `{ "ok": true }` |
| `delete-skill` | `dirName` | `{ "ok": true }` |
| `create-schedule` | none | `{ "ok": true, "scheduleId": string }` |
| `update-schedule-field` | `scheduleId`, `field`, `value` | `{ "ok": true }` |
| `delete-schedule` | `scheduleId` | `{ "ok": true }` |

`update-skill-field.field` must be one of `name` or `description`.

`update-schedule-field.field` must be one of:

- `enabled`: truthy when `value` is `"Yes"` or `"true"`.
- `name`
- `prompt`
- `persona`
- `cron`

Errors:

- `400` for missing or invalid fields.
- `404` for unknown actions.
