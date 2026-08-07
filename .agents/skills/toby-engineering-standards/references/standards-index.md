# Standards index (quick)

| ID | Name | Typical signals |
| --- | --- | --- |
| S1 | Module ownership | Feature file imports EventKit directly; harness logic in view |
| S2 | Design system | Raw RGB; custom settings row reinventing SettingsCard |
| S3 | DI consistency | New `.shared` singleton; store created deep in leaf view |
| S4 | File size & cohesion | File >1000 lines growing; unrelated types in one file |
| S5 | Naming | `chat_view`, mislocated feature files |
| S6 | Windows | Window not in TobyApp.swift; Settings TabView |
| S7 | Tests | New UI without tests; suite not @MainActor; find(viewWithId:) only |
| S8 | Logging | `print` for errors; secrets in logs |
| S9 | Security | Token in source; credentials in UserDefaults |
| S10 | Docs | Behavior change, no docs/help-site update |
| S11 | Monorepo / plugins | Swift plugin scaffold; core built-in integration module |

## Severity defaults

| ID | Default severity when violated in new code |
| --- | --- |
| S1, S9, S11 | blocker or major |
| S2, S6, S7 | major |
| S3, S4, S5, S8, S10 | major or minor depending on blast radius |
