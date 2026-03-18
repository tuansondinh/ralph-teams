#!/bin/bash
# Ralph Teams — Project Manager Shell Harness
# Ralph never writes code. Ralph schedules epics and spawns teams.
#
# Usage: ./ralph.sh [prd.json] [--max-epics N] [--backend claude|copilot|codex|opencode] [--parallel N]

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
TEAM_LEAD_POLICY_FILE="${SCRIPT_DIR}/prompts/team-lead-policy.md"

# --- Config ---
PRD_FILE="${1:-prd.json}"
MAX_EPICS=10
RALPH_RUNTIME_DIRNAME=".ralph-teams"
PROGRESS_FILE=""
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
IDLE_TIMEOUT="${RALPH_IDLE_TIMEOUT:-600}"
MAX_CRASH_RETRIES="${RALPH_MAX_CRASH_RETRIES:-2}"
VALIDATOR_MAX_PUSHBACKS="${RALPH_VALIDATOR_MAX_PUSHBACKS:-1}"
MODEL_TEAM_LEAD="${RALPH_MODEL_TEAM_LEAD:-opus}"
MODEL_PLANNER="${RALPH_MODEL_PLANNER:-opus}"
MODEL_BUILDER="${RALPH_MODEL_BUILDER:-sonnet}"
MODEL_VALIDATOR="${RALPH_MODEL_VALIDATOR:-sonnet}"
MODEL_MERGER="${RALPH_MODEL_MERGER:-sonnet}"
# Only apply RALPH_PARALLEL env var if --parallel flag was not provided
if [ -z "$PARALLEL" ] && [ -n "${RALPH_PARALLEL:-}" ] && [ "${RALPH_PARALLEL}" != "0" ]; then
  PARALLEL="$RALPH_PARALLEL"
fi

map_model_for_backend() {
  local backend="$1"
  local model="$2"

  case "$backend:$model" in
    claude:haiku|claude:sonnet|claude:opus)
      echo "$model"
      ;;
    copilot:haiku)
      echo "gpt-5-mini"
      ;;
    copilot:sonnet)
      echo "gpt-5.3-codex"
      ;;
    copilot:opus)
      echo "gpt-5.4"
      ;;
    codex:haiku)
      echo "gpt-5-mini"
      ;;
    codex:sonnet)
      echo "gpt-5.3-codex"
      ;;
    codex:opus)
      echo "gpt-5.4"
      ;;
    opencode:haiku)
      echo "openai/gpt-5-mini"
      ;;
    opencode:sonnet)
      echo "openai/gpt-5.3-codex"
      ;;
    opencode:opus)
      echo "openai/gpt-5.4"
      ;;
    *)
      echo "$model"
      ;;
  esac
}

MODEL_TEAM_LEAD="$(map_model_for_backend "$BACKEND" "$MODEL_TEAM_LEAD")"
MODEL_PLANNER="$(map_model_for_backend "$BACKEND" "$MODEL_PLANNER")"
MODEL_BUILDER="$(map_model_for_backend "$BACKEND" "$MODEL_BUILDER")"
MODEL_VALIDATOR="$(map_model_for_backend "$BACKEND" "$MODEL_VALIDATOR")"
MODEL_MERGER="$(map_model_for_backend "$BACKEND" "$MODEL_MERGER")"

resolve_rjq_bin() {
  local candidates=()

  if [ -n "${RALPH_RJQ_BIN:-}" ]; then
    candidates+=("${RALPH_RJQ_BIN}")
  fi
  candidates+=(
    "${SCRIPT_DIR}/dist/json-tool.js"
    "${SCRIPT_DIR}/node_modules/.bin/rjq"
  )

  local candidate
  for candidate in "${candidates[@]}"; do
    if [ -n "$candidate" ] && [ -f "$candidate" ] && [ -x "$candidate" ]; then
      echo "$candidate"
      return 0
    fi
  done

  if command -v rjq >/dev/null 2>&1; then
    command -v rjq
    return 0
  fi

  return 1
}

RJQ_BIN="$(resolve_rjq_bin || true)"

rjq() {
  if [ -z "${RJQ_BIN:-}" ]; then
    echo "Error: rjq binary is not configured." >&2
    exit 1
  fi

  if [ ! -e "$RJQ_BIN" ]; then
    echo "Error: resolved rjq binary does not exist: $RJQ_BIN" >&2
    exit 1
  fi

  case "$RJQ_BIN" in
    *.js)
      node "$RJQ_BIN" "$@"
      ;;
    *)
      "$RJQ_BIN" "$@"
      ;;
  esac
}

export RALPH_MODEL_TEAM_LEAD="$MODEL_TEAM_LEAD"
export RALPH_MODEL_PLANNER="$MODEL_PLANNER"
export RALPH_MODEL_BUILDER="$MODEL_BUILDER"
export RALPH_MODEL_VALIDATOR="$MODEL_VALIDATOR"
export RALPH_MODEL_MERGER="$MODEL_MERGER"

# --- Backend configuration ---
case "$BACKEND" in
  claude)
    AGENT_CMD="claude"
    AGENT_FLAGS="--agent team-lead --model $MODEL_TEAM_LEAD --dangerously-skip-permissions --print --verbose --output-format stream-json"
    STREAM_FORMAT="stream-json"
    ;;
  copilot)
    AGENT_CMD="gh"
    # Copilot uses -p for non-interactive, --allow-all for full permissions
    # --agent team-lead loads .github/agents/team-lead.agent.md
    # --no-ask-user for autonomous execution, --stream on for live output
    AGENT_FLAGS="copilot -- --agent team-lead --model $MODEL_TEAM_LEAD --allow-all --no-ask-user --stream on -p"
    STREAM_FORMAT="text"
    ;;
  codex)
    AGENT_CMD="codex"
    AGENT_FLAGS=""
    STREAM_FORMAT="text"
    ;;
  opencode)
    AGENT_CMD="opencode"
    AGENT_FLAGS=""
    STREAM_FORMAT="stream-json"
    ;;
  *)
    echo "Error: Unknown backend '$BACKEND'. Use 'claude', 'copilot', 'codex', or 'opencode'."
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

if [ "$BACKEND" = "codex" ] && ! command -v codex &> /dev/null; then
  echo "Error: 'codex' CLI not found. Install Codex CLI first."
  exit 1
fi

if [ "$BACKEND" = "opencode" ] && ! command -v opencode &> /dev/null; then
  echo "Error: 'opencode' CLI not found. Install OpenCode CLI first."
  exit 1
fi

if [ -z "$RJQ_BIN" ]; then
  echo "Error: 'rjq' not found. Expected a bundled json tool at ${SCRIPT_DIR}/dist/json-tool.js or an rjq binary on PATH."
  exit 1
fi

if [ ! -f "$TEAM_LEAD_POLICY_FILE" ]; then
  echo "Error: Team Lead policy file not found at '$TEAM_LEAD_POLICY_FILE'."
  exit 1
fi

# --- Validate PRD file exists ---
if [ ! -f "$PRD_FILE" ]; then
  echo "Error: PRD file '$PRD_FILE' not found."
  echo "Usage: ./ralph.sh [prd.json] [--max-epics N]"
  exit 1
fi

ROOT_DIR="$(pwd)"
RALPH_RUNTIME_DIR="${ROOT_DIR}/${RALPH_RUNTIME_DIRNAME}"
PROGRESS_FILE="${RALPH_RUNTIME_DIR}/progress.txt"
PLANS_DIR="${RALPH_RUNTIME_DIR}/plans"
LOGS_DIR="${RALPH_RUNTIME_DIR}/logs"
STATE_DIR="${RALPH_RUNTIME_DIR}/state"
WORKTREES_DIR="${RALPH_RUNTIME_DIR}/.worktrees"
mkdir -p "$RALPH_RUNTIME_DIR" "$PLANS_DIR" "$LOGS_DIR" "$STATE_DIR" "$WORKTREES_DIR"

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
TOTAL_EPICS=$(rjq length "$PRD_FILE" .epics)

STATE_FILE="$(cd "$(dirname "$PRD_FILE")" && pwd)/${RALPH_RUNTIME_DIRNAME}/ralph-state.json"
LOOP_BRANCH_PREFIX="ralph/loop"
CURRENT_BRANCH=$(git branch --show-current 2>/dev/null || echo "")
SOURCE_BRANCH="$CURRENT_BRANCH"
LOOP_BRANCH=""
IS_RESUME="${RALPH_RESUME:-0}"

generate_loop_branch_name() {
  echo "${LOOP_BRANCH_PREFIX}/$(date +%Y%m%d-%H%M%S)"
}

if [ "$IS_RESUME" = "1" ] && [ -f "$STATE_FILE" ]; then
  LOOP_BRANCH=$(rjq read "$STATE_FILE" .loopBranch "" 2>/dev/null || echo "")
  STATE_SOURCE_BRANCH=$(rjq read "$STATE_FILE" .sourceBranch "" 2>/dev/null || echo "")
  if [ -n "$STATE_SOURCE_BRANCH" ]; then
    SOURCE_BRANCH="$STATE_SOURCE_BRANCH"
  fi
fi

if [ -z "$LOOP_BRANCH" ] && [[ "$CURRENT_BRANCH" == ${LOOP_BRANCH_PREFIX}/* ]]; then
  LOOP_BRANCH="$CURRENT_BRANCH"
fi

if [ -z "$CURRENT_BRANCH" ]; then
  echo "Error: unable to determine the current git branch."
  exit 1
fi

if [ -z "$LOOP_BRANCH" ]; then
  LOOP_BRANCH=$(generate_loop_branch_name)
fi

echo ""
echo "========================================================"
echo "  Ralph Teams — Project Manager"
echo "  Project: $PROJECT"
echo "  Source Branch: ${SOURCE_BRANCH:-<unknown>}"
echo "  Loop Branch: $LOOP_BRANCH"
echo "  Epics: $TOTAL_EPICS"
echo "  Backend: $BACKEND"
if [ -n "$PARALLEL" ]; then
  echo "  Parallel: $PARALLEL"
else
  echo "  Mode: sequential"
fi
echo "  Models: team-lead=$MODEL_TEAM_LEAD  planner=$MODEL_PLANNER  builder=$MODEL_BUILDER  validator=$MODEL_VALIDATOR  merger=$MODEL_MERGER"
echo "========================================================"

ensure_runtime_gitignore_entries() {
  local gitignore_file=".gitignore"
  local changed=0
  local entries=(".ralph-teams/")

  [ -f "$gitignore_file" ] || : > "$gitignore_file"

  local entry
  for entry in "${entries[@]}"; do
    if ! grep -Fqx "$entry" "$gitignore_file" 2>/dev/null; then
      printf '%s\n' "$entry" >> "$gitignore_file"
      changed=1
    fi
  done

  if [ "$changed" -eq 1 ]; then
    echo "Updated .gitignore with Ralph runtime directory"
  fi
}

prompt_to_commit_dirty_worktree() {
  local target_branch="$1"

  echo "Worktree has uncommitted changes and Ralph needs to create or switch to branch '$target_branch'."
  echo "Ralph will now stage and commit all current changes before the run."
  git status --short
  git add -A
  git commit -m "chore: auto-commit changes before ralph run"
}

auto_remove_stale_worktree_dir() {
  local worktree_path="$1"
  local branch_name="$2"

  echo "Found a stale worktree directory at '$worktree_path' for branch '$branch_name'." >&2
  echo "Git does not recognize it as an active worktree, but the directory still exists on disk." >&2
  echo "Removing the stale directory so Ralph can recreate the worktree." >&2
  rm -rf "$worktree_path"
}

cleanup_epic_worktree_artifacts() {
  local worktree_path="$1"
  local branch_name="$2"

  # Prune stale git worktree metadata before cleanup.
  git worktree prune >/dev/null 2>&1 || true

  # Remove stale worktree entry if it exists.
  git worktree remove "$worktree_path" --force >/dev/null 2>&1 || true

  # If Git no longer knows about the worktree but the directory is still on disk,
  # remove the stale directory so a fresh worktree can be created.
  if [ -d "$worktree_path" ]; then
    auto_remove_stale_worktree_dir "$worktree_path" "$branch_name"
  fi

  # Remove a leftover branch from a partial worktree-add attempt.
  git branch -D "$branch_name" >/dev/null 2>&1 || true
}

# --- Ensure loop branch exists and is checked out ---
ensure_runtime_gitignore_entries

mkdir -p "$RALPH_RUNTIME_DIR" "$PLANS_DIR" "$LOGS_DIR" "$STATE_DIR" "$WORKTREES_DIR"

ensure_loop_branch_ready() {
  local checkout_output=""

  if [ "$CURRENT_BRANCH" != "$LOOP_BRANCH" ]; then
    if ! git diff --quiet 2>/dev/null || ! git diff --cached --quiet 2>/dev/null; then
      prompt_to_commit_dirty_worktree "$LOOP_BRANCH"
    fi

    if git show-ref --verify --quiet "refs/heads/${LOOP_BRANCH}"; then
      echo "Switching to loop branch: $LOOP_BRANCH"
      if ! checkout_output=$(git checkout "$LOOP_BRANCH" 2>&1 >/dev/null); then
        echo "Error: failed to switch to loop branch '$LOOP_BRANCH'." >&2
        [ -n "$checkout_output" ] && echo "$checkout_output" >&2
        exit 1
      fi
    else
      echo "Creating loop branch: $LOOP_BRANCH (from $CURRENT_BRANCH)"
      if ! checkout_output=$(git checkout -b "$LOOP_BRANCH" 2>&1 >/dev/null); then
        echo "Error: failed to create loop branch '$LOOP_BRANCH' from '$CURRENT_BRANCH'." >&2
        [ -n "$checkout_output" ] && echo "$checkout_output" >&2
        exit 1
      fi
    fi
  fi

  if ! git show-ref --verify --quiet "refs/heads/${LOOP_BRANCH}"; then
    echo "Error: loop branch '$LOOP_BRANCH' does not exist locally after setup." >&2
    exit 1
  fi

  CURRENT_BRANCH=$(git branch --show-current 2>/dev/null || echo "")
  if [ "$CURRENT_BRANCH" != "$LOOP_BRANCH" ]; then
    echo "Error: expected current branch '$LOOP_BRANCH' after setup, got '${CURRENT_BRANCH:-<none>}'." >&2
    exit 1
  fi
}

ensure_loop_branch_ready

# --- Worktree Management ---
# Creates a git worktree at .worktrees/<epic_id> on branch ralph/<epic_id>,
# rooted from the loop branch for this run.
# If the worktree already exists and is valid (e.g. from an interrupted run),
# it is reused as-is. Otherwise, any stale entries are cleaned up first.
create_epic_worktree() {
  local epic_id="$1"
  local branch_name="ralph/${epic_id}"
  local worktree_path="${RALPH_RUNTIME_DIRNAME}/.worktrees/${epic_id}"
  local add_output
  local retry_output

  # Reuse existing worktree if it is already registered and present on disk
  if [ -d "$worktree_path" ] && git worktree list | grep -Fq "$worktree_path"; then
    echo "$worktree_path"
    return
  fi

  cleanup_epic_worktree_artifacts "$worktree_path" "$branch_name"

  if add_output=$(git worktree add "$worktree_path" -b "$branch_name" "$LOOP_BRANCH" 2>&1 >/dev/null); then
    echo "$worktree_path"
    return
  fi

  echo "Worktree creation for '$branch_name' failed on the first attempt; pruning stale state and retrying once." >&2
  [ -n "$add_output" ] && echo "$add_output" >&2

  cleanup_epic_worktree_artifacts "$worktree_path" "$branch_name"

  if ! retry_output=$(git worktree add "$worktree_path" -b "$branch_name" "$LOOP_BRANCH" 2>&1 >/dev/null); then
    echo "Error: failed to create worktree $worktree_path for $branch_name" >&2
    [ -n "$retry_output" ] && echo "$retry_output" >&2
    exit 1
  fi
  echo "$worktree_path"
}

ensure_worktree_runtime_link() {
  local worktree_abs_path="$1"
  local worktree_runtime_path="${worktree_abs_path}/${RALPH_RUNTIME_DIRNAME}"

  if [ -L "$worktree_runtime_path" ]; then
    return 0
  fi

  if [ -e "$worktree_runtime_path" ] && [ ! -L "$worktree_runtime_path" ]; then
    rm -rf "$worktree_runtime_path"
  fi

  ln -s "$RALPH_RUNTIME_DIR" "$worktree_runtime_path"
}

# Removes a worktree. The branch is kept for potential merge by a later agent.
cleanup_epic_worktree() {
  local epic_id="$1"
  git worktree remove "${RALPH_RUNTIME_DIRNAME}/.worktrees/${epic_id}" --force 2>/dev/null || true
}

# Removes ALL .worktrees/* entries (used on EXIT).
cleanup_all_worktrees() {
  for dir in "${RALPH_RUNTIME_DIRNAME}"/.worktrees/*/; do
    [ -d "$dir" ] && git worktree remove "$dir" --force 2>/dev/null || true
  done
}

get_file_mtime() {
  local file="$1"
  if [ ! -f "$file" ]; then
    echo "0"
    return
  fi
  # macOS: stat -f %m, Linux: stat -c %Y
  if stat -f %m "$file" 2>/dev/null; then
    return
  fi
  stat -c %Y "$file" 2>/dev/null || echo "0"
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
            if [ "$BACKEND" = "codex" ] && is_codex_noise_line "$log_line"; then
              continue
            fi
            echo "  [$epic_id] $log_line"
          fi
        done
  fi

  LAST_LOG_LINE_COUNT="$current_line_count"
}

is_codex_noise_line() {
  local line="$1"
  local trimmed
  trimmed=$(printf '%s' "$line" | sed 's/^[[:space:]]*//; s/[[:space:]]*$//')

  [ -z "$trimmed" ] && return 0

  # Codex can emit one bare repo-relative path per tool step, which is useful
  # in the raw log but too noisy in the main progress stream.
  if [[ "$trimmed" =~ ^\./[^[:space:]]+$ || "$trimmed" =~ ^src/[^[:space:]]+$ || "$trimmed" =~ ^test/[^[:space:]]+$ ]]; then
    return 0
  fi

  return 1
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
active_start_times=()

# Track the currently-processing story ID so SIGINT can capture it
CURRENT_STORY_ID=""

# Resolve absolute path to PRD file so team lead always has the correct path
PRD_ABS_PATH="$(cd "$(dirname "$PRD_FILE")" && pwd)/$(basename "$PRD_FILE")"
if [ "${PRD_ABS_PATH#"$ROOT_DIR"/}" != "$PRD_ABS_PATH" ]; then
  PRD_REL_PATH="${PRD_ABS_PATH#"$ROOT_DIR"/}"
else
  PRD_REL_PATH="$(basename "$PRD_FILE")"
fi
OPENCODE_AGENT_DIR="${SCRIPT_DIR}/agent"
CODEX_AGENT_DIR="${SCRIPT_DIR}/.codex/agents"
CODEX_AGENT_RUNTIME_DIR=""

write_codex_agent_config() {
  local source_file="$1"
  local output_file="$2"
  local model="$3"

  {
    printf 'sandbox_mode = "workspace-write"\n'
    printf 'model = "%s"\n' "$model"
    sed '1{/^sandbox_mode = /d;}' "$source_file"
  } > "$output_file"
}

prepare_codex_agent_configs() {
  [ "$BACKEND" = "codex" ] || return 0

  CODEX_AGENT_RUNTIME_DIR=$(mktemp -d "${TMPDIR:-/tmp}/ralph-codex-agents.XXXXXX")

  local planner_model_easy="$MODEL_PLANNER"
  local planner_model_medium="$MODEL_PLANNER"
  local planner_model_difficult="$MODEL_PLANNER"
  local builder_model_easy="$MODEL_BUILDER"
  local builder_model_medium="$MODEL_BUILDER"
  local builder_model_difficult="$MODEL_BUILDER"
  local validator_model_easy="$MODEL_VALIDATOR"
  local validator_model_medium="$MODEL_VALIDATOR"
  local validator_model_difficult="$MODEL_VALIDATOR"

  if [ "${RALPH_MODEL_PLANNER_EXPLICIT:-0}" != "1" ]; then
    planner_model_easy="$(map_model_for_backend codex haiku)"
    planner_model_medium="$(map_model_for_backend codex sonnet)"
    planner_model_difficult="$(map_model_for_backend codex opus)"
  fi

  if [ "${RALPH_MODEL_BUILDER_EXPLICIT:-0}" != "1" ]; then
    builder_model_easy="$(map_model_for_backend codex haiku)"
    builder_model_medium="$(map_model_for_backend codex sonnet)"
    builder_model_difficult="$(map_model_for_backend codex opus)"
  fi

  if [ "${RALPH_MODEL_VALIDATOR_EXPLICIT:-0}" != "1" ]; then
    validator_model_easy="$(map_model_for_backend codex haiku)"
    validator_model_medium="$(map_model_for_backend codex sonnet)"
    validator_model_difficult="$(map_model_for_backend codex opus)"
  fi

  write_codex_agent_config "${CODEX_AGENT_DIR}/planner.toml" "${CODEX_AGENT_RUNTIME_DIR}/planner-easy.toml" "$planner_model_easy"
  write_codex_agent_config "${CODEX_AGENT_DIR}/planner.toml" "${CODEX_AGENT_RUNTIME_DIR}/planner-medium.toml" "$planner_model_medium"
  write_codex_agent_config "${CODEX_AGENT_DIR}/planner.toml" "${CODEX_AGENT_RUNTIME_DIR}/planner-difficult.toml" "$planner_model_difficult"

  write_codex_agent_config "${CODEX_AGENT_DIR}/builder.toml" "${CODEX_AGENT_RUNTIME_DIR}/builder-easy.toml" "$builder_model_easy"
  write_codex_agent_config "${CODEX_AGENT_DIR}/builder.toml" "${CODEX_AGENT_RUNTIME_DIR}/builder-medium.toml" "$builder_model_medium"
  write_codex_agent_config "${CODEX_AGENT_DIR}/builder.toml" "${CODEX_AGENT_RUNTIME_DIR}/builder-difficult.toml" "$builder_model_difficult"

  write_codex_agent_config "${CODEX_AGENT_DIR}/validator.toml" "${CODEX_AGENT_RUNTIME_DIR}/validator-easy.toml" "$validator_model_easy"
  write_codex_agent_config "${CODEX_AGENT_DIR}/validator.toml" "${CODEX_AGENT_RUNTIME_DIR}/validator-medium.toml" "$validator_model_medium"
  write_codex_agent_config "${CODEX_AGENT_DIR}/validator.toml" "${CODEX_AGENT_RUNTIME_DIR}/validator-difficult.toml" "$validator_model_difficult"

  write_codex_agent_config "${CODEX_AGENT_DIR}/merger.toml" "${CODEX_AGENT_RUNTIME_DIR}/merger.toml" "$MODEL_MERGER"
}

run_codex_exec() {
  local workdir="$1"
  local prompt="$2"
  shift 2

  printf '%s' "$prompt" | codex \
    -a never \
    exec \
    -C "$workdir" \
    -m "$MODEL_TEAM_LEAD" \
    -s workspace-write \
    --skip-git-repo-check \
    --color never \
    --enable multi_agent \
    -c "agents.max_threads=3" \
    -c "agents.max_depth=2" \
    -c "agents.planner_easy.description='Implementation planner for easy Ralph tasks'" \
    -c "agents.planner_easy.config_file='${CODEX_AGENT_RUNTIME_DIR}/planner-easy.toml'" \
    -c "agents.planner_medium.description='Implementation planner for normal Ralph tasks'" \
    -c "agents.planner_medium.config_file='${CODEX_AGENT_RUNTIME_DIR}/planner-medium.toml'" \
    -c "agents.planner_difficult.description='Implementation planner for difficult Ralph tasks'" \
    -c "agents.planner_difficult.config_file='${CODEX_AGENT_RUNTIME_DIR}/planner-difficult.toml'" \
    -c "agents.builder_easy.description='Implementation builder for easy Ralph stories'" \
    -c "agents.builder_easy.config_file='${CODEX_AGENT_RUNTIME_DIR}/builder-easy.toml'" \
    -c "agents.builder_medium.description='Implementation builder for normal Ralph stories'" \
    -c "agents.builder_medium.config_file='${CODEX_AGENT_RUNTIME_DIR}/builder-medium.toml'" \
    -c "agents.builder_difficult.description='Implementation builder for difficult Ralph stories'" \
    -c "agents.builder_difficult.config_file='${CODEX_AGENT_RUNTIME_DIR}/builder-difficult.toml'" \
    -c "agents.validator_easy.description='Independent validator for easy Ralph stories'" \
    -c "agents.validator_easy.config_file='${CODEX_AGENT_RUNTIME_DIR}/validator-easy.toml'" \
    -c "agents.validator_medium.description='Independent validator for normal Ralph stories'" \
    -c "agents.validator_medium.config_file='${CODEX_AGENT_RUNTIME_DIR}/validator-medium.toml'" \
    -c "agents.validator_difficult.description='Independent validator for difficult Ralph stories'" \
    -c "agents.validator_difficult.config_file='${CODEX_AGENT_RUNTIME_DIR}/validator-difficult.toml'" \
    "$@" \
    -
}

run_opencode_exec() {
  local workdir="$1"
  local prompt="$2"
  local agent_name="$3"
  local model="$4"
  shift 4

  opencode run \
    --format json \
    --dir "$workdir" \
    --agent "$agent_name" \
    --model "$model" \
    "$@" \
    "$prompt"
}

normalize_epic_statuses() {
  local updated=false

  for epic_index in $(seq 0 $((TOTAL_EPICS - 1))); do
    local epic_status
    epic_status=$(rjq read "$PRD_FILE" ".epics[$epic_index].status" "pending")
    local epic_id
    epic_id=$(rjq read "$PRD_FILE" ".epics[$epic_index].id")

    if [ "$epic_status" = "failed" ] || [ "$epic_status" = "partial" ]; then
      echo "  [$epic_id] previous status ${epic_status} — resetting to pending for rerun"
      rjq set "$PRD_FILE" ".epics[$epic_index].status" '"pending"'
      echo "[$epic_id] RETRY RESET (${epic_status} -> pending) — $(date)" >> "$PROGRESS_FILE"
      epic_status="pending"
      updated=true
    fi

    [ "$epic_status" != "pending" ] && continue

    local story_count
    story_count=$(rjq length "$PRD_FILE" ".epics[$epic_index].userStories")
    [ "$story_count" -eq 0 ] && continue

    local passed_count
    passed_count=$(rjq count-where "$PRD_FILE" ".epics[$epic_index].userStories" "passes=true")

    if [ "$passed_count" -eq "$story_count" ]; then
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
  mkdir -p "$RALPH_RUNTIME_DIR"

  # Project latest state before saving
  for idx in "${active_indices[@]+"${active_indices[@]}"}"; do
    local _ep_id
    _ep_id=$(rjq read "$PRD_FILE" ".epics[$idx].id" 2>/dev/null || true)
    [ -n "$_ep_id" ] && project_state_to_prd "$_ep_id" 2>/dev/null || true
  done

  local tmp_file
  tmp_file=$(mktemp "${RALPH_RUNTIME_DIR}/.ralph-state.json.XXXXXX")

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
  "sourceBranch": "${SOURCE_BRANCH}",
  "loopBranch": "${LOOP_BRANCH}",
  "currentWave": ${CURRENT_WAVE},
  "activeEpics": ${active_epic_ids},
  "backend": "${BACKEND}",
  "parallel": "${PARALLEL}",
  "storyProgress": ${story_progress},
  "interruptedStoryId": ${interrupted_story_json},
  "timestamp": "$(date -u +%Y-%m-%dT%H:%M:%SZ)"
}
STATEEOF

  mv "$tmp_file" "$STATE_FILE"
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
prepare_codex_agent_configs

# Cleanup worktrees on exit only when NOT interrupted (on interrupt, worktrees are preserved for resume)
trap 'if [ "$INTERRUPTED" = false ]; then cleanup_all_worktrees; fi; [ -n "${CODEX_AGENT_RUNTIME_DIR:-}" ] && rm -rf "${CODEX_AGENT_RUNTIME_DIR}"; kill $(jobs -p) 2>/dev/null || true' EXIT

# process_epic_result: derive epic result from prd.json story passes and update PRD status
process_epic_result() {
  local epic_index="$1"
  local epic_id
  epic_id=$(rjq read "$PRD_FILE" ".epics[$epic_index].id")

  local total_stories
  total_stories=$(rjq length "$PRD_FILE" ".epics[$epic_index].userStories")
  local passed_stories
  passed_stories=$(rjq count-where "$PRD_FILE" ".epics[$epic_index].userStories" "passes=true")

  if [ "$passed_stories" -eq "$total_stories" ] && [ "$total_stories" -gt 0 ]; then
    echo ""
    echo "  [$epic_id] PASSED — all stories completed ($passed_stories/$total_stories)"
    rjq set "$PRD_FILE" ".epics[$epic_index].status" '"completed"'
    COMPLETED=$((COMPLETED + 1))
    echo "[$epic_id] PASSED — $(date)" >> "$PROGRESS_FILE"
  elif [ "$passed_stories" -gt 0 ]; then
    echo ""
    echo "  [$epic_id] PARTIAL — $passed_stories/$total_stories stories passed"
    rjq set "$PRD_FILE" ".epics[$epic_index].status" '"partial"'
    echo "[$epic_id] PARTIAL ($passed_stories/$total_stories) — $(date)" >> "$PROGRESS_FILE"
  else
    echo ""
    echo "  [$epic_id] FAILED — 0/$total_stories stories passed"
    rjq set "$PRD_FILE" ".epics[$epic_index].status" '"failed"'
    FAILED=$((FAILED + 1))
    echo "[$epic_id] FAILED (0/$total_stories) — $(date)" >> "$PROGRESS_FILE"
  fi
}

init_epic_state_file() {
  local epic_id="$1"
  local epic_index="$2"
  local state_file="${STATE_DIR}/${epic_id}.json"

  # Read current story states from PRD to seed the state file
  # (handles resume case where some stories already passed)
  local stories_json
  stories_json=$(
    node - "$PRD_FILE" "$epic_index" <<'NODE'
const fs = require('fs');
const [prdPath, epicIndex] = process.argv.slice(2);
const prd = JSON.parse(fs.readFileSync(prdPath, 'utf8'));
const epic = prd.epics[parseInt(epicIndex)];
const stories = {};
for (const s of epic.userStories) {
  stories[s.id] = { passes: s.passes === true, failureReason: s.failureReason || null };
}
const result = { epicId: epic.id, stories };
process.stdout.write(JSON.stringify(result, null, 2));
NODE
  ) || return 1

  local tmp_file
  tmp_file=$(mktemp "${STATE_DIR}/.${epic_id}.json.XXXXXX")
  printf '%s\n' "$stories_json" > "$tmp_file"
  mv "$tmp_file" "$state_file"
}

read_epic_state_passed() {
  local epic_id="$1"
  local state_file="${STATE_DIR}/${epic_id}.json"
  [ -f "$state_file" ] || { echo "0"; return; }

  node - "$state_file" <<'NODE'
const fs = require('fs');
const state = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
const passed = Object.values(state.stories).filter(s => s.passes === true).length;
process.stdout.write(String(passed));
NODE
}

project_state_to_prd() {
  local epic_id="$1"
  local state_file="${STATE_DIR}/${epic_id}.json"
  [ -f "$state_file" ] || return 1

  local merge_status
  merge_status=$(
    node - "$PRD_FILE" "$state_file" "$epic_id" <<'NODE'
const fs = require('fs');
const [prdPath, statePath, epicId] = process.argv.slice(2);
const prd = JSON.parse(fs.readFileSync(prdPath, 'utf8'));
const state = JSON.parse(fs.readFileSync(statePath, 'utf8'));
const epicIndex = prd.epics.findIndex(e => e.id === epicId);
if (epicIndex === -1) process.exit(2);

let changed = false;
for (const story of prd.epics[epicIndex].userStories) {
  const s = state.stories[story.id];
  if (!s) continue;
  if (story.passes !== s.passes || story.failureReason !== s.failureReason) {
    story.passes = s.passes;
    story.failureReason = s.failureReason;
    changed = true;
  }
}

if (!changed) {
  process.stdout.write('unchanged');
  process.exit(0);
}

const tmpPath = `${prdPath}.tmp.${process.pid}`;
fs.writeFileSync(tmpPath, `${JSON.stringify(prd, null, 2)}\n`);
fs.renameSync(tmpPath, prdPath);
process.stdout.write('updated');
NODE
  ) || return 1

  if [ "$merge_status" = "updated" ]; then
    echo "  [$epic_id] Projected state to PRD"
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
  local PENDING_STORIES_JSON
  PENDING_STORIES_JSON=$(rjq read "$PRD_FILE" ".epics[$EPIC_INDEX].userStories" | \
    node -e 'const fs=require("fs"); const stories=JSON.parse(fs.readFileSync(0,"utf8")); process.stdout.write(JSON.stringify(stories.filter(s => s.passes !== true)));')

  local EPIC_LOG="${LOGS_DIR}/epic-${EPIC_ID}-$(date +%s).log"

  # Create isolated worktree for this epic
  local WORKTREE_PATH
  WORKTREE_PATH=$(create_epic_worktree "$EPIC_ID")
  local WORKTREE_ABS_PATH
  WORKTREE_ABS_PATH="$(cd "${ROOT_DIR}/${WORKTREE_PATH}" && pwd)"
  ensure_worktree_runtime_link "$WORKTREE_ABS_PATH"
  local WORKTREE_PRD_PATH="${WORKTREE_ABS_PATH}/${PRD_REL_PATH}"
  local WORKTREE_STATE_FILE="${WORKTREE_ABS_PATH}/${RALPH_RUNTIME_DIRNAME}/state/${EPIC_ID}.json"
  local WORKTREE_PLAN_FILE="${WORKTREE_ABS_PATH}/${RALPH_RUNTIME_DIRNAME}/plans/plan-${EPIC_ID}.md"

  init_epic_state_file "$EPIC_ID" "$EPIC_INDEX"

  echo "  Spawning [$EPIC_ID] in worktree $WORKTREE_PATH"

  local TEAM_LEAD_POLICY
  TEAM_LEAD_POLICY="$(cat "$TEAM_LEAD_POLICY_FILE")"

  local TEAM_PROMPT="You are the Team Lead for this epic. Read the epic below and execute it.

## Project
$PROJECT

## Working Directory
ALL work for this epic MUST happen in this directory: $WORKTREE_ABS_PATH
Do NOT modify files outside this directory, except for the epic state file below.

## Epic State File
$WORKTREE_STATE_FILE

## PRD File Path (read-only context)
$WORKTREE_PRD_PATH

## Epic
$EPIC_JSON

## Plan File
If this epic has planned=true in the PRD, the canonical implementation plan is:
$WORKTREE_PLAN_FILE

## Stories To Plan And Execute
Only these stories should be planned or worked in this run. Stories omitted here are already passed and must be treated as done context only.
$PENDING_STORIES_JSON

## Canonical Team Lead Policy
$TEAM_LEAD_POLICY

## Model Selection Policy
- Respect explicit ralph.config.yml agent model overrides when they are present.
  - If RALPH_MODEL_PLANNER_EXPLICIT=1, use RALPH_MODEL_PLANNER for planner work.
  - If RALPH_MODEL_BUILDER_EXPLICIT=1, use RALPH_MODEL_BUILDER for builder work.
  - If RALPH_MODEL_VALIDATOR_EXPLICIT=1, use RALPH_MODEL_VALIDATOR for validator work.
  - If RALPH_MODEL_MERGER_EXPLICIT=1, use RALPH_MODEL_MERGER for merger work.
- If there is no explicit override for that role, choose the model by task difficulty.
- Default difficulty policy by backend:
  - Claude: easy -> haiku, medium -> sonnet, difficult -> opus
  - Copilot / Codex: easy -> gpt-5-mini, medium -> gpt-5.3-codex, difficult -> gpt-5.4
  - OpenCode: easy -> openai/gpt-5-mini, medium -> openai/gpt-5.3-codex, difficult -> openai/gpt-5.4
- If your runtime supports setting reasoning effort per spawned task, use low for easy tasks, medium for normal tasks, high for difficult tasks, and xhigh only for unusually hard analysis or verification.
- If your runtime is Codex, use these exact named teammate roles when spawning:
  - planners: planner_easy, planner_medium, planner_difficult
  - builders: builder_easy, builder_medium, builder_difficult
  - validators: validator_easy, validator_medium, validator_difficult
- If your runtime is OpenCode, use these exact agent names when spawning with the Task tool:
  - planner
  - builder
  - validator
  - merger

## Runtime-Specific Notes
- Use the exact plan path shown above when the policy refers to the canonical epic plan file.
- Use the exact epic state file path shown above for every story update. The PRD path is read-only context.
- If your runtime supports named sub-agents, use the dedicated planner, builder, and validator roles and choose their models using the policy above.
- If a story fails validation and still has retries left, spawn a new Builder for the retry instead of reusing the previous Builder run.

Begin."

  # Run agent in background; write all output to log file (no console streaming in parallel mode)
  if [ "$STREAM_FORMAT" = "stream-json" ]; then
    (
      if [ "$BACKEND" = "opencode" ]; then
        run_opencode_exec "$WORKTREE_ABS_PATH" "$TEAM_PROMPT" team-lead "$MODEL_TEAM_LEAD" > "$EPIC_LOG" 2>&1
      else
        echo "$TEAM_PROMPT" | $AGENT_CMD $AGENT_FLAGS > "$EPIC_LOG" 2>&1
      fi
    ) &
  elif [ "$BACKEND" = "codex" ]; then
    (
      run_codex_exec "$WORKTREE_ABS_PATH" "$TEAM_PROMPT" --add-dir "$ROOT_DIR" > "$EPIC_LOG" 2>&1
    ) &
  else
    (
      COPILOT_TEAM_PROMPT="$TEAM_PROMPT" \
        script -q /dev/null /bin/sh -lc 'exec gh copilot -- --agent team-lead --model "$MODEL_TEAM_LEAD" --allow-all --no-ask-user --stream on -p "$COPILOT_TEAM_PROMPT"' \
        > "$EPIC_LOG" 2>&1
    ) &
  fi
  LAST_SPAWN_PID=$!
  LAST_SPAWN_LOG="$EPIC_LOG"
}

# merge_wave: merges completed epic branches back to the loop branch sequentially.
# Takes epic IDs as arguments. Clean merges succeed without AI intervention.
# On conflict, spawns the merger agent. Logs all outcomes to progress.txt.
merge_wave() {
  local -a completed_epic_ids=("$@")

  if [ ${#completed_epic_ids[@]} -eq 0 ]; then
    return 0
  fi

  echo ""
  echo "  --- Merging completed epic branches into ${LOOP_BRANCH} ---"

  local merge_failures=0
  local target_branch="$LOOP_BRANCH"

  if [ "$(git branch --show-current 2>/dev/null || echo "")" != "$target_branch" ]; then
    git checkout "$target_branch" >/dev/null 2>&1
  fi

  for epic_id in "${completed_epic_ids[@]}"; do
    local branch_name="ralph/${epic_id}"

    # Check if branch exists
    if ! git show-ref --verify --quiet "refs/heads/${branch_name}"; then
      echo "  [$epic_id] No branch ${branch_name} found — skipping merge"
      continue
    fi

    echo "  [$epic_id] Merging ${branch_name} → ${target_branch}"

    local dirty_status
    dirty_status=$(git status --porcelain 2>/dev/null || true)
    if [ -n "$dirty_status" ]; then
      git add -A
      if git commit -m "chore: checkpoint loop branch before merge wave" >/dev/null 2>&1; then
        echo "  [$epic_id] Auto-committed dirty worktree before merge"
        echo "[$epic_id] AUTO-COMMIT before merge wave — $(date)" >> "$PROGRESS_FILE"
      fi
    fi

    # Attempt clean merge first
    if git merge "${branch_name}" --no-edit 2>/dev/null; then
      echo "  [$epic_id] Merge successful (clean)"
      echo "[$epic_id] MERGED (clean) — $(date)" >> "$PROGRESS_FILE"
    else
      local conflicted_files
      conflicted_files=$(git diff --name-only --diff-filter=U 2>/dev/null || true)

      if [ -z "$conflicted_files" ] && [ ! -f ".git/MERGE_HEAD" ]; then
        local merge_error
        merge_error=$(git status --short 2>/dev/null || true)
        echo "  [$epic_id] Merge FAILED — merge did not enter conflict state"
        echo "[$epic_id] MERGE FAILED (merge did not enter conflict state) — $(date)" >> "$PROGRESS_FILE"
        [ -n "$merge_error" ] && echo "  [$epic_id] Working tree state:" && printf '%s\n' "$merge_error" | sed 's/^/    /'
        merge_failures=$((merge_failures + 1))

        local epic_index
        epic_index=$(rjq find-index "$PRD_FILE" .epics id "$epic_id")
        if [ -n "$epic_index" ]; then
          rjq set "$PRD_FILE" ".epics[$epic_index].status" '"merge-failed"'
        fi

        git merge --abort 2>/dev/null || true
        git branch -d "${branch_name}" 2>/dev/null || true
        continue
      fi

      # Conflicts detected — attempt AI resolution via merger agent
      echo "  [$epic_id] conflicts detected — spawning merger agent..."
      echo "[$epic_id] merge conflicts — attempting AI resolution — $(date)" >> "$PROGRESS_FILE"

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

      local merge_log="${LOGS_DIR}/merge-${epic_id}-$(date +%s).log"

      case "$BACKEND" in
        claude)
          echo "$merge_prompt" | $AGENT_CMD --agent merger --model "$MODEL_MERGER" --dangerously-skip-permissions --print --verbose --output-format stream-json > "$merge_log" 2>&1 || true
          ;;
        copilot)
          COPILOT_MERGE_PROMPT="$merge_prompt" \
            script -q /dev/null /bin/sh -lc 'exec gh copilot -- --agent merger --model "$MODEL_MERGER" --allow-all --no-ask-user --stream on -p "$COPILOT_MERGE_PROMPT"' \
            > "$merge_log" 2>&1 || true
          ;;
        codex)
          MODEL_TEAM_LEAD="$MODEL_MERGER" run_codex_exec "$ROOT_DIR" "$merge_prompt" > "$merge_log" 2>&1 || true
          ;;
        opencode)
          run_opencode_exec "$ROOT_DIR" "$merge_prompt" merger "$MODEL_MERGER" > "$merge_log" 2>&1 || true
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
        echo "  [$epic_id] Merge log: ${merge_log}"
        echo "[$epic_id] MERGED (AI-resolved) — $(date)" >> "$PROGRESS_FILE"
        git branch -d "${branch_name}" 2>/dev/null || true
      else
        # AI failed or aborted — ensure clean state
        git merge --abort 2>/dev/null || true
        echo "  [$epic_id] Merge FAILED — AI could not resolve conflicts in: ${conflicted_files}"
        echo "  [$epic_id] Merge log: ${merge_log}"
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

# Count total stories across all epics for running estimate calculations
TOTAL_STORIES=0
for i in $(seq 0 $((TOTAL_EPICS - 1))); do
  sc=$(rjq length "$PRD_FILE" ".epics[$i].userStories")
  TOTAL_STORIES=$((TOTAL_STORIES + sc))
done

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
  if [ -n "$PARALLEL" ]; then
    echo "  Wave $WAVE_NUM — ${#WAVE_EPICS[@]} epic(s), $PARALLEL at a time"
  else
    REMAINING_EPICS=$(rjq count-where "$PRD_FILE" .epics "status=pending" --default pending)
    echo "  ${REMAINING_EPICS} epic(s) remaining to run sequentially"
  fi
  echo "========================================================"

  # Log wave boundary to progress.txt
  echo "" >> "$PROGRESS_FILE"
  if [ -n "$PARALLEL" ]; then
    echo "=== Wave $WAVE_NUM — $(date) ===" >> "$PROGRESS_FILE"
  else
    echo "=== Run — $(date) ===" >> "$PROGRESS_FILE"
  fi
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
  # (all are script-level so SIGINT handler and nested functions can access them)
  active_pids=()
  active_indices=()
  active_start_times=()
  active_logs=()
  active_log_lines=()
  # wave_completed_ids collects epic IDs that completed successfully (for merge_wave)
  wave_completed_ids=()
  # Bash 3 on macOS does not support associative arrays, so keep retry counts
  # in parallel indexed arrays keyed by epic id.
  crash_retry_epic_ids=()
  crash_retry_counts=()
  queue_pos=0

  get_crash_retry_count() {
    local epic_id="$1"
    local idx
    for idx in "${!crash_retry_epic_ids[@]}"; do
      if [ "${crash_retry_epic_ids[$idx]}" = "$epic_id" ]; then
        echo "${crash_retry_counts[$idx]}"
        return
      fi
    done
    echo 0
  }

  set_crash_retry_count() {
    local epic_id="$1"
    local count="$2"
    local idx
    for idx in "${!crash_retry_epic_ids[@]}"; do
      if [ "${crash_retry_epic_ids[$idx]}" = "$epic_id" ]; then
        crash_retry_counts[$idx]="$count"
        return
      fi
    done
    crash_retry_epic_ids+=("$epic_id")
    crash_retry_counts+=("$count")
  }

  # Helper: wait_for_one_slot — polls active_pids until a slot is free,
  # processes its result, and removes it from the arrays.
  wait_for_one_slot() {
    while true; do
      local now
      now=$(date +%s)
      for slot in "${!active_pids[@]}"; do
        local finished_epic_id
        finished_epic_id=$(rjq read "$PRD_FILE" ".epics[${active_indices[$slot]}].id")
        local process_finished=false

        emit_new_log_output "$finished_epic_id" "${active_logs[$slot]}" "${active_log_lines[$slot]:-0}"
        active_log_lines[$slot]="$LAST_LOG_LINE_COUNT"

        # Check epic timeout
        local elapsed=$(( now - ${active_start_times[$slot]:-$now} ))
        if [ "$elapsed" -ge "$EPIC_TIMEOUT" ]; then
          echo ""
          echo "  [$finished_epic_id] TIMED OUT after ${EPIC_TIMEOUT}s"
          terminate_process_tree "${active_pids[$slot]}"
          wait "${active_pids[$slot]}" 2>/dev/null || true
          # Check progress and retry if possible
          local _to_total _to_passed
          _to_total=$(rjq length "$PRD_FILE" ".epics[${active_indices[$slot]}].userStories")
          _to_passed=$(read_epic_state_passed "$finished_epic_id")
          local _to_retry_count
          _to_retry_count="$(get_crash_retry_count "$finished_epic_id")"
          if [ "$_to_retry_count" -lt "$MAX_CRASH_RETRIES" ] && [ "$_to_passed" -lt "$_to_total" ]; then
            set_crash_retry_count "$finished_epic_id" "$((_to_retry_count + 1))"
            echo "  [$finished_epic_id] Timeout with $_to_passed/$_to_total passed — retry $((_to_retry_count + 1))/$MAX_CRASH_RETRIES"
            echo "[$finished_epic_id] TIMEOUT RETRY $((_to_retry_count + 1))/$MAX_CRASH_RETRIES ($_to_passed/$_to_total passed) — $(date)" >> "$PROGRESS_FILE"
            project_state_to_prd "$finished_epic_id" || true
            cleanup_epic_worktree "$finished_epic_id"
            spawn_epic_bg "${active_indices[$slot]}"
            active_pids[$slot]="$LAST_SPAWN_PID"
            active_start_times[$slot]="$(date +%s)"
            active_logs[$slot]="$LAST_SPAWN_LOG"
            active_log_lines[$slot]="0"
            continue
          fi
          project_state_to_prd "$finished_epic_id" || true
          cleanup_epic_worktree "$finished_epic_id"
          echo "TIMEOUT: Epic exceeded ${EPIC_TIMEOUT}s limit" >> "${active_logs[$slot]}"
          # Log timeout-specific message before generic result
          echo "[$finished_epic_id] FAILED (epic timeout after ${EPIC_TIMEOUT}s) — $(date)" >> "$PROGRESS_FILE"
          process_epic_result "${active_indices[$slot]}"
          # Clean up tracking arrays
          unset 'active_pids[$slot]'
          unset 'active_indices[$slot]'
          unset 'active_start_times[$slot]'
          unset 'active_logs[$slot]'
          unset 'active_log_lines[$slot]'
          active_pids=("${active_pids[@]+"${active_pids[@]}"}")
          active_indices=("${active_indices[@]+"${active_indices[@]}"}")
          active_start_times=("${active_start_times[@]+"${active_start_times[@]}"}")
          active_logs=("${active_logs[@]+"${active_logs[@]}"}")
          active_log_lines=("${active_log_lines[@]+"${active_log_lines[@]}"}")
          return
        fi

        # Check idle timeout — kill if log file has had no new output for IDLE_TIMEOUT seconds
        local log_mtime
        log_mtime=$(get_file_mtime "${active_logs[$slot]}")
        local idle_seconds
        if [ "$log_mtime" -eq 0 ]; then
          # Log file doesn't exist yet — use start time as baseline
          idle_seconds=$(( now - ${active_start_times[$slot]:-$now} ))
        else
          idle_seconds=$(( now - log_mtime ))
        fi

        if [ "$idle_seconds" -ge "$IDLE_TIMEOUT" ]; then
          echo ""
          echo "  [$finished_epic_id] IDLE TIMEOUT — no output for ${IDLE_TIMEOUT}s"
          terminate_process_tree "${active_pids[$slot]}"
          wait "${active_pids[$slot]}" 2>/dev/null || true
          # Check progress and retry if possible
          local _it_total _it_passed
          _it_total=$(rjq length "$PRD_FILE" ".epics[${active_indices[$slot]}].userStories")
          _it_passed=$(read_epic_state_passed "$finished_epic_id")
          local _it_retry_count
          _it_retry_count="$(get_crash_retry_count "$finished_epic_id")"
          if [ "$_it_retry_count" -lt "$MAX_CRASH_RETRIES" ] && [ "$_it_passed" -lt "$_it_total" ]; then
            set_crash_retry_count "$finished_epic_id" "$((_it_retry_count + 1))"
            echo "  [$finished_epic_id] Idle timeout with $_it_passed/$_it_total passed — retry $((_it_retry_count + 1))/$MAX_CRASH_RETRIES"
            echo "[$finished_epic_id] IDLE RETRY $((_it_retry_count + 1))/$MAX_CRASH_RETRIES ($_it_passed/$_it_total passed) — $(date)" >> "$PROGRESS_FILE"
            project_state_to_prd "$finished_epic_id" || true
            cleanup_epic_worktree "$finished_epic_id"
            spawn_epic_bg "${active_indices[$slot]}"
            active_pids[$slot]="$LAST_SPAWN_PID"
            active_start_times[$slot]="$(date +%s)"
            active_logs[$slot]="$LAST_SPAWN_LOG"
            active_log_lines[$slot]="0"
            continue
          fi
          project_state_to_prd "$finished_epic_id" || true
          cleanup_epic_worktree "$finished_epic_id"
          # Log idle-timeout-specific message before generic result
          echo "[$finished_epic_id] FAILED (idle timeout — no output for ${IDLE_TIMEOUT}s) — $(date)" >> "$PROGRESS_FILE"
          process_epic_result "${active_indices[$slot]}"
          # Clean up tracking arrays
          unset 'active_pids[$slot]'
          unset 'active_indices[$slot]'
          unset 'active_start_times[$slot]'
          unset 'active_logs[$slot]'
          unset 'active_log_lines[$slot]'
          active_pids=("${active_pids[@]+"${active_pids[@]}"}")
          active_indices=("${active_indices[@]+"${active_indices[@]}"}")
          active_start_times=("${active_start_times[@]+"${active_start_times[@]}"}")
          active_logs=("${active_logs[@]+"${active_logs[@]}"}")
          active_log_lines=("${active_log_lines[@]+"${active_log_lines[@]}"}")
          return
        fi

        if ! kill -0 "${active_pids[$slot]}" 2>/dev/null; then
          process_finished=true
        fi

        local total_s passed_s
        total_s=$(rjq length "$PRD_FILE" ".epics[${active_indices[$slot]}].userStories")
        passed_s=$(read_epic_state_passed "$finished_epic_id")
        local all_done=false
        [ "$passed_s" -eq "$total_s" ] && [ "$total_s" -gt 0 ] && all_done=true

        if [ "$process_finished" = true ] || [ "$all_done" = true ]; then
          # Treat fully-passed stories in the PRD as the authoritative completion
          # signal, even if the backend session is still idling.
          if [ "$process_finished" = false ]; then
            terminate_process_tree "${active_pids[$slot]}"
          fi
          wait "${active_pids[$slot]}" 2>/dev/null || true

          # If the process exited before the epic reached all stories passed,
          # consider it a crash and retry when possible.
          if [ "$all_done" = false ]; then
            local retry_count
            retry_count="$(get_crash_retry_count "$finished_epic_id")"
            if [ "$retry_count" -lt "$MAX_CRASH_RETRIES" ]; then
              set_crash_retry_count "$finished_epic_id" "$((retry_count + 1))"
              echo ""
              echo "  [$finished_epic_id] CRASH DETECTED ($passed_s/$total_s passed) — retry $((retry_count + 1))/$MAX_CRASH_RETRIES"
              echo "[$finished_epic_id] CRASH RETRY $((retry_count + 1))/$MAX_CRASH_RETRIES ($passed_s/$total_s passed so far) — $(date)" >> "$PROGRESS_FILE"
              project_state_to_prd "$finished_epic_id" || true
              cleanup_epic_worktree "$finished_epic_id"
              spawn_epic_bg "${active_indices[$slot]}"
              active_pids[$slot]="$LAST_SPAWN_PID"
              active_start_times[$slot]="$(date +%s)"
              active_logs[$slot]="$LAST_SPAWN_LOG"
              active_log_lines[$slot]="0"
              # Don't free slot — respawned epic reuses it. Continue polling.
              continue
            fi
            echo ""
            echo "  [$finished_epic_id] CRASH — retries exhausted ($passed_s/$total_s stories passed)"
            echo "[$finished_epic_id] CRASH RETRIES EXHAUSTED ($passed_s/$total_s passed) — $(date)" >> "$PROGRESS_FILE"
          fi

          echo "  [$finished_epic_id] finished — processing result"
          project_state_to_prd "$finished_epic_id" || true
          process_epic_result "${active_indices[$slot]}"
          # Track completed epics for merge_wave
          local post_status
          post_status=$(rjq read "$PRD_FILE" ".epics[${active_indices[$slot]}].status" "pending")
          if [ "$post_status" = "completed" ]; then
            wave_completed_ids+=("$finished_epic_id")
          fi
          cleanup_epic_worktree "$finished_epic_id"
          unset 'active_pids[$slot]'
          unset 'active_indices[$slot]'
          unset 'active_start_times[$slot]'
          unset 'active_logs[$slot]'
          unset 'active_log_lines[$slot]'
          active_pids=("${active_pids[@]+"${active_pids[@]}"}")
          active_indices=("${active_indices[@]+"${active_indices[@]}"}")
          active_start_times=("${active_start_times[@]+"${active_start_times[@]}"}")
          active_logs=("${active_logs[@]+"${active_logs[@]}"}")
          active_log_lines=("${active_log_lines[@]+"${active_log_lines[@]}"}")
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
    active_start_times+=("$(date +%s)")
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
  echo "All attempted epics processed. Check ${PROGRESS_FILE} for details."
  exit 1
fi
