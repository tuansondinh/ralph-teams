# Ralph Teams — Web App Plan

## Overview

A mobile-first web app for managing ralph-teams loops. Users can manage multiple
projects (each backed by a GitHub repo), run epics, monitor progress, and interact
with an AI assistant (via opencode SDK + MCP) that can operate the tool on their
behalf.

## Architecture

```
┌─────────────────────────────────────────────────────┐
│  Vercel (stateless)                                  │
│  Next.js web app — UI, auth, chat                    │
│  Reads/writes only to Supabase + GitHub API          │
└─────────────────┬───────────────────────────────────┘
                  │ Supabase Realtime (logs, status)
                  │ REST API (trigger runs)
┌─────────────────▼───────────────────────────────────┐
│  Railway (single persistent container)               │
│  Runner service — runs ralph.sh, manages processes   │
│  Persistent volume — cloned GitHub repos             │
└─────────────────┬───────────────────────────────────┘
                  │
┌─────────────────▼───────────────────────────────────┐
│  Supabase                                            │
│  • Auth (email/password + GitHub OAuth)              │
│  • users, projects, runs, run_logs, project_status   │
│  • Realtime subscriptions for live log streaming     │
└─────────────────┬───────────────────────────────────┘
                  │
┌─────────────────▼───────────────────────────────────┐
│  GitHub                                              │
│  Source of truth for project files                   │
│  Runner clones repo, pushes results back             │
└─────────────────────────────────────────────────────┘
```

### Chat Layer

```
Browser ──SSE──→ Vercel /api/chat ──HTTP──→ Railway /opencode/chat
                                                    │
                                              opencode server (@opencode-ai/sdk)
                                                    │ MCP
                                              MCP server (ralph-teams CLI wrappers)
```

The opencode server runs on Railway alongside the runner. The Next.js chat API
route proxies SSE from Railway to the browser. Each project session gets an
opencode server instance with MCP tools scoped to that project's local path.

---

## Stack

| Layer | Choice | Reason |
|---|---|---|
| Web app | Next.js 15 (App Router) + TypeScript | Full-stack, SSE, server components |
| Styling | Tailwind CSS | Mobile-first utility classes |
| Auth | Supabase Auth | Email/password + GitHub OAuth built-in |
| Database | Supabase (Postgres) | RLS for user isolation, Realtime for log streaming |
| Runner | Railway container + persistent volume | Long-running processes, filesystem for repo clones |
| Chat | `@opencode-ai/sdk` | Spawns opencode server, MCP tool integration, SSE streaming |
| MCP server | `@modelcontextprotocol/sdk` | Wraps ralph-teams CLI as tools for the AI |

---

## Database Schema (Supabase)

```sql
-- Managed by Supabase Auth
-- auth.users: id, email, ...

-- Public tables (RLS enabled on all)

create table projects (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid references auth.users not null,
  name        text not null,
  repo_owner  text not null,
  repo_name   text not null,
  repo_url    text not null,
  created_at  timestamptz default now()
);

create table runs (
  id          uuid primary key default gen_random_uuid(),
  project_id  uuid references projects not null,
  started_at  timestamptz default now(),
  ended_at    timestamptz,
  status      text default 'running'  -- running | completed | failed | stopped
);

create table run_logs (
  id          bigserial primary key,
  run_id      uuid references runs not null,
  ts          timestamptz default now(),
  line        text not null
);

create table project_status (
  project_id  uuid references projects not null,
  epic_id     text not null,
  story_id    text not null,
  passes      boolean default false,
  updated_at  timestamptz default now(),
  primary key (project_id, epic_id, story_id)
);
```

Row-level security policies ensure users can only access their own projects and
all related data.

---

## GitHub Integration

- Users connect GitHub via Supabase Auth GitHub OAuth provider
- GitHub access token stored encrypted in Supabase (via vault or encrypted column)
- On project creation: user picks a repo from their GitHub account
- Runner clones the repo to its persistent volume: `/repos/<projectId>/`
- After a run: runner commits changes and pushes to the repo (or opens a PR)
- If the runner container restarts, the next run re-clones from GitHub — no data loss

---

## MCP Server Tools

The MCP server (`mcp-server/`) wraps ralph-teams CLI commands and is configured
as a local MCP server in the opencode session for each project.

| Tool | Description |
|---|---|
| `get_prd` | Read prd.json for the project |
| `get_status` | Epic/story pass-fail summary |
| `get_logs` | Tail progress.txt (optional N lines) |
| `run_epics` | Start ralph.sh for the project |
| `stop_run` | Send SIGINT to running ralph.sh process |
| `resume_run` | Resume from ralph-state.json |
| `reset_epic` | Reset one epic to pending |
| `update_story` | Edit story fields in prd.json |
| `validate_prd` | Validate PRD structure |
| `sync_repo` | git pull from GitHub |
| `push_results` | git push / open PR |

---

## One Loop Per Project

The Railway runner maintains an in-memory process registry:

```ts
// runner/lib/process-registry.ts
const registry = new Map<string, { process: ChildProcess; runId: string }>()

startRun(projectId, runId, prdPath)  // rejects if already running
stopRun(projectId)                    // SIGINT
getStatus(projectId)                  // running | idle
```

As ralph.sh produces output, the runner:
1. Inserts each log line into `run_logs` via Supabase
2. Parses epic/story status updates and upserts `project_status`

The web app subscribes to both tables via Supabase Realtime for live updates.

---

## Folder Structure

```
ralph-teams/
  mcp-server/
    index.ts
    tools/
      get-prd.ts
      get-status.ts
      get-logs.ts
      run-epics.ts
      stop-run.ts
      resume-run.ts
      reset-epic.ts
      update-story.ts
      validate-prd.ts
      sync-repo.ts
      push-results.ts

  runner/                        # Railway service
    index.ts                     # Express server (REST API for web app)
    lib/
      process-registry.ts
      log-streamer.ts            # Pipes ralph.sh output → Supabase run_logs
      status-syncer.ts           # Parses prd.json → Supabase project_status
      opencode-manager.ts        # Spawns/manages opencode server per session
    routes/
      run.ts                     # POST /run/:projectId, DELETE /run/:projectId
      chat.ts                    # GET /chat/:projectId (SSE proxy for opencode)
      sync.ts                    # POST /sync/:projectId (git pull)
      push.ts                    # POST /push/:projectId (git push / PR)

  web/                           # Vercel deployment
    app/
      (auth)/
        login/page.tsx
        register/page.tsx
      (app)/
        layout.tsx               # Auth guard + bottom nav
        page.tsx                 # Project list
        projects/
          new/page.tsx           # Create project — pick GitHub repo
          [id]/
            page.tsx             # Dashboard (epic cards, run controls)
            prd/page.tsx         # PRD editor
            chat/page.tsx        # AI chat
            logs/page.tsx        # Live log stream
      api/
        github/repos/route.ts    # List user's GitHub repos
        projects/
          route.ts               # GET list, POST create
          [id]/
            route.ts             # GET, DELETE
            run/route.ts         # POST start, DELETE stop (proxies to runner)
            chat/route.ts        # SSE proxy → runner /chat/:projectId
    components/
      BottomNav.tsx
      ProjectCard.tsx
      EpicStatusCard.tsx
      LogStream.tsx
      ChatPanel.tsx
      PRDEditor.tsx
    lib/
      supabase.ts                # Supabase client (browser + server)
      runner.ts                  # HTTP client for runner service
      github.ts                  # GitHub API helpers
```

---

## Mobile UI

Bottom navigation with four sections:

```
┌─────────────────────────┐
│  Projects               │
│  ┌──────────┐           │
│  │ my-app   │           │
│  │ ● 1 live │           │
│  └──────────┘           │
│  ┌──────────┐           │
│  │ api-svc  │           │
│  │ ○ idle   │           │
│  └──────────┘           │
│  [+ New Project]        │
└─────────────────────────┘
     [Proj][Status][Chat][Log]
```

Per-project dashboard:

```
┌─────────────────────────┐
│ ← my-app    [▶ Run] [■] │
│─────────────────────────│
│ EPIC-001  ●●●○○  3/5   │
│ EPIC-002  ●●●●●  5/5   │
│ EPIC-003  pending       │
│─────────────────────────│
│ [Edit PRD] [Chat] [Logs]│
└─────────────────────────┘
```

---

## What Is Reused from Existing CLI

- `ralph.sh` — invoked directly by the runner's process registry
- `rjq` — used by MCP server tools for PRD JSON manipulation
- All agent definitions (`.claude/agents/`, `.github/agents/`, `.codex/agents/`)
- `src/prd-utils.ts`, `src/retry-controller.ts`, `src/config.ts` — imported by MCP server and runner

The CLI remains fully functional and is not replaced. The web app is an additional
interface on top of the same underlying system.

---

## Build Order

1. **MCP server** — foundation; tools wrap existing CLI, tested independently
2. **Runner service** — Express server on Railway; process registry, log streamer, status syncer
3. **Supabase setup** — schema, RLS policies, auth config (GitHub OAuth)
4. **Web app auth** — login/register pages, Supabase client, auth guard
5. **Project management** — create project (pick GitHub repo), list projects
6. **Dashboard + run controls** — epic status cards, run/stop/resume, Realtime log stream
7. **Chat integration** — opencode SDK on runner, SSE proxy in web app
8. **PRD editor** — edit epics and stories in the UI
9. **GitHub push/PR** — push results back after a run
10. **Mobile polish** — bottom nav, touch targets, PWA manifest
