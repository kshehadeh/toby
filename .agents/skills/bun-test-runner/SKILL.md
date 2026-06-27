---
name: bun-test-runner
description: Describes how to write JavaScript/TypeScript tests in the Toby monorepo using Bun's native test runner. Use when creating new test files or reviewing existing ones.
---

# Writing Tests with Bun

All tests in the Toby monorepo use **Bun's native test runner** (`bun:test`). Tests run under the same runtime as production, so `bun:sqlite` and other Bun-native APIs are available.

## Basics

### Import test APIs from `bun:test`

```typescript
import { describe, expect, it, beforeEach, afterEach } from "bun:test";
```

Use `describe` for grouping and `it` for individual tests. `expect` supports `.toBe`, `.toEqual`, `.toHaveLength`, `.toMatch`, `.toContain`, `.toBeGreaterThan`, `.toBeLessThan`, `.toBeDefined`, `.toBeNull`, `.toBeTruthy`, `.toBeFalsy`, `.toMatchObject`, `.rejects.toMatchObject`, and `.toThrow`.

### Basic test structure

```typescript
import { describe, expect, it } from "bun:test";

describe("feature name", () => {
  it("does the expected thing", () => {
    expect(doSomething()).toBe(42);
  });
});
```

### Async tests

```typescript
it("handles async operations", async () => {
  const result = await fetchData();
  expect(result).toEqual({ ok: true });
});
```

### Skipping tests conditionally

```typescript
function canUseBunSqlite(): boolean {
  try {
    require("bun:sqlite");
    return true;
  } catch {
    return false;
  }
}

it.skipIf(!canUseBunSqlite())("uses SQLite", () => {
  // test code
});
```

## Mocking

### Mocking functions with `mock()`

```typescript
import { mock, expect } from "bun:test";

const myMock = mock(() => "result");
expect(myMock()).toBe("result");
expect(myMock).toHaveBeenCalledTimes(1);
```

### Mocking modules with `mock.module()`

Use `mock.module()` to replace module imports. The factory must be synchronous.

```typescript
import { mock } from "bun:test";
import * as actual from "./real-module";

mock.module("./real-module", () => ({
  ...actual,
  someFunction: () => "mocked"
}));
```

For modules mocked by many test files, create a shared helper in `tests/helpers/`:

```typescript
// tests/helpers/setup-ai-mocks.ts
import { mock } from "bun:test";
import * as actualAi from "ai";

export const generateTextMock = mock((..._args: unknown[]) =>
  Promise.resolve({})
);

mock.module("ai", () => ({
  ...actualAi,
  generateText: (...args: unknown[]) => generateTextMock(...args),
}));
```

Then import it at the top of each test file that needs it:

```typescript
import "./helpers/setup-ai-mocks";
```

### Spying on object methods with `spyOn()`

```typescript
import { spyOn, afterEach, jest } from "bun:test";

afterEach(() => {
  jest.restoreAllMocks();
});

it("tracks calls", () => {
  spyOn(console, "log", () => {});
  console.log("hello");
  expect(console.log).toHaveBeenCalledTimes(1);
});
```

**Important**: `spyOn` does not auto-clear between tests. Always add `afterEach(() => jest.restoreAllMocks())` when using spies.

### Direct property mutation for class instances

When `spyOn` does not reliably intercept cross-module calls on class instances, mutate the property directly and restore it manually:

```typescript
it("replaces behavior", () => {
  const original = instance.method;
  instance.method = () => ({ status: "mocked" });
  // ... test ...
  instance.method = original;
});
```

### Global mutation

```typescript
const originalFetch = globalThis.fetch;
globalThis.fetch = mock(() => Promise.resolve({ ok: true }));
// ... test ...
globalThis.fetch = originalFetch;
```

## Timers

### Fake timers

```typescript
import { beforeEach, afterEach, jest } from "bun:test";

beforeEach(() => {
  jest.useFakeTimers();
});

afterEach(() => {
  jest.useRealTimers();
});
```

### Advancing timers

```typescript
jest.advanceTimersByTime(50);
```

### Running all timers

```typescript
jest.runAllTimers();
await Promise.resolve(); // let microtasks flush
```

### Waiting for async conditions

Bun:test does not have a `waitFor` helper. Use a simple polling function:

```typescript
async function waitFor(assertion: () => void, timeoutMs = 500): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  let lastError: Error | undefined;
  while (Date.now() < deadline) {
    try {
      assertion();
      return;
    } catch (err) {
      lastError = err as Error;
      await new Promise((r) => setTimeout(r, 10));
    }
  }
  throw lastError ?? new Error("waitFor timeout");
}
```

## Environment and temp directories

### Temporary directories

```typescript
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "toby-test-"));
try {
  // test code
} finally {
  fs.rmSync(dir, { recursive: true, force: true });
}
```

### Isolating config with `TOBY_DIR`

```typescript
function withTempTobyDir(run: () => void | Promise<void>): Promise<void> {
  const previous = process.env.TOBY_DIR;
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "toby-test-"));
  process.env.TOBY_DIR = dir;
  return Promise.resolve()
    .then(run)
    .finally(() => {
      if (previous === undefined) {
        Reflect.deleteProperty(process.env, "TOBY_DIR");
      } else {
        process.env.TOBY_DIR = previous;
      }
      fs.rmSync(dir, { recursive: true, force: true });
    });
}
```

### Environment variable cleanup

Always restore `process.env` values in a `finally` block:

```typescript
const prev = process.env.TOBY_SOME_FLAG;
process.env.TOBY_SOME_FLAG = "1";
try {
  expect(isFeatureEnabled()).toBe(true);
} finally {
  if (prev === undefined) {
    process.env.TOBY_SOME_FLAG = undefined;
  } else {
    process.env.TOBY_SOME_FLAG = prev;
  }
}
```

## Database-dependent tests

Tests that depend on `bun:sqlite` should conditionally skip when unavailable, or use `withTempTobyDir` to create an isolated database per test.

## What NOT to do

- **Don't** import from `"vitest"`
- **Don't** use `jest.fn()` or `jest.spyOn()` - Bun uses `mock()` and `spyOn()` from `bun:test`
- **Don't** assume mocks auto-clear between tests - always add cleanup
- **Don't** use `await jest.runAllTimersAsync()` - use `jest.runAllTimers()` + `await Promise.resolve()` instead
- **Don't** create `mock.module()` factories that return Promises - they must be synchronous
