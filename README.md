# ralph-team-agents

`ralph-team-agents` is a CLI for running Ralph Team Agents: a shell-based orchestrator that reads a `prd.json`, loops through epics, and spawns Claude team agents to implement work story by story.

## What It Does

The system has two layers:

- `ralph.sh` acts as the project manager. It validates the PRD, checks epic dependencies, loops through ready epics, records results, and updates progress files.
- A Claude session handles one epic at a time using a small team:
  - `team-lead` coordinates the epic
  - `planner` creates the implementation plan
  - `builder` makes changes and runs tests
  - `validator` verifies the result independently

Ralph never writes code itself. It only schedules work, tracks results, and updates project state.

## Flow

```mermaid
flowchart TB
    U[User runs CLI] --> C[run command]
    C --> S[ralph.sh]
    S --> V[Validate PRD and tools]
    V --> E[Read next epic from PRD]
    E --> B{Epic ready}
    B -->|No| K[Skip epic]
    B -->|Yes| TL

    subgraph CS[Claude session: team agents for one epic]
        direction TB
        TL[Team lead]
        P[Planner creates plan]
        Q{Story already passed}
        BU[Builder implements]
        VA[Validator checks]
        R{Validation passed}
        W[Mark story passed in PRD]
        F[Record failure]
        M{More stories}
        RF[Write result file]

        TL --> P
        P --> Q
        Q -->|Yes| M
        Q -->|No| BU
        BU --> VA
        VA --> R
        R -->|Yes| W
        R -->|Retry left| BU
        R -->|No retry left| F
        W --> M
        F --> M
        M -->|Yes| Q
        M -->|No| RF
    end

    K --> ME{More epics}
    RF --> P2[Update epic status]
    P2 --> L[Append progress log]
    L --> ME
    ME -->|Yes| E
    ME -->|No| D[Finish run]
```

## Requirements

- Node.js 18+
- `claude` CLI in `PATH`
- `jq` in `PATH`
- Git available if you want Ralph to switch/create the target branch

Install `jq` on macOS:

```bash
brew install jq
```

## Install

Install globally:

```bash
npm install -g ralph-team-agents
```

Or use it locally from this repo:

```bash
npm install
npm run build
npm link
```

Then verify:

```bash
ralph-team-agents --help
```

## Quick Start

1. Create a PRD:

```bash
ralph-team-agents init
```

2. Validate it:

```bash
ralph-team-agents validate
```

3. Inspect the planned work:

```bash
ralph-team-agents summary
ralph-team-agents status
```

4. Run Ralph:

```bash
ralph-team-agents run
```

5. Check progress:

```bash
ralph-team-agents logs
```

## Commands

### `ralph-team-agents init`

Creates a new `prd.json` interactively in the current directory.

```bash
ralph-team-agents init
```

It prompts for:

- project name
- branch name
- project description
- first epic title and description
- one or more user stories

### `ralph-team-agents run [path]`

Runs Ralph against a PRD file. Default path is `./prd.json`.

```bash
ralph-team-agents run
ralph-team-agents run ./my-prd.json
```

Behavior:

- validates that `claude`, `jq`, and the PRD are available
- locates bundled `ralph.sh`
- streams Ralph output directly to the terminal
- exits with Ralph's exit code

### `ralph-team-agents status [path]`

Shows epic and story pass/fail state from a PRD.

```bash
ralph-team-agents status
ralph-team-agents status ./my-prd.json
```

### `ralph-team-agents logs [--tail N]`

Shows `progress.txt` with light colorization.

```bash
ralph-team-agents logs
ralph-team-agents logs --tail 20
```

### `ralph-team-agents reset <epicId> [path]`

Resets one epic to `pending` and sets all of its stories back to `passes: false`.

```bash
ralph-team-agents reset EPIC-002
```

### `ralph-team-agents add-epic [path]`

Interactively appends a new epic to an existing PRD.

```bash
ralph-team-agents add-epic
```

This command:

- creates the next `EPIC-###` id
- creates globally unique `US-###` ids across the PRD
- lets you choose dependencies from existing epics

### `ralph-team-agents validate [path]`

Validates PRD structure and dependency integrity.

```bash
ralph-team-agents validate
```

Checks include:

- required fields
- valid epic status values
- duplicate epic IDs
- duplicate story IDs
- unknown `dependsOn` references
- circular epic dependencies

### `ralph-team-agents summary [path]`

Prints a dependency-oriented overview of epics.

```bash
ralph-team-agents summary
```

Shows:

- dependency arrows
- epic status
- story pass counts
- blocked epics

## PRD Format

Example:

```json
{
  "project": "MyApp",
  "branchName": "ralph/my-feature",
  "description": "Short description of the project",
  "epics": [
    {
      "id": "EPIC-001",
      "title": "Authentication",
      "description": "Add login and session handling",
      "status": "pending",
      "dependsOn": [],
      "userStories": [
        {
          "id": "US-001",
          "title": "Login form",
          "description": "As a user, I want to sign in",
          "acceptanceCriteria": [
            "User can submit email and password",
            "Validation errors are shown clearly"
          ],
          "priority": 1,
          "passes": false
        }
      ]
    }
  ]
}
```

Important fields:

- `epics[].status`: `pending` | `completed` | `partial` | `failed`
- `epics[].dependsOn`: epic IDs that must be completed first
- `userStories[].passes`: whether the story is currently marked as passing

## Files Ralph Produces

During a run, Ralph writes:

- `progress.txt`: high-level run log
- `plans/plan-EPIC-xxx.md`: planner output for an epic
- `results/result-EPIC-xxx.txt`: final pass/partial/fail result per epic
- `logs/epic-EPIC-xxx-<timestamp>.log`: raw Claude session log

Ralph also updates the original `prd.json` in place as story and epic state changes.

## Runtime Rules

The current execution contract is:

- Ralph loops through epics in PRD order
- blocked epics are skipped until dependencies are complete
- the Claude team processes one epic per session
- stories run sequentially inside that epic
- already-passed stories are skipped
- each story gets at most two build/validate cycles
- the validator checks output independently from the builder's reasoning

## Troubleshooting

### `zsh: command not found: ralph-team-agents`

Install or relink the package:

```bash
npm install -g ralph-team-agents
```

Or from this repo:

```bash
npm link
```

### `Error: 'claude' CLI not found`

Install Claude Code and ensure `claude` is on your `PATH`.

### `Error: 'jq' not found`

Install `jq`:

```bash
brew install jq
```

### Ralph cannot switch branches

`ralph.sh` refuses to switch branches if the worktree is dirty. Commit or stash your changes first.

## Development

Useful commands in this repo:

```bash
npm run build
npm run typecheck
npm link
```

The packaged CLI entrypoint is `dist/index.js`, and the runtime orchestrator is `ralph.sh`.
