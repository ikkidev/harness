const VERDICTS = {
  approved: 'success',
  'changes-requested': 'failure',
};

export function parseArgs(argv) {
  const [prArg, sha, verdict, roundArg = '1'] = argv;
  if (!/^[1-9]\d*$/.test(prArg ?? '')) throw new Error(`PR number must be a positive integer, got "${prArg}"`);
  if (!/^[0-9a-f]{40}$/i.test(sha ?? '')) throw new Error(`head SHA must be a full 40-hex SHA, got "${sha}"`);
  if (!Object.hasOwn(VERDICTS, verdict)) throw new Error(`verdict must be approved or changes-requested, got "${verdict}"`);
  if (!/^[1-9]\d*$/.test(roundArg)) throw new Error(`round must be a positive integer, got "${roundArg}"`);
  return { pr: Number(prArg), sha, verdict, round: Number(roundArg) };
}

export function statusFor({ verdict, round }) {
  return { state: VERDICTS[verdict], description: `round ${round}: ${verdict}` };
}

export function parseTier(description) {
  return /^tier=(\w+)$/.exec(description ?? '')?.[1] ?? null;
}

export function assertLocalTier(description) {
  if (description === null || description === undefined) throw new Error('no harness/tier status on this SHA; wait for CI');
  if (description === '') throw new Error('harness/tier status has an empty description');
  const tier = parseTier(description);
  if (tier === 'high') throw new Error('tier=high: the local agent must not post harness/review');
  if (tier !== 'low' && tier !== 'normal') throw new Error(`unrecognized harness/tier description "${description}"`);
  return tier;
}

export function assertHead(pr, sha, head) {
  if (sha.toLowerCase() !== String(head).trim().toLowerCase()) {
    throw new Error(`${sha} is not the head of PR #${pr} (head is ${String(head).trim()})`);
  }
}
