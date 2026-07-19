---
sidebar_position: 2
title: Server API
---

# Server API

The **Server API** is the localhost HTTP API served by Toby’s background service (daemon). Toby.app, scheduled jobs, and other local clients use it for chat, sessions, configuration, recordings metadata, projects, memories, and more.

This page is the endpoint reference. For access model, config, and how this differs from Toby.app’s **Native API**, see [Local APIs](./overview).

:::note Native API is separate
Paths under `/api/native/*` are **not** part of this API. They are hosted by Toby.app on the port in `~/.toby/native-port`. See the [Native API reference](./native-api).
:::

## Access model

| Item | Detail |
| ---- | ------ |
| Base URL | `http://127.0.0.1:<port>` (default **7847**) |
| Binding | Localhost only |
| Auth | None (local trust) |
| Encoding | JSON; SSE for chat turns |
| Errors | `{ "error": string }` on non-2xx |
| Unknown `/api/*` | `404` |

```json
{
  "web": {
    "enabled": true,
    "port": 7847
  }
}
```

## Common types

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
  status: string;
  phases: readonly {
    id: string;
    label: string;
    status: string;
  }[];
};
```

Transcript entries and chat stream events are structured JSON objects emitted during a turn (see [Chat turns](#chat-turns)).

## Endpoint index

| Method | Path | Purpose |
| --- | --- | --- |
| `ANY` | `/api/health` | Daemon health and identity handshake |
| `GET` | `/api/status` | Version, persona, model, integrations, skill count |
| `GET` | `/api/dashboard` | Aggregator payload (all categories; internal / debug) |
| `GET` | `/api/dashboard/:section` | Aggregator list for one category (not used by home cards) |
| `GET` | `/api/dashboard/:section/content` | Home card block content (flow output; preferred) |
| `GET` | `/api/dashboard/:section/summary` | Alias of `/content` |
| `GET` | `/api/flows` | Flow list for the app UI (`id`, `name`, `description`, `builtin`, `persona`, nodes, timestamps; built-ins seeded on list) |
| `GET` | `/api/flows/runs` | Flow execution history summaries |
| `GET` | `/api/flows/runs/:id` | One flow run with per-node detail |
| `POST` | `/api/issues` | File or forward a GitHub issue report |
| `GET` | `/api/daemon/status` | Process + inbound chat status |
| `POST` | `/api/daemon/restart` | Restart the daemon |
| `POST` | `/api/daemon/stop` | Stop the daemon |
| `GET` | `/api/listen/status` | Listen manager state |
| `POST` | `/api/listen/start` | Start helper-backed capture |
| `POST` | `/api/listen/stop` | Stop capture (save or discard) |
| `GET` | `/api/listen/recordings` | List saved recordings |
| `GET` | `/api/listen/recordings/:id` | Recording detail + transcript + summary |
| `PATCH` | `/api/listen/recordings/:id` | Update name, description, or linked chat |
| `DELETE` | `/api/listen/recordings/:id` | Delete a recording |
| `POST` | `/api/listen/recordings/:id/transcribe` | Transcribe or retranscribe |
| `POST` | `/api/listen/recordings/:id/summarize` | Summarize or re-summarize a transcript |
| `GET` | `/api/sessions` | List chat sessions |
| `POST` | `/api/sessions` | Create a session |
| `GET` | `/api/sessions/:id` | Session transcript and settings |
| `PATCH` | `/api/sessions/:id` | Rename or update settings |
| `DELETE` | `/api/sessions/:id` | Delete a session |
| `POST` | `/api/sessions/:id/bootstrap` | Assemble-only bootstrap |
| `POST` | `/api/sessions/:id/turn` | Chat turn (SSE stream) |
| `POST` | `/api/sessions/:id/turn/:turnId/cancel` | Cancel an in-flight turn |
| `POST` | `/api/sessions/:id/turn/:turnId/ask-user/:requestId` | Answer `askUser` prompt |
| `GET` | `/api/sessions/:id/plan` | Active plan summary |
| `POST` | `/api/sessions/:id/plan/skip` | Skip a plan phase |
| `POST` | `/api/sessions/:id/plan/cancel` | Cancel the active plan |
| `GET` | `/api/personas` | Persona picker list |
| `GET` | `/api/personas/:name` | Persona detail |
| `GET` | `/api/personas/image/:filename` | Persona image asset |
| `GET` | `/api/ai/providers` | AI provider catalog with live models when configured |
| `GET` | `/api/ai/providers/usage` | Plan usage / balance for all providers |
| `GET` | `/api/ai/providers/:id/usage` | Plan usage / balance for one provider |
| `GET` | `/api/modules` | Connected chat modules |
| `GET` | `/api/skills` | Local skills list |
| `GET` | `/api/skills/:name` | Skill body |
| `GET` | `/api/skills/:name/icon` | Skill icon |
| `GET` | `/api/plugins` | Discovered plugins |
| `GET` | `/api/plugins/:name/icon` | Plugin icon |
| `GET` | `/api/projects` | List projects |
| `POST` | `/api/projects` | Create a project |
| `GET` / `PATCH` / `DELETE` | `/api/projects/:idOrSlug` | Project detail, update, delete |
| `GET` | `/api/projects/:idOrSlug/tree` | Project folder tree |
| `POST` | `/api/projects/:idOrSlug/sessions` | Create a project-scoped session |
| `GET` | `/api/releases/changelog` | Changelog payload |
| `GET` | `/api/memories` | Search / page memories |
| `POST` | `/api/memories` | Create a manual memory |
| `GET` | `/api/memories/:id` | One memory |
| `PATCH` | `/api/memories/:id` | Update a memory |
| `DELETE` | `/api/memories/:id` | Delete a memory |
| `GET` | `/api/memories/:id/explain` | Source / audit explanation |
| `GET` | `/api/configure/tree` | Full configure tree + values |
| `GET` | `/api/configure/sections` | Lightweight settings sections |
| `GET` | `/api/configure/sections/:sectionKey` | One section detail |
| `PATCH` | `/api/configure/values` | Persist configure changes |
| `POST` | `/api/configure/actions/:action` | Named configure actions |
| `POST` | `/api/schedules/parse-cron` | Parse cron / natural language |
| `GET` | `/api/schedules/runs/:id` | Schedule run detail |
| `GET` | `/api/integrations/:name/status` | Integration status |
| `GET` | `/api/integrations/:name/setup-guide` | Setup wizard steps |
| `POST` | `/api/integrations/:name/connect` | Connect |
| `POST` | `/api/integrations/:name/disconnect` | Disconnect |
| `POST` | `/api/integrations/:name/reauthorize` | Reauthorize |
| `POST` | `/api/integrations/:name/setup` | Run plugin setup |
| `GET` | `/icons/*` | Static provider / asset icons |

## Health and status

### `ANY /api/health`

Returns `200` when the daemon HTTP server is reachable. Prefer `GET`.

Includes an **identity** payload so Toby.app can confirm it is talking to the expected binary (version, path, compiled vs source).

```json
{
  "ok": true,
  "daemon": true,
  "identity": {
    "version": "1.2.3",
    "executablePath": "/Applications/Toby.app/Contents/Resources/toby",
    "execKind": "compiled",
    "tobyDir": "/Users/you/.toby",
    "pid": 12345,
    "startedAt": "2026-01-01T00:00:00.000Z",
    "entryScript": null
  }
}
```

| Field | Meaning |
| --- | --- |
| `version` | Toby release version |
| `executablePath` | Absolute path of the binary or entry script |
| `execKind` | `"compiled"` or `"source"` |
| `tobyDir` | Data directory for this process |
| `entryScript` | TS/JS entry path when `execKind` is `"source"`; otherwise `null` |

### `GET /api/status`

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

```ts
type DaemonStatusResponse = {
  process: {
    pid: number;
    uptimeSeconds: number;
    startedAt: string;
    intervalSeconds: number | null;
    logPath: string;
    webPort: number | null;
    executablePath: string;
    execKind: "compiled" | "source";
    version: string;
    tobyDir: string;
    entryScript: string | null;
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

```json
{ "ok": true, "restarting": true }
```

Schedules a detached restart after the response is flushed.

### `POST /api/daemon/stop`

```json
{ "ok": true, "stopping": true }
```

Schedules `SIGTERM` after the response is flushed. The API goes offline when the process exits.

## Dashboard

### `GET /api/dashboard`

Returns aggregator list/count data for all categories. Home cards do not use this; it remains for debug and tooling.

### `GET /api/dashboard/:section`

Returns aggregator detail for one category (`email`, `tasks`, `calendar`). Unknown categories return `404` with `{ "error": "Unknown dashboard category: …" }`.

Optional query: `?fresh=1` bypasses the short category cache.

### `GET /api/dashboard/:section/content`

Returns **block content** for a home card body (flow-generated markdown plus light meta such as `count` and `launchUrls`), or `null` when no providers are connected. Preferred path for Toby.app.

Optional query: `?fresh=1` regenerates content (bypasses caches; used for manual refresh).

### `GET /api/dashboard/:section/summary`

Alias of `/content` (legacy path name).

## Issues

### `POST /api/issues`

Files or opens a GitHub issue report helper.

Request body:

```ts
{
  type: "bug" | "feature";
  details: string; // required
  source?: "tui" | "native-app";
  repo?: string; // optional override
}
```

Success: `{ "ok": true, "url": string, "number": number }`.  
If automatic filing fails: `{ "ok": false, "fallbackUrl": string, "reason": string }`.

## Listen and recordings

These endpoints manage the **daemon-facing** recording lifecycle (list, detail, patch, delete, transcribe). Toby.app often captures audio through its **Native API**, then uses this Server API for transcription and browsing.

Daemon listen start/stop is separate from Toby.app’s in-process native capture state.

### `GET /api/listen/status`

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

### `POST /api/listen/start`

Starts helper-backed capture (default mic + system audio). Returns `ListenManagerState`.

- `409` if already recording
- `500` if capture cannot start

### `POST /api/listen/stop`

Optional JSON body. Empty body saves by default. Use `{ "action": "discard" }` to discard (when supported by the manager path).

- `400` invalid JSON
- `409` no active recording
- `500` finalization failure

### `GET /api/listen/recordings`

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

Newest first.

### `GET /api/listen/recordings/:id`

Full metadata, playable `audioPath` (prefers `combined.m4a`, then mic WAV, then system WAV), transcript text, optional segments/warnings.

- `404` if not found

### `PATCH /api/listen/recordings/:id`

```ts
type PatchRecordingRequest = {
  name?: string;
  description?: string;
  chatSessionId?: string | null;
};
```

At least one of `name`, `description`, or `chatSessionId` is required. Returns the same detail shape as `GET`.

- `400` invalid body
- `404` not found

### `DELETE /api/listen/recordings/:id`

```json
{ "ok": true }
```

- `404` / `500` on failure

### `POST /api/listen/recordings/:id/transcribe`

Runs transcription against the recording’s audio and updates artifacts.

Optional body:

```json
{ "recordingsDir": "/path/to/recordings" }
```

Clients that send `Accept: text/event-stream` may receive a streaming transcription progress response; otherwise JSON is returned.

- `400` no readable audio
- `404` not found
- `500` transcription failure

## Sessions

### `GET /api/sessions`

| Query | Default | Max | Description |
| --- | ---: | ---: | --- |
| `limit` | `50` | `500` | Max sessions to return |

```ts
type SessionsListResponse = {
  sessions: SessionSummary[];
};
```

### `POST /api/sessions`

Empty body is allowed.

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

- Default name: `"New chat"`
- `bootstrap: true` runs assemble-only bootstrap (no model call)

Response `201`:

```ts
type CreateSessionResponse = {
  id: string;
  name: string;
  settings: ChatSessionSettings;
};
```

### `GET /api/sessions/:id`

```ts
type SessionDetailResponse = {
  id: string;
  name: string;
  transcript: readonly unknown[];
  messageCount: number;
  settings: ChatSessionSettings;
  activePlan: PlanSummary | null;
};
```

- `404` if missing

### `PATCH /api/sessions/:id`

```ts
type PatchSessionRequest = Partial<{
  name: string;
  persona: string;
  modules: readonly string[];
  dryRun: boolean;
  debug: boolean;
}>;
```

Blank `name` is ignored; settings merge with existing values.

### `DELETE /api/sessions/:id`

```json
{ "ok": true }
```

### `POST /api/sessions/:id/bootstrap`

```ts
type BootstrapSessionRequest = {
  initialText?: string;
};

type BootstrapSessionResponse = {
  messageCount: number;
};
```

## Chat turns

### `POST /api/sessions/:id/turn`

Submits a user turn and streams events as **server-sent events**.

`Content-Type` of the response: `text/event-stream; charset=utf-8`.

```ts
type TurnRequestBody = {
  text: string; // required (non-blank after trim)
  persona?: string;
  modules?: readonly string[];
  dryRun?: boolean;
  clientTurnId?: string;
  steering?: boolean;
  generatePlan?: boolean;
};
```

- `persona` / `modules` / `dryRun` override session settings for this turn
- `clientTurnId` is optional correlation / idempotency
- `steering: true` may cancel an active turn before submitting
- `generatePlan` may be present on the shared type; behavior depends on the current handler

**SSE format**

- Heartbeats: comment lines `: keep-alive`
- Default messages: `data: <ChatEvent JSON>`
- Named terminal events: `event: done`, `event: error`, `event: ask_user_prompt`

`done` payload:

```ts
type TurnDonePayload = {
  turnId: string;
  text: string;
  appliedActions: readonly string[];
  sessionName?: string;
  usage?: unknown;
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

Errors **before** the stream starts: `400` (bad JSON / blank text), `404` (session). Failures **after** streaming starts use `event: error`.

Example:

```bash
curl -N -X POST "http://127.0.0.1:7847/api/sessions/<id>/turn" \
  -H "Content-Type: application/json" \
  -d '{"text":"Summarize my calendar for today"}'
```

### `POST /api/sessions/:id/turn/:turnId/cancel`

```ts
type CancelTurnResponse = {
  ok: true;
  cancelled: true;
};
```

- `404` if turn not found, already done, or session missing

### `POST /api/sessions/:id/turn/:turnId/ask-user/:requestId`

```ts
type AskUserAnswerRequest = {
  selectedIndex: number;
  selectedLabel: string;
  rawInput?: string;
};
```

Missing fields normalize to `selectedIndex: -1`, empty labels/input.

```json
{ "ok": true }
```

## Plans

### `GET /api/sessions/:id/plan`

```ts
type SessionPlanResponse = {
  plan: PlanSummary | null;
};
```

### `POST /api/sessions/:id/plan/skip`

```json
{ "planId": "…", "phaseId": "…" }
```

### `POST /api/sessions/:id/plan/cancel`

```json
{ "planId": "…" }
```

## Metadata

### `GET /api/personas`

```ts
type PersonasResponse = {
  personas: readonly { name: string; label: string }[];
};
```

### `GET /api/personas/:name`

Persona detail for the named persona (`404` if missing).

### `GET /api/personas/image/:filename`

Serves a persona image asset. Use `default.png` for the default image.

### `GET /api/ai/providers`

AI provider catalog used by settings and persona editor model pickers.

When a provider is **configured** (API key / credentials present — or Ollama base URL), Toby queries that provider’s models API and returns that list as-is. When unconfigured or the remote list fails, the response falls back to built-in curated model ids. User `customModels` from config are appended only when not already present.

```ts
type AIProvidersResponse = {
  providers: readonly {
    id: string;
    displayName: string;
    models: string[];
    allowCustomModel: boolean;
    configured: boolean;
  }[];
};
```

### `GET /api/ai/providers/usage`

Plan usage and balance for all registered AI providers. Providers that do not expose balance APIs return `supported: false` with `"N/A"` display labels. Results are cached for 60 seconds.

```ts
type AIProvidersUsageResponse = {
  usage: readonly {
    providerId: string;
    supported: boolean;
    currency?: "USD";
    totalSpent?: number;
    remaining?: number;
    totalSpentLabel?: string;
    remainingLabel?: string;
    unavailableReason?: string;
    fetchedAt: string;
  }[];
};
```

### `GET /api/ai/providers/:id/usage`

Plan usage and balance for a single AI provider. Bypasses the cache, so it is suitable for a manual refresh action.

```ts
type AIProviderUsageResponse = {
  usage: {
    providerId: string;
    supported: boolean;
    currency?: "USD";
    totalSpent?: number;
    remaining?: number;
    totalSpentLabel?: string;
    remainingLabel?: string;
    unavailableReason?: string;
    fetchedAt: string;
  };
};
```

### `GET /api/modules`

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

```ts
type SkillsResponse = {
  skills: readonly {
    name: string;
    description: string;
  }[];
};
```

### `GET /api/skills/:name` / `GET /api/skills/:name/icon`

Skill body and optional icon asset.

### `GET /api/plugins` / `GET /api/plugins/:name/icon`

Discovered installable plugins and icons.

### `GET /api/releases/changelog`

Changelog / release notes payload. Optional `limit` query (default/max typically 10).

## Projects

### `GET /api/projects`

```ts
{ projects: ProjectPayload[] }
```

### `POST /api/projects`

```ts
type CreateProjectRequest = {
  name?: string;
  summary?: string;
  folderPath?: string;
  personaName?: string | null;
};
```

Response `201`: `{ project: ProjectPayload }`.

### `GET /api/projects/:idOrSlug`

```ts
{
  project: ProjectPayload;
  sessions: SessionSummary[]; // project-scoped sessions
}
```

`ProjectPayload` includes `id`, `slug`, `name`, `summary`, `folderPath`, `personaName`, `outputsDir`, `skillsDir`, timestamps.

### `PATCH /api/projects/:idOrSlug`

Partial update of `name`, `summary`, `folderPath`, `personaName`.

### `DELETE /api/projects/:idOrSlug`

```json
{ "ok": true }
```

### `GET /api/projects/:idOrSlug/tree`

```json
{ "tree": /* folder tree nodes */ }
```

### `POST /api/projects/:idOrSlug/sessions`

Creates a chat session bound to the project.

```ts
type CreateProjectSessionRequest = {
  name?: string;
  persona?: string;
  modules?: readonly string[];
  dryRun?: boolean;
  debug?: boolean;
};
```

Response `201`: `{ session: … }`.

## Memories

### `GET /api/memories`

| Query | Default | Description |
| --- | ---: | --- |
| `q` | — | Search query |
| `limit` | `50` (max 500) | Page size |
| `offset` | `0` | Skip count |

```ts
type MemoriesResponse = {
  memories: MemoryItem[];
  limit: number;
  offset: number;
  total: number;
  hasMore: boolean;
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

### `POST /api/memories`

Create a manual memory. Body must include non-empty `value`. Optional: `type`, `subject`, `confidence`, `sensitivity`, `visibility`, `expiresAt`.

Response `201`: `{ memory: MemoryItem }`.

### `GET /api/memories/:id`

```ts
{ memory: MemoryItem }
```

### `PATCH /api/memories/:id`

Updatable fields: `value`, `subject`, `type`, `sensitivity`, `visibility`, `confidence`, `expiresAt`. At least one required.

### `DELETE /api/memories/:id`

```json
{ "ok": true }
```

### `GET /api/memories/:id/explain`

```ts
type MemoryExplainResponse = {
  explanation: {
    item: MemoryItem;
    sources: Array<{ id: string; system: string; label?: string }>;
    auditTrail: Array<{ action: string; at: string; reason?: string }>;
  };
};
```

## Configure

### `GET /api/configure/tree`

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

Secrets are redacted (placeholder `••••••`).

### `GET /api/configure/sections`

Lightweight section nodes for settings navigation (for example `chatInbound`, `defaults`, `ai`, `projects`).

### `GET /api/configure/sections/:sectionKey`

Full section detail for a top-level or nested key (for example `ai.openai`).

### `PATCH /api/configure/values`

```ts
type ConfigurePatchRequest = {
  changes: Record<string, string>;
};
```

Response matches `GET /api/configure/tree`.

- `400` if `changes` missing
- `403` if the patch cannot be applied

### `POST /api/configure/actions/:action`

Body: `Record<string, string>`.

| Action | Request fields | Response |
| --- | --- | --- |
| `create-persona` | — | `{ "ok": true, "personaName": string }` |
| `delete-persona` | `personaName` | `{ "ok": true }` |
| `set-default-persona` | `personaName` | `{ "ok": true }` |
| `clear-default-persona` | — | `{ "ok": true }` |
| `update-skill-field` | `dirName`, `field`, `value` | `{ "ok": true }` |
| `delete-skill` | `dirName` | `{ "ok": true }` |
| `create-schedule` | — | `{ "ok": true, "scheduleId": string }` |
| `update-schedule-field` | `scheduleId`, `field`, `value` | `{ "ok": true }` |
| `delete-schedule` | `scheduleId` | `{ "ok": true }` |

- `update-skill-field.field`: `name` or `description`
- `update-schedule-field.field`: `enabled` (`"Yes"` / `"true"`), `name`, `prompt`, `persona`, `cron`

## Schedules

### `POST /api/schedules/parse-cron`

Parses natural-language or cron expressions for the schedules UI.

### `GET /api/schedules/runs/:id`

Returns schedule run detail / transcript for a completed or in-progress run.

## Integrations

### `GET /api/integrations/:name/status`

Connection state, health, tools list, setup flags, auth methods.

### `GET /api/integrations/:name/setup-guide`

Onboarding wizard steps for the integration.

### `POST /api/integrations/:name/connect`

### `POST /api/integrations/:name/disconnect`

### `POST /api/integrations/:name/reauthorize`

### `POST /api/integrations/:name/setup`

Connect / disconnect / reauthorize / run plugin setup. Success typically `{ "ok": true }`; failures return error JSON with appropriate status codes.

## Icons

### `GET /icons/*`

Static AI provider and related icon assets (not under `/api/`, but served by the same local server).

## See also

- [Local APIs](./overview) — Server API vs Native API
- [Native API](./native-api) — Toby.app TCC-gated endpoints
- [Architecture](../architecture/overview) — how Toby.app and the daemon fit together
- [Toby.app](../toby-app) — product UI surfaces
- Contributor reference on GitHub: [server-api.md](https://github.com/kshehadeh/toby/blob/main/docs/server-api.md)
