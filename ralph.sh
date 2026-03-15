#!/bin/bash
# Ralph Teams — Project Manager Shell Harness
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
    # --no-ask-user for autonomous execution, --stream on for live output
    AGENT_FLAGS="copilot -- --agent team-lead --allow-all --no-ask-user --stream on -p"
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

# --- Circular Dependency Detection ---
# Uses Kahn's algorithm (BFS topological sort) to detect cycles.
# If after processing all zero-in-degree nodes some epics remain unprocessed,
# a cycle exists. Exits with code 1 and an error message if a cycle is found.
detect_circular_deps() {
  local prd_file="$1"
  local total="$2"

  # Build in-degree array and adjacency list using jq
  # in_degree[i] = number of dependencies epic i has
  local -a in_degree=()
  for i in $(seq 0 $((total - 1))); do
    local cnt
    cnt=$(jq ".epics[$i].dependsOn // [] | length" "$prd_file")
    in_degree+=("$cnt")
  done

  # BFS queue: start with all epics that have in-degree 0
  local queue=""
  for i in $(seq 0 $((total - 1))); do
    [ "${in_degree[$i]}" -eq 0 ] && queue="$queue $i"
  done
  queue="${queue# }"  # trim leading space

  local processed=0
  while [ -n "$queue" ]; do
    # Dequeue first element
    local node="${queue%% *}"
    if [ "$queue" = "$node" ]; then
      queue=""
    else
      queue="${queue#* }"
    fi
    processed=$((processed + 1))

    # For each epic that depends on this node (reverse adjacency)
    local node_id
    node_id=$(jq -r ".epics[$node].id" "$prd_file")
    for j in $(seq 0 $((total - 1))); do
      local dep_match
      dep_match=$(jq -r ".epics[$j].dependsOn // [] | map(select(. == \"$node_id\")) | length" "$prd_file")
      if [ "$dep_match" -gt 0 ]; then
        in_degree[$j]=$((in_degree[$j] - 1))
        if [ "${in_degree[$j]}" -eq 0 ]; then
          queue="$queue $j"
          queue="${queue# }"
        fi
      fi
    done
  done

  if [ "$processed" -lt "$total" ]; then
    echo "Error: Circular dependency detected in epic dependency graph. Check dependsOn fields." >&2
    exit 1
  fi
}

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
echo "  Ralph Teams — Project Manager"
echo "  Project: $PROJECT"
echo "  Branch: ${BRANCH:-<not set>}"
echo "  Epics: $TOTAL_EPICS"
echo "  Backend: $BACKEND"
echo "========================================================"

prompt_to_commit_dirty_worktree() {
  local target_branch="$1"

  echo "Worktree has uncommitted changes and Ralph needs to switch to branch '$target_branch'."
  echo "Ralph will now stage and commit all current changes before the run."
  git status --short
  printf "Proceed with auto-commit before continuing? [y/N]: "

  local response
  IFS= read -r response || response=""
  case "$response" in
    y|Y|yes|YES)
      git add -A
      git commit -m "chore: auto-commit changes before ralph run"
      ;;
    *)
      echo "Aborted: user declined auto-commit before run."
      exit 1
      ;;
  esac
}

# --- Ensure correct branch ---
CURRENT_BRANCH=$(git branch --show-current 2>/dev/null || echo "")
if [ -n "$BRANCH" ] && [ "$CURRENT_BRANCH" != "$BRANCH" ]; then
  if ! git diff --quiet 2>/dev/null || ! git diff --cached --quiet 2>/dev/null; then
    prompt_to_commit_dirty_worktree "$BRANCH"
  fi
  echo "Switching to branch: $BRANCH"
  git checkout "$BRANCH" 2>/dev/null || git checkout -b "$BRANCH"
fi

# --- Process Epics (Wave-based) ---
COMPLETED=0
FAILED=0
PROCESSED=0

# Resolve absolute path to PRD file so team lead always has the correct path
PRD_ABS_PATH="$(cd "$(dirname "$PRD_FILE")" && pwd)/$(basename "$PRD_FILE")"

# Detect circular dependencies before starting
detect_circular_deps "$PRD_FILE" "$TOTAL_EPICS"

# process_epic_result: parse result file and update PRD status for a given epic index
process_epic_result() {
  local epic_index="$1"
  local epic_id
  epic_id=$(jq -r ".epics[$epic_index].id" "$PRD_FILE")
  local result_file="$(pwd)/results/result-${epic_id}.txt"

  if [ ! -f "$result_file" ]; then
    echo ""
    echo "  [$epic_id] FAILED — no result file found at $result_file"
    jq ".epics[$epic_index].status = \"failed\"" "$PRD_FILE" > tmp.$$.json && mv tmp.$$.json "$PRD_FILE"
    FAILED=$((FAILED + 1))
    echo "[$epic_id] FAILED (no result file) — $(date)" >> "$PROGRESS_FILE"
    return
  fi

  local result
  result=$(cat "$result_file")

  if echo "$result" | grep -qi "^PASS$"; then
    echo ""
    echo "  [$epic_id] PASSED — all stories completed"
    jq ".epics[$epic_index].status = \"completed\"" "$PRD_FILE" > tmp.$$.json && mv tmp.$$.json "$PRD_FILE"
    COMPLETED=$((COMPLETED + 1))
    echo "[$epic_id] PASSED — $(date)" >> "$PROGRESS_FILE"

  elif echo "$result" | grep -qi "^PARTIAL"; then
    echo ""
    echo "  [$epic_id] PARTIAL — $result"
    jq ".epics[$epic_index].status = \"partial\"" "$PRD_FILE" > tmp.$$.json && mv tmp.$$.json "$PRD_FILE"
    echo "[$epic_id] PARTIAL — $(date) — $result" >> "$PROGRESS_FILE"

  else
    echo ""
    echo "  [$epic_id] FAILED — $result"
    jq ".epics[$epic_index].status = \"failed\"" "$PRD_FILE" > tmp.$$.json && mv tmp.$$.json "$PRD_FILE"
    FAILED=$((FAILED + 1))
    echo "[$epic_id] FAILED — $(date) — $result" >> "$PROGRESS_FILE"
  fi
}

# spawn_epic: build prompt and run team lead for a given epic index (foreground)
spawn_epic() {
  local EPIC_INDEX="$1"
  local EPIC_ID
  EPIC_ID=$(jq -r ".epics[$EPIC_INDEX].id" "$PRD_FILE")
  local EPIC_TITLE
  EPIC_TITLE=$(jq -r ".epics[$EPIC_INDEX].title" "$PRD_FILE")
  local EPIC_JSON
  EPIC_JSON=$(jq ".epics[$EPIC_INDEX]" "$PRD_FILE")

  echo ""
  echo "========================================================"
  echo "  Spawning team for: [$EPIC_ID] $EPIC_TITLE"
  echo "  $(date)"
  echo "========================================================"

  local RESULT_FILE="$(pwd)/results/result-${EPIC_ID}.txt"
  local EPIC_LOG="$(pwd)/logs/epic-${EPIC_ID}-$(date +%s).log"
  mkdir -p results logs
  rm -f "$RESULT_FILE"

  local TEAM_PROMPT="You are the Team Lead for this epic. Read the epic below and execute it.

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

  local AGENT_EXIT=0

  if [ "$STREAM_FORMAT" = "stream-json" ]; then
    echo "$TEAM_PROMPT" | $AGENT_CMD $AGENT_FLAGS 2>&1 | while IFS= read -r line; do
      echo "$line" >> "$EPIC_LOG"
      local TEXT
      TEXT=$(echo "$line" | jq -r 'select(.type == "assistant") | .message.content[]? | select(.type == "text") | .text // empty' 2>/dev/null || true)
      if [ -n "$TEXT" ]; then
        echo "$TEXT"
      fi
      local TOOL
      TOOL=$(echo "$line" | jq -r 'select(.type == "assistant") | .message.content[]? | select(.type == "tool_use") | "  -> \(.name): \(.input | tostring | .[0:100])"' 2>/dev/null || true)
      if [ -n "$TOOL" ]; then
        echo "$TOOL"
      fi
    done || AGENT_EXIT=$?
  else
    COPILOT_TEAM_PROMPT="$TEAM_PROMPT" \
      script -q /dev/null /bin/sh -lc 'exec gh copilot -- --agent team-lead --allow-all --no-ask-user --stream on -p "$COPILOT_TEAM_PROMPT"' \
      2>&1 | tee "$EPIC_LOG" || AGENT_EXIT=$?
  fi

  if [ "$AGENT_EXIT" -ne 0 ]; then
    echo "  Warning: $BACKEND exited with code $AGENT_EXIT for epic $EPIC_ID"
  fi
}

WAVE_NUM=0
while true; do
  # Find all epics ready for this wave
  WAVE_EPICS=()

  for EPIC_INDEX in $(seq 0 $((TOTAL_EPICS - 1))); do
    EPIC_STATUS=$(jq -r ".epics[$EPIC_INDEX].status // \"pending\"" "$PRD_FILE")
    [ "$EPIC_STATUS" != "pending" ] && continue

    # Check all dependencies
    ALL_DEPS_MET=true
    DEPS=$(jq -r ".epics[$EPIC_INDEX].dependsOn // [] | .[]" "$PRD_FILE" 2>/dev/null || true)
    for DEP in $DEPS; do
      DEP_STATUS=$(jq -r ".epics[] | select(.id == \"$DEP\") | .status // \"pending\"" "$PRD_FILE")
      if [ "$DEP_STATUS" = "failed" ] || [ "$DEP_STATUS" = "partial" ]; then
        # Dependency failed — skip this epic permanently
        EPIC_ID=$(jq -r ".epics[$EPIC_INDEX].id" "$PRD_FILE")
        EPIC_TITLE=$(jq -r ".epics[$EPIC_INDEX].title" "$PRD_FILE")
        echo "  [$EPIC_ID] $EPIC_TITLE — skipped (dependency $DEP has status: $DEP_STATUS)"
        jq ".epics[$EPIC_INDEX].status = \"failed\"" "$PRD_FILE" > tmp.$$.json && mv tmp.$$.json "$PRD_FILE"
        FAILED=$((FAILED + 1))
        echo "[$EPIC_ID] SKIPPED (dependency $DEP failed) — $(date)" >> "$PROGRESS_FILE"
        ALL_DEPS_MET=false
        break
      elif [ "$DEP_STATUS" != "completed" ]; then
        ALL_DEPS_MET=false
        break
      fi
    done

    [ "$ALL_DEPS_MET" = true ] && WAVE_EPICS+=("$EPIC_INDEX")
  done

  # If no epics ready, we're done
  [ ${#WAVE_EPICS[@]} -eq 0 ] && break

  WAVE_NUM=$((WAVE_NUM + 1))
  echo ""
  echo "========================================================"
  echo "  Wave $WAVE_NUM — ${#WAVE_EPICS[@]} epic(s)"
  echo "========================================================"

  # Log wave boundary to progress.txt
  echo "" >> "$PROGRESS_FILE"
  echo "=== Wave $WAVE_NUM — $(date) ===" >> "$PROGRESS_FILE"
  for IDX in "${WAVE_EPICS[@]}"; do
    W_EPIC_ID=$(jq -r ".epics[$IDX].id" "$PRD_FILE")
    echo "  $W_EPIC_ID" >> "$PROGRESS_FILE"
  done

  # Process epics in this wave sequentially (US-002 will make this parallel)
  for EPIC_INDEX in "${WAVE_EPICS[@]}"; do
    # Check --max-epics limit
    if [ "$PROCESSED" -ge "$MAX_EPICS" ]; then
      echo "Reached max epics limit ($MAX_EPICS). Stopping."
      break 2
    fi

    EPIC_STATUS=$(jq -r ".epics[$EPIC_INDEX].status // \"pending\"" "$PRD_FILE")
    if [ "$EPIC_STATUS" = "completed" ]; then
      EPIC_ID=$(jq -r ".epics[$EPIC_INDEX].id" "$PRD_FILE")
      EPIC_TITLE=$(jq -r ".epics[$EPIC_INDEX].title" "$PRD_FILE")
      echo "  [$EPIC_ID] $EPIC_TITLE — already completed, skipping"
      COMPLETED=$((COMPLETED + 1))
      continue
    fi

    PROCESSED=$((PROCESSED + 1))
    spawn_epic "$EPIC_INDEX"
    process_epic_result "$EPIC_INDEX"
  done
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
