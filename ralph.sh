#!/bin/bash
# Ralph Teams — Project Manager Shell Harness
# Ralph never writes code. Ralph schedules epics and spawns teams.
#
# Usage: ./ralph.sh [prd.json] [--max-epics N] [--backend claude|copilot] [--parallel N]

set -euo pipefail

# --- Config ---
PRD_FILE="${1:-prd.json}"
MAX_EPICS=10
PROGRESS_FILE="progress.txt"
BACKEND="claude"
PARALLEL=""

# Parse flags — shift past the PRD_FILE arg first
shift 2>/dev/null || true
while [[ $# -gt 0 ]]; do
  case $1 in
    --max-epics) MAX_EPICS="$2"; shift 2 ;;
    --max-epics=*) MAX_EPICS="${1#*=}"; shift ;;
    --backend) BACKEND="$2"; shift 2 ;;
    --backend=*) BACKEND="${1#*=}"; shift ;;
    --parallel) PARALLEL="$2"; shift 2 ;;
    --parallel=*) PARALLEL="${1#*=}"; shift ;;
    *) shift ;;
  esac
done

if [ -n "$PARALLEL" ] && ! [[ "$PARALLEL" =~ ^[0-9]+$ ]]; then
  echo "Error: --parallel must be a whole number."
  exit 1
fi

# Read env vars as fallbacks (set by ralph-teams CLI from ralph.config.yml).
# CLI flags passed directly to ralph.sh take precedence over these env vars.
EPIC_TIMEOUT="${RALPH_EPIC_TIMEOUT:-3600}"
IDLE_TIMEOUT="${RALPH_IDLE_TIMEOUT:-300}"
VALIDATOR_MAX_PUSHBACKS="${RALPH_VALIDATOR_MAX_PUSHBACKS:-1}"
# Only apply RALPH_PARALLEL env var if --parallel flag was not provided
if [ -z "$PARALLEL" ] && [ -n "${RALPH_PARALLEL:-}" ] && [ "${RALPH_PARALLEL}" != "0" ]; then
  PARALLEL="$RALPH_PARALLEL"
fi

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

if ! command -v rjq &> /dev/null; then
  echo "Error: 'rjq' not found. Run 'npm install -g ralph-teams' to install."
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

PRD_PROJECT=$(rjq read "$PRD_FILE" .project "")
if [ -z "$PRD_PROJECT" ]; then
  echo "Error: PRD missing required field: .project"
  exit 1
fi

EPICS_COUNT=$(rjq length "$PRD_FILE" .epics)
if [ -z "$EPICS_COUNT" ] || [ "$EPICS_COUNT" = "null" ] || [ "$EPICS_COUNT" -eq 0 ]; then
  echo "Error: PRD missing required field: .epics (must be a non-empty array)"
  exit 1
fi

# Check each epic has id, title, userStories
VALIDATION_ERRORS=0
for i in $(seq 0 $((EPICS_COUNT - 1))); do
  EPIC_ID_CHECK=$(rjq read "$PRD_FILE" ".epics[$i].id" "")
  EPIC_TITLE_CHECK=$(rjq read "$PRD_FILE" ".epics[$i].title" "")
  STORIES_COUNT=$(rjq length "$PRD_FILE" ".epics[$i].userStories")

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

  # Build in-degree array and adjacency list using rjq
  # in_degree[i] = number of dependencies epic i has
  local -a in_degree=()
  for i in $(seq 0 $((total - 1))); do
    local cnt
    cnt=$(rjq length "$prd_file" ".epics[$i].dependsOn")
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
    node_id=$(rjq read "$prd_file" ".epics[$node].id")
    for j in $(seq 0 $((total - 1))); do
      local dep_match
      dep_match=$(rjq count-matches "$prd_file" ".epics[$j].dependsOn" "$node_id")
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
PROJECT=$(rjq read "$PRD_FILE" .project)
BRANCH=$(rjq read "$PRD_FILE" .branchName "")
TOTAL_EPICS=$(rjq length "$PRD_FILE" .epics)

echo ""
echo "========================================================"
echo "  Ralph Teams — Project Manager"
echo "  Project: $PROJECT"
echo "  Branch: ${BRANCH:-<not set>}"
echo "  Epics: $TOTAL_EPICS"
echo "  Backend: $BACKEND"
if [ -n "$PARALLEL" ]; then
  echo "  Parallel: $PARALLEL"
else
  echo "  Mode: sequential"
fi
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

# --- Worktree Management ---
# Creates a git worktree at .worktrees/<epic_id> on branch ralph/<epic_id>.
# If the worktree already exists and is valid (e.g. from an interrupted run),
# it is reused as-is. Otherwise, any stale entries are cleaned up first.
create_epic_worktree() {
  local epic_id="$1"
  local branch_name="ralph/${epic_id}"
  local worktree_path=".worktrees/${epic_id}"

  # Reuse existing worktree if it is already registered and present on disk
  if [ -d "$worktree_path" ] && git worktree list | grep -q "$worktree_path"; then
    echo "$worktree_path"
    return
  fi

  # Remove stale worktree entry if it exists
  git worktree remove "$worktree_path" --force 2>/dev/null || true
  # Remove stale branch if it exists
  git branch -D "$branch_name" 2>/dev/null || true

  git worktree add "$worktree_path" -b "$branch_name" >/dev/null 2>&1
  echo "$worktree_path"
}

# Removes a worktree. The branch is kept for potential merge by a later agent.
cleanup_epic_worktree() {
  local epic_id="$1"
  git worktree remove ".worktrees/${epic_id}" --force 2>/dev/null || true
}

# Removes ALL .worktrees/* entries (used on EXIT).
cleanup_all_worktrees() {
  for dir in .worktrees/*/; do
    [ -d "$dir" ] && git worktree remove "$dir" --force 2>/dev/null || true
  done
}

terminate_process_tree() {
  local pid="$1"
  local child_pids
  child_pids=$(pgrep -P "$pid" 2>/dev/null || true)

  for child_pid in $child_pids; do
    terminate_process_tree "$child_pid"
  done

  kill "$pid" 2>/dev/null || true
}

emit_new_log_output() {
  local epic_id="$1"
  local log_file="$2"
  local previous_line_count="$3"

  [ -f "$log_file" ] || {
    LAST_LOG_LINE_COUNT="$previous_line_count"
    return
  }

  local current_line_count
  current_line_count=$(wc -l < "$log_file")

  if [ "$current_line_count" -gt "$previous_line_count" ]; then
    sed -n "$((previous_line_count + 1)),${current_line_count}p" "$log_file" 2>/dev/null \
      | while IFS= read -r log_line; do
          [ -z "$log_line" ] && continue

          if printf '%s\n' "$log_line" | rjq validate 2>/dev/null; then
            printf '%s\n' "$log_line" \
              | rjq extract-stream-text 2>/dev/null \
              | while IFS= read -r text_line; do
                  [ -n "$text_line" ] && echo "  [$epic_id] $text_line"
                done
          elif [ "$STREAM_FORMAT" = "text" ]; then
            echo "  [$epic_id] $log_line"
          fi
        done
  fi

  LAST_LOG_LINE_COUNT="$current_line_count"
}

# --- Process Epics (Wave-based) ---
COMPLETED=0
FAILED=0
PROCESSED=0
CURRENT_WAVE=0
INTERRUPTED=false

# Script-level arrays so the SIGINT handler can access them
active_pids=()
active_indices=()

# Track the currently-processing story ID so SIGINT can capture it
CURRENT_STORY_ID=""

# Resolve absolute path to PRD file so team lead always has the correct path
PRD_ABS_PATH="$(cd "$(dirname "$PRD_FILE")" && pwd)/$(basename "$PRD_FILE")"
ROOT_DIR="$(pwd)"

normalize_epic_statuses() {
  local updated=false

  for epic_index in $(seq 0 $((TOTAL_EPICS - 1))); do
    local epic_status
    epic_status=$(rjq read "$PRD_FILE" ".epics[$epic_index].status" "pending")
    [ "$epic_status" != "pending" ] && continue

    local story_count
    story_count=$(rjq length "$PRD_FILE" ".epics[$epic_index].userStories")
    [ "$story_count" -eq 0 ] && continue

    local passed_count
    passed_count=$(rjq count-where "$PRD_FILE" ".epics[$epic_index].userStories" "passes=true")

    if [ "$passed_count" -eq "$story_count" ]; then
      local epic_id
      epic_id=$(rjq read "$PRD_FILE" ".epics[$epic_index].id")
      echo "  [$epic_id] all stories already pass — marking epic completed"
      rjq set "$PRD_FILE" ".epics[$epic_index].status" '"completed"'
      echo "[$epic_id] AUTO-COMPLETED (all stories already passed) — $(date)" >> "$PROGRESS_FILE"
      updated=true
    fi
  done

  if [ "$updated" = true ]; then
    echo "Resume state refreshed from PRD story pass flags."
  fi
}

initialize_counters() {
  COMPLETED=$(rjq count-where "$PRD_FILE" .epics "status=completed" --default pending)
  FAILED=$(rjq count-where "$PRD_FILE" .epics "status=failed|merge-failed" --default pending)
}

# Writes current run state to ralph-state.json atomically (temp file + rename).
# Captures CURRENT_WAVE, active epic indices, backend, parallel settings,
# story progress from the PRD, and the currently-interrupted story ID.
save_run_state() {
  local prd_dir
  prd_dir="$(cd "$(dirname "$PRD_FILE")" && pwd)"
  local tmp_file
  tmp_file=$(mktemp "${prd_dir}/.ralph-state.json.XXXXXX")

  # Build JSON array of active epic IDs
  local active_epic_ids="["
  local first=true
  for idx in "${active_indices[@]+"${active_indices[@]}"}"; do
    local epic_id
    epic_id=$(rjq read "$PRD_FILE" ".epics[$idx].id" 2>/dev/null || true)
    if [ -n "$epic_id" ]; then
      [ "$first" = true ] && first=false || active_epic_ids="${active_epic_ids},"
      active_epic_ids="${active_epic_ids}\"${epic_id}\""
    fi
  done
  active_epic_ids="${active_epic_ids}]"

  # Build storyProgress object from PRD: { "epicId": { "storyId": true/false, ... }, ... }
  local story_progress="{"
  local epic_first=true
  local total_epics_count
  total_epics_count=$(rjq length "$PRD_FILE" .epics 2>/dev/null || echo 0)
  for ep_idx in $(seq 0 $((total_epics_count - 1))); do
    local ep_id
    ep_id=$(rjq read "$PRD_FILE" ".epics[$ep_idx].id" 2>/dev/null || true)
    [ -z "$ep_id" ] && continue

    local story_count
    story_count=$(rjq length "$PRD_FILE" ".epics[$ep_idx].userStories" 2>/dev/null || echo 0)
    [ "$story_count" -eq 0 ] && continue

    [ "$epic_first" = true ] && epic_first=false || story_progress="${story_progress},"
    story_progress="${story_progress}\"${ep_id}\": {"

    local story_first=true
    for st_idx in $(seq 0 $((story_count - 1))); do
      local st_id
      st_id=$(rjq read "$PRD_FILE" ".epics[$ep_idx].userStories[$st_idx].id" 2>/dev/null || true)
      local st_passes
      st_passes=$(rjq read "$PRD_FILE" ".epics[$ep_idx].userStories[$st_idx].passes" "false" 2>/dev/null || echo "false")
      [ -z "$st_id" ] && continue

      # Normalize passes to JSON boolean
      [ "$st_passes" = "true" ] && st_passes="true" || st_passes="false"

      [ "$story_first" = true ] && story_first=false || story_progress="${story_progress},"
      story_progress="${story_progress}\"${st_id}\": ${st_passes}"
    done
    story_progress="${story_progress}}"
  done
  story_progress="${story_progress}}"

  # interruptedStoryId: the story being processed when interrupt occurred (empty = null)
  local interrupted_story_json
  if [ -n "$CURRENT_STORY_ID" ]; then
    interrupted_story_json="\"${CURRENT_STORY_ID}\""
  else
    interrupted_story_json="null"
  fi

  cat > "$tmp_file" << STATEEOF
{
  "version": 1,
  "prdFile": "${PRD_ABS_PATH}",
  "currentWave": ${CURRENT_WAVE},
  "activeEpics": ${active_epic_ids},
  "backend": "${BACKEND}",
  "parallel": "${PARALLEL}",
  "storyProgress": ${story_progress},
  "interruptedStoryId": ${interrupted_story_json},
  "timestamp": "$(date -u +%Y-%m-%dT%H:%M:%SZ)"
}
STATEEOF

  mv "$tmp_file" "${prd_dir}/ralph-state.json"
}

# SIGINT handler — kills active agents, saves state, then exits 130.
handle_sigint() {
  INTERRUPTED=true
  echo ""
  echo "Interrupt received — saving state..."

  # Kill all active agent processes
  for pid in "${active_pids[@]+"${active_pids[@]}"}"; do
    terminate_process_tree "$pid"
  done

  # Save run state atomically
  save_run_state

  echo "Run interrupted. Resume with: ralph-teams resume"
  exit 130
}

trap handle_sigint INT

# Detect circular dependencies before starting
detect_circular_deps "$PRD_FILE" "$TOTAL_EPICS"
normalize_epic_statuses
initialize_counters

# Cleanup worktrees on exit only when NOT interrupted (on interrupt, worktrees are preserved for resume)
trap 'if [ "$INTERRUPTED" = false ]; then cleanup_all_worktrees; fi; kill $(jobs -p) 2>/dev/null || true' EXIT

# process_epic_result: parse result file and update PRD status for a given epic index
process_epic_result() {
  local epic_index="$1"
  local epic_id
  epic_id=$(rjq read "$PRD_FILE" ".epics[$epic_index].id")
  local result_file="$(pwd)/results/result-${epic_id}.txt"

  if [ ! -f "$result_file" ]; then
    echo ""
    echo "  [$epic_id] FAILED — no result file found at $result_file"
    rjq set "$PRD_FILE" ".epics[$epic_index].status" '"failed"'
    FAILED=$((FAILED + 1))
    echo "[$epic_id] FAILED (no result file) — $(date)" >> "$PROGRESS_FILE"
    return
  fi

  local result
  result=$(cat "$result_file")

  if echo "$result" | grep -qi "^PASS$"; then
    echo ""
    echo "  [$epic_id] PASSED — all stories completed"
    rjq set "$PRD_FILE" ".epics[$epic_index].status" '"completed"'
    COMPLETED=$((COMPLETED + 1))
    echo "[$epic_id] PASSED — $(date)" >> "$PROGRESS_FILE"

  elif echo "$result" | grep -qi "^PARTIAL"; then
    echo ""
    echo "  [$epic_id] PARTIAL — $result"
    rjq set "$PRD_FILE" ".epics[$epic_index].status" '"partial"'
    echo "[$epic_id] PARTIAL — $(date) — $result" >> "$PROGRESS_FILE"

  else
    echo ""
    echo "  [$epic_id] FAILED — $result"
    rjq set "$PRD_FILE" ".epics[$epic_index].status" '"failed"'
    FAILED=$((FAILED + 1))
    echo "[$epic_id] FAILED — $(date) — $result" >> "$PROGRESS_FILE"
  fi
}

# spawn_epic_bg: create worktree, build prompt, and run team lead in the background.
# Sets LAST_SPAWN_PID to the background PID.
# Callers must wait on that PID and then call cleanup_epic_worktree + process_epic_result.
spawn_epic_bg() {
  local EPIC_INDEX="$1"
  local EPIC_ID
  EPIC_ID=$(rjq read "$PRD_FILE" ".epics[$EPIC_INDEX].id")
  local EPIC_TITLE
  EPIC_TITLE=$(rjq read "$PRD_FILE" ".epics[$EPIC_INDEX].title")
  local EPIC_JSON
  EPIC_JSON=$(rjq read "$PRD_FILE" ".epics[$EPIC_INDEX]")

  local RESULT_FILE="${ROOT_DIR}/results/result-${EPIC_ID}.txt"
  local EPIC_LOG="${ROOT_DIR}/logs/epic-${EPIC_ID}-$(date +%s).log"
  mkdir -p "${ROOT_DIR}/results" "${ROOT_DIR}/logs"
  rm -f "$RESULT_FILE"

  # Create isolated worktree for this epic
  local WORKTREE_PATH
  WORKTREE_PATH=$(create_epic_worktree "$EPIC_ID")
  local WORKTREE_ABS_PATH
  WORKTREE_ABS_PATH="$(cd "${ROOT_DIR}/${WORKTREE_PATH}" && pwd)"

  echo "  Spawning [$EPIC_ID] in worktree $WORKTREE_PATH"

  local TEAM_PROMPT="You are the Team Lead for this epic. Read the epic below and execute it.

## Project
$PROJECT

## Working Directory
ALL work for this epic MUST happen in this directory: $WORKTREE_ABS_PATH
Do NOT modify files outside this directory.

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
6. Immediately after writing the result file, print the same single-line result and exit the session. Do not remain idle.

## Critical Rules
- Do NOT stop after the first story — process ALL stories before writing the result file
- Idle or waiting messages from teammates are NORMAL — they do not mean the session should end
- Once the final result is written, end the session immediately. Do not wait for more input.
- Process stories sequentially: build → validate → next. Do not stop early.
- After each story result (pass or fail), update $PRD_ABS_PATH to set passes: true/false for that story

Begin."

  # Run agent in background; write all output to log file (no console streaming in parallel mode)
  if [ "$STREAM_FORMAT" = "stream-json" ]; then
    (
      echo "$TEAM_PROMPT" | $AGENT_CMD $AGENT_FLAGS > "$EPIC_LOG" 2>&1
    ) &
  else
    (
      COPILOT_TEAM_PROMPT="$TEAM_PROMPT" \
        script -q /dev/null /bin/sh -lc 'exec gh copilot -- --agent team-lead --allow-all --no-ask-user --stream on -p "$COPILOT_TEAM_PROMPT"' \
        > "$EPIC_LOG" 2>&1
    ) &
  fi
  LAST_SPAWN_PID=$!
  LAST_SPAWN_LOG="$EPIC_LOG"
}

# merge_wave: merges completed epic branches back to the target branch sequentially.
# Takes epic IDs as arguments. Clean merges succeed without AI intervention.
# On conflict, spawns the merger agent. Logs all outcomes to progress.txt.
merge_wave() {
  local -a completed_epic_ids=("$@")

  if [ ${#completed_epic_ids[@]} -eq 0 ]; then
    return 0
  fi

  echo ""
  echo "  --- Merging completed epic branches ---"

  local merge_failures=0
  local target_branch
  target_branch=$(rjq read "$PRD_FILE" .branchName "")
  [ -z "$target_branch" ] && target_branch=$(git branch --show-current)

  for epic_id in "${completed_epic_ids[@]}"; do
    local branch_name="ralph/${epic_id}"

    # Check if branch exists
    if ! git show-ref --verify --quiet "refs/heads/${branch_name}"; then
      echo "  [$epic_id] No branch ${branch_name} found — skipping merge"
      continue
    fi

    echo "  [$epic_id] Merging ${branch_name} → ${target_branch}"

    # Attempt clean merge first
    if git merge "${branch_name}" --no-edit 2>/dev/null; then
      echo "  [$epic_id] Merge successful (clean)"
      echo "[$epic_id] MERGED (clean) — $(date)" >> "$PROGRESS_FILE"
    else
      # Conflicts detected — attempt AI resolution via merger agent
      echo "  [$epic_id] conflicts detected — spawning merger agent..."
      echo "[$epic_id] merge conflicts — attempting AI resolution — $(date)" >> "$PROGRESS_FILE"

      # Get conflicted files for the prompt
      local conflicted_files
      conflicted_files=$(git diff --name-only --diff-filter=U 2>/dev/null || true)

      local merge_prompt="You are the Merger Agent. Resolve the git merge conflicts.

## Context
- Target branch: ${target_branch}
- Source branch: ${branch_name}
- Epic ID: ${epic_id}

## Conflicted Files
${conflicted_files}

## Instructions
1. For each conflicted file listed above, read the full file to see the conflict markers
2. Run: git log --oneline ${target_branch}..${branch_name} (what the epic branch changed)
3. Run: git log --oneline ${branch_name}..${target_branch} (what target changed since branch point)
4. Resolve each conflict by combining both sides' intent
5. Stage each resolved file with: git add <filename>
6. Do NOT commit — ralph.sh will create the merge commit
7. Do NOT run git merge --abort
8. If you cannot safely resolve a conflict, leave the conflict markers in place

Begin resolving."

      local merge_log="${ROOT_DIR}/logs/merge-${epic_id}-$(date +%s).log"

      case "$BACKEND" in
        claude)
          echo "$merge_prompt" | $AGENT_CMD --agent merger --dangerously-skip-permissions --print --verbose --output-format stream-json > "$merge_log" 2>&1 || true
          ;;
        copilot)
          COPILOT_MERGE_PROMPT="$merge_prompt" \
            script -q /dev/null /bin/sh -lc 'exec gh copilot -- --agent merger --allow-all --no-ask-user --stream on -p "$COPILOT_MERGE_PROMPT"' \
            > "$merge_log" 2>&1 || true
          ;;
      esac

      # Check for remaining unresolved conflicts
      local remaining_conflicts
      remaining_conflicts=$(git diff --name-only --diff-filter=U 2>/dev/null || true)

      # Also check if agent aborted the merge (MERGE_HEAD won't exist)
      if [ -z "$remaining_conflicts" ] && [ -f ".git/MERGE_HEAD" ]; then
        # All conflicts resolved — complete the merge commit
        git commit --no-edit 2>/dev/null || true
        echo "  [$epic_id] merged (AI-resolved conflicts)"
        echo "[$epic_id] MERGED (AI-resolved) — $(date)" >> "$PROGRESS_FILE"
        git branch -d "${branch_name}" 2>/dev/null || true
      else
        # AI failed or aborted — ensure clean state
        git merge --abort 2>/dev/null || true
        echo "  [$epic_id] Merge FAILED — AI could not resolve conflicts in: ${conflicted_files}"
        echo "[$epic_id] MERGE FAILED (AI resolution failed, files: ${conflicted_files}) — $(date)" >> "$PROGRESS_FILE"
        merge_failures=$((merge_failures + 1))

        # Update epic status to merge-failed
        local epic_index
        epic_index=$(rjq find-index "$PRD_FILE" .epics id "$epic_id")
        if [ -n "$epic_index" ]; then
          rjq set "$PRD_FILE" ".epics[$epic_index].status" '"merge-failed"'
        fi
      fi
    fi

    # Clean up the merged branch
    git branch -d "${branch_name}" 2>/dev/null || true
  done

  return $merge_failures
}

WAVE_NUM=0
while true; do
  # Find all epics ready for this wave
  WAVE_EPICS=()

  for EPIC_INDEX in $(seq 0 $((TOTAL_EPICS - 1))); do
    EPIC_STATUS=$(rjq read "$PRD_FILE" ".epics[$EPIC_INDEX].status" "pending")
    [ "$EPIC_STATUS" != "pending" ] && continue

    # Check all dependencies
    ALL_DEPS_MET=true
    DEPS=$(rjq list "$PRD_FILE" ".epics[$EPIC_INDEX].dependsOn")
    for DEP in $DEPS; do
      DEP_STATUS=$(rjq read-where "$PRD_FILE" .epics id "$DEP" status "pending")
      if [ "$DEP_STATUS" = "failed" ] || [ "$DEP_STATUS" = "partial" ] || [ "$DEP_STATUS" = "merge-failed" ]; then
        # Dependency failed — skip this epic permanently
        EPIC_ID=$(rjq read "$PRD_FILE" ".epics[$EPIC_INDEX].id")
        EPIC_TITLE=$(rjq read "$PRD_FILE" ".epics[$EPIC_INDEX].title")
        echo "  [$EPIC_ID] $EPIC_TITLE — skipped (dependency $DEP has status: $DEP_STATUS)"
        rjq set "$PRD_FILE" ".epics[$EPIC_INDEX].status" '"failed"'
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
  CURRENT_WAVE=$WAVE_NUM
  echo ""
  echo "========================================================"
  echo "  Wave $WAVE_NUM — ${#WAVE_EPICS[@]} epic(s)"
  echo "========================================================"

  # Log wave boundary to progress.txt
  echo "" >> "$PROGRESS_FILE"
  echo "=== Wave $WAVE_NUM — $(date) ===" >> "$PROGRESS_FILE"
  for IDX in "${WAVE_EPICS[@]}"; do
    W_EPIC_ID=$(rjq read "$PRD_FILE" ".epics[$IDX].id")
    echo "  $W_EPIC_ID" >> "$PROGRESS_FILE"
  done

  # Process epics in this wave with optional concurrency limit (PARALLEL).
  # Uses kill -0 polling to detect when a slot frees up, then starts the next
  # queued epic. All result processing happens after each epic finishes.
  if [ -n "$PARALLEL" ]; then
    local_max_slots="$PARALLEL"
    [ "$local_max_slots" -eq 0 ] && local_max_slots=${#WAVE_EPICS[@]}
  else
    local_max_slots=1
  fi

  # Reset script-level active tracking arrays for this wave
  # (active_pids and active_indices are script-level so SIGINT handler can access them)
  active_pids=()
  active_indices=()
  declare -a active_logs=()
  declare -a active_log_lines=()
  # wave_completed_ids collects epic IDs that completed successfully (for merge_wave)
  declare -a wave_completed_ids=()
  queue_pos=0

  # Helper: wait_for_one_slot — polls active_pids until a slot is free,
  # processes its result, and removes it from the arrays.
  wait_for_one_slot() {
    while true; do
      for slot in "${!active_pids[@]}"; do
        local finished_epic_id
        finished_epic_id=$(rjq read "$PRD_FILE" ".epics[${active_indices[$slot]}].id")
        local result_file="${ROOT_DIR}/results/result-${finished_epic_id}.txt"
        local process_finished=false

        emit_new_log_output "$finished_epic_id" "${active_logs[$slot]}" "${active_log_lines[$slot]:-0}"
        active_log_lines[$slot]="$LAST_LOG_LINE_COUNT"

        if ! kill -0 "${active_pids[$slot]}" 2>/dev/null; then
          process_finished=true
        fi

        if [ "$process_finished" = true ] || [ -f "$result_file" ]; then
          # If the result file exists, the epic is complete even if the backend
          # session is still idling. Terminate the lingering job and advance.
          if [ "$process_finished" = false ]; then
            terminate_process_tree "${active_pids[$slot]}"
          fi
          wait "${active_pids[$slot]}" 2>/dev/null || true
          echo "  [$finished_epic_id] finished — processing result"
          cleanup_epic_worktree "$finished_epic_id"
          process_epic_result "${active_indices[$slot]}"
          # Track completed epics for merge_wave
          local post_status
          post_status=$(rjq read "$PRD_FILE" ".epics[${active_indices[$slot]}].status" "pending")
          if [ "$post_status" = "completed" ]; then
            wave_completed_ids+=("$finished_epic_id")
          fi
          unset 'active_pids[$slot]'
          unset 'active_indices[$slot]'
          active_pids=("${active_pids[@]+"${active_pids[@]}"}")
          active_indices=("${active_indices[@]+"${active_indices[@]}"}")
          return
        fi

      done
      sleep 1
    done
  }

  while [ "$queue_pos" -lt "${#WAVE_EPICS[@]}" ]; do
    EPIC_INDEX="${WAVE_EPICS[$queue_pos]}"
    queue_pos=$((queue_pos + 1))

    # Check --max-epics limit
    if [ "$PROCESSED" -ge "$MAX_EPICS" ]; then
      echo "Reached max epics limit ($MAX_EPICS). Stopping."
      break
    fi

    EPIC_STATUS=$(rjq read "$PRD_FILE" ".epics[$EPIC_INDEX].status" "pending")
    if [ "$EPIC_STATUS" = "completed" ]; then
      local_epic_id=$(rjq read "$PRD_FILE" ".epics[$EPIC_INDEX].id")
      local_epic_title=$(rjq read "$PRD_FILE" ".epics[$EPIC_INDEX].title")
      echo "  [$local_epic_id] $local_epic_title — already completed, skipping"
      COMPLETED=$((COMPLETED + 1))
      continue
    fi

    # Wait for a free slot if at capacity
    while [ "${#active_pids[@]}" -ge "$local_max_slots" ]; do
      wait_for_one_slot
    done

    PROCESSED=$((PROCESSED + 1))
    spawn_epic_bg "$EPIC_INDEX"
    active_pids+=("$LAST_SPAWN_PID")
    active_indices+=("$EPIC_INDEX")
    active_logs+=("$LAST_SPAWN_LOG")
    active_log_lines+=("0")
  done

  # Wait for all remaining active processes to finish
  while [ "${#active_pids[@]}" -gt 0 ]; do
    wait_for_one_slot
  done

  # Merge completed epic branches back to starting branch
  if [ ${#wave_completed_ids[@]} -gt 0 ]; then
    merge_wave "${wave_completed_ids[@]}"
  fi

  # If we hit --max-epics mid-wave, stop processing further waves
  if [ "$PROCESSED" -ge "$MAX_EPICS" ] && [ "$queue_pos" -lt "${#WAVE_EPICS[@]}" ]; then
    break
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
