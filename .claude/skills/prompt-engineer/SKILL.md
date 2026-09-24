---
name: prompt-engineer
description: Analyze ai-prompt-eval reports and edit the AI spam classifier's system prompt to fix observed per-bucket miscalibration (e.g. legitimate mail scoring too high). Use when the user asks to tune, calibrate, or improve the AI classification prompt, or says "prompt engineer" / "tune the prompt". Requires a report from `src/cli/eval-prompt.ts` to already exist in `.temp/reports/`.
metadata:
  author: spam-scanner
  version: '1.0'
---

Read `skills/prompt-engineer/SKILL.md` (repo root) now, in full, and follow it exactly as
this skill's instructions, passing along any `args` given here.
