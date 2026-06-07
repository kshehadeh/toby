# Listen binaries: build and deploy

Listen mode depends on two native executables that ship with Toby releases:

| Binary | Source | Role |
| ------ | ------ | ---- |
| **`toby-listener`** | Swift package [`apps/audio-helper/`](../apps/audio-helper/) | Records mic/system audio, combines tracks, and runs transcription by orchestrating whisper.cpp |
| **`whisper-cli`** | [whisper.cpp](https://github.com/ggerganov/whisper.cpp) via [`scripts/build-whisper-cli.sh`](../scripts/build-whisper-cli.sh) | Local speech-to-text engine invoked by the listener helper during `transcribe` |

Toby (Node/Bun) does **not** spawn `ffmpeg` or `whisper-cli` directly. After a recording stops, the CLI asks `toby-listener transcribe …` to convert audio with AVFoundation, run whisper.cpp, and write `transcript.txt` / `transcript.json`. See [listen.md](listen.md) for the runtime protocol and user-facing behavior.

Transcription models (for example `ggml-base.en.bin`) are **not** bundled in release archives. They are downloaded on first install or upgrade via `toby whisper setup` into `~/.toby/models/`.

## Release layout

Each macOS release archive (`toby-darwin-arm64.zip`, `toby-darwin-x64.zip`) contains these executables:

```text
toby                 # Bun-compiled CLI (only binary on PATH after install)
toby-listener        # Audio capture + transcription orchestration
toby-plugin-macos    # macOS system integration plugin
toby-plugin-sample   # Sample installable plugin
toby-plugin-azuread  # Azure AD integration plugin
toby-plugin-gmail    # Gmail integration plugin
toby-plugin-jira      # Jira integration plugin (Swift)
whisper-cli          # whisper.cpp CLI
```

[`install-toby.sh`](../install-toby.sh) and `toby upgrade` install the plugin
binaries into **`~/.toby/plugins/`** alongside helpers under **`~/.toby/helpers/`**.

[`install-toby.sh`](../install-toby.sh) installs `toby` to `~/.local/bin/` (or `TOBY_INSTALL_DIR`) and places the helper binaries under **`~/.toby/helpers/`**. It then runs **`toby whisper setup`** to fetch the default model.

## Build commands

### Full release build (local or CI)

[`scripts/build-release-artifacts.sh`](../scripts/build-release-artifacts.sh) is the single entry point used by CI and `bun run build:release`. It requires **`BUN_TARGET`** and **`SWIFT_ARCH`**:

```bash
# Apple Silicon host
BUN_TARGET=bun-darwin-arm64 SWIFT_ARCH=arm64 ./scripts/build-release-artifacts.sh

# Intel release (often cross-compiled from Apple Silicon CI)
BUN_TARGET=bun-darwin-x64 SWIFT_ARCH=x86_64 ./scripts/build-release-artifacts.sh
```

On a native macOS machine you can use the convenience script:

```bash
bun run build:release
```

This writes all release binaries to **`dist/`** and runs [`scripts/verify-release-artifacts.mjs`](../scripts/verify-release-artifacts.mjs) to confirm they exist and are executable.

### Listener (`toby-listener`)

Built with Swift Package Manager from `apps/audio-helper/`:

```bash
swift build -c release --arch "${SWIFT_ARCH}" --package-path apps/audio-helper
cp "$(swift build --show-bin-path -c release --arch "${SWIFT_ARCH}" --package-path apps/audio-helper)/toby-audio-helper" dist/toby-listener
```

For day-to-day development (host architecture only):

```bash
bun run build:audio-helper
# → apps/audio-helper/.build/release/toby-audio-helper
```

Toby auto-detects that dev path when launched from the repo root. Packaged installs resolve `~/.toby/helpers/toby-listener` instead.

### Transcriber (`whisper-cli`)

Built by cloning whisper.cpp into `.build/whisper.cpp-${SWIFT_ARCH}` and compiling with CMake:

```bash
SWIFT_ARCH=arm64 ./scripts/build-whisper-cli.sh dist/whisper-cli
SWIFT_ARCH=x86_64 ./scripts/build-whisper-cli.sh dist/whisper-cli
```

Environment overrides:

| Variable | Default | Purpose |
| -------- | ------- | ------- |
| `SWIFT_ARCH` | `uname -m` | Target architecture (`arm64` or `x86_64`) |
| `WHISPER_CPP_REF` | `v1.7.5` | whisper.cpp git tag to build |

**Requirements:** `git`, `cmake`, and a C++ toolchain (Xcode Command Line Tools).

#### CMake flags (CI-safe cross-compilation)

Release builds disable host CPU tuning so cross-compiling on GitHub Actions does not pass Apple Silicon–specific flags (for example `apple-m3`) into the wrong target:

- **`GGML_NATIVE=OFF`** — do not tune for the build host CPU.
- **arm64:** `WHISPER_METAL=ON`, `-march=armv8.5-a+dotprod` — avoids ggml i8mm mis-detection on `macos-latest` where some translation units compile without `+i8mm`.
- **x86_64:** `-march=x86-64` — generic Intel baseline for release archives.

The whisper.cpp checkout is cached under `.build/whisper.cpp-${SWIFT_ARCH}/` between builds on the same machine.

### Lightweight dev executable build

`bun run build:executable` compiles `dist/toby`, `dist/toby-listener`, and first-party plugins via `build:plugins` for the **host** architecture only. It does **not** build `whisper-cli`. Use `bun run build:release` when you need the full release payload locally.

## CI and GitHub Releases

Pushing a version tag (`v*`) runs [`.github/workflows/release.yml`](../.github/workflows/release.yml). The workflow matrix builds **both** architectures on `macos-latest`:

| Matrix row | `BUN_TARGET` | `SWIFT_ARCH` | Archive |
| ---------- | ------------ | ------------ | ------- |
| Apple Silicon | `bun-darwin-arm64` | `arm64` | `toby-darwin-arm64.zip` |
| Intel | `bun-darwin-x64` | `x86_64` | `toby-darwin-x64.zip` |

Each job:

1. Runs `./scripts/build-release-artifacts.sh` with the matrix env vars.
2. Optionally signs and notarizes all five binaries (Developer ID secrets).
3. Packages them into a zip via `ditto` after `verify-release-artifacts.mjs`.

See [build-executable.md](build-executable.md) for signing secrets, release-it workflow, and end-user install notes.

## Runtime resolution

After install, Toby resolves paths in this order (see [native-helpers.md](native-helpers.md)):

**Listener**

1. `--helper` / `TOBY_AUDIO_HELPER`
2. `~/.toby/helpers/toby-listener`
3. Sibling of the `toby` binary (legacy)
4. Dev build at `apps/audio-helper/.build/release/toby-audio-helper`

**Whisper CLI**

1. Configuration override / `TOBY_WHISPER_CPP_BINARY`
2. `~/.toby/helpers/whisper-cli`
3. Sibling of the `toby` binary (legacy)

The listener receives the resolved whisper-cli path on each `transcribe` invocation:

```bash
toby-listener transcribe --input <audio> --out-dir <dir> --whisper-cli <path> --model <path> [--language <code>]
```

## Verification checklist

Before tagging a release:

```bash
bun run build:release
node scripts/verify-release-artifacts.mjs dist
dist/whisper-cli --help   # smoke-test whisper.cpp binary
dist/toby-listener --help # smoke-test listener (if supported)
```

After install:

```bash
toby whisper status
toby listen   # confirm helper discovery and model path
```
