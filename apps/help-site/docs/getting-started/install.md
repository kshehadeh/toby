---
sidebar_position: 1
title: Install Toby
---

# Install Toby

You can install Toby with the install script, from a release binary, or from source.

## Option 1: Install script (recommended)

The [install script](https://github.com/kshehadeh/toby/blob/main/install-toby.sh) downloads the latest macOS release archive and installs the `toby` binary to `~/.local/bin`. The bundled `bun` runtime goes to `~/.toby/helpers/bun` (for TypeScript bun-package plugins) and first-party plugins (`toby-plugin-sample-ts`, `toby-plugin-azuread`, `toby-plugin-gmail`, `toby-plugin-todoist`, `toby-plugin-jira`, `toby-plugin-slack`, `toby-plugin-websearch`, `toby-plugin-applecalendar`, `toby-plugin-macos`) to `~/.toby/plugins/`, so only `toby` is added to your `PATH`. The native `Toby.app` is installed to `/Applications` (or `~/Applications`). It does not require `sudo`.

After installing binaries, the script runs `toby whisper setup` to download the default local transcription model (`ggml-base.en.bin`) into `~/.toby/models/`. If that step fails (for example offline install), run `toby whisper setup` later.

On **macOS**, run:

```bash
curl -fsSL https://raw.githubusercontent.com/kshehadeh/toby/main/install-toby.sh | bash
```

If you already cloned the repo, you can run the script locally:

```bash
./install-toby.sh
```

The script picks the right asset for your system:

| Platform | Architecture | Release asset |
| -------- | ------------ | ------------- |
| macOS | Apple Silicon | `toby-darwin-arm64.zip` |
| macOS | Intel | `toby-darwin-x64.zip` |

After it finishes, verify the install:

```bash
toby --help
```

If `toby` is not found, the script prints how to add `~/.local/bin` to your shell `PATH` (zsh, bash, or fish). Open a new terminal or `source` your profile after updating `PATH`.

### Optional settings

| Variable | Purpose |
| -------- | ------- |
| `TOBY_INSTALL_DIR` | Install directory (default: `~/.local/bin`) |
| `TOBY_VERSION` | Install a specific release tag, e.g. `v0.9.2` |
| `TOBY_REPO` | GitHub repo as `owner/name` (default: `kshehadeh/toby`) |
| `GITHUB_TOKEN` | Optional token to raise GitHub API rate limits |

Example — install to a custom directory:

```bash
TOBY_INSTALL_DIR="$HOME/bin" curl -fsSL https://raw.githubusercontent.com/kshehadeh/toby/main/install-toby.sh | bash
```

## Option 2: Release binary (manual)

If you prefer to download the binary yourself:

1. Open the [Toby releases page](https://github.com/kshehadeh/toby/releases).
2. Download the archive for your platform (see the table above).
3. Extract it, then put `toby` on your PATH, plugins under `~/.toby/plugins/`, and `Toby.app` in `/Applications` (or `~/Applications`):

```bash
unzip toby-darwin-arm64.zip
chmod +x toby toby-plugin-*
mkdir -p ~/.toby/plugins
mv toby-plugin-* ~/.toby/plugins/
sudo mv toby /usr/local/bin/
sudo mv Toby.app /Applications/
```

4. Verify the install:

```bash
toby --help
```

## Option 3: Install from source

1. Clone the repository:

```bash
git clone https://github.com/kshehadeh/toby.git
cd toby
```

2. Install dependencies and build:

```bash
bun install
bun run build
```

3. Run Toby:

```bash
bun run dev -- --help
```

When developing from source, prefix commands with `bun run dev --` (for example, `bun run dev -- chat`). Build and install first-party plugins before using Gmail, Azure AD, Web Search, or other plugin integrations:

```bash
bun run build:plugins
toby plugins doctor
```

To link individual plugins during development:

```bash
toby plugins install ./dist/toby-plugin-gmail --link --force
toby plugins install ./dist/toby-plugin-azuread --link --force
toby plugins install ./dist/toby-plugin-websearch --link --force
```

## Next steps

- [Set up your AI provider](./setup-ai)
- [Configure and connect integrations](./configure-and-status)
