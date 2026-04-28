---
name: atomic-conventional-commit
description: Creates feature-level and bug-level atomic git commits with Conventional Commit messages. Use when the user asks to commit changes, split mixed changes into multiple commits, or wants conventional commits (feat/fix/docs/refactor/test/chore) with clean staging.
---

# Atomic Conventional Commit

## Goal

Turn a working tree with changes into **small, reviewable, logically complete commits**, using **Conventional Commit** messages.

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

Identify **separable groups** by user-facing intent:
- **feat**: new capability
- **fix**: bug fix
- **docs**: documentation only
- **refactor**: internal restructure without behavior change
- **test**: tests only
- **chore/build/ci**: tooling/config/packaging

### 2) Make commits atomic (staging strategy)

- Prefer staging **whole files** when changes are cleanly separated by file.
- If multiple intents are mixed in one file, stage hunks with patch staging:

```bash
git add -p <path>
```

If patch-staging becomes messy or risky, stop and do one of:
- Rework the edit to separate concerns (move refactor into its own commit).
- Keep a single commit only if separation would create broken intermediate states.

### 3) Write a conventional commit message (why over what)

Rules:
- Imperative subject (“add”, “fix”, “remove”…)
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
- Proposed commit breakdown (1–N commits) with type/scope/subject
- Exact staging plan per commit
- Final `git status` summary after committing

