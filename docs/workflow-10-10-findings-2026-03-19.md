# Findings: Bringing Ralph Teams to 10/10

Date: 2026-03-19

## Scope

This document captures the main gaps between the current Ralph Teams workflow and a "10/10" workflow, based on review of:

- `prompts/team-lead-policy.md`
- `prompts/agents/epic-planner.md`
- `prompts/agents/story-planner.md`
- `prompts/agents/builder.md`
- `prompts/agents/story-validator.md`
- `prompts/agents/epic-validator.md`
- `prompts/agents/final-validator.md`
- `src/commands/plan.ts`
- `src/commands/task.ts`

The conclusion is that the current model selection is already close to optimal. The larger gaps are in orchestration policy, decision routing, and feedback loops.

## Current Strengths

- The role split is clear: Team Lead coordinates, planner roles design, builder implements, validators verify, merger resolves conflicts.
- The expensive model budget is already concentrated in high-leverage roles like epic planning and higher-level validation.
- The epic planner contract is stronger than the story planner contract and requires a persisted artifact, which is the right bias.
- Validators are intentionally independent from builders, which protects verification quality.

## Main Gaps

### 1. Team Lead can over-explore before delegating

The Team Lead policy says the Team Lead is a coordinator, but it does not clearly prohibit codebase exploration before the first builder or planner spawn.

Why this happens:

- The Team Lead must decide whether an epic or story is "medium/high complexity".
- The Team Lead must decide whether a canonical plan is "usable".
- The Team Lead may validate low-complexity stories itself.
- The policy never says "do not inspect implementation files beyond the minimum needed before delegation".

This creates a predictable failure mode: a strong Team Lead model tries to reduce uncertainty by reading files, searching the repo, and partially doing the builder's job before spawning the builder.

Impact:

- Increased latency on trivial stories.
- Duplicate exploration across Team Lead and Builder.
- Higher Team Lead cost with little gain.
- More chance that the Team Lead slips from coordinator into implementer/reviewer behavior.

Recommendation:

- Add an explicit pre-delegation guardrail to `prompts/team-lead-policy.md`.
- Restrict the Team Lead's first-step reads to:
  - epic state file
  - current story metadata and acceptance criteria
  - canonical plan file path, if one exists
- Explicitly forbid repo-wide searches or implementation-file inspection before the first builder spawn unless the Team Lead is deciding whether a planner is required and that decision cannot be made from the story and plan context alone.

Suggested policy addition:

```md
- For an unpassed story, default to delegation. Before the first Builder spawn, do not inspect implementation files, run repo-wide searches, or perform broad codebase exploration unless planning is enabled and the planner decision genuinely cannot be made from the story text and existing plan context.
- The Team Lead is not the first codebase explorer for normal story execution. That is the Builder's job, or the Planner's job when planning is required.
```

### 2. Complexity routing is too implicit

The current policy relies on phrases like:

- "medium- or high-complexity"
- "ambiguity"
- "design risk"
- "anything requiring judgment"

Those are directionally right, but they leave too much variance in behavior between runs and between models.

Impact:

- Similar stories may be routed differently across runs.
- The Team Lead may overuse planning or validation.
- Model selection by difficulty is less predictable than it should be.

Recommendation:

- Replace or supplement the current language with concrete routing heuristics.
- Define exact triggers for:
  - story planner spawn
  - story validator spawn
  - epic validator spawn
  - stronger model escalation

Suggested routing heuristic:

- Trivial/mechanical:
  - copy edits
  - constant changes
  - narrow config edits
  - deterministic one-file updates with obvious acceptance criteria
- Medium:
  - new logic path
  - bug fix with branching behavior
  - small refactor
  - single API/component contract change
- High:
  - multiple stories interacting
  - shared abstraction changes
  - async/data/auth/state/UI interaction work
  - changes that require integration judgment

The Team Lead prompt should say exactly which of those categories force planner or validator use.

### 3. Plan quality is strong but not mechanically checked

The epic planner contract is good: it requires story order, test strategy, files, verification commands, and persisted output. But the system still relies on prose quality rather than a hard completeness gate.

Impact:

- Plans can still miss acceptance-criteria coverage.
- Reviewers can keep "finding something" because there is no bounded definition of "ready".
- Builders may still need to infer missing test coverage or missing file scope.

Recommendation:

- Do not add a general-purpose `EpicPlanReviewer`.
- Add, if needed, a narrow optional `EpicPlanChecker` or a non-agent validation step with a blocker-only rubric.
- The checker should only answer PASS/FAIL on:
  - every acceptance criterion is mapped to a story
  - every story has tests to add/update
  - every story has likely files and verification commands
  - story order and dependencies are coherent
  - no major ambiguity remains that would force Builder guessing

Boundaries:

- no style feedback
- no "could also consider"
- no redesign suggestions
- at most one revision cycle

### 4. Validators are independent, but the failure taxonomy is weak

The validators return useful PASS/FAIL outputs, but the system does not appear to require structured failure categories that can be analyzed across runs.

Impact:

- Repeated workflow failures are harder to tune.
- It is difficult to learn whether the dominant problem is planning quality, builder quality, validator strictness, or Team Lead routing.
- Model choices cannot be tuned from real evidence.

Recommendation:

- Require validator failures to include a short category:
  - `missing-test`
  - `acceptance-gap`
  - `integration-break`
  - `regression`
  - `verification-gap`
  - `plan-gap`
- Store these categories in run artifacts or logs.
- Use those results to tune routing and model defaults.

### 5. Story-level validation can still duplicate effort

The current workflow is defensible, but there is still risk of paying repeatedly for similar verification work across:

- story validation
- epic validation
- final validation

Impact:

- Repeated rediscovery of the same integration issue.
- More cost than necessary on larger runs.

Recommendation:

- Tighten validator contracts so each level verifies a different thing:
  - story validator: story acceptance criteria only
  - epic validator: cross-story integration within one epic
  - final validator: cross-epic and branch-level regressions
- Require higher-level validators to treat lower-level PASS results as prior evidence, not as work to fully redo, except where integration changes the risk.

### 6. No closed-loop measurement for model routing

The current balanced model mix is sensible, but it is still a static policy. There is no strong evidence loop tying:

- retry rate
- validation failure categories
- planner quality
- merge-conflict rate

back into model selection.

Impact:

- Expensive models may be used where they are not buying reliability.
- Cheaper models may remain assigned in roles where they are causing retries.

Recommendation:

- Track per-role:
  - invocation count
  - retry count
  - pass/fail rate
  - time-to-success
  - common failure categories
- Revisit defaults only after this data exists.

## What Not To Do

- Do not add more always-on roles just because reviewers can always find something.
- Do not turn planning into an unbounded polish loop.
- Do not solve Team Lead overreach by upgrading the Team Lead model further.
- Do not let validators drift into redesign or implementation suggestions.

## Path To 10/10

The shortest path to a 10/10 workflow is:

1. Tighten Team Lead delegation rules so it stops exploring before the first handoff.
2. Make routing rules explicit instead of qualitative.
3. Add a bounded plan-completeness gate only if needed.
4. Give validators a structured failure taxonomy.
5. Use real run data to tune model defaults instead of tuning by intuition alone.

## Recommended Order

1. Update `prompts/team-lead-policy.md` with anti-over-exploration rules.
2. Add concrete complexity/routing heuristics to the Team Lead policy.
3. Tighten validator output format with failure categories.
4. Add optional plan completeness checking only if plan misses remain common after steps 1-3.
5. Add run-level metrics collection for routing and model evaluation.

## Bottom Line

Ralph Teams is already close on model allocation. The main remaining work is not adding more agents. It is making the Team Lead more disciplined, making routing more deterministic, and making validator output more useful for system tuning.
