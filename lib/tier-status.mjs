export function parseEvent(event) {
  const pr = event?.pull_request;
  if (!pr?.number || !pr.base?.ref || !pr.head?.sha) {
    throw new Error('event payload has no pull_request number, base ref and head sha');
  }
  return { number: pr.number, baseRef: pr.base.ref, headSha: pr.head.sha };
}

export function staleRiskLabels(labels, tier) {
  return labels.filter((l) => l.startsWith('risk:') && l !== `risk:${tier}`);
}

export const RISK_LABELS = {
  low: { color: '0e8a16', description: 'harness: low risk' },
  normal: { color: 'fbca04', description: 'harness: normal risk' },
  high: { color: 'b60205', description: 'harness: high risk' },
};

export function riskLabelSpec(tier) {
  const spec = RISK_LABELS[tier];
  if (!spec) throw new Error(`no label defined for tier "${tier}"`);
  return { name: `risk:${tier}`, ...spec };
}
