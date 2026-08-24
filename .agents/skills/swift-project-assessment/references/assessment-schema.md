# Assessment artifact schema

Path: `.agents/context/swift-project-assessment.yaml`

Keep the document small and scannable. Prefer bullet lists over prose.

```yaml
# Metadata
source: swift-project-assessment
assessed_at: YYYY-MM-DD
target: apps/toby-app
confidence: high | medium | low   # overall confidence of this snapshot

Project:
  Name: Toby.app
  Kind: <one line>
  Architecture: <pattern label>
  Deployment_Target: macOS 26
  Swift: "6.0"                    # from Package.swift tools version / practice
  Observation: "@Observable + @State ownership"
  Navigation: <summary>
  Persistence: <summary>
  Dependency_Injection: <summary>
  Networking: <summary>
  Frameworks:
    - SwiftUI
    - AppKit (where needed)
    - ...
  Third_Party:
    - Sparkle
    - ViewInspector (tests)

Repository_Conventions:
  - <bullet>
  - <bullet>

Feature_Boundaries:
  App: Sources/TobyApp/App
  Features: Sources/TobyApp/Features/*
  Stores: Sources/TobyApp/Stores
  UI: Sources/TobyApp/UI
  Native: Sources/TobyApp/Native
  Models: Sources/TobyApp/Models
  Tests: Tests/TobyAppTests
  Intentional_Patterns:
    - <pattern and where it shows up>

Potential_Risks:
  - <structural risk only>

Review_Guidance:
  Prefer:
    - <what reviewers should lean into>
  Ignore:
    - <advice that is wrong for this repo>
  Validate_Against:
    - <design system, window skill, docs>

Related_Skills:
  windows: toby-native-window
  swiftui_refs:
    - swiftui-expert-skill
    - swiftui-pro
  engineering: toby-engineering-standards
  orchestrator: toby-swift-review
```

## Field rules

| Field | Rule |
| --- | --- |
| `Architecture` | Name the real pattern; avoid forcing MVVM if stores + views are the practice |
| `Observation` | Be explicit about wrappers and ownership |
| `Ignore` | Prevent false positives from generic iOS/SwiftUI advice |
| `Potential_Risks` | No file:line nits; structural only |
| `Feature_Boundaries` | Paths relative to `apps/toby-app/` when possible |
