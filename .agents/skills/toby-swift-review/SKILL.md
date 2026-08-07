---
name: toby-swift-review
description: >
  Orchestrate the Toby Swift/macOS review pipeline: Project Assessment → SwiftUI
  Architecture Review → Engineering Standards → aggregated findings. Use for full
  Toby.app reviews, PR sweeps of apps/toby-app, or when the user runs /toby-swift-review
  or asks for a comprehensive SwiftUI/macOS code review of this repo.
---

# Toby Swift Review (pipeline)

## Goal

Run the **multi-skill review harness** so each stage stays single-purpose and low-noise:

```
swift-project-assessment
        │
        ▼
swiftui-architecture-review
        │
        ▼
toby-engineering-standards
        │
        ▼
   Findings Aggregator (this skill)
```

Specialist skills you may invoke when the scoped change needs them:

- `toby-native-window` — new/changed windows
- `swiftui-expert-skill` — Instruments traces, deep topic refs
- `toby-docs` — user/dev docs after behavior changes

Future optional splits (not separate skills yet; covered as dimensions inside
architecture review): State, Performance, Concurrency, Accessibility. Prefer
extending `swiftui-architecture-review` with focused sub-passes before adding
new skill folders.

## When to use

| Request | Pipeline |
| --- | --- |
| Full / comprehensive Swift review | Full pipeline |
| “Review my SwiftUI changes” | Architecture + Standards (refresh assessment if stale) |
| “What is this app’s architecture?” | Assessment only |
| Window-only change | Assessment (if needed) → `toby-native-window` + Standards S6 |
| Org hygiene only | Standards only |

## Stage 0 — Scope

Establish review scope once:

1. Uncommitted / staged diff under `apps/toby-app`, or
2. Branch/PR diff, or
3. Named paths/features the user provided

Record scope in the final report header. Ignore pure TypeScript unless the user
explicitly asked about ownership boundaries (S1/S11).

## Stage 1 — Project Assessment

Skill: **`swift-project-assessment`**

1. If `.agents/context/swift-project-assessment.yaml` is missing, or `assessed_at`
   is older than 30 days, or the scoped change edits `Package.swift` / top-level
   app layout, **run the assessment skill** (update the YAML).
2. Otherwise **load the existing artifact** and do not rediscover the monorepo.
3. Carry forward `Review_Guidance` into later stages.

Assessment must remain **nitpick-free**.

## Stage 2 — SwiftUI Architecture & Anti-Pattern Review

Skill: **`swiftui-architecture-review`**

1. Assume assessment is loaded.
2. Review only scoped SwiftUI/app code against architecture + framework best practices.
3. Collect findings with severity and dimension labels.
4. Do not enforce file-size quotas or naming matrices here.

Load deep references from `swiftui-pro` / `swiftui-expert-skill` only as needed.

## Stage 3 — Engineering Standards

Skill: **`toby-engineering-standards`**

1. Apply S1–S11 to the same scope.
2. Skip restating architecture-review SwiftUI findings.
3. Include test, design-system, ownership, and docs obligations.

## Stage 4 — Findings Aggregator

Merge stages 2–3 into one report. Deduplicate overlapping items (keep the richer
write-up; tag both dimension and standard ID when both apply).

### Report template

```markdown
# Toby Swift Review

**Scope:** …
**Assessment:** .agents/context/swift-project-assessment.yaml (assessed_at: …)
**Stages run:** Assessment (refresh|cache) · Architecture · Standards

## Blockers
- …

## Major
- …

## Minor
- …

## Notes / waivers
- …

## Summary
- Top 3 actions
- Assessment Ignore guidance honored: …
- Follow-ups: docs (toby-docs)? windows (toby-native-window)? Instruments?
```

Ordering within a severity band: architecture/correctness first, then standards,
then polish.

## Operating rules

- **Do not** expand into implementing fixes unless the user asked to fix.
- **Do not** re-run generic `swiftui-pro` as a fourth full pass; architecture review
  already routes into those references.
- Keep each stage’s token budget focused: assessment = structure only;
  architecture = code quality; standards = culture.
- If scope is empty (no Swift changes), say so and stop after stage 0.

## Slash commands

| Command | Effect |
| --- | --- |
| `/toby-swift-review` | Full pipeline for current scope |
| `/swift-project-assessment` | Stage 1 only |
| `/swiftui-architecture-review` | Stage 2 only (requires assessment) |
| `/toby-engineering-standards` | Stage 3 only |

## Related paths

| Path | Role |
| --- | --- |
| `.agents/context/swift-project-assessment.yaml` | Shared context artifact |
| `.agents/skills/swift-project-assessment/` | Stage 1 |
| `.agents/skills/swiftui-architecture-review/` | Stage 2 |
| `.agents/skills/toby-engineering-standards/` | Stage 3 |
| `.agents/skills/toby-native-window/` | Window specialist |
| `.agents/skills/swiftui-pro/` | Framework reference library |
| `.agents/skills/swiftui-expert-skill/` | Framework reference + Instruments |
