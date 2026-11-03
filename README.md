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
