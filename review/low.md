# Review checklist: low tier

Docs and copy only. Answer each check pass or fail with a `file:line` citation.

## Output contract

- First line is exactly `verdict: approved` or `verdict: changes-requested`.
- Then numbered findings, one per failed check: `N. path:line — failure — fix`.
- An approval ends with a table mapping each acceptance criterion from the linked issue to what covers it (`path:line` of the test, or an artifact URL):

  | Acceptance criterion | Covered by |
  |---|---|
  | <criterion> | <path:line, or artifact URL> |

## Checks

1. Every changed file is documentation or copy. No executable code, config, or workflow file changed.
2. No code semantics changed: no edited code blocks that other files copy, run, or test against.
3. Every relative path and anchor added or edited resolves to an existing file or heading (check with Read/Glob). External URLs are checked for well-formed format only, not fetched.
4. No PR-template placeholder (`<!--`) is left in the PR body or in any changed file.
5. No secrets, tokens, credentials, or private hostnames appear in the diff.
6. No attribution footers or trailers (`Co-Authored-By`, "Generated with") appear in the diff, commits, or PR body.
7. Each acceptance criterion in the linked issue is satisfied by the change, or the PR states why it is out of scope.
