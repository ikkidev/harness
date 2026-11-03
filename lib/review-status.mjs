const VERDICTS = {
  approved: 'success',
  'changes-requested': 'failure',
};

export function parseArgs(argv) {
  const [prArg, sha, verdict, roundArg = '1'] = argv;
  if (!/^[1-9]\d*$/.test(prArg ?? '')) throw new Error(`PR number must be a positive integer, got "${prArg}"`);
  if (!/^[0-9a-f]{7,40}$/i.test(sha ?? '')) throw new Error(`head SHA must be 7-40 hex chars, got "${sha}"`);
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
