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

export function decideCarry({ prior, priorSha, beforeFp, afterFp, trusted }) {
  if (!prior || prior.state !== 'success' || !trusted.has(prior.creator)) return { action: 'none' };
  if (!beforeFp || !afterFp) return { action: 'none' };
  const short = String(priorSha).slice(0, 7);
  if (beforeFp === afterFp) return { action: 'success', description: `carried from ${short}: ${prior.description}` };
  return { action: 'failure', description: `changes since ${short} (${prior.description}); re-review needed` };
}
