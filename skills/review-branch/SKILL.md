# review-branch

Create or tear down a throwaway git branch that stages a batch of commits as one
uncommitted merge, so they can be reviewed together as a single diff in the IDE's
source-control panel, without touching the real working branch.

This skill automates a two-phase git workflow:

- **Start**: branch off from a confirmed starting point (before the reviewed work), check
  it out, then `git merge --no-commit --no-ff <source-branch>` so the IDE shows every
  change since that point as one combined, uncommitted diff. Nothing is committed and the
  real working branch is never touched.
- **End**: abort that staged merge, switch back to the source branch, delete the review
  branch, and clear the marker this skill left behind.

Only one review is tracked at a time - state is stored in local git config
(`reviewbranch.source`, `reviewbranch.branch`), not in conversation memory, so "end" works
correctly even in a fresh session.

## Determining intent

- `args` of `start` → do the Start procedure.
- `args` of `end`/`done`/`cleanup`/`stop` → do the End procedure.
- No `args`, or unclear: inspect state and infer, telling the user which you inferred and why:
  - `git config --local --get reviewbranch.branch` set, **and** that branch is currently
    checked out, **and** `MERGE_HEAD` exists → infer **End**.
  - Otherwise (no active marker, or on a different branch) → infer **Start**.
- If inference is genuinely ambiguous (e.g. a marker exists but points at a branch that no
  longer exists, or `MERGE_HEAD` exists on a branch the marker doesn't name), stop and ask
  the user how to proceed rather than guessing.

## Start procedure

1. **Check for an existing active review first.** Run
   `git config --local --get reviewbranch.branch`. If it's set and that branch still
   exists, tell the user a review is already in progress on it and ask whether to end that
   one first (run the End procedure) or leave it and start a second review branch anyway.
   The marker only tracks one review at a time, so proceeding will overwrite it - warn them
   that a later `end` will only know how to clean up this newer branch, not the older one
   (which they'd then need to clean up manually). Do not silently overwrite the marker
   without saying so.

2. **Run `git status --short`.** If there are uncommitted changes, tell the user what they
   are before proceeding - they will carry over onto the new branch (uncommitted changes
   aren't tied to a branch), which is usually what's wanted but should never be a silent
   surprise. Do not stash or discard anything.

3. **Record the source branch**: `git branch --show-current`. This is what "End" returns
   to. If this is empty (detached HEAD), stop and ask the user what branch they intend to
   return to afterward.

4. **Determine and confirm the starting point** - this step is required, never skip it:
   - Try to find an upstream: `git rev-parse --abbrev-ref --symbolic-full-name @{u}` (may
     fail if none is configured).
   - If an upstream exists, compute the default base with
     `git merge-base HEAD @{u}`. This is almost always exactly "the commit before this
     session's/branch's unpushed work" - the natural meaning of "the work done in the
     session" - since it's the point where local history diverges from what's already
     shared.
   - If no upstream exists, there is no safe default - ask the user directly for a
     commit-ish (a hash, tag, or "N commits back").
   - Either way, before creating anything: show the resolved base commit (short hash +
     subject) and run `git log --oneline <base>..HEAD` to show exactly which commits would
     be included, and ask the user to confirm this is the right starting point or give a
     different one. Do not proceed until they confirm.

5. **Name the review branch.** Auto-generate a short, descriptive default (e.g.
   `review/<short-base-sha>-<yyyymmdd>`, or something more descriptive if the session
   context suggests a good name, like `review/<topic>`) and tell the user the name you
   picked - no need to ask unless they'd previously indicated a naming preference or the
   default would collide with an existing branch (`git rev-parse --verify --quiet
   refs/heads/<name>`).

6. **Create it and stage the merge:**
   ```bash
   git branch <review-branch> <base>
   git checkout <review-branch>
   git merge --no-commit --no-ff <source-branch>
   ```
   If the merge reports conflicts (unexpected for this workflow - it implies the review
   branch's base diverged from the source branch in a way that isn't a strict ancestor
   relationship), stop, show the user the conflicting files, and ask how to proceed. Do not
   resolve conflicts unilaterally.

7. **Persist the marker:**
   ```bash
   git config --local reviewbranch.source <source-branch>
   git config --local reviewbranch.branch <review-branch>
   ```

8. **Report to the user**: branch name, base commit, source branch, and
   `git status --short` summary of what's staged for review. Remind them: review it in the
   IDE's source-control panel, and to say when they're done (or run this skill with `end`)
   to abort the staged merge and return to `<source-branch>`. Never commit the staged merge
   yourself.

## End procedure

1. **Read the marker**: `git config --local --get reviewbranch.source` and
   `git config --local --get reviewbranch.branch`. If neither is set, fall back to asking
   the user which branch to return to and which review branch(es) to delete - do not guess.

2. **If `MERGE_HEAD` exists** (merge still staged, not committed): `git merge --abort`.
   **If it does not exist** but the review branch has a commit beyond its base (the user
   committed the staged merge themselves instead of leaving it staged): do not discard
   it - tell the user their review branch has a real commit on it now, ask whether they
   still want it deleted (which would lose that commit unless it's merged elsewhere), and
   only delete on explicit confirmation.

3. **Return to the source branch**: `git checkout <source-branch>` (from the marker, or
   the branch the user named in step 1).

4. **Delete the review branch** with `git branch -d <review-branch>` (safe delete, never
   `-D`). This succeeds whenever the branch has no commits that aren't ancestors of another
   branch - true for the normal staged-merge-aborted case. If it fails, that means the
   branch does carry unique commits; report this to the user and ask before using `-D`.

5. **Clear the marker**: `git config --local --unset reviewbranch.source`;
   `git config --local --unset reviewbranch.branch`.

6. **Confirm the final state**: `git status --short` and `git branch --show-current`,
   showing the user they're back on a clean `<source-branch>` with the review branch gone.

## Boundaries

- Never run `git merge --abort` or delete a branch without first checking whether it would
  discard a real commit the user might want - see step 2 of the End procedure.
- Never use `git branch -D`, `git reset --hard`, or `git push --force` as part of this
  skill without the user explicitly asking for that specific operation.
- Never commit the staged merge, and never push the review branch or the source branch.
- Never skip the Start procedure's step 4 confirmation, even if a default base was
  computed automatically - the user must confirm the starting point every time.
- If more than one review branch marker situation is ambiguous (stale config pointing at a
  deleted branch, `MERGE_HEAD` on an unexpected branch, etc.), stop and ask rather than
  guessing which branch/commit is meant.
