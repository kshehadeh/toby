---
name: atomic-conventional-commit
description: Creates feature-level and bug-level atomic git commits with Conventional Commit messages. Use when the user asks to commit changes, split mixed changes into multiple commits, or wants conventional commits (feat/fix/docs/refactor/test/chore) with clean staging.
---

# Atomic Conventional Commit

## Goal

Turn a working tree into **cohesive, reviewable commits**, using **Conventional Commit** messages. A commit should be atomic enough to be complete and understandable, but not split so finely that related changes end up in separate commits purely because they touch different files or types of files.

## When to split vs. combine

**Prefer a single commit when:**
- All changes relate to the same issue, task, or user-facing goal (e.g., one GitHub issue).
- The changes are naturally coupled: a feature, its tests, and the docs that describe it belong together.
- Splitting would create incomplete or misleading intermediate states.

**Prefer multiple commits when:**
- The working tree contains genuinely unrelated work (e.g., a bug fix and a new feature, or a refactor that stands on its own).
- A large change has clear, independent milestones that are useful to review separately.
- Mixing the changes would make the commit message incoherent or misleading.

A commit is atomic when it represents one logical, complete unit of work, not necessarily one file or one type of change.

## Commit message format

Use:

```
<type>(<scope>): <subject>

<body optional: why + key details>
```

Types: `feat`, `fix`, `docs`, `refactor`, `test`, `perf`, `chore`, `build`, `ci`, `style`.

## Workflow

### 1) Inspect the repo state (always)

Run these first:

```bash
git status --porcelain
git diff
git diff --staged
git log -n 10 --oneline
```

Identify **separable groups** by intent, not just file type:
- **feat**: new capability, plus the tests and docs that complete it
- **fix**: bug fix, plus related regression tests
- **docs**: documentation only
- **refactor**: internal restructure without behavior change (only split if it’s large and self-contained)
- **test**: tests only
- **chore/build/ci**: tooling/config/packaging

If changes are tied to one issue, treat them as one unit of work unless there is a strong reason to separate them.

### 2) Stage commits as cohesive units

- Prefer staging **whole files** when the files are part of the same logical change.
- If multiple unrelated intents are mixed in one file, stage hunks with patch staging:

```bash
git add -p <path>
```

If patch-staging becomes messy or risky, stop and do one of:
- Rework the edit to separate concerns (e.g., move an unrelated refactor into its own commit).
- Keep a single commit when the changes are still part of one issue or goal.

Do not split a single issue into separate commits just because the diff touches multiple packages, files, or concerns, unless those concerns are independently meaningful.

### 3) Write a conventional commit message (why over what)

Rules:
- Imperative subject ("add", "fix", "remove"…)
- Subject <= ~50 chars when possible
- Body explains **why** / constraints / behavior changes
- Include scope when it adds clarity (module/package/area)

Examples:

```
feat(chat): cache pretreatment results by prompt

Skip repeated pretreatment calls by persisting successful specs in SQLite.
```

```
fix(ui): treat literal newline input as Shift+Enter

Some terminals emit Shift+Enter as a raw newline without shift flags.
```

Example of a single commit spanning multiple concerns for one issue:

```
feat(auth): add password reset flow

Add the password reset endpoint, UI form, and integration tests.
Closes #123.
```

### 4) Commit safely

- Never commit secrets (`.env`, tokens, credentials dumps).
- Don’t use destructive git commands (force push, hard reset) unless explicitly requested.
- Avoid `--no-verify` unless explicitly requested.
- Avoid `git commit --amend` unless explicitly requested and safe (not pushed; created in this session).

Create the commit message via a heredoc to preserve formatting:

```bash
git commit -m "$(cat <<'EOF'
type(scope): subject

Body (optional).
EOF
)"
```

### 5) Verify after each commit

```bash
git status
git show --stat
```

Repeat steps 2–5 until the working tree matches the intended final state.

## Output expectations

When asked to “commit my changes”, respond with:
- Proposed commit breakdown (1–N commits) with type/scope/subject and why each is one logical unit
- Exact staging plan per commit
- Final `git status` summary after committing
