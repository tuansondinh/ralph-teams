# Merge Conflict Batching Plan

## Goal

Reduce merger-agent cost without changing the default clean-merge behavior.

Keep this invariant:

- Ralph attempts all merges directly first.
- Only conflicted merges are escalated to the `merger` agent.

## Proposed Model

Replace "spawn one merger per conflicted epic" with "spawn one merger session for the conflict queue in the current merge phase".

Flow:

1. Ralph collects pending epic branches to merge.
2. Ralph attempts each merge in order with plain `git merge`.
3. Clean merges are completed immediately by Ralph.
4. Conflicted merges are added to an ordered conflict queue.
5. If the queue is non-empty, Ralph spawns one `merger` session for that queue.
6. The merger processes queued conflicts one by one.
7. Ralph verifies outcomes, updates PRD/progress, and performs cleanup.

## Non-Goals

- Do not spawn the `merger` agent for clean merges.
- Do not let the merger take over general run orchestration.
- Do not redesign epic scheduling or wave execution in this change.

## Why This Shape

Benefits:

- clean merges stay fast and deterministic
- fewer agent startups when several conflicts happen in one wave
- Ralph remains the source of truth for merge ordering, status, logging, and failure handling
- resume can recover a single merge queue instead of many disconnected merge attempts

Tradeoff:

- the merge phase becomes stateful and needs persisted queue metadata

## Phase 1: Refactor Merge Flow Internally

Split the current `merge_wave` behavior into explicit sub-steps.

Suggested shell functions:

- `collect_merge_candidates`
- `attempt_clean_merge`
- `classify_merge_failure`
- `build_conflict_queue`
- `run_conflict_queue`
- `finalize_merge_success`
- `finalize_merge_failure`

Target outcome:

- no behavior change yet
- same external results as today
- easier to insert queue persistence and one-shot merger invocation

## Phase 2: Add Conflict Queue Data Model

Persist merge-recovery state in `ralph-state.json`.

Suggested fields:

```json
{
  "pendingMerges": [
    {
      "epicId": "EPIC-001",
      "branchName": "ralph/EPIC-001",
      "targetBranch": "ralph/loop/20260318-120000",
      "status": "queued",
      "conflictedFiles": ["src/foo.ts", "README.md"],
      "mergeLog": ".ralph-teams/logs/merge-EPIC-001-123.log"
    }
  ],
  "mergePhase": "clean-pass|conflict-queue|done"
}
```

Rules:

- cleanly merged epics are not kept in `pendingMerges`
- only incomplete merge work is persisted
- `status` values should stay narrow: `queued`, `resolving`, `merged`, `failed`

## Phase 3: Batch Conflict Resolution

After the clean pass:

- if `conflictQueue` is empty, Ralph exits the merge phase normally
- if `conflictQueue` is non-empty, Ralph spawns one `merger` session

Merger session input:

- target branch name
- ordered list of conflicted epic branches
- conflicted files for each epic
- strict instructions to process one epic at a time

Recommended contract:

- Ralph starts the merge attempt
- Ralph detects conflict and records queue item
- merger resolves only queued conflicts
- Ralph remains responsible for PRD status updates, progress logging, branch deletion, and final failure classification

Two implementation options:

1. Ralph opens each queued merge, then invokes the merger repeatedly inside one long-lived session.
2. Ralph hands the whole ordered queue to one merger session and lets it process the queue end to end.

Recommended first version:

- use one merger session for the whole queue
- keep the prompt strict and procedural
- keep Ralph responsible for post-step verification

## Phase 4: Resume Support

On resume:

1. restore loop branch
2. check `pendingMerges`
3. if `mergePhase` is `clean-pass`, re-run clean merge detection safely
4. if `mergePhase` is `conflict-queue`, continue from the persisted queue
5. only then continue with new epic scheduling

Fallback behavior:

- if queue state is missing but completed epic branches still exist, keep the current branch/PRD-based recovery as a backup

## Ordering Rules

Process queued conflicts in a deterministic order.

Recommended order:

1. original wave order
2. dependency-respecting order if dependencies exist inside the queue
3. stable lexical tie-break on epic ID

Avoid dynamic reordering in the first implementation.

## Failure Handling

If a queued epic cannot be resolved:

- abort that merge cleanly
- mark that epic `merge-failed`
- continue to the next queued epic when safe

Do not fail the whole queue immediately unless git state is no longer trustworthy.

Hard-stop conditions:

- unable to restore clean working tree
- target branch no longer exists
- queue metadata is inconsistent with git state

## Logging

Add explicit progress entries for queue handling.

Examples:

- `[EPIC-001] QUEUED FOR BATCHED MERGE CONFLICT RESOLUTION`
- `[EPIC-001] BATCHED MERGE RESOLUTION STARTED`
- `[EPIC-001] MERGED (AI-resolved, batched)`
- `[EPIC-001] MERGE FAILED (batched AI resolution failed, files: ...)`

Also log queue-level events:

- `[merge-queue] STARTED (3 epics)`
- `[merge-queue] COMPLETED`

## Testing Plan

Add shell-level tests for:

- multiple conflicted epics in one wave cause only one merger session spawn
- clean merges in the same wave still do not invoke merger
- batched queue survives interrupt and resumes correctly
- one epic in the queue fails but later queued epics can still merge
- queue state falls back to branch-based recovery when state is partial
- progress log contains queue lifecycle entries

Add focused helper tests for:

- queue serialization/deserialization
- deterministic queue ordering
- safe detection of already-merged branches

## Rollout Strategy

Implement in three small PRs:

1. internal refactor of merge flow with no behavior change
2. persisted merge queue plus resume support
3. single-session batched merger execution

This keeps the risky part isolated to the final step.

## Recommendation

Do this only if merger startup cost is materially hurting real runs.

If conflicts are relatively rare, the current model plus the new resume recovery may already be the better complexity/cost tradeoff.

If you proceed, keep the first batched version conservative:

- one queue per merge phase
- one deterministic order
- Ralph remains orchestrator
- fallback recovery stays in place
