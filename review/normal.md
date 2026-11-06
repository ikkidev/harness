# Review checklist: normal tier

The low checks listed below that still apply, plus the code checks. Answer each check pass or fail with a `file:line` citation.

## Output contract

- First line is exactly `verdict: approved` or `verdict: changes-requested`.
- Then numbered findings, one per failed check: `N. path:line — failure — fix`.
- An approval ends with a table mapping each acceptance criterion from the linked issue to what covers it (`path:line` of the test, or an artifact URL):

  | Acceptance criterion | Covered by |
  |---|---|
  | <criterion> | <test path:line, or artifact URL> |

## Low checks that still apply (the docs-only checks do not)

1. No PR-template placeholder (`<!--`) is left in the PR body or in any changed file.
2. Every relative path and anchor added or edited resolves (Read/Glob); external URLs are checked for format only.
3. No secrets, tokens, credentials, or private hostnames appear in the diff.
4. No attribution footers or trailers (`Co-Authored-By`, "Generated with") appear in the diff, commits, or PR body. Applies only when the PR author is `ikkidev`, `app/seatsnags-harness` or `app/ikkidev-harness`; other authors' attribution lines are not a finding.

## Normal checks

5. Every acceptance criterion in the linked issue maps to a named test or artifact. An unmapped criterion is a finding.
6. Each mapped test exercises behavior: it asserts on outputs or effects, and would fail if the feature were removed.
7. Tests do not assert only on mocks or on calls the test itself arranged.
8. No swallowed errors: no empty `catch`/`rescue`, no `catch` that only logs and continues, no `|| true` or ignored exit code on a command whose failure matters.
9. Every new `rescue`/`catch` handles the error (recover, translate, or re-raise) and has a test for that path.
10. Every new external call that is not idempotent (write, charge, send, enqueue) carries an idempotency key, or the PR states why a retry is safe. Read-only calls pass with no statement needed.
11. The PR body sections are complete and accurate: Issue, Tests, and Evidence where required, with no unfilled placeholders.
12. The diff contains no unrelated changes, debug output, or commented-out code.
