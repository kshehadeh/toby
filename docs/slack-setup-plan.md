# Slack setup wizard and app provisioning plan

Status: native wizard implemented; provisioning API spike remains proposed. Researched 2026-10-04. This document records the design and remaining work. The wizard is in the workspace; it has not been released.

## Recommendation

Deliver a native Slack wizard first, with manifest-assisted creation of a
user-owned Slack app and verified inbound setup. Investigate optional API
provisioning separately. Do not make the wizard depend on Slack partner access
or a hosted Toby service.

Slack apps are installed into workspaces, with user and/or bot authorizations;
creating an app and installing an existing app are separate operations.

## Starting point before the wizard

- `VercelAIGatewaySetupWizardView.swift` is the shared AI wizard entry point,
  with a two-column sheet, explicit steps, browser authorization, inline errors,
  connection testing, and a completion screen. `AISetupStore.swift` owns its
  lifecycle; `AISetupOAuthSession.swift` owns browser authorization state.
- `IntegrationSetupWizardView.swift` displays all instructions and credentials
  together. Slack's `handleSetupGuide` in `apps/plugin-slack/src/cli.ts` guides
  users through creating an app from scratch, OAuth credentials, and connection.
  It omits a dedicated inbound token and Socket Mode verification sequence.
- `apps/plugin-slack/src/auth.ts` uses localhost PKCE with user scopes. It
  returns a user token in the normal flow, not the inbound bot/app token pair.
- `getSlackInboundCredentials` requires bot and app-level tokens. Ordinary chat
  readiness is separate and currently does not prove inbound readiness.
- `apps/help-site/static/slack-app-manifest.json` already provides a starting
  manifest, but its scopes differ from `OAUTH_USER_SCOPES` and it should explicitly
  configure the App Home messages experience for supported DMs.
- Earlier work in this thread corrects startup errors being reported as connected.
  Retain that fix and extend lifecycle reporting for runtime disconnects/exits.

## Track 1: native wizard

Use the AI wizard's presentation and behavior, with a dedicated
`SlackSetupWizardView` and `@Observable @MainActor SlackSetupStore`. Reuse native
controls, `AppTheme`, `SettingsDesign`, secure fields, and `InlineStatusMessage`.
Keep the existing Settings window and generic setup fallback for other plugins.
Avoid a general-purpose wizard framework unless concrete shared code warrants it.

Proposed steps:

1. **Choose what to connect.** Default to Slack tools plus inbound DMs/@mentions;
   offer tools only. Explain that search requires user authorization. Offer
   “Use an existing Slack app” for configured users.
2. **Create the Toby app.** Open Slack's manifest-prefilled creation URL. The
   user chooses the workspace and reviews permissions. Show a compact explanation
   of requested access and a copy/download manifest fallback. Existing-app users
   skip creation; do not overwrite their manifest automatically.
3. **Install and add credentials.** Guide installation into the workspace, then
   collect the bot token (`xoxb-…`). For inbound, show the exact Basic Information
   → App-Level Tokens path and collect `xapp-…` with `connections:write`. Capture
   app ID when available for direct settings links. Detect bot identity through
   `auth.test` rather than requiring manual Bot User ID entry.
4. **Authorize search and user tools.** For the full user-tool feature set,
   collect the app's Client ID and run the existing user PKCE flow. Skip for
   bot-only use; communicate which tools remain unavailable. Audit the current
   Client Secret requirement: public-client PKCE exchange does not send it.
5. **Verify and enable inbound.** Validate credentials, show workspace/bot
   identity, and surface missing permissions precisely. Ask for persona and
   explicit inbound enablement; make clear if another active provider will be
   replaced. Save verified credentials through core helpers and reload inbound.
6. **Try it in Slack.** Wait for actual transport readiness and offer a DM or
   channel @mention test. Show “Connected; waiting for a test message” until an
   event arrives; mark end-to-end verified only after Toby processes and replies.
   Allow finishing without the message test with its unverified state visible.

Connection and verification must be distinct: token presence, API authentication,
Socket Mode ready, received event, and delivered reply are separate results.
A token API probe alone cannot prove event subscriptions or reply delivery.
Do not silently send a test message; make a “Send test” action explicit if added.

State and recovery:

- Back/Next, browser reopen, cancel, bounded timeouts, retry at the failed step.
- Recover after cancellation or restart from persisted app/workspace IDs and
  completed configuration, not raw tokens in UserDefaults.
- Keep credential drafts in memory and persist verified stages deliberately.
  Mask existing credentials; do not replace them with redaction placeholders.
- Preserve existing successful tools access if inbound setup fails.
- Handle app approval required, denied OAuth, expired/revoked tokens, missing
  scopes, mismatched workspace/app credentials, unavailable daemon, and dropped
  Socket Mode transport. Where app identity cannot be verified via supported
  APIs, rely on the explicit event test rather than claiming validation.

Implementation boundaries:

- **Plugin:** manifest generation, Slack API checks, OAuth, app/token identities,
  Slack-specific setup steps and structured errors under `apps/plugin-slack/`.
- **Core:** generic setup-session orchestration, cancellation, credential/state
  persistence, configuration changes, inbound reload and lifecycle status.
- **Native app:** sheet, navigation, secure input, browser opening, polling and
  completion UI. Use daemon APIs; do not access TypeScript core directly.
- Inspect existing guide/status/connect routes first. Extend the plugin setup
  protocol additively for validation/provision actions and structured results
  only where existing commands cannot support the workflow. Keep CLI commands
  generic and the plugin backward compatible.
- Introduce one authoritative plugin manifest generator shared by the creation
  link and published help-site manifest. Audit scopes against actual tools;
  distinguish user-tool scopes from bot/inbound scopes and test against drift.

## Implementation checkpoint

Implemented the native wizard, canonical manifest, staged credential checks and
save, cancellable asynchronous setup, OAuth state/loopback/timeout hardening,
inbound enablement and event/reply verification. User-owned apps still need
installation approval and manually generated bot/app tokens. Existing-app
manifest compatibility is guided, not automatically inspected or overwritten.
The wizard preserves choices but deliberately revalidates credentials on resume.
No live-workspace provisioning or real Slack message test was performed during
implementation. The API spike below needs a development workspace and explicit
configuration credentials; ordinary user OAuth cannot substitute for them.

## Track 2: app provisioning research

| Approach | What it enables | Requirement / limitation | Recommendation |
| --- | --- | --- | --- |
| Prefilled manifest link | Preconfigures a new user-owned app | User reviews creation, installation, and token generation | Ship with wizard |
| Manifest API | Creates/updates an app and returns app ID, credentials, authorization URL | Separate app configuration token; existing user OAuth token is insufficient | Optional local automation spike |
| Manager app | Creates managed child apps and requests installation | Slack partner access; `managed_apps:install` is unavailable for ordinary developers | Investigate eligibility; do not assume access |
| One Toby-owned distributed app | OAuth installs an existing app with bot/user grants | Hosted OAuth and inbound routing design; desktop PKCE cannot request bot scopes | Longer-term product architecture option |

### Local Manifest API spike

In a disposable development workspace, with explicitly supplied configuration
credentials:

1. Validate the manifest and call `apps.manifest.create` once.
2. Inspect the actual response and retain app ID plus returned credentials via
   the core's encrypted credential path. Do not log them.
3. Open the returned authorization URL and confirm the installation/token flow
   compatible with our desktop architecture.
4. Determine whether any generally available supported API supplies the needed
   `xapp` token. The public create response documents app credentials and an
   authorization URL, but does not document an app-level token. Keep manual
   generation as the planned fallback; do not infer support from error codes.
5. Assess whether this improves setup given the extra configuration-token step.
   Configuration tokens can manage the user's apps across a workspace, expire
   after 12 hours, and have refresh tokens. Prefer transient use and discard
   after provisioning unless ongoing management is explicitly requested.
6. Track provisioning intent and created app ID to avoid duplicate apps after
   retries. Reconcile ambiguous network failures before retrying creation.
   Cancellation preserves the created app and offers a settings link; no
   automatic deletion or mutation of an existing app.

Deliverable: supported API/permission matrix, recorded redacted responses,
working sandbox proof, remaining manual steps, and a go/no-go recommendation.
This spike must not provision anything in the user's live workspace as part of
planning.

### Shared app / hosted OAuth option

A Toby-owned app can be installed through normal OAuth without each user
creating an app. Bot authorization needs a flow allowed to request bot scopes;
Toby's current localhost public-client PKCE flow cannot do so. A hosted HTTPS
OAuth broker is one option, requiring secure device handoff, state validation,
rotation, revocation, workspace/install storage, and service operation.

Do not distribute a shared `xapp` token to desktops. Slack Socket Mode supports
up to ten concurrent connections per app and can dispatch any payload to any
connection. Independent user Macs connecting to one shared app therefore cannot
serve as correctly isolated installation listeners. A shared-app design needs
central event ingestion and authenticated routing to the intended Toby instance,
with an explicit policy for multiple users/devices and offline machines.

If pursuing manager apps instead, first obtain confirmation from Slack about
eligibility, granted scopes, app-token issuance, installation behavior, limits,
and admin approval. This route may preserve user-owned local transport but is
not a capability we can currently promise.

## Delivery sequence and acceptance

1. **Contract and manifest:** scope audit, structured tools/inbound checks,
   canonical manifest, and resumable setup states.
2. **Wizard:** implement manifest-assisted and existing-app paths, browser flow,
   staged credential validation, persona selection and inbound reload.
3. **End-to-end verification:** receive/reply test, reliable failure/disconnect
   status, partial completion and retries.
4. **Automation spike:** configuration-token route and partner eligibility;
   select architecture only after results and product preference are known.

Acceptance checks:

- A new user completes bot/inbound setup without manually entering scopes or
  event names; tools-only setup never requires an app-level token.
- Existing installations remain usable and can resume only the missing steps.
- Missing `xapp`, invalid bot token, wrong workspace, denied approval, missing
  scopes and failed transport never appear as fully verified success.
- OAuth validates state, binds its callback to loopback, supports cancellation
  and timeout, and keeps secrets out of URLs/logs except Slack-prescribed OAuth
  parameters. These are requirements to audit in the current implementation.
- Bun tests cover manifest/schema drift, scope selection, credential validation,
  setup session state, cancellation, retries and secret redaction. Swift tests
  cover navigation, partial success and error states. Run lint, typecheck, TS
  tests, Swift tests and a native build for implementation changes.
- Manually verify in a development Slack workspace: fresh install, existing app,
  tools-only, DM, channel mention, thread follow-up and reconnect. Verify keyboard,
  VoiceOver, light/dark appearance and Reduce Motion for the sheet.
- Update `docs/chat-inbound.md`, `docs/plugin-protocol.md` if extended, and
  help-site Slack/inbound setup guides; refresh screenshots after shipping UI.

## Source findings (official Slack documentation)

- [Manifest creation and prefilled links](https://docs.slack.dev/app-manifests/configuring-apps-with-app-manifests/): creation links and configuration-token API workflow.
- [apps.manifest.create](https://docs.slack.dev/reference/methods/apps.manifest.create/): required configuration token and documented response.
- [PKCE restrictions](https://docs.slack.dev/authentication/using-pkce/): desktop redirects cannot request bot scopes; public-client exchange omits client secret.
- [Manager installation scope](https://docs.slack.dev/reference/scopes/managed_apps.install/): partner-only managed app installation and admin approval constraints.
- [OAuth installation](https://docs.slack.dev/authentication/installing-with-oauth/): installing an existing app with requested grants.
- [Socket Mode](https://docs.slack.dev/apis/events-api/using-socket-mode/): app-level token setup, connection limits and payload distribution.
