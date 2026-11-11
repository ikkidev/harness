import { execFileSync } from 'node:child_process';

const runGit = (args, opts) => execFileSync('git', args, { encoding: 'utf8', maxBuffer: 256 * 1024 * 1024, ...opts });

/* What a PR changes against its base, as one id: GitHub's "Files changed" diff (from the merge base),
   through `patch-id --verbatim`, which ignores line positions but keeps whitespace. Two heads with the
   same changes get the same id however they were rebased or retargeted. 'empty' when nothing changes;
   null when git cannot answer (unknown commit, no merge base), so a caller never mistakes it for a match. */
export function fingerprint({ cwd, base, head, git = runGit }) {
  try {
    const mergeBase = git(['merge-base', base, head], { cwd }).trim();
    const diff = git(['diff', '--no-color', '--no-ext-diff', '--binary', mergeBase, head], { cwd });
    if (diff === '') return 'empty';
    const id = git(['patch-id', '--verbatim'], { cwd, input: diff }).trim().split(/\s+/)[0];
    return id || null;
  } catch {
    return null;
  }
}
