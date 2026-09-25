# spam-scanner

This is the root of an npm-workspaces monorepo. Read the app-specific
`CLAUDE.md` for whichever package you're actually working in — this file only
covers repo-wide layout and conventions.

## Layout

- **`terminal/`** — the existing IMAP spam scanner (CLI/service). It has its
  own `terminal/CLAUDE.md` with its architecture (layering, `ctx` conventions,
  testing rules) — read it before touching anything under `terminal/`.
- **`app/server/`** — a NestJS multi-mailbox web server, forthcoming. Not
  scaffolded yet (see `openspec/changes/2-nest-server-foundation/`).
- **`openspec/`** — the process of record for design/plan work across the
  whole monorepo, used via `/opsx:*` slash commands.

## Shared infrastructure

Root `docker-compose.yml` / `docker-compose.base.yml` and `rspamd/` are
shared across apps; each app's compose service builds from its own subfolder.

## Skills split (easy to forget)

Custom skills are split by whether they're project-specific:

- `skills/review-branch/` stays at the repo root — it's a generic git
  workflow, not tied to this project's code.
- `skills/prompt-engineer/` lives inside `terminal/skills/prompt-engineer/` —
  it's terminal-specific (reads `terminal/.temp/reports/`, edits
  `terminal/src/lib/clients/ai.client.ts`).
- Each is mirrored by a thin stub under `.claude/skills/<name>/SKILL.md`
  pointing at the real location above.

A future skill specific to `app/server/` (or any other terminal-specific
skill) belongs in that app's own `skills/` folder, not the root.
