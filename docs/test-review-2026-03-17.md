# Test Suite Review — 2026-03-17

## Overview

**Test Framework**: Node.js built-in `node:test` module with `node:assert/strict`
**TypeScript Execution**: `tsx` (no transpile step required)
**Discovery**: `find ./test -type f -name '*.test.ts' | sort`
**Total Test Files**: 19 active + 2 new untracked (`task.test.ts`, `test/ralph-shell.test.ts`)

---

## Test Files at a Glance

| File | Tests | Focus |
|------|-------|-------|
| `config.test.ts` | 22 | Config loading, YAML parsing, CLI override merging |
| `discuss-command.test.ts` | 3 | Discuss command flow, failed story collection |
| `discuss.test.ts` | ~9 groups | Failure parsing, plan extraction, session execution |
| `guidance.test.ts` | 11 | Guidance file save/load/format |
| `helpers.ts` | — | Shared utilities (ExitSignal, mockProcessExit) |
| `init.test.ts` | 8 | Init prompt generation, phase gates |
| `logs.test.ts` | 3 | Tail filtering, wave block extraction |
| `plan.test.ts` | 3 | Unplanned epic collection, plan prompt |
| `ralph-shell.test.ts` | 2+ | Shell script path/pattern validation |
| `reset.test.ts` | 2 | Epic reset to pending |
| `resume.test.ts` | 6 | State file validation, ralph.sh re-invocation |
| `run-stats.test.ts` | 52 | Cost calc, stat aggregation, persistence |
| `run.test.ts` | 11 | PRD validation, backend CLI checks, ralph.sh invocation |
| `stats.test.ts` | 1 | Placeholder — command currently disabled |
| `summary.test.ts` | 12 | Wave parsing from progress.txt |
| `task.test.ts` | 3 | Task command: planning vs execution prompts |
| `time-utils.test.ts` | 8 | Duration formatting edge cases |
| `token-parser.test.ts` | 15 | Token log parsing, dedup, backend fallback |
| `validate.test.ts` | 18 | PRD schema, dependency cycles, duplicate IDs |

---

## Patterns and Conventions

### Dependency Injection
Commands accept a `deps` object rather than calling I/O directly:
```ts
runCommand(prdPath, options, { spawnSync, fs, exit })
```
This is the primary testability mechanism — no stubbing globals.

### Filesystem Isolation
Every test suite creates a temp dir in `beforeEach` and removes it in `afterEach`:
```ts
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ralph-test-'));
// ...
fs.rmSync(tmpDir, { recursive: true });
```
Tests are safe to run in parallel with no shared state.

### ExitSignal Pattern
`process.exit` is mocked to throw a custom `ExitSignal` error, allowing tests to assert exit codes without terminating the process:
```ts
class ExitSignal extends Error { constructor(public code: number) { ... } }
```

### Fixture Helpers
Modules that deal with complex objects (e.g., PRD stories, stats) have local `makeStory()` / `makeProject()` helpers that accept partial overrides. This keeps tests concise and intent-focused.

### Round-Trip Serialization
Several suites (especially `run-stats.test.ts`) write data to disk and reload it to catch serialization bugs. JSON output is validated to be pretty-printed with a trailing newline.

---

## Coverage Assessment

### Well-Covered Areas

- **Configuration**: All fields, defaults, validation, and CLI overrides. Good boundary testing (negative values, wrong types, unknown backends).
- **PRD Validation**: Schema correctness, circular dependency detection, duplicate IDs, unknown dependencies.
- **Run Statistics**: Cost calculation (input/output/cache tokens × price/1000), aggregation across stories and epics, estimate projections, persistence.
- **Token Parsing**: UUID-based deduplication during streaming, null handling, malformed JSON lines, backend gating.
- **Guidance Files**: Create/read/format lifecycle, legacy filename fallback, directory creation.
- **CLI Flag Validation**: `--parallel`, `--tail`, and `--backend` flags tested across relevant commands.
- **Duration Formatting**: Covers sub-second, seconds-only, minutes+seconds, hours+minutes+seconds, and boundary values.

### Partially Covered Areas

- **ralph-shell.test.ts**: Only validates that certain string patterns exist in `ralph.sh`. Does not execute bash or test branching logic.
- **discuss.test.ts / discuss-command.test.ts**: Context building and session setup are tested; actual agent invocation is mocked (expected), but error recovery paths for agent spawn failures are light.
- **validate.test.ts**: Circular dependency has one test. Complex multi-node cycles and self-references are not covered.
- **resume.test.ts**: Success/failure cleanup is tested; no test for corrupt (non-JSON) state files.

### Gaps

1. **No integration tests** — All tests mock `spawnSync` and the filesystem. There are no end-to-end tests that actually invoke `ralph.sh` or a real backend CLI.

2. **stats.test.ts is a stub** — The stats command is currently disabled. If re-enabled, tests will need to be written.

3. **No agent spawning tests** — `task.ts`, `plan.ts`, and `discuss.ts` build prompts correctly (tested), but whether the agent actually runs and returns is not tested.

4. **No merge conflict handling tests** — `validate.test.ts` accepts `merge-failed` as a valid status, but no test exercises the merge flow itself.

5. **No timezone/locale tests** — ISO 8601 timestamps are generated and consumed, but always in a single locale. Cross-timezone edge cases (DST boundaries, UTC offset persistence) are not tested.

6. **No large-scale PRD tests** — No stress or performance tests for PRDs with many epics and stories. Aggregation and estimate functions could have scaling issues.

7. **No concurrent write tests** — `saveRunStats` and `saveGuidance` write files without locking. Concurrent agent writes to the same file are not tested.

8. **Dashboard tests deleted** — Per git status, the entire `src/dashboard/` module and its 10 test files have been deleted. If dashboard features are re-introduced, coverage will need to be rebuilt.

9. **Retry controller tests deleted** — `test/retry-controller.test.ts` was deleted alongside `src/retry-controller.ts`. If retry logic resurfaces in another module, tests are needed.

---

## Notable Issues

### `stats.test.ts` disabled
The single test file for the stats command just asserts a placeholder message. If the command is re-enabled this should be a high-priority gap to fill.

### Shell script tested by string matching only
`ralph-shell.test.ts` reads `ralph.sh` as a string and checks for expected substrings (file paths, prompt patterns). This is fragile — a comment change could break tests, and actual bash logic is untested. Consider adding a bash unit test runner (e.g., `bats`) or at minimum smoke-testing the script with a minimal fixture PRD.

### Mocked agent spawning throughout
All commands that spawn agents (discuss, plan, task, team-lead) use mocked `spawnSync`. The real contract between ralph and its agent sub-processes is untested. A single lightweight integration test per command type would substantially improve confidence.

### Missing `docs/` coverage for new `task` command
`task.ts` and `task.test.ts` are new (untracked in git). The test covers prompts and flow selection but no docs exist for this command in `README.md` or `CLAUDE.md`.

---

## Recommendations

| Priority | Recommendation |
|----------|---------------|
| High | Add integration smoke test that runs ralph.sh against a minimal fixture PRD with a mock backend |
| High | Expand circular dependency tests in `validate.test.ts` (self-reference, 3-node cycles) |
| Medium | Add bash unit tests for ralph.sh branching logic (bats-core or similar) |
| Medium | Add timezone edge case tests to `time-utils.test.ts` and `run-stats.test.ts` |
| Medium | Add concurrent write safety tests (or add file locking if tests reveal a race) |
| Low | Fill in `stats.test.ts` if/when the command is re-enabled |
| Low | Add stress tests for large PRDs (50+ epics, 250+ stories) |
| Low | Document the `task` command in README.md and update CLAUDE.md |

---

## Summary

The test suite is well-structured with 19 files covering all major command, utility, and data-layer modules. The dependency injection pattern and filesystem isolation make individual unit tests reliable and fast. The primary weaknesses are the absence of integration tests (all agent spawning is mocked), light coverage on shell script logic, and a few deleted modules (dashboard, retry-controller) whose replacements may need coverage if reintroduced. The `run-stats.test.ts` file stands out as the most thorough suite (52 tests), reflecting the criticality of cost tracking to the system.
