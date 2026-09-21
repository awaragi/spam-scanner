# Contributing

## Process: openspec

This project uses [openspec](https://github.com/Fission-AI/OpenSpec) as the process of
record for design/plan/spec work. Any change beyond a small, self-contained fix should go
through it rather than as an ad-hoc PR:

- `openspec/specs/` holds the current, agreed behavior of each capability (e.g.
  `sender-lists`, `orchestration`, `ai-spam-escalation`) as living spec documents.
- `openspec/changes/` holds proposals in flight: a delta against one or more specs plus an
  implementation plan, reviewed and agreed before code is written.
- `openspec/changes/archive/` holds completed changes, kept for history — each one's
  original proposal and plan stay readable there after the delta is merged into the main
  specs.

In practice:

1. Before making a non-trivial change, start (or continue) an openspec change proposing
   the spec delta and plan.
2. Get the proposal reviewed/agreed (by the maintainer, or Claude Code's openspec skills:
   `openspec-new-change`, `openspec-continue-change`, `openspec-ff-change`).
3. Implement against the agreed plan (`openspec-apply-change`).
4. Verify the implementation matches the change's artifacts
   (`openspec-verify-change`), then archive it (`openspec-archive-change`), which syncs
   the delta into `openspec/specs/`.

Small, self-contained fixes (typos, a single-line config correction, a clearly-scoped bug
fix with no behavior-design questions) don't need a full change — use judgment, and prefer
going through openspec when in doubt.

`ROADMAP.md` tracks open findings and proposed work at a higher level than any single
openspec change; picking up a roadmap item is usually the trigger for starting one.

## Conventions

See `CLAUDE.md` for the project's layered architecture (`controllers` → `services`/
`clients` → `utils`/`core`), directory structure, testing conventions, and commands
(`npm test`, `npm run lint`, `npm run format`, etc.). Read it before making structural
changes — it documents invariants (e.g. `services`/`utils` never take `ctx`) that aren't
otherwise enforced by tooling.

## Commit style

Commits mostly follow [Conventional Commits](https://www.conventionalcommits.org/)
(`feat:`, `fix:`, `refactor:`, `chore:`, `docs:`, `test:`) — keep using that prefix style
so history stays scannable and future tooling (changelog generation, release automation)
can rely on it.
