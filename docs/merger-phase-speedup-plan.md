# Merger Phase Speedup Plan

## Goal

Reduce merge-resolution wall-clock time, especially for small conflicts that currently pay the cost of a full agent session.

## Current Bottlenecks

1. Every non-trivial merge conflict escalates to a fresh LLM merger session.
2. The Codex merge path uses the general-purpose `run_codex_exec()` wrapper, which enables multi-agent orchestration and loads the full teammate catalog even though merge work is narrow.
3. The merger prompt makes the agent rediscover context that `ralph.sh` already has:
   - conflicted file list
   - branch-to-branch commit logs
   - conflict markers in the affected files
4. There are too few deterministic fast paths before AI escalation.
5. Parallel epics frequently touch the same hotspot files, creating preventable merge work.

## Plan

### 1. Add a Lightweight Merge Runner

Create a merge-specific backend launch path for Codex instead of reusing the all-purpose team-lead runner.

Requirements:
- no `multi_agent`
- no planner / builder / validator role registration
- lower reasoning effort than the default team-lead path
- keep the same filesystem permissions and repo access needed to resolve conflicts safely

Expected effect:
- lower startup cost for Codex merger sessions
- less prompt and configuration overhead for simple conflict cases

### 2. Precompute Merge Context in Shell

Before spawning the merger agent, gather the context once in `ralph.sh` and inject it directly into the prompt.

Include:
- conflicted file names
- `git log --oneline target..source`
- `git log --oneline source..target`
- full contents of each conflicted file with conflict markers
- optional `git diff --ours --theirs` snippets when useful

Expected effect:
- fewer exploratory tool calls by the merger agent
- faster first useful action
- more deterministic merge behavior across backends

### 3. Add Deterministic Fast Paths Before AI Escalation

Extend the current special-casing beyond `prd.json`.

Candidate safe cases:
- generated metadata files where `ours` is authoritative
- append-only docs or changelog merges that can be combined mechanically
- simple export-list conflicts that can be unioned safely
- additive test-file conflicts where both sides can be retained

Guardrails:
- only apply automatic resolution when the rule is clearly safe
- leave ambiguous cases to the merger agent
- log which fast path was used

Expected effect:
- fewer merger-agent invocations
- much lower tail latency on parallel waves

### 4. Narrow the Merger Prompt

Tighten the merger instructions so the agent stays scoped to the actual conflict.

Prompt changes:
- inspect only the listed conflicted files first
- do not inspect unrelated repo files unless the conflict remains ambiguous
- use git history only when the conflict markers are not enough
- prefer combining both sides' intent mechanically when safe
- stage only the conflicted files

Expected effect:
- less wasted exploration
- more consistent resolution time

### 5. Reduce Conflict Frequency Upstream

Speeding up the merger phase also means creating fewer merges that need AI help.

Operational changes:
- lower `execution.parallel` in repos with known hotspot files
- improve epic slicing so concurrent epics touch different files or layers
- treat shared root files as serialization points where needed

Expected effect:
- fewer expensive conflict-resolution sessions
- more predictable wave completion times

## Rollout Order

1. Implement the lightweight Codex merger runner.
2. Precompute and inject merge context from `ralph.sh`.
3. Add one or two deterministic fast paths for the most common safe conflict shapes.
4. Tighten the merger prompt once the context handoff is in place.
5. Tune parallelism guidance and epic-slicing recommendations based on observed hotspot files.

## Validation

Measure before and after on the same conflict scenarios.

Track:
- time from `merge conflicts — attempting AI resolution` to `MERGED (AI-resolved)`
- merger-agent invocation count per run
- percentage of conflicts resolved without spawning AI
- failure rate of automatic merge resolution

Add or update tests for:
- lightweight merge runner selection on Codex
- prompt includes precomputed conflict context
- deterministic fast-path resolution for safe cases
- fallback to merger agent for ambiguous cases

## Success Criteria

- small two-file conflicts resolve materially faster than the current baseline
- Codex merger startup overhead drops noticeably
- more merge conflicts are handled without any LLM session
- no increase in incorrect merges or merge-failed runs
