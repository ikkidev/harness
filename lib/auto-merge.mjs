/*
 * Auto-merge after the automated review. Only PRs into an allowlisted base
 * branch (one with branch protection and required checks) qualify: on an
 * unprotected base, `gh pr merge --auto` merges at once. Promotes into a
 * release branch must never be listed.
 */
export const MERGE_METHODS = ['merge', 'squash', 'rebase'];

export function parseBases(input) {
  return String(input ?? '').split(/[\s,]+/).map((b) => b.trim()).filter(Boolean);
}

/* Decide what to do. Returns { action: 'enable' | 'disable' | 'skip', why }. */
export function planAutoMerge({ verdict, pr, bases, method }) {
  if (!MERGE_METHODS.includes(method)) return { action: 'skip', why: `bad merge-method "${method}"` };
  if (!bases.includes(pr.base)) return { action: 'skip', why: `base ${pr.base} is not in auto-merge-bases` };
  if (verdict.verdict !== 'approved') return { action: 'disable', why: 'changes requested' };
  if (pr.draft) return { action: 'skip', why: 'draft PR' };
  if (pr.head.toLowerCase() !== verdict.sha.toLowerCase()) return { action: 'skip', why: 'head moved since the review' };
  return { action: 'enable', why: 'approved' };
}

/* gh arguments for the plan; --match-head-commit makes GitHub refuse if the head moved meanwhile. */
export function ghArgs({ action, repo, number, sha, method }) {
  if (action === 'disable') return ['pr', 'merge', String(number), '--repo', repo, '--disable-auto'];
  return ['pr', 'merge', String(number), '--repo', repo, '--auto', `--${method}`, '--match-head-commit', sha];
}

/*
 * Best-effort runner. deps: { getPr() -> {base, head, draft}, mint() -> token,
 * exec(args, extra), log(msg) }. Never throws: the verdict status is already
 * posted when this runs. No network call unless auto-merge is configured.
 */
export async function runAutoMerge({ verdict, repo, number, bases, method, haveCredentials }, deps) {
  if (bases.length === 0) return deps.log('auto-merge: off (no auto-merge-bases)'), { action: 'skip', why: 'off' };
  if (!haveCredentials) return deps.log('auto-merge: skipped (no App credentials)'), { action: 'skip', why: 'no credentials' };
  let plan = { action: 'skip', why: 'not planned' };
  try {
    plan = planAutoMerge({ verdict, pr: deps.getPr(), bases, method });
    if (plan.action === 'skip') return deps.log(`auto-merge: skipped (${plan.why})`), plan;
    const token = await deps.mint();
    deps.log(`::add-mask::${token}`);
    deps.exec(ghArgs({ action: plan.action, repo, number, sha: verdict.sha, method }), { GH_TOKEN: token });
    deps.log(`auto-merge: ${plan.action === 'enable' ? `enabled (${method})` : 'disabled'} as the App`);
    return plan;
  } catch (err) {
    const first = String(err.message).split('\n')[0];
    if (plan.action === 'disable') deps.log(`auto-merge: nothing to disable (${first})`);
    else deps.log(`WARNING: auto-merge ${plan.action === 'enable' ? 'enable' : 'step'} failed: ${first}`);
    return { action: 'error', why: plan.action };
  }
}
