# Chat API parity matrix

Maps Ink TUI capabilities to the unified daemon API contract. Surfaces: **TUI** (Ink), **Web** (React SPA), **Native** (SwiftUI).

| Feature | TUI today | Contract | Owner |
| -------- | --------- | -------- | ----- |
| Chat turn (model + tools) | Direct `runChatTurnPipeline` | `POST /api/sessions/:id/turn` (SSE `ChatEvent` + `done`) | Daemon |
| Session create | `createChatSession` | `POST /api/sessions` | Daemon |
| Session list / resume | `/sessions`, SQLite load | `GET /api/sessions`, `GET /api/sessions/:id` | Daemon |
| Session rename | auto + manual | `PATCH /api/sessions/:id`, `done.sessionName` | Daemon |
| Session delete | — | `DELETE /api/sessions/:id` | Daemon |
| Persona selection | `/persona`, Shift+Tab | `PATCH /api/sessions/:id` `{ persona }`, turn `{ persona }` | Daemon |
| Module scope | CLI `--integration`, picker | `PATCH /api/sessions/:id` `{ modules }`, turn `{ modules }` | Daemon |
| dry-run | `--dry-run` | Session/turn `{ dryRun }` | Daemon |
| Streaming assistant text | `assistant_text_delta` | Same `ChatEvent` over SSE | Shared |
| Tool / prep / plan events | `ChatEvent` → transcript reducer | Same events; core transcript reducer | Shared |
| Transcript persistence | React → SQLite | Daemon turn runtime → SQLite | Daemon |
| askUser modal | Ink `AskUserModal` | SSE `ask_user_prompt` + `POST .../ask-user/:requestId` | Daemon + client UI |
| Turn cancel (Esc) | `AbortController` | `POST .../turn/:turnId/cancel` | Daemon |
| Steering (submit while loading) | abort + queue | cancel + turn `{ steering: true }` | Daemon + client |
| Plan skip/cancel | `/plan` | `POST .../plan/skip`, `POST .../plan/cancel` | Daemon |
| Plan execute (boot) | `generatePlan` + `executePlan` in TUI | Turn runtime optional `generatePlan` on first turn | Daemon (phase 2) / TUI bridge |
| Token usage | per-turn + session totals | `done.usage`, `GET .../usage` | Daemon |
| Status header | local persona/model | `GET /api/status` | Daemon |
| Slash: help, exit, terminal | Ink only | Client-local | TUI |
| Slash: listen / audio | macOS capture | Client-local capture → submit turn `{ text }` | TUI |
| Slash: connect, config, schedules | Ink modals + core | Existing `/api/configure/*`, integration connect via configure actions | Daemon (configure routes) |
| Slash: web, app, daemon | launcher helpers | `/api/daemon/*` + client launch | Mixed |

## Migration rule

Anything that mutates **session state**, **agent execution**, **transcript**, **persona/modules**, or **plans** goes through the daemon API. Rendering, keyboard shortcuts, modals, and device-specific capture stay in each client.
