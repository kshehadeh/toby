# Recent architecture changes: June 12–18, 2026

This is a dated summary of the major repository changes made from June 12
through June 18. The linked topic documents remain the source of truth for
current behavior.

## Local surfaces now share the daemon

- CLI chat, the React web UI, and Toby.app use the daemon's unified session and
  chat API. Interactive turns stream the same `ChatEvent` model over SSE.
- Toby.app starts the daemon when needed and now includes session history,
  search, persona selection, configuration, settings actions, richer work
  summaries, tool/reasoning progress, and corrected prompt focus behavior.
- The daemon API reference was added and expanded to cover sessions, plans,
  metadata, configuration, Listen state, and recordings.

See [architecture.md](architecture.md), [server-api.md](server-api.md), and
[chat-pipeline.md](chat-pipeline.md).

## Native permissions and app distribution

- Toby.app now runs a second localhost server, published through
  `~/.toby/native-port`, for operations that must carry a stable macOS bundle
  identity.
- Apple Calendar and macOS window-control plugins route EventKit and
  Accessibility work through that server and can auto-launch Toby.app.
- Release installs place Toby.app in `/Applications` or `~/Applications` rather
  than next to the CLI binary. Development builds display as **Toby (Dev)** so
  they are distinguishable from production bundles.
- The macOS plugin added minimize/unminimize controls, improved shortcut
  detection and setup, and plugin diagnostics.

See [native-helpers.md](native-helpers.md) and
[macos-integration.md](macos-integration.md).

## Recording and transcription

- Recording lifecycle and metadata moved into shared core Listen modules so
  daemon and CLI flows use the same implementation.
- Toby.app added native microphone/system-audio capture, recording status,
  completion toasts, a Recordings window, audio playback, transcript display,
  and confirmed deletion.
- The Recordings window is daemon-backed. It does not read or mutate recording
  directories directly.
- Transcription prefers `combined.m4a`, falls back to microphone/system WAV,
  avoids reconverting WAV input, and remains plugin-based through
  `toby-plugin-whisper` by default.

See [listen.md](listen.md) and the
[recording architecture](architecture.md#recording-and-transcription-architecture).

## Projects and skills

- Projects now scope reference context, generated outputs, pinned integrations,
  pinned global skills, and automatically loaded project-local skills.
- The chat and configure UIs gained project creation, selection, detail, and
  multi-select configuration flows.
- Skill-authoring requests can auto-select the local skill creation tool.

See [projects.md](projects.md).

## Models and configuration

- Ollama was added as an OpenAI-compatible local model provider.
- Custom provider model ids persist across configure sessions.
- Vercel AI Gateway's model list gained `openai/o4-mini`.

## Plugins, status, and upgrades

- Plugin discovery now supports executable-adjacent and repository `dist/`
  binaries ahead of installed plugins, improving local development workflows.
- Plugin commands and `/plugins` report discovery paths; `/status` reports CLI,
  native app, server, web UI, plugin, and helper locations.
- Upgrade handling now preserves adjacent plugin resource bundles and removes
  legacy Toby.app copies from old install locations.

See [plugin-protocol.md](plugin-protocol.md),
[slash-commands.md](slash-commands.md), and [build-executable.md](build-executable.md).

## Chat observability and interaction

- Chat surfaces now stream reasoning, tool calls, selected skills/tools, and
  meaningful tool-result feedback while work is in progress.
- Turn work duration is persisted in transcripts and rendered in the native
  app's work summary.
- The CLI gained improved multiline/paste handling, server restart/status
  commands, and clearer failed-tool rendering.
