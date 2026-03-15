# ralph-claude

CLI for running **ralph + claude agent teams** — an autonomous project manager that spawns Claude Code agent teams to implement epics from a `prd.json` file.

## What it is

Ralph reads a `prd.json` (Product Requirements Document) and spawns a team of Claude agents to implement each epic:

- **Team Lead** — coordinates the epic, assigns stories
- **Builder** — writes code, runs tests, commits
- **Validator** — independently verifies each story

## Requirements

- [Claude Code](https://claude.ai/code) (`claude` CLI must be in PATH)
- [jq](https://jqlang.github.io/jq/) (`brew install jq`)
- Node.js 18+

## Install

```bash
npm install -g ralph-claude
```

Or link locally for development:

```bash
git clone <repo>
cd ralph-team-agents
npm install
npm run build
npm link
```

## Usage

### `ralph-claude init`

Interactively create a `prd.json` in the current directory.

```bash
ralph-claude init
```

Prompts for project name, branch name, epic details, and user stories.

### `ralph-claude status [path]`

Show the status of epics and user stories from a `prd.json`.

```bash
ralph-claude status             # reads ./prd.json
ralph-claude status my-prd.json
```

Output includes each epic's status (color-coded) and a pass/fail indicator per story.

### `ralph-claude run [path]`

Run the ralph agent team against a `prd.json`.

```bash
ralph-claude run                # reads ./prd.json
ralph-claude run my-prd.json
```

Spawns `ralph.sh` which processes each pending epic in order.

### `ralph-claude --version`

Show the installed version.

### `ralph-claude --help`

Show all available commands.

## prd.json format

```json
{
  "project": "MyApp",
  "branchName": "ralph/my-feature",
  "description": "Short description of the project",
  "epics": [
    {
      "id": "EPIC-001",
      "title": "Epic Title",
      "description": "What this epic delivers",
      "status": "pending",
      "dependsOn": [],
      "userStories": [
        {
          "id": "US-001",
          "title": "Story Title",
          "description": "As a user, I want...",
          "acceptanceCriteria": [
            "Criterion one",
            "Criterion two"
          ],
          "priority": 1,
          "passes": false
        }
      ]
    }
  ]
}
```

**Status values:** `pending` | `completed` | `partial` | `failed`

**dependsOn:** array of epic IDs that must complete before this epic runs.
