import { minimatch } from 'minimatch';

const RANK = { low: 0, normal: 1, high: 2 };

function tierOfPath(path, config) {
  let best = null;
  for (const [tier, globs] of Object.entries(config.tiers ?? {})) {
    if (!(tier in RANK)) throw new Error(`unknown tier "${tier}" in harness.yml`);
    if (globs.some((g) => minimatch(path, g, { dot: true })) && (best === null || RANK[tier] > RANK[best])) {
      best = tier;
    }
  }
  return best ?? config.default ?? 'normal';
}

export function resolveTier(changedPaths, config) {
  const fallback = config.default ?? 'normal';
  if (!(fallback in RANK)) throw new Error(`unknown default tier "${fallback}" in harness.yml`);
  let result = null;
  for (const path of changedPaths) {
    const tier = tierOfPath(path, config);
    if (result === null || RANK[tier] > RANK[result]) result = tier;
  }
  return result ?? fallback;
}
