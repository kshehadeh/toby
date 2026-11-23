# Agent and contributor guide

Toby is a single native macOS app written in Swift (macOS 26+, Swift 6,
SwiftUI). There is no TypeScript runtime, CLI, background daemon, local HTTP
server, plugin system, or MCP. AI goes through **OpenRouter** only, via the
in-repo **TobyAI** module.

The only other code in the repo is the public help site (`apps/help-site/`,
Next.js), deployed by Vercel.

## Repository layout

```
apps/
  toby-app/     Swift package: the app and its modules (source of truth)
  help-site/    Public docs + marketing site (www.tobyai.app)
scripts/        Build, release, dev-loop, and screenshot scripts
VERSION         App version (read by scripts/build-app.sh)
```

### Swift package targets (`apps/toby-app/Package.swift`)

| Target | Role |
| ------ | ---- |
| `TobyAI` | OpenRouter client: streaming chat with tool calls, structured output, embeddings, model catalog, OAuth (PKCE) sign-in, Keychain key store |
| `TobyStore` | GRDB SQLite database (`$TOBY_DIR/app/toby.sqlite`), schema migrations, `TobyPaths`, and the one-time `LegacyImporter` from older `~/.toby` homes |
| `TobyCore` | Domain services: chat engine + tools, todos + todo sync, memories + graph, library, projects, personas, skills, Feed (Home), follow-ups + observations, flows + cron, recordings, mail and Slack services, backups + sync vault, unified log, changelog |
| `TobyMail` | Dependency-free IMAP/SMTP client, MIME parsing, server discovery |
| `TobyApp` | SwiftUI app: features, stores, native macOS handlers, `NativeRuntime` |

### Inside `TobyApp`

| Layer | Path | Notes |
| ----- | ---- | ----- |
| App | `App/` | `TobyApp`, `RootView`, `NativeRuntime` (owns the database, services, and background loops), menu bar |
| Features | `Features/*` | SwiftUI feature UI. Settings window: `Features/Settings/NativeSettingsView.swift` |
| Stores | `Stores/*` | `@Observable @MainActor` UI state; call `TobyClient` |
| NativeCore | `NativeCore/*` | Routers adapting TobyCore services to the app's JSON models; `NativeStatusRouter`, `NativeConfigureActions`, `LegacyDaemonCleanup` |
| Native | `Native/*` | TCC / framework handlers (EventKit, Contacts, audio, speech, location, macOS controls) behind `NativeDispatcher` |
| Utilities / Models | `Utilities/`, `Models/` | `TobyClient` (in-process facade over `NativeRuntime`), DTOs |

**Flow of a call:** view → store → `TobyClient` → `NativeRuntime` service
(TobyCore) → SQLite / OpenRouter / IMAP / Slack. TobyCore reaches macOS
frameworks only through the `NativeBridge` protocol (`AppNativeBridge` →
`NativeDispatcher`).

## Runtime and data

- Toby home: `~/.toby` (override with `TOBY_DIR` or Settings → General → Home directory).
- Database: `app/toby.sqlite`. Files stay in place: `projects/`, `library/`,
  `listen/recordings/`, `skills/`, `persona/images/`. Preferences: `config.json`.
  Log: `logs/toby.log` (`TobyLog`).
- Secrets (OpenRouter key, `mail.*`, `slack.*`, sync vault password) live in the
  Keychain.
- First launch on an older home runs `LegacyImporter` (chat/memory databases,
  credentials, feed state), then `LegacyDaemonCleanup` stops a running
  `toby daemon` once and deletes `plugins`, `plugins-data`, `helpers/bun`,
  `daemon.lock`, `native-port`, `staging`.
- Background work runs while the app is running: mail sync, Feed scheduler,
  follow-ups, flow triggers, Slack replies (Socket Mode), todo sync, daily
  data snapshots.
- Test processes resolve a temporary home (`TobyPaths.isRunningTests`); tests
  never touch `~/.toby`.

## Commands

```sh
bun run app              # build dist/Toby (Dev).app and open it
bun run test             # swift test --package-path apps/toby-app
bun run build:release    # production Toby.app (scripts/build-release-artifacts.sh)
bun run build:dmg        # release build + DMG
bun run lint             # Biome (help site + scripts)
bun run docs:start       # help site dev server
bun run dev:upgrade-available  # Dev app with a fake pending update
bun run dev:sandbox      # Dev app against a temp TOBY_DIR
bun run app:screenshots  # Dev app against a seeded generic home
```

Swift tests need Xcode selected (`sudo xcode-select -s /Applications/Xcode.app/Contents/Developer`).

## Conventions for agents

- **Single app.** Do not add plugins, MCP, a daemon or local HTTP server, a
  CLI, or TypeScript runtime code. New sources and capabilities are Swift
  services in TobyCore, exposed as chat tools via `ChatToolbox`.
- **AI** goes through TobyAI / OpenRouter. Use `ModelRole` defaults
  (`.chat`, `.fast`, `.structured`); the only user override is
  `toby.ai.chatModel` (Settings → Account) plus per-persona models.
- **Data compatibility:** native services emit the same JSON shapes the app
  models decode, and read/write existing file formats (Feed state,
  `config.json`, recordings, `.tbybak` backups, the todo sync vault).
- **Swift 6 strict concurrency.** Return values (not `Row`) from GRDB closures;
  `nonisolated(unsafe)` for static regexes.
- **`@Observable` and TobyCore:** TobyCore defines a type named
  `Observation`, which breaks the `@Observable` macro in files that
  `import TobyCore`. Keep observable models in files that don't import
  TobyCore, or use plain value state.
- **Real data is precious.** Never run code against a real `~/.toby`; copy it
  to a scratch `TOBY_DIR`. Opt-in parity tests read real data read-only.
- **App tests:** `TobyAppTests` has known ViewInspector failures and a
  signal-5 runner crash. Compare `--no-parallel` failures against a baseline
  worktree before attributing them to a change.
- **Documentation:** when behavior changes, update `apps/help-site/docs/`
  (and this file / `CLAUDE.md` for build or layout changes). Use the
  `toby-docs` skill.
- **Native UI work:** read [`DESIGN.md`](DESIGN.md) and use
  [`toby-design`](.agents/skills/toby-design/). Reuse `AppTheme`,
  `SettingsDesign`, and existing primitives. For windows, sidebars, Settings,
  or modal windows also use [`toby-native-window`](.agents/skills/toby-native-window/).
- **Commits:** use the `atomic-conventional-commit` skill.

## Skills

| Skill | When to use |
| ----- | ----------- |
| [`toby-docs`](.agents/skills/toby-docs/) | Any user-visible or contributor-doc change |
| [`atomic-conventional-commit`](.agents/skills/atomic-conventional-commit/) | Commits (`feat`/`fix`/`docs`/`refactor`/`test`/`chore`) |
| [`release-toby`](.agents/skills/release-toby/) | Releases (`release-it`, `VERSION`, signed DMG, Sparkle appcast) |
| [`toby-design`](.agents/skills/toby-design/) | Required for native UI work |
| [`toby-screenshot-docs`](.agents/skills/toby-screenshot-docs/) | Native UI screenshots for the help site |
| `resolve-github-issue` | End-to-end GitHub issue resolution |
| Swift pipeline (below) | SwiftUI/macOS reviews |
| Reference only: [`swiftui-pro`](.agents/skills/swiftui-pro/), [`swiftui-expert-skill`](.agents/skills/swiftui-expert-skill/), [`toby-native-window`](.agents/skills/toby-native-window/) | Deep SwiftUI topic refs, Instruments, window chrome |

## Swift review skills

```
swift-project-assessment          # context only — never nitpicks code
        │
        ▼
swiftui-architecture-review     # architecture + SwiftUI quality
        │
        ▼
toby-engineering-standards      # repo culture (ownership, tests, DS)
        │
        ▼
toby-swift-review               # orchestrator + findings aggregator
```

| Skill | Role |
| ----- | ---- |
| [`swift-project-assessment`](.agents/skills/swift-project-assessment/) | Conventions and feature boundaries; writes `.agents/context/swift-project-assessment.yaml` |
| [`swiftui-architecture-review`](.agents/skills/swiftui-architecture-review/) | State, performance, concurrency, navigation, a11y, maintainability |
| [`toby-engineering-standards`](.agents/skills/toby-engineering-standards/) | Ownership, design system, file size, DI, tests, logging, single-app policy |
| [`toby-swift-review`](.agents/skills/toby-swift-review/) | Runs the pipeline and aggregates findings |

Slash commands: `/toby-swift-review`, `/swift-project-assessment`,
`/swiftui-architecture-review`, `/toby-engineering-standards`.

## Release and CI

- `release.yml` (tags `v*`): builds `Toby.app`, signs (Sparkle, then app),
  notarizes, builds the DMG, and publishes `Toby-arm64.dmg` + `appcast.xml`.
  Its GitHub Pages job still publishes `appcast.xml` for builds ≤ v0.194.2
  (they read `https://kshehadeh.github.io/toby/appcast.xml`); v0.194.3+ read
  `https://www.tobyai.app/appcast.xml`, which Vercel redirects to the latest
  release asset.
- `e2e.yml`: Swift tests on every PR (selects Xcode first).
- Help site: Vercel project `toby-docs` deploys `main` when `apps/help-site/`
  changes (`apps/help-site/vercel.json`).
