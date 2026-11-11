/* Whether a harness/review success still holds after the PR's head or base changed: the same changes keep
   it, different changes need a re-review. Pure: the bin script fetches statuses and fingerprints. */

export function carryEvent(payload) {
  const pr = payload?.pull_request;
  if (!pr) return null;
  if (payload.action === 'synchronize') {
    return { kind: 'sync', number: pr.number, before: payload.before, after: payload.after, base: pr.base.ref };
  }
  const fromBase = payload.action === 'edited' ? payload.changes?.base?.ref?.from : undefined;
  if (fromBase) return { kind: 'retarget', number: pr.number, head: pr.head.sha, fromBase, toBase: pr.base.ref };
  return null;
}

export const parseTrusted = (csv) => new Set(String(csv ?? '').split(',').map((s) => s.trim()).filter(Boolean));

const trustedSuccess = (prior, trusted) => Boolean(prior && prior.state === 'success' && trusted.has(prior.creator));
const short = (sha) => String(sha).slice(0, 7);
const reReview = (sha, prior) => `changes since ${short(sha)} (${prior.description}); re-review needed`;

/* The tier action's placeholder on a high-tier head is not a verdict; anything else on the new head is. */
const isVerdict = (current) => Boolean(current) && !(current.state === 'pending' && /^high tier/.test(current.description));

/* New head, same base. `current` is the new head's own harness/review: a verdict posted there while this
   job waited is newer than anything carried from the old head, so it is left alone. */
export function decideCarry({ prior, priorSha, beforeFp, afterFp, trusted, current = null }) {
  if (!trustedSuccess(prior, trusted) || !beforeFp || !afterFp || isVerdict(current)) return { action: 'none' };
  if (beforeFp === afterFp) return { action: 'success', description: `carried from ${short(priorSha)}: ${prior.description}` };
  return { action: 'failure', description: reReview(priorSha, prior) };
}

/* Same head, new base. The review already sits on this head, so doing nothing keeps it green: every
   doubt (a fingerprint git could not compute) must post failure instead. */
export function decideRetarget({ prior, priorSha, fromFp, toFp, trusted }) {
  if (!trustedSuccess(prior, trusted)) return { action: 'none' };
  if (!fromFp || !toFp) return { action: 'failure', description: 'base changed and could not be compared; re-review needed' };
  if (fromFp === toFp) return { action: 'stands' };
  return { action: 'failure', description: reReview(priorSha, prior) };
}

/* Whether the PR's base changed after the review was posted (ISO times). The sync path compares both heads
   against today's base, which is the wrong question once the base moved since the review. */
export function baseChangedSince(baseChangeTimes, reviewedAt) {
  const at = Date.parse(reviewedAt ?? '');
  if (Number.isNaN(at)) return true;
  return baseChangeTimes.some((t) => Date.parse(t) > at);
}
