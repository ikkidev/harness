# Review Carry-Forward Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A PR keeps its green `harness/review` across a new commit or a base change when its changes are byte-identical; any real change blocks it until re-reviewed.

**Architecture:** A new `carry-review` job in each Seatsnags repo's `harness-gate.yml` runs on `pull_request` `synchronize` and `edited` (base change). It calls a harness composite action that fingerprints the PR's changes before and after (git, `patch-id --verbatim` over the three-dot diff) and, if the previous head had a trusted `harness/review` success, posts success (same) or failure (different) on the current head. Fingerprints are computed at run time from both commits, so the three existing producers of `harness/review` are untouched.

**Tech Stack:** Node 22 ESM, `node --test`, git CLI, `gh` CLI, GitHub Actions composite action.

**Spec:** Session design `2026-11-11-review-carry-forward-design.md` (not committed, per the repo-docs rule); its decisions are restated below.

## Global Constraints

- Fingerprint = `git patch-id --verbatim` of `git diff --no-color --no-ext-diff --binary <merge-base(base, head)> <head>`. Line numbers ignored, whitespace counts. An empty diff fingerprints as the literal `empty`.
- Trusted creators of a `harness/review` success: `github-actions[bot]`, `seatsnags-harness[bot]`, `ikkidev`. Passed as the action input `trusted-creators` (comma separated), not hardcoded in lib.
- Only `GITHUB_TOKEN` (`statuses: write`, `contents: read`, `pull-requests: read`). No new secrets, no App permissions.
- Honor system (Ikki, 2026-11-11): no forgery defense; any listed approver re-greens on any tier.
- Never post success unless both fingerprints were computed and are equal. Any git or API error: log `NOTE:` and post nothing (the PR stays blocked).
- Status descriptions at most 140 chars (`postStatus` already truncates). Success: `carried from <sha7>: <prior description>`. Failure: `changes since <sha7> (<prior description>); re-review needed`.
- No emoji or non-ASCII in scripts or logs. Commit subjects single line, no trailers.

## Review Focus

- **Force-pushed `before` no longer on any ref**: `git fetch origin <sha>` is tried; if it still fails, post nothing (test: `fingerprint` returns null for an unknown SHA).
- **Rebase and retarget at once**: GitHub sends `edited` (base) and `synchronize` separately. The sync path refuses to carry when the PR timeline shows a base change after the review (final review C1); runs queue rather than cancel.
- **`before` has only a carried success**: chains keep carrying (test: a prior description starting `carried from` still counts).
- **Prior `harness/review` is failure or from an untrusted creator**: post nothing.
- **Whitespace-only change** (YAML indentation): a different fingerprint (test in Task 1).

---

### Task 1: Diff fingerprint

**Files:**
- Create: `lib/fingerprint.mjs`
- Test: `lib/fingerprint.test.mjs`

**Interfaces:**
- Produces: `fingerprint({ cwd, base, head, git? }) -> string | null` where `base` and `head` are commit-ish; returns `'empty'` for no changes, `null` if any git call fails. `git` is an injectable `(args: string[], opts) -> string` defaulting to `execFileSync('git', ...)`.

- [ ] **Step 1: Write the failing tests** (each builds a throwaway repo in `mkdtempSync` with `git init`, commits on `main`, branches `feat`):
  - `'an empty commit on top keeps the fingerprint'`: fp(main, feat) === fp(main, feat plus `git commit --allow-empty`).
  - `'a rebase onto a moved base keeps the fingerprint'`: add an unrelated file commit to main, `git rebase main feat`; fp equal before and after.
  - `'retargeting a stacked branch after its parent merged with a merge commit keeps the fingerprint'`: `parent` off main, `child` off parent; fp(parent, child) === fp(main after `merge --no-ff parent`, child).
  - `'retargeting a stacked branch whose parent did not merge changes the fingerprint'`: fp(parent, child) !== fp(main, child).
  - `'a whitespace-only change changes the fingerprint'`: re-indent one YAML line in feat.
  - `'a one-character change changes the fingerprint'`.
  - `'no changes fingerprint as empty'`: fp(main, main) === 'empty'.
  - `'an unknown commit gives null'`: head is 40 hex of a commit that does not exist.
- [ ] **Step 2: Run** `node --test lib/fingerprint.test.mjs`. Expected: FAIL, module not found.
- [ ] **Step 3: Implement** `fingerprint` in `lib/fingerprint.mjs`: `merge-base base head`, then `diff --no-color --no-ext-diff --binary mb head`, fed (`input:`) to `patch-id --verbatim`; first token of its output, or `'empty'` when the diff is empty; any throw gives `null`.
- [ ] **Step 4: Run** `node --test lib/fingerprint.test.mjs`. Expected: all pass.
- [ ] **Step 5: Commit** `git add lib/fingerprint.mjs lib/fingerprint.test.mjs && git commit -m "Fingerprint a PR's changes against its base"`

### Task 2: Carry decision and event parsing

**Files:**
- Create: `lib/carry-review.mjs`
- Test: `lib/carry-review.test.mjs`

**Interfaces:**
- Consumes: nothing from Task 1 (pure).
- Produces:
  - `carryEvent(payload) -> { kind: 'sync', number, before, after, base } | { kind: 'retarget', number, head, fromBase, toBase } | null`. `synchronize` gives sync with `payload.before`, `payload.after`, `pull_request.base.ref`; `edited` with `changes.base.ref.from` gives retarget (`head` = `pull_request.head.sha`, `toBase` = `pull_request.base.ref`); anything else gives null.
  - `parseTrusted(csv) -> Set<string>` (trimmed, empty entries dropped).
  - `decideCarry({ prior, priorSha, beforeFp, afterFp, trusted }) -> { action: 'success' | 'failure' | 'none', description?: string }` where `prior` is `{ state, description, creator } | null`. `none` when prior is null, its state is not `success`, its creator is not trusted, or either fp is null. Equal fps: success, `carried from <first 7 of priorSha>: <prior.description>`. Different: failure, `changes since <sha7> (<prior.description>); re-review needed`.

- [ ] **Step 1: Write the failing tests**: `carryEvent` for a synchronize payload, an edited-base payload, an edited-title-only payload (null), an `opened` payload (null). `decideCarry`: equal fps give success with exactly `carried from 1234567: approved by ikkidev`; different fps give failure `changes since 1234567 (approved by ikkidev); re-review needed`; prior state failure gives none; creator `mallory` gives none; afterFp null gives none; prior description `carried from abcdef0: round 1: approved` still carries. `parseTrusted(' github-actions[bot], ikkidev ')` has exactly those two.
- [ ] **Step 2: Run** `node --test lib/carry-review.test.mjs`. Expected: FAIL.
- [ ] **Step 3: Implement** the three functions in `lib/carry-review.mjs`.
- [ ] **Step 4: Run** it. Expected: PASS.
- [ ] **Step 5: Commit** `git commit -m "Decide whether a review carries to a new head"`

### Task 3: Status lookup with creator, the bin script and the action

**Files:**
- Modify: `lib/gh.mjs` (add `latestStatus`)
- Test: `lib/gh.test.mjs` (add cases), `lib/bin-smoke.test.mjs` (fake-gh run)
- Create: `bin/carry-review-status.mjs`, `actions/carry-review/action.yml`
- Modify: `README.md` (one section: what carry-review does, the trusted list, and the GitHub setting Ikki turns off)

**Interfaces:**
- Consumes: `fingerprint` (Task 1), `carryEvent`, `decideCarry`, `parseTrusted` (Task 2), `postStatus`, `gh`.
- Produces: `latestStatus(repo, sha, context, { exec? }) -> { state, description, creator } | null` (newest row for the context, any creator; reuses `STATUSES_JQ`). Action `ikkidev/harness/actions/carry-review` with inputs `token` (default `github.token`) and `trusted-creators` (default `github-actions[bot],seatsnags-harness[bot],ikkidev`). The consumer checks out the repo with `fetch-depth: 0` before calling it.

- [ ] **Step 1: Write the failing tests**: `latestStatus` returns the first matching row with its creator, and null when absent (fake `exec`). In `bin-smoke.test.mjs`, a fake `gh` plus a real temp git repo (with a bare `origin` remote) as cwd and a synchronize event file: (a) prior trusted success and an empty commit give one `statuses` POST with `state=success` and `context=harness/review`; (b) a real change gives one POST with `state=failure`; (c) no prior status gives no POST.
- [ ] **Step 2: Run** `npm test`. Expected: the new tests fail.
- [ ] **Step 3: Implement** `latestStatus`, then `bin/carry-review-status.mjs`: read `GITHUB_EVENT_PATH`, `GITHUB_REPOSITORY`, `HARNESS_TRUSTED_CREATORS`. Sync: `git fetch --no-tags origin <before> <after> <base>` (a failure is logged, and `fingerprint` then returns null), prior = `latestStatus(before)`, fps = `fingerprint(origin/<base>, before)` and `fingerprint(origin/<base>, after)`, post on `after`. Retarget: prior = `latestStatus(head)`, fps against `origin/<fromBase>` and `origin/<toBase>`, post only on failure (the existing success already stands). One log line per decision; exit 0 on `none`. The action mirrors `actions/tier/action.yml` (setup-node, `npm ci --omit=dev`, run the bin with `GH_TOKEN` and `HARNESS_TRUSTED_CREATORS`).
- [ ] **Step 4: Run** `npm test`. Expected: all pass.
- [ ] **Step 5: Commit** `git commit -m "Carry harness/review to a new head when the changes are unchanged"`; push and open the harness PR (no harness.yml there: a plain PR that Ikki merges). Record its merge SHA in the Progress log.

### Task 4: Wire both Seatsnags repos

**Files (each repo, one PR each, opened through the seatsnags-harness App helper):**
- Modify: `.github/workflows/harness-gate.yml` (add job `carry-review`)
- Modify: `AGENTS.md` (one line: approvals carry across rebases, retargets and empty commits when the diff is unchanged; a real change shows "re-review needed")

**Interfaces:**
- Consumes: the Task 3 action at the harness merge SHA.

- [ ] **Step 1: Add the job**: `if: github.event.action == 'synchronize' || (github.event.action == 'edited' && github.event.changes.base)`; `permissions: { statuses: write, contents: read, pull-requests: read }`; `needs: tier`; `concurrency: { group: harness-carry-${{ github.event.pull_request.number }}, cancel-in-progress: false }`; steps: `actions/checkout` (pinned SHA, as elsewhere in these workflows) with `fetch-depth: 0`, then `ikkidev/harness/actions/carry-review@<merge SHA>`.
- [ ] **Step 2: Verify the YAML** parses: `node --input-type=module -e "import {parse} from '/Users/ikkilachance/Projects/harness/node_modules/yaml/dist/index.js'; import {readFileSync} from 'node:fs'; parse(readFileSync('.github/workflows/harness-gate.yml','utf8')); console.log('OK')"`, plus `actionlint` if installed.
- [ ] **Step 3: Commit, push, open the PR**: body links the harness PR, label `no-tests`, `Tier: high (.github/**)`. Ikki approves.

### Task 5: End-to-end check and the GitHub setting

- [ ] **Step 1: On a throwaway frontend PR** (docs-only branch off `main`, opened via the App, label `no-tests`): get a trusted `harness/review` success (low tier, local reviewer); push an empty commit; expect `harness/review` success `carried from ...` on the new head within a few minutes. Push a one-space change; expect failure `... re-review needed`. Close the PR and delete the branch.
- [ ] **Step 2: Ask Ikki to turn off** "Dismiss stale pull request approvals when new commits are pushed" on backend `dev` and `main` and frontend `main` (agents may not change branch protection). Re-check: `gh api repos/<repo>/branches/<b>/protection --jq .required_pull_request_reviews.dismiss_stale_reviews` prints `false`.
- [ ] **Step 3:** Move this file to `docs/exec-plans/completed/`.

## Progress log

| Date | Task | Note |
|---|---|---|
| 2026-11-11 | - | Plan written; design approved by Ikki (honor system, both Seatsnags repos). |

## Decision log

| Date | Decision | Why |
|---|---|---|
| 2026-11-11 | Harness owns staleness; GitHub dismissal off | GitHub dismisses on any push (frontend #412: empty commit, identical patch-id, approval dismissed). |
| 2026-11-11 | Fingerprints computed at run time from `before`/`after`, not recorded at approval | Same guarantee, and the three producers of `harness/review` stay untouched. |
| 2026-11-11 | `patch-id --verbatim` over the three-dot diff | Ignores line positions, keeps whitespace; matches GitHub's "Files changed". |
| 2026-11-11 | Honor system | Ikki: cofounders, no point guarding strictly. |
| 2026-11-11 | Final review fixes C1, I1-I4 | Sync refuses after a base change; retarget doubt posts failure; a newer verdict on the new head wins; squash retargets ask for re-review (documented, tested); retarget path smoke-tested. |
