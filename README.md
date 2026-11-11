# harness

Reusable CI gate pieces. Repos declare risk tiers for changed paths in a `harness.yml`; the tier action resolves the tier of a pull request, posts it as the commit status `harness/tier` on the head SHA, and sets a `risk:<tier>` label for humans. Other jobs read the status, not the label.

The config is read from the PR's base ref, so a PR cannot change its own tier rules.

## Wiring the tier action

Pin by commit SHA, never by tag.

```yaml
name: harness
on:
  pull_request:
    types: [opened, synchronize, reopened, edited, labeled, unlabeled]
permissions:
  contents: read
  statuses: write
  pull-requests: write
jobs:
  tier:
    if: >-
      !((github.event.action == 'labeled' || github.event.action == 'unlabeled')
      && startsWith(github.event.label.name, 'risk:'))
    concurrency:
      group: harness-${{ github.event.pull_request.number }}
      cancel-in-progress: true
    runs-on: ubuntu-latest
    steps:
      - uses: ikkidev/harness/actions/tier@<full-commit-sha>
```

- `edited`, `labeled`, `unlabeled` re-run the checks when the PR body or labels (such as `no-issue`, `no-tests`) change.
- The job-level `if` skips `risk:` label events. With the default `github.token` the action's own label writes trigger no workflows (GITHUB_TOKEN events are suppressed), so the guard matters only when a PAT is used as `token`, or when a human edits a `risk:` label while a run is in flight.
- `concurrency` with `cancel-in-progress` keeps a stale run from posting a status after a newer push. It is set at job level so a job skipped by its `if` does not claim the group and cancel a live run.

The action creates and manages the `risk:low|normal|high` labels itself and removes stale ones; the label work runs before the status is posted, so the status is the last write.

On `pull_request` events from forks the token is read-only, so the status and label calls fail with 403; the action is meant for same-repo branches (private repos).

Inputs: `token` (default `github.token`), `config-path` (default `harness.yml`). Output: `tier`.

## Wiring the evidence action

Runs after the tier job and posts the commit status `harness/evidence` (`ok`, or `missing: Tests, Evidence`). A failed check is a failed status, not a failed job; the job fails only on an operational error. Copy `templates/pull_request_template.md` to `.github/pull_request_template.md`. With `evidence.standard_template: true` every section (Summary, Risk, Tests, Evidence, Deploy) must be present and not just its placeholder comment (Tests is exempt on docs-only PRs and with the `no-tests` label; write "n/a: no visible change" in Evidence when nothing is visible). Repos with `invariants: true` add their own `## Invariants` section. HTML comments are ignored in every section, also without the flag; an unterminated `<!--` hides the rest of the section and fails it.

```yaml
jobs:
  tier:
    runs-on: ubuntu-latest
    outputs:
      tier: ${{ steps.tier.outputs.tier }}
    steps:
      - id: tier
        uses: ikkidev/harness/actions/tier@<full-commit-sha>
  evidence:
    needs: tier
    runs-on: ubuntu-latest
    steps:
      - uses: ikkidev/harness/actions/evidence@<full-commit-sha>
        with:
          tier: ${{ needs.tier.outputs.tier }}
```

The tier job must expose `outputs.tier` as above for `needs.tier.outputs.tier` to resolve. Inputs: `tier` (required), `token`, `config-path`. Use the trigger types from the tier wiring above; put the same `concurrency` block on the evidence job.

`harness/review` is also a required check; its producer differs by tier (see Review status below).

Rules, listed in the order they are reported (`Issue`, `Tests`, `Evidence`, `Invariants`). A section is a `## <Name>` heading (case-insensitive) up to the next `## ` heading. A section with `<!--` anywhere still has its template placeholder and fails.

- Issue: outside HTML comments, the body has one of: `Closes|Fixes|Resolves` with `#N`, `owner/repo#N` or a GitHub issue URL; `Part of`, `Refs`, `Tracked in`, `Relates to` or `Plan:` followed within three words by a reference (an issue such as `#N` or `repo#N`, a ticket key such as `SMF-5`, an epic such as `E27`, a `.md` plan path, a URL, or "the plan" / "the brief"); a Notion URL; an epic step (`Step 7 of E25`, `E27 slice 1`); or a `## Issue` section containing a reference. Otherwise the PR needs the `no-issue` label. Only the closing keywords close issues on merge.
- Tests: required when any changed file is not a doc (`docs/**` or `**/*.md`), unless the PR has the `no-tests` label. On `high` tier the label is accepted but the status reads `ok (no-tests on high)`, and the approver must judge the label. The `## Tests` section must contain the path of a changed file under a `spec`, `specs`, `test`, `tests`, `__tests__`, `e2e` or `maestro` directory, or named `*.test.*`, `*.spec.*` (JS/TS), `*_spec.rb` or `*_test.go`.
- Evidence: required when a changed file matches an `evidence.screenshots_for` glob. Files named `*.test.*` / `*.spec.*` (JS/TS) or under a `__tests__` directory never count. The `## Evidence` section must contain a Markdown image (`![`), an `<img` tag, a URL ending in `.png|.jpg|.jpeg|.gif|.mp4|.mov|.webm`, or a URL containing `/actions/runs/` or `/artifacts/`.
- Automated evidence: when `evidence.automated_status` (a status context) and `evidence.automated_screens_section` (a body section name) are both set, a `screenshots_for` match with no media passes if the newest `github-actions[bot]` status of that context on the head SHA is `success` and the named section has a line starting with a page path (`/event/1`, optionally after a list marker or backtick). The status reads `ok (automated evidence (<context>))`. A status does not re-run the check: the consumer's workflow must re-run `harness-gate` after posting it.
- Invariants: required when `evidence.invariants` is true and the tier is `high`. The `## Invariants` section must be present and non-empty.

## Review status

`harness/review` is a required check whose producer differs by tier: the authoring Claude Code session posts it locally for low and normal.

For high tier, the tier action posts `harness/review` as `pending` (`high tier: awaiting approver`). The approver account posts the success status by hand after their code-owner review, until a CI-hosted reviewer exists:

```
gh api -X POST repos/{owner}/{repo}/statuses/<sha> -f state=success -f context=harness/review -f description="approved by <login>"
```

For low and normal, after applying `review/low.md` or `review/normal.md`, the session runs from the consumer repo checkout, with the developer's `gh` login:

```
node bin/review-status.mjs <pr-number> <head-sha> <approved|changes-requested> [round]
```

It posts `harness/review` on the SHA: `success` for approved, `failure` for changes-requested, description `round <n>: <verdict>` (round defaults to 1).

- It refuses with an `ERROR:` line and exit 1 when the verdict word is anything else, or when no `harness/tier` status exists on the SHA yet.
- With a PAT as the action's `token`, the `harness/tier` creator is the PAT user, not `github-actions[bot]`, so `review-status` refuses; use the default token.
- It refuses when the SHA is not the head of the PR, and when the tier (read from the `github-actions[bot]` status) is `high`: the local agent never posts a review status there, and high-tier merges also need a code-owner review.
- Below high tier the status is spoofable by the same agent that wrote the change. That is by design: it is a process gate, and the tier, evidence and CI checks remain independent.

## harness.yml

See `templates/harness.yml`.

```yaml
default: normal            # tier for paths no glob matches
approvers: [some-account]
tiers:
  high: ["src/server/**", ".github/**", "harness.yml", "CODEOWNERS"]
  normal: []               # optional
  low: ["docs/**", "**/*.md"]
evidence:
  screenshots_for: ["src/**/*.tsx"]
  automated_status: "preview/screens"       # optional, needs the next key
  automated_screens_section: "Screens"     # optional
  invariants: false
```

Regardless of config, `.github/**`, `CODEOWNERS` (at any depth) and the config file itself are always high. A PR takes the highest tier among its changed paths (high > normal > low). A path matching several tiers takes the highest. An empty PR takes `default`. Globs use minimatch with `dot: true`.

## Development

```
npm ci
npm test
```
