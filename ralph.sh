#!/bin/bash
# Ralph Team Agents — Project Manager Shell Harness
# Ralph never writes code. Ralph schedules epics and spawns teams.
#
# Usage: ./ralph.sh [prd.json] [--max-epics N] [--backend claude|copilot]

set -euo pipefail

# --- Config ---
PRD_FILE="${1:-prd.json}"
MAX_EPICS=10
PROGRESS_FILE="progress.txt"
BACKEND="claude"

# Parse flags — shift past the PRD_FILE arg first
shift 2>/dev/null || true
while [[ $# -gt 0 ]]; do
  case $1 in
    --max-epics) MAX_EPICS="$2"; shift 2 ;;
    --max-epics=*) MAX_EPICS="${1#*=}"; shift ;;
    --backend) BACKEND="$2"; shift 2 ;;
    --backend=*) BACKEND="${1#*=}"; shift ;;
    *) shift ;;
  esac
done

# --- Backend configuration ---
case "$BACKEND" in
  claude)
    AGENT_CMD="claude"
    AGENT_FLAGS="--agent team-lead --dangerously-skip-permissions --print --verbose --output-format stream-json"
    STREAM_FORMAT="stream-json"
    ;;
  copilot)
    AGENT_CMD="gh"
    # Copilot uses -p for non-interactive, --allow-all for full permissions
    # --agent team-lead loads .github/agents/team-lead.agent.md
    # --no-ask-user for autonomous execution, --silent for clean output
    AGENT_FLAGS="copilot -- --agent team-lead --allow-all --no-ask-user --silent -p"
    STREAM_FORMAT="text"
    ;;
  *)
    echo "Error: Unknown backend '$BACKEND'. Use 'claude' or 'copilot'."
    exit 1
    ;;
esac

# --- Validate CLI deps ---
if [ "$BACKEND" = "claude" ] && ! command -v claude &> /dev/null; then
  echo "Error: 'claude' CLI not found. Install Claude Code first."
  exit 1
fi

if [ "$BACKEND" = "copilot" ] && ! command -v gh &> /dev/null; then
  echo "Error: 'gh' CLI not found. Install GitHub CLI first."
  exit 1
fi

if [ "$BACKEND" = "copilot" ]; then
  if ! gh copilot -- --version &> /dev/null; then
    echo "Error: GitHub Copilot CLI not available. Run 'gh copilot' to install."
    exit 1
  fi
fi

if ! command -v jq &> /dev/null; then
  echo "Error: 'jq' not found. Install with: brew install jq"
  exit 1
fi

# --- Validate PRD file exists ---
if [ ! -f "$PRD_FILE" ]; then
  echo "Error: PRD file '$PRD_FILE' not found."
  echo "Usage: ./ralph.sh [prd.json] [--max-epics N]"
  exit 1
fi

# --- Validate PRD structure ---
echo "Validating PRD structure..."

PRD_PROJECT=$(jq -r '.project // empty' "$PRD_FILE" 2>/dev/null)
if [ -z "$PRD_PROJECT" ]; then
  echo "Error: PRD missing required field: .project"
  exit 1
fi

EPICS_COUNT=$(jq '.epics | length' "$PRD_FILE" 2>/dev/null)
if [ -z "$EPICS_COUNT" ] || [ "$EPICS_COUNT" = "null" ] || [ "$EPICS_COUNT" -eq 0 ]; then
  echo "Error: PRD missing required field: .epics (must be a non-empty array)"
  exit 1
fi

# Check each epic has id, title, userStories
VALIDATION_ERRORS=0
for i in $(seq 0 $((EPICS_COUNT - 1))); do
  EPIC_ID_CHECK=$(jq -r ".epics[$i].id // empty" "$PRD_FILE")
  EPIC_TITLE_CHECK=$(jq -r ".epics[$i].title // empty" "$PRD_FILE")
  STORIES_COUNT=$(jq ".epics[$i].userStories | length" "$PRD_FILE" 2>/dev/null)

  if [ -z "$EPIC_ID_CHECK" ]; then
    echo "Error: epics[$i] missing required field: id"
    VALIDATION_ERRORS=$((VALIDATION_ERRORS + 1))
  fi
  if [ -z "$EPIC_TITLE_CHECK" ]; then
    echo "Error: epics[$i] missing required field: title"
    VALIDATION_ERRORS=$((VALIDATION_ERRORS + 1))
  fi
  if [ -z "$STORIES_COUNT" ] || [ "$STORIES_COUNT" = "null" ] || [ "$STORIES_COUNT" -eq 0 ]; then
    echo "Error: epics[$i] (${EPIC_ID_CHECK:-unknown}) missing required field: userStories (must be non-empty)"
    VALIDATION_ERRORS=$((VALIDATION_ERRORS + 1))
  fi
done

if [ "$VALIDATION_ERRORS" -gt 0 ]; then
  echo "PRD validation failed with $VALIDATION_ERRORS error(s). Fix before running."
  exit 1
fi

echo "PRD validation passed."

# --- Initialize ---
if [ ! -f "$PROGRESS_FILE" ]; then
  echo "# Ralph Progress Log" > "$PROGRESS_FILE"
  echo "Started: $(date)" >> "$PROGRESS_FILE"
  echo "PRD: $PRD_FILE" >> "$PROGRESS_FILE"
  echo "---" >> "$PROGRESS_FILE"
fi

# --- Read PRD ---
PROJECT=$(jq -r '.project' "$PRD_FILE")
BRANCH=$(jq -r '.branchName // empty' "$PRD_FILE")
TOTAL_EPICS=$(jq '.epics | length' "$PRD_FILE")

echo ""
echo "========================================================"
echo "  Ralph Team Agents — Project Manager"
echo "  Project: $PROJECT"
echo "  Branch: ${BRANCH:-<not set>}"
echo "  Epics: $TOTAL_EPICS"
echo "  Backend: $BACKEND"
echo "========================================================"

# --- Ensure correct branch ---
CURRENT_BRANCH=$(git branch --show-current 2>/dev/null || echo "")
if [ -n "$BRANCH" ] && [ "$CURRENT_BRANCH" != "$BRANCH" ]; then
  # Check for dirty worktree before switching
  if ! git diff --quiet 2>/dev/null || ! git diff --cached --quiet 2>/dev/null; then
    echo "Error: Worktree is dirty (uncommitted changes). Cannot switch to branch '$BRANCH'."
    echo "Please commit or stash your changes first."
    git status --short
    exit 1
  fi
  echo "Switching to branch: $BRANCH"
  git checkout "$BRANCH" 2>/dev/null || git checkout -b "$BRANCH"
fi

# --- Process Epics ---
COMPLETED=0
FAILED=0

# Resolve absolute path to PRD file so team lead always has the correct path
PRD_ABS_PATH="$(cd "$(dirname "$PRD_FILE")" && pwd)/$(basename "$PRD_FILE")"

for EPIC_INDEX in $(seq 0 $((TOTAL_EPICS - 1))); do
  # Check max epics limit
  if [ $((EPIC_INDEX + 1)) -gt "$MAX_EPICS" ]; then
    echo "Reached max epics limit ($MAX_EPICS). Stopping."
    break
  fi

  # Read epic details
  EPIC_ID=$(jq -r ".epics[$EPIC_INDEX].id" "$PRD_FILE")
  EPIC_TITLE=$(jq -r ".epics[$EPIC_INDEX].title" "$PRD_FILE")
  EPIC_STATUS=$(jq -r ".epics[$EPIC_INDEX].status // \"pending\"" "$PRD_FILE")

  # Skip completed epics
  if [ "$EPIC_STATUS" = "completed" ]; then
    echo "  [$EPIC_ID] $EPIC_TITLE — already completed, skipping"
    COMPLETED=$((COMPLETED + 1))
    continue
  fi

  # Check dependencies
  DEPS=$(jq -r ".epics[$EPIC_INDEX].dependsOn // [] | .[]" "$PRD_FILE" 2>/dev/null || true)
  BLOCKED=false
  for DEP in $DEPS; do
    DEP_STATUS=$(jq -r ".epics[] | select(.id == \"$DEP\") | .status // \"pending\"" "$PRD_FILE")
    if [ "$DEP_STATUS" != "completed" ]; then
      echo "  [$EPIC_ID] $EPIC_TITLE — blocked by $DEP (status: $DEP_STATUS)"
      BLOCKED=true
      break
    fi
  done
  if [ "$BLOCKED" = true ]; then
    continue
  fi

  echo ""
  echo "========================================================"
  echo "  Spawning team for: [$EPIC_ID] $EPIC_TITLE"
  echo "  $(date)"
  echo "========================================================"

  # Extract epic data as JSON for the team lead
  EPIC_JSON=$(jq ".epics[$EPIC_INDEX]" "$PRD_FILE")

  # Setup result file
  RESULT_FILE="$(pwd)/results/result-${EPIC_ID}.txt"
  EPIC_LOG="$(pwd)/logs/epic-${EPIC_ID}-$(date +%s).log"
  mkdir -p results logs
  rm -f "$RESULT_FILE"

  # Build the prompt for team lead
  TEAM_PROMPT="You are the Team Lead for this epic. Read the epic below and execute it.

## Project
$PROJECT

## PRD File Path
$PRD_ABS_PATH

## Epic
$EPIC_JSON

## Instructions
1. Spawn the Planner first and wait for the plan to be written to plans/plan-${EPIC_ID}.md
2. Process ALL user stories in priority order — do NOT stop until every story has been attempted
3. For each story: check if passes=true in the PRD (skip those — they are already done), then Builder implements → Validator verifies → max 2 total cycles
4. Document any failures and move on to the next story
5. When ALL stories have been processed (or skipped because already passed), write your result to: $RESULT_FILE
   - Write ONLY one line: PASS, PARTIAL, or FAIL with details
   - Example: PASS
   - Example: PARTIAL: 3/5 stories passed. Failed: US-003, US-005
   - Example: FAIL: 0/5 stories passed.

## Critical Rules
- Do NOT stop after the first story — process ALL stories before writing the result file
- Idle or waiting messages from teammates are NORMAL — they do not mean the session should end
- NEVER send shutdown_request messages — the session ending handles cleanup automatically
- Process stories sequentially: build → validate → next. Do not stop early.
- After each story result (pass or fail), update $PRD_ABS_PATH to set passes: true/false for that story

Begin."

  # Spawn team lead
  AGENT_EXIT=0

  if [ "$STREAM_FORMAT" = "stream-json" ]; then
    # Claude: stream-json gives real-time structured output
    echo "$TEAM_PROMPT" | $AGENT_CMD $AGENT_FLAGS 2>&1 | while IFS= read -r line; do
      echo "$line" >> "$EPIC_LOG"
      # Extract and display assistant text messages
      TEXT=$(echo "$line" | jq -r 'select(.type == "assistant") | .message.content[]? | select(.type == "text") | .text // empty' 2>/dev/null || true)
      if [ -n "$TEXT" ]; then
        echo "$TEXT"
      fi
      # Show tool use activity
      TOOL=$(echo "$line" | jq -r 'select(.type == "assistant") | .message.content[]? | select(.type == "tool_use") | "  -> \(.name): \(.input | tostring | .[0:100])"' 2>/dev/null || true)
      if [ -n "$TOOL" ]; then
        echo "$TOOL"
      fi
    done || AGENT_EXIT=$?
  else
    # Copilot / text mode: -p takes the prompt as argument, plain text output
    $AGENT_CMD $AGENT_FLAGS "$TEAM_PROMPT" 2>&1 | tee "$EPIC_LOG" || AGENT_EXIT=$?
  fi

  if [ "$AGENT_EXIT" -ne 0 ]; then
    echo "  Warning: $BACKEND exited with code $AGENT_EXIT for epic $EPIC_ID"
  fi

  # Result parsing: ONLY use the result file. Never grep logs.
  if [ ! -f "$RESULT_FILE" ]; then
    echo ""
    echo "  [$EPIC_ID] FAILED — no result file found at $RESULT_FILE"
    jq ".epics[$EPIC_INDEX].status = \"failed\"" "$PRD_FILE" > tmp.$$.json && mv tmp.$$.json "$PRD_FILE"
    FAILED=$((FAILED + 1))
    echo "[$EPIC_ID] FAILED (no result file) — $(date)" >> "$PROGRESS_FILE"
    continue
  fi

  RESULT=$(cat "$RESULT_FILE")

  if echo "$RESULT" | grep -qi "^PASS$"; then
    echo ""
    echo "  [$EPIC_ID] PASSED — all stories completed"
    jq ".epics[$EPIC_INDEX].status = \"completed\"" "$PRD_FILE" > tmp.$$.json && mv tmp.$$.json "$PRD_FILE"
    COMPLETED=$((COMPLETED + 1))
    echo "[$EPIC_ID] PASSED — $(date)" >> "$PROGRESS_FILE"

  elif echo "$RESULT" | grep -qi "^PARTIAL"; then
    echo ""
    echo "  [$EPIC_ID] PARTIAL — $RESULT"
    jq ".epics[$EPIC_INDEX].status = \"partial\"" "$PRD_FILE" > tmp.$$.json && mv tmp.$$.json "$PRD_FILE"
    echo "[$EPIC_ID] PARTIAL — $(date) — $RESULT" >> "$PROGRESS_FILE"

  else
    echo ""
    echo "  [$EPIC_ID] FAILED — $RESULT"
    jq ".epics[$EPIC_INDEX].status = \"failed\"" "$PRD_FILE" > tmp.$$.json && mv tmp.$$.json "$PRD_FILE"
    FAILED=$((FAILED + 1))
    echo "[$EPIC_ID] FAILED — $(date) — $RESULT" >> "$PROGRESS_FILE"
  fi
done

# --- Summary ---
REMAINING=$((TOTAL_EPICS - COMPLETED - FAILED))
echo ""
echo "========================================================"
echo "  Ralph Summary"
echo "  Completed: $COMPLETED / $TOTAL_EPICS"
echo "  Failed: $FAILED"
echo "  Remaining: $REMAINING"
echo "========================================================"

if [ "$COMPLETED" -eq "$TOTAL_EPICS" ]; then
  echo "All epics completed!"
  exit 0
elif [ "$REMAINING" -gt 0 ]; then
  echo "Some epics remaining. Run ralph.sh again to continue."
  exit 0
else
  echo "All attempted epics processed. Check progress.txt for details."
  exit 1
fi
