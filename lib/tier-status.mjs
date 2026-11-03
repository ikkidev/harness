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
