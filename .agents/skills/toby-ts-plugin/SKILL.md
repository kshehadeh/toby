---
name: toby-ts-plugin
description: >-
  Create a new TypeScript bun-package (directory) plugin or convert an existing
  compiled binary plugin to a bun-package. Use when the user asks to make a
  plugin TypeScript-based, convert from binary/Swift to bun-package, or scaffold
  a new directory plugin with manifest.json.
---

# TypeScript bun-package plugin

## Goal

Create or convert a Toby integration plugin as a **bun-package** (directory)
plugin instead of a compiled binary. The plugin ships as a directory containing
`manifest.json`, `package.json`, and TypeScript source. Toby discovers the
directory, reads the manifest, and invokes the entry point via the bundled Bun
runtime.

## When to use bun-package vs binary

| Format | When | Examples |
| ------ | ---- | -------- |
| **Bun-package** (this skill) | API-based integrations, or macOS system controls and Calendar/EventKit routed through Toby.app's native API server | `plugin-sample-ts`, `plugin-jira`, `plugin-todoist`, `plugin-macos`, `plugin-applecalendar` (delegates EventKit to Toby.app) |
| **Binary** (`bun build --compile` or Swift) | Deep macOS integration requiring direct framework access that cannot be routed through Toby.app | (none currently) |

Prefer bun-package unless the plugin needs direct access to macOS frameworks.

## Prerequisites

Read first:
- [`docs/plugin-protocol.md`](../../../docs/plugin-protocol.md) — protocol v1 spec
- [`.agents/skills/toby-plugin/SKILL.md`](../toby-plugin/SKILL.md) — general plugin skill (protocol subcommands, hard rules, core touchpoints)

The general plugin skill covers protocol behavior, subcommands, and hard rules.
**This skill** covers only what is different about the bun-package format:
manifest, build, release wiring, dependencies, and tests.

## Reference implementations

| Plugin | Notes |
| ------ | ----- |
| [`apps/plugin-sample-ts/`](../../../apps/plugin-sample-ts/) | Minimal bun-package plugin (no dependencies) |
| [`apps/plugin-jira/`](../../../apps/plugin-jira/) | Converted from Swift; REST API client, gateway retry, no dependencies |
| [`apps/plugin-todoist/`](../../../apps/plugin-todoist/) | Converted from compiled binary; has vendored `@doist/todoist-sdk` dependency |
| [`apps/plugin-macos/`](../../../apps/plugin-macos/) | Converted from Swift; delegates all macOS ops to Toby.app native API server; bundled shortcut setup |
| [`apps/plugin-applecalendar/`](../../../apps/plugin-applecalendar/) | Converted from Swift; delegates EventKit calendar operations to Toby.app native API server |

---

## Workflow A — Create a new bun-package plugin

```
Task progress:
- [ ] 1. Scaffold directory
- [ ] 2. Implement protocol subcommands
- [ ] 3. Wire build + release
- [ ] 4. Tests
```

### 1. Scaffold

```
apps/plugin-<name>/
  manifest.json         # bun-package runtime declaration
  package.json          # name, scripts (build = no-op), dependencies
  README.md
  src/
    index.ts            # argv router (entry point)
    protocol.ts         # readStdin, parseEnvelope, emitJson, emitError
    client.ts           # API client (optional)
    tools.ts            # tool definitions + executeTool
    prompts.ts          # chatModelPrep strings
```

#### manifest.json

```json
{
  "name": "<name>",
  "displayName": "<Display Name>",
  "description": "<short description>",
  "version": "1.0.0",
  "protocolVersion": "1",
  "runtime": {
    "type": "bun",
    "entry": "src/index.ts"
  },
  "capabilities": ["chat"],
  "providerCategories": ["<category>"],
  "resources": ["<resource1>", "<resource2>"]
}
```

#### package.json

```json
{
  "name": "@toby/plugin-<name>",
  "version": "1.0.0",
  "private": true,
  "type": "module",
  "description": "<description>",
  "scripts": {
    "dev": "bun src/index.ts status",
    "lint": "bunx biome check .",
    "build": "echo 'bun-package plugin: no compilation needed'"
  }
}
```

If the plugin has npm dependencies, add them to `dependencies`. The release
build **must strip `node_modules`** from the dist copy (see Dependencies
below) so the installer can run a clean `bun install` at install time.

### 2. Implement protocol subcommands

Follow the same protocol v1 subcommands as any plugin (see
[toby-plugin skill](../toby-plugin/SKILL.md) for the full table). The entry
point (`src/index.ts`) routes argv:

```typescript
#!/usr/bin/env bun
import { emitError, emitJson, parseEnvelope, readStdin } from "./protocol";
// ... imports

async function main(): Promise<void> {
  const [command, subcommand] = process.argv.slice(2);
  const stdin = await readStdin();

  if (command === "status") { /* ... */ }
  if (command === "connect") { /* ... */ }
  if (command === "disconnect") { /* ... */ }
  if (command === "config" && subcommand === "shape") { /* ... */ }
  if (command === "config" && subcommand === "get") { /* ... */ }
  if (command === "config" && subcommand === "set") { /* ... */ }
  if (command === "tools" && subcommand === "list") { /* ... */ }
  if (command === "tools" && subcommand === "execute") { /* ... */ }

  emitError(`Unknown command: ${command ?? "(none)"}`, "usage", 2);
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  emitError(message, "internal_error", 2);
});
```

### 3. Wire build + release

**Root [`package.json`](../../../package.json):**

Add to scripts:
```json
"build:plugin:<name>": "rm -rf ./dist/toby-plugin-<name> && mkdir -p ./dist && cp -R ./apps/plugin-<name> ./dist/toby-plugin-<name> && rm -rf ./dist/toby-plugin-<name>/node_modules ./dist/toby-plugin-<name>/.turbo ./dist/toby-plugin-<name>/.build"
```

> **Always exclude `node_modules`** from the dist copy. In the monorepo,
> `node_modules` contains symlinks to `../../../node_modules/.bun/...` (hoisted
> workspace deps). These symlinks break when the plugin directory is copied to
> `~/.toby/plugins/`, causing the plugin to fail at runtime with `ENOENT`
> errors. The installer runs `bun install` after copying to create fresh,
> self-contained `node_modules`.

Add to `build:plugins` string.

**[`scripts/build-release-artifacts.sh`](../../../scripts/build-release-artifacts.sh):**

```bash
echo "Building toby-plugin-<name> (bun-package)..."
rm -rf dist/toby-plugin-<name>
cp -R apps/plugin-<name> dist/toby-plugin-<name>
rm -rf dist/toby-plugin-<name>/node_modules dist/toby-plugin-<name>/.turbo dist/toby-plugin-<name>/.build
```

Remove the plugin name from the `chmod +x` line (it is a directory, not an
executable).

**[`.github/workflows/release.yml`](../../../.github/workflows/release.yml):**

- Remove `codesign` and `codesign --verify` lines for `dist/toby-plugin-<name>`.
- In the "Package release archive" step, remove the plugin from the `cp` (file)
  line and add `cp -R dist/toby-plugin-<name> release-payload/toby-plugin-<name>`.

**[`scripts/verify-release-artifacts.mjs`](../../../scripts/verify-release-artifacts.mjs):**

Move the plugin name from the `required` array (executable check) to the
`requiredDirs` array (directory + manifest.json check).

**[`install-toby.sh`](../../../install-toby.sh):**

Change detection from `-f` to `-d`:
```bash
has_<name>_plugin=false
if [[ -d "${tmpdir}/toby-plugin-<name>" ]]; then
    has_<name>_plugin=true
fi
```

Change install from `chmod + mv` to `rm -rf + cp -R`:
```bash
if $has_<name>_plugin; then
    mkdir -p "$toby_plugins_dir"
    rm -rf "${toby_plugins_dir}/toby-plugin-<name>"
    cp -R "${tmpdir}/toby-plugin-<name>" "${toby_plugins_dir}/toby-plugin-<name>"
    echo "Installed: ${toby_plugins_dir}/toby-plugin-<name>"
fi
```

**[`apps/cli/src/upgrade/index.ts`](../../../apps/cli/src/upgrade/index.ts):**

1. In `downloadRelease`, change `rm` for the plugin staging path to
   `{ recursive: true, force: true }`.
2. In `applyStagedRelease`, change `installStagedPluginBinary` to
   `installStagedPluginDirectory` for the plugin.

### 4. Tests

Create `apps/cli/tests/plugins-<name>.test.ts`. Pattern for bun-package plugins:

```typescript
function copy<Name>Plugin(pluginDir: string): void {
  fs.mkdirSync(pluginDir, { recursive: true });
  const dest = path.join(pluginDir, "toby-plugin-<name>");
  fs.cpSync(pluginSourceDir, dest, {
    recursive: true,
    filter: (src) => !src.includes(".turbo") && !src.includes(".build"),
  });
}

function find<Name>Plugin(pluginDir: string): DiscoveredPlugin {
  const discovered = discoverPluginBinaries();
  const found = discovered.find((d) => d.binaryName === "toby-plugin-<name>");
  expect(found).toBeDefined();
  if (!found) throw new Error("toby-plugin-<name> not discovered");
  return found;
}
```

Use `resolvePluginTarget(found)` to get the invocation target, then pass it to
`pluginStatus`, `pluginConfigShape`, `pluginToolsList`, `pluginConnect`, etc.

Use `loadPluginMetadata(found)` (not a raw `{ kind: "binary" }` object) for
`createPluginIntegrationModule` and `validatePluginBinary`.

Run: `bun run typecheck`, `bun run test`.

---

## Workflow B — Convert existing binary plugin to bun-package

```
Task progress:
- [ ] 1. Add manifest.json
- [ ] 2. Update package.json build script
- [ ] 3. Update release wiring (6 files)
- [ ] 4. Update tests
- [ ] 5. Update docs
- [ ] 6. Validate
```

### 1. Add manifest.json

Create `apps/plugin-<name>/manifest.json` with the same `name`, `displayName`,
`description`, `version`, `protocolVersion`, `capabilities`,
`providerCategories`, and `resources` that the plugin already reports in its
`status` response.

### 2. Update package.json

Change the `build` script from `bun build --compile` to a no-op:
```json
"build": "echo 'bun-package plugin: no compilation needed'"
```

### 3. Update release wiring

Apply all 6 release wiring changes from Workflow A step 3. Specifically:

| File | Change |
| ---- | ------ |
| `package.json` (root) | `build:plugin:<name>` → directory copy; **must `rm -rf node_modules`** |
| `scripts/build-release-artifacts.sh` | `bun build --compile` → `cp -R`; **must `rm -rf node_modules`**; remove from `chmod +x` |
| `.github/workflows/release.yml` | Remove codesign/verify; `cp -R` in payload |
| `scripts/verify-release-artifacts.mjs` | Move from `required` to `requiredDirs` |
| `install-toby.sh` | `-f` → `-d`; `chmod + mv` → `rm -rf + cp -R` |
| `apps/cli/src/upgrade/index.ts` | `installStagedPluginBinary` → `installStagedPluginDirectory`; `rm` → `recursive: true` |

### 4. Update tests

Rewrite the plugin test file to use directory copy + bun-package discovery
(see Workflow A step 4). If other test files use a bash wrapper for this
plugin, replace with directory copy:

```typescript
// Before (binary wrapper):
writePluginWrapper(pluginsDir, "toby-plugin-<name>", cliPath);

// After (bun-package directory copy):
fs.cpSync(pluginSourceDir, path.join(pluginsDir, "toby-plugin-<name>"), {
  recursive: true,
  filter: (src) => !src.includes(".turbo") && !src.includes(".build"),
});
```

Search for the plugin name across all test files:
```bash
grep -r "toby-plugin-<name>" apps/cli/tests/
```

### 5. Update docs

| File | What to change |
| ---- | -------------- |
| `docs/plugin-protocol.md` | Reference table: language → "TypeScript (bun-package)", build notes |
| `docs/integrations.md` | Description of the plugin |
| `docs/create-integration.md` | Migration examples list |
| `apps/help-site/docs/integrations/<name>.md` | Build/install instructions |
| `apps/help-site/docs/plugins/creating-a-plugin.md` | Table entry: Binary → Bun-package |
| `.agents/skills/toby-plugin/SKILL.md` | Migration/reference examples |
| `apps/plugin-<name>/README.md` | Build/install instructions |

Search for stale references:
```bash
grep -ri "<name>.*Swift\|Swift.*<name>\|<name>.*binary\|<name>.*compile" docs/ apps/help-site/ .agents/
```

### 6. Validate

```bash
bun run lint
bun run typecheck
bun run test
```

---

## Dependencies

### Critical: always strip `node_modules` from the dist copy

In the Toby monorepo, Bun creates `node_modules` entries as **symlinks** into
the hoisted workspace store (`../../../node_modules/.bun/<pkg>@<ver>/...`).
These symlinks are valid inside the repo but **break** when the plugin
directory is copied to `~/.toby/plugins/` during install or upgrade, because
the workspace `node_modules` is not present at the destination. The plugin
then fails at runtime with `ENOENT` errors and is silently skipped by plugin
discovery (which swallows status-call errors).

**Always exclude `node_modules` from the dist copy**, regardless of whether
the plugin has dependencies. The installer (`installBunPackagePlugin` in
[`install.ts`](../../../packages/core/src/integrations/plugins/install.ts)
and `installStagedPluginDirectory` in
[`apps/cli/src/upgrade/index.ts`](../../../apps/cli/src/upgrade/index.ts))
will run `bun install` after copying to create fresh, self-contained
`node_modules` at the install location.

### No dependencies (e.g., Jira)

The plugin only uses Node.js built-in APIs (`fetch`, `Buffer`, etc.). Strip
`node_modules` (harmless even if empty):

```bash
rm -rf ./dist/toby-plugin-<name> && mkdir -p ./dist && cp -R ./apps/plugin-<name> ./dist/toby-plugin-<name> && rm -rf ./dist/toby-plugin-<name>/node_modules ./dist/toby-plugin-<name>/.turbo ./dist/toby-plugin-<name>/.build
```

### With dependencies (e.g., Todoist with `@doist/todoist-sdk`)

Strip `node_modules` from the dist copy — the installer will run
`bun install` to restore dependencies at the install location:

```bash
rm -rf ./dist/toby-plugin-<name> && mkdir -p ./dist && cp -R ./apps/plugin-<name> ./dist/toby-plugin-<name> && rm -rf ./dist/toby-plugin-<name>/node_modules ./dist/toby-plugin-<name>/.turbo ./dist/toby-plugin-<name>/.build
```

The `package.json` `dependencies` field and `bun.lock`/`bunfig.toml` (if
present) are included in the archive, so `bun install` can resolve the
correct versions at install time.

---

## Common mistakes

- Forgetting `manifest.json` — discovery will not find the plugin without it.
- **Shipping `node_modules` in the release archive** — monorepo `node_modules`
  contains symlinks to `../../../node_modules/.bun/...` that break outside the
  repo. The plugin will fail with `ENOENT` and be silently skipped. Always
  `rm -rf dist/toby-plugin-<name>/node_modules` in the build script.
- Using `installStagedPluginBinary` instead of `installStagedPluginDirectory`
  in the upgrade path — `rename` of a directory over an existing file fails
  with `ENOTDIR` on macOS.
- Leaving the plugin in the `required` (executable) list in
  `verify-release-artifacts.mjs` — verification will fail because the path is a
  directory, not an executable file.
- Not updating `install-toby.sh` from `-f` to `-d` — the installer will skip
  the plugin because it checks for a file, not a directory.
- Forgetting to remove codesign lines in `release.yml` — codesign will fail on
  a directory (unless using `--deep`, which is not appropriate for plugins).
