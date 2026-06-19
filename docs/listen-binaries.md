# Listen binaries: build and deploy

Listen mode depends on the native **Toby.app** for audio capture and on the
**`toby-plugin-whisper`** plugin for local transcription.

| Binary | Source | Role |
| ------ | ------ | ---- |
| **`Toby.app`** | Swift package [`apps/toby-app/`](../apps/toby-app/) | Records mic/system audio and combines tracks via `NativeAudioHandler` |
| **`toby-plugin-whisper`** | Swift package [`apps/plugin-whisper/`](../apps/plugin-whisper/) | Local transcription plugin with **embedded** whisper.cpp (`doTranscription`) |

After a recording stops, the CLI invokes the configured transcription plugin
(default: `toby-plugin-whisper`) to write temp transcript files; Toby copies
them into the recording folder as `transcript.txt` / `transcript.json`. See
[listen.md](listen.md) for user-facing behavior.

Transcription models (for example `ggml-base.en.bin`) are **not** bundled in
release archives. They are downloaded on first install or upgrade via
`toby plugins setup whisper` into `~/.toby/models/`.

## Release layout

Each macOS release archive (`toby-darwin-arm64.zip`, `toby-darwin-x64.zip`) contains:

```text
toby                 # Bun-compiled CLI (only binary on PATH after install)
Toby.app             # Native macOS app for audio capture and privileged APIs
toby-plugin-whisper  # Local whisper.cpp transcription plugin (statically linked)
toby-plugin-macos    # macOS system integration plugin
...other plugins...
```

[`install-toby.sh`](../install-toby.sh) and `toby upgrade` install plugins under
**`~/.toby/plugins/`** and `Toby.app` into `/Applications` (or `~/Applications`).
The bundled `whisper-cli` helper is installed under **`~/.toby/helpers/`**.

## Build commands

### Full release build (local or CI)

[`scripts/build-release-artifacts.sh`](../scripts/build-release-artifacts.sh) is the single entry point used by CI and `bun run build:release`. It requires **`BUN_TARGET`** and **`SWIFT_ARCH`**:

```bash
# Apple Silicon host
BUN_TARGET=bun-darwin-arm64 SWIFT_ARCH=arm64 ./scripts/build-release-artifacts.sh

# Intel release (often cross-compiled from Apple Silicon CI)
BUN_TARGET=bun-darwin-x64 SWIFT_ARCH=x86_64 ./scripts/build-release-artifacts.sh
```

On a native macOS machine:

```bash
bun run build:release
```

This writes all release binaries to **`dist/`** and runs [`scripts/verify-release-artifacts.mjs`](../scripts/verify-release-artifacts.mjs).

### Native app (`Toby.app`)

```bash
bun run build:app
```

Packaged installs install `Toby.app` to `/Applications` or `~/Applications`.

### Transcription (`toby-plugin-whisper`)

whisper.cpp is built as **static libraries** and linked into the Swift plugin:

```bash
bun run build:plugin:whisper
```

Under the hood:

1. [`scripts/build-whisper-static-libs.sh`](../scripts/build-whisper-static-libs.sh) clones whisper.cpp into `.build/whisper.cpp-${SWIFT_ARCH}`, builds static `libwhisper.a` / `libggml*.a`, and installs headers to `.build/whisper-static-${SWIFT_ARCH}/`.
2. [`scripts/build-plugin-whisper.sh`](../scripts/build-plugin-whisper.sh) compiles the Swift plugin and C++ `WhisperBridge` against those libraries.

Environment overrides:

| Variable | Default | Purpose |
| -------- | ------- | ------- |
| `SWIFT_ARCH` | `uname -m` | Target architecture (`arm64` or `x86_64`) |
| `WHISPER_CPP_REF` | `v1.7.5` | whisper.cpp git tag |
| `WHISPER_STATIC_PREFIX` | `.build/whisper-static-${SWIFT_ARCH}` | Static libs + headers for SwiftPM |

**Requirements:** `git`, `cmake`, Xcode Command Line Tools.

CMake flags (CI-safe cross-compilation):

- **`BUILD_SHARED_LIBS=OFF`** — static ggml/whisper for embedding in the plugin
- **`GGML_NATIVE=OFF`** — do not tune for the build host CPU
- **arm64:** `WHISPER_METAL=ON`, `GGML_METAL_EMBED_LIBRARY=ON`, `-march=armv8.5-a+dotprod`

`bun run build:executable` runs `build:plugins`, which includes the whisper plugin build for the host architecture.

## Verification checklist

```bash
bun run build:release
node scripts/verify-release-artifacts.mjs dist
dist/toby-plugin-whisper status   # via plugin protocol (optional smoke test)
```

After install:

```bash
toby plugins setup whisper
toby listen
```
