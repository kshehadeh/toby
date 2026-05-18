---
sidebar_position: 1
title: Install Toby
---

# Install Toby

You can install Toby from a release binary or from source.

## Option 1: Release binary (recommended)

1. Open the [Toby releases page](https://github.com/kshehadeh/toby/releases).
2. Download the latest binary for your platform (for example, `toby-darwin-arm64` on Apple Silicon Macs).
3. Move it onto your PATH and make it executable:

```bash
chmod +x toby-darwin-arm64
sudo mv toby-darwin-arm64 /usr/local/bin/toby
```

4. Verify the install:

```bash
toby --help
```

## Option 2: Install from source

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
