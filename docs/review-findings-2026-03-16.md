# Deferred Review Findings

Date: 2026-03-16

These findings were identified during a code-quality review and intentionally
deferred while the affected features were being disabled or reduced in scope.

## Deferred Items

### 1. Dashboard mode is not production-ready

Status:
- Temporarily disabled in `ralph-teams run --dashboard`

Reasons:
- the dashboard path had backend-specific correctness issues
- the wrapper can currently collapse signal exits into success on child close handling
- the overall path needs another validation pass before being re-enabled

Suggested follow-up:
- audit the async child lifecycle in `src/commands/run.ts`
- re-validate dashboard polling against all supported backends
- run the failing shell integration scenarios before re-enabling

### 2. Statistics model is misleading

Status:
- temporarily disabled for both `stats` and `update-stats`

Reasons:
- `ralph.sh` reports one synthetic `"all"` story per epic
- `src/run-stats.ts` aggregates those entries as if they were real stories
- totals, averages, and remaining-story estimates therefore drift away from the PRD

Suggested follow-up:
- decide whether stats are tracked per story or per epic
- align `ralph.sh`, `update-stats`, and `run-stats` around one consistent unit
- re-enable only after the telemetry contract is covered by tests

### 3. Shell integration wave tests are failing

Observed failing tests:
- `US-001: two independent epics run in the same wave`
- `US-001: dependent epic runs after its dependency completes`
- `US-001: wave boundaries are logged to progress.txt`
- `US-002: epics in a wave run in parallel (both finish)`
- `US-002: result file completion advances even if backend session lingers`

Suggested follow-up:
- isolate the regression in `ralph.sh`
- fix wave scheduling and completion handling before relying on parallel execution claims

## Fixed In This Pass

### Guided discuss flow

The discuss flow was changed to behave like a backend-guided session rather than
trying to collect user guidance through a broken pseudo-interactive pipe.

Current contract:
- the selected backend drives the conversation interactively
- the agent is instructed to write the final guidance file itself
- `runDiscussSession()` reads the resulting file after the session ends
