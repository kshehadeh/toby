# Personas

A **persona** is a named profile: instructions, prompt mode (`add` | `replace`), and an AI provider/model. Chat, dashboard summaries, listen summaries, schedules, and flows resolve a persona and compose it into the system prompt via [`composeSystemPromptWithPersona`](../packages/core/src/personas/prompt.ts).

User-facing setup lives in the [help site Personas page](../apps/help-site/docs/personas.md).

## Built-in personas

Source:

- Registry: [`packages/core/src/personas/builtins.ts`](../packages/core/src/personas/builtins.ts)
- Resolution: [`packages/core/src/personas/index.ts`](../packages/core/src/personas/index.ts)
- Toby instructions: [`packages/core/src/personas/default-instructions.ts`](../packages/core/src/personas/default-instructions.ts)
- Mailman instructions: [`packages/core/src/personas/mailman-instructions.ts`](../packages/core/src/personas/mailman-instructions.ts)

`BUILTIN_PERSONAS` is the shipped set. `DEFAULT_CHAT_PERSONA` is still **Toby** (used when no default is configured). Every built-in uses `promptMode: "add"` so instructions append to integration and one-shot base prompts rather than replacing tool guidance.

Built-in images live in [`packages/core/assets/personas/`](../packages/core/assets/personas/) (`toby.png`, `mailman.png`). `resolvePersona` / `listPersonas` attach that `imagePath` unless the user uploaded a custom image. `GET /api/personas/image/:filename` serves a user file from `~/.toby/persona/images/` first, then the bundled asset. `default.png` maps to `toby.png` when no user default exists.

| Persona | Role | Instructions contract |
| ------- | ---- | --------------------- |
| **Toby** | General productivity | Focus, grounding, missing-context, format (including markdown images for visual items); optional labels News / Ads / Personal / Career / Creative |
| **Mailman** | Inbox triage | Same grounding; priorities Needs attention / Worth noting / Ignore; labels Personal / Work / Financial / Home / Travel / Accounts / Promotions |

Do not put integration-specific tool policy in these prompts. Those rules belong on the integration / combined chat base prompt.

To add another built-in:

1. Add an instructions module next to `mailman-instructions.ts`.
2. Register a `Persona` on `BUILTIN_PERSONAS` (picker order is array order).
3. Keep name / instructions / promptMode locked; inherit Toby's persisted AI until the user sets this persona's provider/model.
4. Add a portrait at [`packages/core/assets/personas/<name>.png`](../packages/core/assets/personas/) (lowercase filename) and set `imagePath` to that file. Release packaging copies this directory next to the compiled binary.

Reserved names cannot be created, renamed onto, or deleted.

## Locked fields

Settings and `update-persona` allow only **provider** and **model** edits on any built-in persona. Name, instructions, and prompt mode always come from the registry.

`resolvePersona` / `listPersonas` call `withBuiltInPersonaDefaults` so a stale copy in `~/.toby/config.json` cannot freeze an old prompt. `rebuildPersonas` writes the current shipped instructions back when settings are saved.

A built-in that is not yet persisted inherits AI settings from the persisted **Toby** persona (if any) so Mailman works after guided AI setup without a second provider pick. Once the user saves Mailman’s provider or model, that copy is independent.

Custom personas keep whatever instructions the user stored.

## Starting a chat from the toolbar

The chat toolbar **+** control is a split button:

- Click **+** (or File → New Chat / ⌘N outside Projects) to start a draft that follows the configured default. When a project is selected, ⌘N starts a new project chat instead.
- Open the menu for **Chat with Default Persona** plus **Chat with \<name\>** for each `listPersonas()` option (built-ins first, then custom).

A named pick is sent as `persona` on `POST /api/sessions` when the first turn creates the session. That becomes `session.settings.persona` (a named override). **Chat with Default Persona** omits `persona` so later default changes still apply.

## Resolution order

1. Named override (new-chat menu, schedule, flow, project, inbound config).
2. Configured default (`defaultPersona` in `config.json`).
3. Built-in **Toby**.
