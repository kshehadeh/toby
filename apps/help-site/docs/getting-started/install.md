---
sidebar_position: 1
title: Install Toby
---

# Install Toby

Toby is a native macOS app. Download the DMG, drag **Toby.app** to your Applications folder, and launch it. The app starts the daemon and sets up everything else automatically.

<a class="button button--primary button--lg margin-vert--md" href="https://github.com/kshehadeh/toby/releases/latest/download/Toby-arm64.dmg">⬇ Download Toby for macOS</a>

1. Open the downloaded `.dmg` file.
2. Drag **Toby.app** into the **Applications** folder shortcut.
3. Launch **Toby.app** from Applications (or Spotlight).

When you launch Toby.app for the first time, macOS may warn that the app was downloaded from the internet. Click **Open** to proceed. The app starts the Toby daemon automatically and creates the `~/.toby/` configuration directory.

:::note[Also need the CLI?]
The DMG installs the native app only. If you also want the `toby` terminal command, see the [install script](https://github.com/kshehadeh/toby/blob/main/install-toby.sh) or [install from source](https://github.com/kshehadeh/toby) instructions on GitHub.
:::

## Next steps

- [Set up your AI provider](./setup-ai)
- [Configure and connect integrations](./configure-and-status)
