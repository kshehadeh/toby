---
sidebar_position: 1
title: Install Toby
---

# Install Toby

You can install Toby with the install script, from a release binary, or from source.

## Option 1: Install script (recommended)

The [install script](https://github.com/kshehadeh/toby/blob/main/install-toby.sh) downloads the latest macOS release archive and installs the `toby` binary to `~/.local/bin`. Bundled helper binaries (`toby-listener`, `toby-macos`) go to `~/.toby/helpers/` and the sample plugin to `~/.toby/plugins/`, so only `toby` is added to your `PATH`. It does not require `sudo`.

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
3. Extract it, then put `toby` on your PATH and the helper binaries under `~/.toby/helpers/`:

```bash
unzip toby-darwin-arm64.zip
chmod +x toby toby-listener toby-macos
mkdir -p ~/.toby/helpers
mv toby-listener toby-macos ~/.toby/helpers/
sudo mv toby /usr/local/bin/
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

When developing from source, prefix commands with `bun run dev --` (for example, `bun run dev -- chat`).

## Next steps

- [Set up your AI provider](./setup-ai)
- [Configure and connect integrations](./configure-and-status)
