---
sidebar_position: 1
slug: /intro
title: Introduction
---

# Welcome to Toby

Toby is an AI-assisted CLI for organizing and summarizing work across integrations like Gmail, Todoist, Apple Mail, and Apple Calendar.

## Install Toby

You can install Toby either from a release binary or from source.

### Option 1: Release binary (recommended)

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

### Option 2: Install from source

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

## Next steps

- Use `toby connect <integration>` to connect services.
- Run `toby chat` to start the assistant experience.
- Run `toby status` to check integration health.
