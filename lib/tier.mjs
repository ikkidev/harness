import { minimatch } from 'minimatch';

const RANK = { low: 0, normal: 1, high: 2 };

export const FLOOR_GLOBS = ['.github/**', '**/CODEOWNERS', 'CODEOWNERS'];

function tierOfPath(path, config, floor) {
  if (floor.some((g) => minimatch(path, g, { dot: true }))) return 'high';
  let best = null;
  for (const [tier, globs] of Object.entries(config.tiers ?? {})) {
    if (!(tier in RANK)) throw new Error(`unknown tier "${tier}" in harness.yml`);
    if (!Array.isArray(globs)) throw new Error(`tier "${tier}" in harness.yml must be a list of globs`);
    if (globs.some((g) => minimatch(path, g, { dot: true })) && (best === null || RANK[tier] > RANK[best])) {
      best = tier;
    }
  }
  return best ?? config.default ?? 'normal';
}

export function resolveTier(changedPaths, config, configPath = 'harness.yml') {
  const floor = [...FLOOR_GLOBS, configPath.replace(/^(\.\/)+/, '')];
  const fallback = config.default ?? 'normal';
  if (!(fallback in RANK)) throw new Error(`unknown default tier "${fallback}" in harness.yml`);
  let result = null;
  for (const path of changedPaths) {
    const tier = tierOfPath(path, config, floor);
    if (result === null || RANK[tier] > RANK[result]) result = tier;
  }
  return result ?? fallback;
}
