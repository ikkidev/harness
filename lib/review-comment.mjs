/*
 * The cloud reviewer cannot post commit statuses (its proxy forbids them), so it
 * posts its verdict as a PR comment and a workflow turns that comment into the
 * harness/review status. These are the pure parts of that workflow.
 */
const LINE1 = /^Automated review \(bot, tier: (low|normal), round ([1-9]\d*)\): (approved|changes requested)\s*$/;
const LINE2 = /^Commit ([0-9a-f]{40})\.\s*$/;

/* Returns { tier, round, verdict, sha } for a well-formed verdict comment, else null. */
export function parseReviewComment(body) {
  const [l1 = '', l2 = ''] = String(body ?? '').replace(/\r\n/g, '\n').split('\n');
  const a = LINE1.exec(l1);
  const b = LINE2.exec(l2);
  if (!a || !b) return null;
  return {
    tier: a[1],
    round: Number(a[2]),
    verdict: a[3] === 'approved' ? 'approved' : 'changes-requested',
    sha: b[1],
  };
}

/* Only a PR comment, newly created, by the configured reviewer login counts. */
export function commentEvent(event, reviewerLogin) {
  if (event?.action !== 'created' || !event?.issue?.pull_request) return null;
  if (event?.comment?.user?.login !== reviewerLogin) return null;
  return { number: event.issue.number, id: event.comment.id, body: event.comment.body };
}

export const needsHuman = ({ verdict, round }) => verdict === 'changes-requested' && round >= 3;

/*
 * What to do with a parsed verdict given the PR head and the posted tier.
 * A missing tier is an error (the run goes red and can be re-run), not a silent skip.
 */
export function decide(verdict, head, tier) {
  if (String(head).trim().toLowerCase() !== verdict.sha.toLowerCase()) return { act: false, why: `${verdict.sha} is no longer the head` };
  if (tier === null || tier === undefined) throw new Error(`no harness/tier status on ${verdict.sha} yet; re-run this job once the tier job has finished`);
  if (tier !== verdict.tier) return { act: false, why: `comment says tier ${verdict.tier}, harness/tier is ${tier}` };
  return { act: true, label: needsHuman(verdict) };
}

/* The Claude cloud proxy appends this footer to every comment it writes, including edits. */
const FOOTER = /\n+-{3,}\s*\n_?Generated (by|with) \[Claude Code\]\([^)]*\)_?\s*$/;

/* Returns the body without the trailing Claude Code footer, or null when there is none. */
export function stripFooter(body) {
  const s = String(body ?? '');
  return FOOTER.test(s) ? s.replace(FOOTER, '\n') : null;
}

/* Cosmetic: never let it block the verdict or the auto-merge after it. */
export function stripFooterBestEffort(repo, ev, { exec, log = console.log }) {
  const clean = stripFooter(ev.body);
  if (clean === null) return;
  try {
    exec('api', '-X', 'PATCH', `repos/${repo}/issues/comments/${ev.id}`, '-f', `body=${clean}`);
    log('stripped the Claude Code footer');
  } catch (err) {
    log(`WARNING: could not strip the footer: ${String(err?.message ?? err).split('\n')[0]}`);
  }
}
