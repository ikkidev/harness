# harness

Reusable CI gate pieces. Repos declare risk tiers for changed paths in a `harness.yml`; the tier action resolves the tier of a pull request, posts it as the commit status `harness/tier` on the head SHA, and sets a `risk:<tier>` label for humans. Other jobs read the status, not the label.

The config is read from the PR's base ref, so a PR cannot change its own tier rules.

## Wiring the tier action

Pin by commit SHA, never by tag.

```yaml
name: harness
on:
  pull_request:
    types: [opened, synchronize, reopened]
permissions:
  contents: read
  statuses: write
  pull-requests: write
jobs:
  tier:
    runs-on: ubuntu-latest
    steps:
      - uses: ikkidev/harness/actions/tier@<full-commit-sha>
```

The action creates and manages the `risk:low|normal|high` labels itself and removes stale ones; the label work runs before the status is posted, so the status is the last write.

On `pull_request` events from forks the token is read-only, so the status and label calls fail with 403; the action is meant for same-repo branches (private repos).

Inputs: `token` (default `github.token`), `config-path` (default `harness.yml`). Output: `tier`.

## Wiring the evidence action

Runs after the tier job and posts the commit status `harness/evidence` (`ok`, or `missing: Tests, Evidence`). A failed check is a failed status, not a failed job; the job fails only on an operational error. Copy `templates/pull_request_template.md` to `.github/pull_request_template.md`.

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

The tier job must expose `outputs.tier` as above for `needs.tier.outputs.tier` to resolve. Inputs: `tier` (required), `token`, `config-path`. The PR also needs `pull_request` types `edited` and `labeled` in the workflow trigger to re-run when the body or labels change.

Rules, listed in the order they are reported (`Issue`, `Tests`, `Evidence`, `Invariants`). A section is a `## <Name>` heading (case-insensitive) up to the next `## ` heading. A section with `<!--` anywhere still has its template placeholder and fails.

- Issue: the body has `Closes|Fixes|Resolves #N` (case-insensitive), or the PR has the `no-issue` label.
- Tests: required when any changed file is not a doc (`docs/**` or `**/*.md`). The `## Tests` section must contain the path of a changed file matching `/(spec|test|__tests__|e2e|maestro)/`.
- Evidence: required when a changed file matches an `evidence.screenshots_for` glob. The `## Evidence` section must contain a Markdown image (`![`), an `<img` tag, a URL ending in `.png|.jpg|.jpeg|.gif|.mp4|.mov|.webm`, or a URL containing `/actions/runs/` or `/artifacts/`.
- Invariants: required when `evidence.invariants` is true and the tier is `high`. The `## Invariants` section must be present and non-empty.

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
  invariants: false
```

A PR takes the highest tier among its changed paths (high > normal > low). A path matching several tiers takes the highest. An empty PR takes `default`. Globs use minimatch with `dot: true`.

## Development

```
npm ci
npm test
```
