# Project Instructions

## Codex Workflow

- After every code change, always:
  1. Run the relevant verification for the change.
  2. Commit the change.

- After every feature change or addon, always:
  1. Run `npm run build`.
  2. Run `npm link`.
  3. Verify `ralph-teams` resolves on `PATH`.
  4. If the npm link exists but the executable shim is missing, recreate:
     - `/Users/sonwork/.nvm/versions/node/v22.22.0/bin/ralph-teams` -> `../lib/node_modules/ralph-teams/dist/index.js`
     - `/Users/sonwork/.nvm/versions/node/v22.22.0/bin/rjq` -> `../lib/node_modules/ralph-teams/dist/json-tool.js`

- Do not stop after editing unless the user explicitly asks you not to commit, build, or link.
