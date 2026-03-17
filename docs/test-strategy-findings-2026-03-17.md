# Test Strategy Findings — 2026-03-17

## Scope

Review of the current planner/builder test-first strategy, with focus on the new requirement that:

- the Planner designs automated tests for each user story
- the Builder must build against those tests
- if no Planner is spawned, the Builder must do TDD

## Findings

### 1. Prompt coverage is strong, runtime enforcement is still weak

The current tests mostly prove that the right instructions exist in prompt assets and policy files.

Examples:
- `test/ralph-shell.test.ts` checks for planner/builder/TDD wording in prompt files
- `test/task.test.ts` checks that the ad hoc execution prompt includes the new TDD language

This is useful, but it does not prove that the runtime will actually reject a Builder result that includes a commit SHA but no test work.

Why this matters:
- the original failure mode was behavioral: a loop completed with zero tests created
- prompt-text assertions alone will not catch that regression if an agent ignores or only partially follows the prompt

### 2. Builder output is not machine-validated

The Builder prompts now require fields such as:

- tests added or updated
- verification commands run

However, the current contract still effectively treats a concrete commit SHA as the primary completion signal.

Current policy gap:
- `prompts/team-lead-policy.md` explicitly says to verify that the Builder result includes a concrete commit SHA before moving to validation
- there is no corresponding runtime test or parser that rejects results missing test evidence

Why this matters:
- a Builder can still return a valid commit SHA with no tests added
- the Team Lead may still accept that attempt if only the SHA is checked

### 3. No end-to-end test covers the no-planner fallback

The most failure-prone case is low-complexity work where the Planner is skipped.

Current coverage:
- prompt tests verify that the no-planner path mentions TDD
- no integration-style test proves that a no-planner story fails if the Builder skips test creation

Why this matters:
- this is exactly the path where “I just made the change and ran existing tests” tends to happen
- the fallback behavior needs behavioral coverage, not only wording coverage

### 4. Regex-based prompt tests are necessary but brittle

The new assertions in `test/ralph-shell.test.ts` are broad regex checks against prompt files.

That has two tradeoffs:
- harmless wording edits can break tests
- superficial prompt wording can satisfy tests without improving actual enforcement

Why this matters:
- these tests are good guardrails for accidental prompt regressions
- they should not be treated as sufficient proof that the strategy is working in practice

## Recommendations

### High Priority

1. Add a runtime test where a mocked Builder returns a commit SHA but no test artifact details, and assert the story is marked failed.
2. Add a runtime test for the no-planner flow where the Builder implements a story without adding tests, and assert that the attempt is rejected.
3. Make Builder completion machine-readable and enforce it. For example, require structured fields such as:
   - `COMMIT_SHA`
   - `TESTS_CHANGED`
   - `VERIFICATION`
4. Update Team Lead success criteria so a story cannot advance on commit SHA alone.

### Medium Priority

1. Validate planner output structure directly:
   - require `### Tests to Add / Update`
   - require `### Verification Commands`
2. Add at least one shell/integration smoke test for story execution rather than only prompt-file assertions.
3. Add a validator-facing check that compares Builder-reported test changes with the actual diff when practical.

## Bottom Line

The direction is correct:

- test design is now part of planning
- TDD is now explicit when planning is skipped

But the current test strategy still verifies language more than behavior. If the goal is to prevent another “0 tests were created” run, the next improvement should be behavioral enforcement in runtime tests and machine-checked Builder outputs.
