---
name: bun-test-runner
description: Ensures all JavaScript/TypeScript tests run under Bun's native test runner (bun:test). Use when writing new tests, migrating from vitest, or troubleshooting test failures.
---

# Bun Test Runner

## Goal

All TypeScript/JavaScript tests in the Toby monorepo must use **Bun's native test runner** (`bun:test`), not vitest. This ensures:

- Tests run under the same runtime as production (Bun)
- `bun:sqlite` and other Bun-native APIs are available in tests
- No ESM/CJS interop issues between vitest and Bun

## Correct Configuration

### Package.json scripts

```json
{
  "scripts": {
    "test": "bun test",
    "test:watch": "bun test --watch"
  }
}
```

### Test file imports

All test files must import from `bun:test`:

```typescript
import { describe, expect, it, mock, spyOn, jest } from "bun:test";
```

### Mock cleanup

Unlike vitest, Bun does **not** automatically clear mocks between tests. Add this to files using `spyOn` or `mock`:

```typescript
import { afterEach, jest } from "bun:test";

afterEach(() => {
  jest.restoreAllMocks();
});
```

### API mappings from vitest to bun:test

| vitest | bun:test |
|--------|----------|
| `import { ... } from "vitest"` | `import { ... } from "bun:test"` |
| `vi.fn()` | `mock()` |
| `vi.spyOn(obj, "method")` | `spyOn(obj, "method")` |
| `vi.useFakeTimers()` | `jest.useFakeTimers()` |
| `vi.useRealTimers()` | `jest.useRealTimers()` |
| `vi.setSystemTime(date)` | `jest.setSystemTime(date)` |
| `vi.advanceTimersByTime(ms)` | `jest.advanceTimersByTime(ms)` |
| `vi.stubGlobal("fetch", fn)` | `globalThis.fetch = fn` (manual restore) |
| `vi.stubEnv("KEY", "val")` | `process.env.KEY = "val"` (manual restore) |
| `vi.mock("module", () => ...)` | `mock.module("module", () => ...)` |
| `vi.hoisted(() => ...)` | Not available; restructure mocks |
| `vi.importOriginal()` | Pre-import module and spread in mock factory |
| `vi.waitFor(fn)` | Not available; use polling or delays |
| `vi.runAllTimersAsync()` | Not available; use `jest.runAllTimers()` + `await Promise.resolve()` |

## Module mocking with `mock.module()`

Bun supports `mock.module()` for replacing module imports:

```typescript
import { mock } from "bun:test";
import * as actual from "./real-module";

mock.module("./real-module", () => ({
  ...actual,
  someFunction: () => "mocked"
}));
```

**Limitations:**
- Factory must be synchronous (no async `importOriginal` equivalent)
- For partial mocks, pre-import the actual module and spread it

## Timer mocking

```typescript
import { beforeEach, afterEach, jest } from "bun:test";

beforeEach(() => {
  jest.useFakeTimers();
});

afterEach(() => {
  jest.useRealTimers();
});
```

## CI Configuration

```yaml
# .github/workflows/ci.yml
- name: Setup Bun
  uses: oven-sh/setup-bun@v1
  with:
    bun-version: latest

- name: Run tests
  run: bun test
```

## Verification

Add this test to verify the runtime:

```typescript
import { describe, it, expect } from "bun:test";

describe("runtime verification", () => {
  it("runs under Bun", () => {
    expect(typeof Bun).toBe("object");
    expect(typeof Bun.version).toBe("string");
  });

  it("can import bun:sqlite", () => {
    expect(() => {
      require("bun:sqlite");
    }).not.toThrow();
  });
});
```

## What NOT to do

- **Don't** import from `"vitest"` in new or migrated tests
- **Don't** use `vi.mock()` - use `mock.module()` instead
- **Don't** use `vi.hoisted()` - restructure test setup
- **Don't** use `vi.waitFor()` or `vi.runAllTimersAsync()` - they're vitest-specific
- **Don't** assume mocks auto-clear between tests - use `jest.restoreAllMocks()`
