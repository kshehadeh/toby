# toby-plugin-whisper

Local whisper.cpp transcription plugin for Toby listen mode. whisper.cpp is
**statically linked** into this binary — no separate `whisper-cli` helper.

## Build

Requires `cmake`, Xcode CLT, and a one-time whisper.cpp static library build:

```bash
bun run build:plugin:whisper
```

Output: `dist/toby-plugin-whisper`

## Protocol

- Capability: `transcription`
- Harness tool: `doTranscription` (`audioFilePath` → temp `transcriptPath` / `transcriptJsonPath`)
- Setup: downloads the default model when Toby passes `modelInstallTarget` on stdin
