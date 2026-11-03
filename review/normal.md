# Review checklist: normal tier

Everything in the low checklist, plus the code checks below. Answer each check pass or fail with a `file:line` citation.

## Output contract

- First line is exactly `verdict: approved` or `verdict: changes-requested`.
- Then numbered findings, one per failed check: `N. path:line — failure — fix`.
- An approval ends with a table mapping each acceptance criterion from the linked issue to the test or artifact covering it:

  | Acceptance criterion | Covered by |
  |---|---|
  | <criterion> | <test name or artifact path:line> |

## Low checks that still apply (the docs-only checks do not)

1. No PR-template placeholder (`<!--`) is left in the PR body or in any changed file.
2. Every link and relative path added or edited resolves.
3. No secrets, tokens, credentials, or private hostnames appear in the diff.
4. No attribution footers or trailers (`Co-Authored-By`, "Generated with") appear in the diff, commits, or PR body.

## Normal checks

5. Every acceptance criterion in the linked issue maps to a named test or artifact. An unmapped criterion is a finding.
6. Each mapped test exercises behavior: it asserts on outputs or effects, and would fail if the feature were removed.
7. Tests do not assert only on mocks or on calls the test itself arranged.
8. No swallowed errors: no empty `catch`/`rescue`, no `catch` that only logs and continues, no discarded exit codes.
9. Every new `rescue`/`catch` handles the error (recover, translate, or re-raise) and has a test for that path.
10. Every new external call (HTTP, queue, payment, email, subprocess with side effects) carries an idempotency key, or the PR states why none is needed.
11. The PR body sections are complete and accurate: Issue, Tests, and Evidence where required, with no unfilled placeholders.
12. The diff contains no unrelated changes, debug output, or commented-out code.
