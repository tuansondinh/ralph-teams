# Ralph Teams

Ralph is a project manager that spawns AI coding agent teams to implement epics autonomously. Supports Claude Code, GitHub Copilot CLI, and OpenAI Codex as backends.

## Architecture

```
ralph.sh (shell harness — scheduling, persistence, dependency graph)
  └── team-lead agent (coordinator — one per epic) [opus]
        ├── planner agent (first — explores codebase, writes plan) [opus]
        ├── builder agent (sonnet — writes code, commits) [sonnet]
        └── validator agent (independent verification) [sonnet]
```

## How It Works

1. Ralph reads `prd.json` which contains epics with user stories
2. For each ready epic (dependencies met), Ralph spawns a Team Lead
3. Team Lead first spawns a Planner to explore the codebase and produce a plan
4. Team Lead then spawns Builder + Validator
5. For each user story: check if already passed (skip if so) → Builder implements → Validator verifies
6. Max 2 total build+validate cycles per story (first attempt + 1 retry). On failure: document and move on.
7. Team Lead writes result to `results/result-{epic-id}.txt`. Ralph reads that file to update PRD status and logs to progress.txt.

## Key Rules

- Ralph never writes code — only schedules and logs
- Teams never schedule themselves — only implement assigned epics
- Validator never sees Builder reasoning — only code output (via commit SHA diff)
- 2-cycle hard limit per story (first attempt + 1 retry = 2 total) — no human escalation, just document and continue
- Epics should target ~5 user stories each when the scope supports it
- Team Lead must NOT stop early — all stories must be processed before writing the result file

## PRD Format

See `prd.json.example` for the expected format. Key fields:
- `epics[].status`: "pending" | "completed" | "partial" | "failed"
- `epics[].dependsOn`: array of epic IDs that must complete first
- `epics[].userStories[].passes`: boolean per story

## Running

```bash
./ralph.sh prd.json                          # Process all epics (default: claude backend)
./ralph.sh prd.json --backend copilot        # Use GitHub Copilot CLI
./ralph.sh prd.json --backend codex          # Use OpenAI Codex CLI
./ralph.sh prd.json --max-epics 1            # Process one epic at a time
./ralph.sh prd.json --backend copilot --max-epics 2
```

## Backends

| Backend | Command | Agent Files | Sub-agent Tool | Permissions |
|---------|---------|------------|----------------|-------------|
| `claude` (default) | `claude` CLI | `.claude/agents/*.md` | `Agent` tool | `--dangerously-skip-permissions` |
| `copilot` | `gh copilot` | `.github/agents/*.agent.md` | `task` tool | `--allow-all --no-ask-user` |
| `codex` | `codex exec` | `.codex/agents/*.toml` | Codex multi-agent roles | `-a never -s workspace-write` |

All backends support sub-agent spawning. The team lead spawns planner, builder, and validator as sub-agents using their respective tool systems.
