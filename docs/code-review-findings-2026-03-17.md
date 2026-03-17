# Code Review Findings — 2026-03-17

## Scope

Quick review of the orchestration layer beyond the new planner/builder test-first strategy.

Focus areas:

- run vs resume behavior
- config loading and environment propagation
- CLI/runtime consistency

## Findings

### 1. Resumed runs do not preserve agent model settings

Severity: High

Files:
- `src/commands/run.ts`
- `src/commands/resume.ts`

Details:

Fresh runs forward the full model configuration and explicit override flags to `ralph.sh`, including:

- `RALPH_MODEL_TEAM_LEAD`
- `RALPH_MODEL_PLANNER`
- `RALPH_MODEL_BUILDER`
- `RALPH_MODEL_VALIDATOR`
- `RALPH_MODEL_MERGER`
- `RALPH_MODEL_*_EXPLICIT`

Resumed runs do not. They currently forward only:

- timeout values
- validator pushback count
- parallel setting
- backend

Impact:

- an interrupted run can resume with different planner/builder/validator models than the original run
- explicit model overrides from `ralph.config.yml` are effectively lost on resume
- this can change cost, quality, and behavior in the middle of an epic

Why this matters:

Resume should preserve execution semantics as closely as possible. Right now it does not.

### 2. `runCommand()` loads config from the current shell directory, not the PRD project root

Severity: Medium

Files:
- `src/commands/run.ts`

Details:

`runCommand()` resolves the PRD path correctly, but it loads `ralph.config.yml` using `deps.cwd()` rather than `path.dirname(resolved)`.

Impact:

- if the command is invoked from outside the target project directory, it can silently load the wrong config
- backend selection, model overrides, timeouts, and parallel settings may come from the caller's directory instead of the PRD's project

Why this matters:

The PRD path is the clearest indicator of which project should control the run. Config should follow the PRD, not the shell location.

### 3. CLI status output can misreport sequential mode

Severity: Low

Files:
- `src/commands/run.ts`
- `ralph.sh`

Details:

The CLI prints `Mode: sequential` whenever `--parallel` is omitted.

But `ralph.sh` also enables parallel execution from `RALPH_PARALLEL` when the flag is absent.

Impact:

- the CLI can claim the run is sequential even when the config-driven environment causes parallel execution
- this makes debugging and operator trust worse

Why this matters:

Even when behavior is correct, misleading status output slows down diagnosis and makes the tool feel unreliable.

## Assessment

The codebase is generally in good shape:

- command modules are cleanly separated
- config validation is strong
- dependency injection keeps command logic testable
- runtime path handling is well-factored

The main weaknesses are in orchestration correctness rather than basic code quality. The highest-value fixes are:

1. make `resume` forward the same agent-model environment as `run`
2. load config relative to the PRD project root
3. align CLI status output with config-driven parallel execution
