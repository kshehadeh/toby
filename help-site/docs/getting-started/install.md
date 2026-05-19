---
sidebar_position: 1
title: Install Toby
---

# Install Toby

You can install Toby with the install script, from a release binary, or from source.

## Option 1: Install script (recommended)

The [install script](https://github.com/kshehadeh/toby/blob/main/install-toby.sh) downloads the latest release for your platform and installs it to `~/.local/bin/toby`. It does not require `sudo`.

On **macOS** or **Linux**, run:

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
| macOS | Apple Silicon | `toby-darwin-arm64` |
| macOS | Intel | `toby-darwin-x64` |
| Linux | arm64 / aarch64 | `toby-linux-arm64` |
| Linux | x86_64 | `toby-linux-x64` |

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
2. Download the asset for your platform (see the table above).
3. Move it onto your PATH and make it executable:

```bash
chmod +x toby-darwin-arm64
sudo mv toby-darwin-arm64 /usr/local/bin/toby
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
