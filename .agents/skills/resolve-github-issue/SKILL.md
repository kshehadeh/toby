---
name: resolve-github-issue
description: >-
  Resolve a GitHub issue end-to-end. Takes an issue number, uses gh to retrieve
  issue details, explores the codebase for relevant areas, asks clarifying
  questions when the issue lacks detail, and builds an implementation plan in
  spec mode. Use when the user asks to resolve, fix, implement, or address a
  GitHub issue.
---

# Resolve GitHub Issue

## Goal

Take a GitHub issue number, understand the problem deeply, fill in any missing
detail by asking the user, and produce a concrete implementation plan in spec
mode that is ready for execution.

## Inputs

The user provides an **issue number** (e.g. `resolve issue 42`, `fix #128`,
`implement #7`). If no number is given, ask the user for it before proceeding.

## Workflow

### 1. Retrieve the issue

Use the `gh` CLI to fetch the issue, its comments, labels, and linked items:

```bash
gh issue view <number> --json number,title,body,labels,assignees,state,comments,milestone,subIssuesSummary
```

Also fetch any sub-issues if present:

```bash
gh issue list --search "linked:<number>" --state all --json number,title,state
```

Read the full issue body and all comments carefully. Summarize:
- **What** is being requested
- **Why** it matters (motivation, user impact)
- **Constraints** mentioned (performance, compatibility, dependencies)
- **Acceptance criteria** or success conditions, if any

### 2. Assess detail sufficiency

Evaluate whether the issue has enough detail to build an implementation plan.
Check for:

| Detail needed | Why |
| ------------- | --- |
| Clear problem statement | Cannot plan without knowing what to solve |
| Expected behavior or acceptance criteria | Needed to know when the work is done |
| Affected area / component hint | Directs codebase exploration |
| Constraints or non-goals | Prevents scope creep and wrong approaches |
| Related issues / PRs / discussions | Provides context and prior decisions |

**If the issue is sufficiently detailed**, proceed to step 3.

**If the issue is missing critical detail**, use the `AskUser` tool to ask
focused multiple-choice questions. Keep the questionnaire concise (1-4
questions). Include context from the issue in the question text so the user
understands what they are choosing. Examples of good questions:

- Which approach should I use for [the problem]?
- Which component area should this target?
- Are there constraints I should know about (backward compat, performance)?
- Should this include tests and docs, or implementation only?

Do not ask questions the issue already answers. Do not ask open-ended questions
in plain text; always use `AskUser`.

### 3. Explore the codebase

Based on the issue area and any answers from the user, explore the relevant
parts of the codebase:

- Read `AGENTS.md` for project orientation and conventions.
- Use `Grep`, `Glob`, and `LS` to find relevant files, patterns, and existing
  implementations.
- Identify the files that will need to change and any new files to create.
- Note existing patterns and conventions to follow (imports, testing, styling).
- Check for existing tests related to the area.

### 4. Build the implementation plan (spec mode)

While in spec mode, synthesize everything into a concrete plan:

- **Summary**: one-sentence description of the change.
- **Files to modify/create**: list with brief rationale per file.
- **Implementation steps**: ordered, concrete steps that another agent or
  developer could follow.
- **Testing plan**: which test files to add/update and what to verify.
- **Risks / edge cases**: anything that could go wrong or needs special care.
- **Key code snippets**: minimal snippets illustrating the approach where
  helpful (e.g., a function signature, a type definition, a config change).

Present the plan via `ExitSpecMode`. The plan must be concise and actionable,
not a stream of consciousness.

### 5. After approval

Once the user approves the plan (spec mode exits), implement it following the
project's conventions:

- Follow patterns found during codebase exploration.
- Run `bun run lint`, `bun run typecheck`, and `bun run test` after substantive
  changes (adjust commands to match the project's actual scripts).
- Use `bun run test:swift` for Swift/Toby app changes.
- Commit using Conventional Commit format (see the `atomic-conventional-commit`
  skill).
- Reference the issue number in the commit message (e.g., `Closes #42`).

## Common mistakes

- Skipping issue comments — prior discussion often contains decisions or
  clarifications that change the approach.
- Asking the user questions that the issue body already answers.
- Producing a vague plan ("improve the UI") instead of a concrete one
  ("add a `RefreshButton` to `ChangelogView.swift` and wire it to
  `ChangelogStore.reload()`").
- Ignoring existing codebase patterns and inventing new ones.
- Forgetting to verify with lint/typecheck/test before declaring done.
