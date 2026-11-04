import { minimatch } from 'minimatch';

const OPTS = { dot: true };
const ISSUE = /\b(closes|fixes|resolves)\s+#\d+/i;
export const TEST_PATH = /(^|\/)(spec|specs|test|tests|__tests__|e2e|maestro)(\/|$)|\.(spec|test)\.[cm]?[jt]sx?$|_spec\.rb$|_test\.go$/;
const TEST_FILE = /(^|\/)__tests__\/|\.(spec|test)\.[cm]?[jt]sx?$/;
const MEDIA = /!\[|<img|https?:\/\/\S+\.(png|jpe?g|gif|mp4|mov|webm)\b|https?:\/\/\S*(\/actions\/runs\/|\/artifacts\/)/i;

export const STANDARD_SECTIONS = ['Summary', 'Risk', 'Tests', 'Evidence', 'Deploy'];

const isDoc = (p) => minimatch(p, 'docs/**', OPTS) || minimatch(p, '**/*.md', OPTS);

function section(body, name) {
  const lines = String(body ?? '').replace(/<!--[\s\S]*?(-->|$)/g, '').split('\n');
  const want = name.toLowerCase();
  let start = -1;
  for (let i = 0; i < lines.length; i++) {
    const m = /^##\s+(.*?)\s*$/.exec(lines[i]);
    if (!m) continue;
    if (start >= 0) return lines.slice(start, i).join('\n');
    if (m[1].toLowerCase() === want) start = i + 1;
  }
  return start >= 0 ? lines.slice(start).join('\n') : null;
}

export function checkEvidence({ body, tier, changedFiles, labels = [], config }) {
  const missing = [];
  const ev = config?.evidence ?? {};

  if (!ISSUE.test(body ?? '') && !labels.includes('no-issue')) missing.push('Issue');

  const notes = [];
  const needsTests = changedFiles.some((p) => !isDoc(p));
  const testsExempt = labels.includes('no-tests');
  if (testsExempt && needsTests && tier === 'high') notes.push('no-tests on high');
  if (!testsExempt && needsTests) {
    const s = section(body, 'Tests');
    const ok = s !== null
      && changedFiles.some((p) => TEST_PATH.test(p) && s.includes(p));
    if (!ok) missing.push('Tests');
  }

  const globs = ev.screenshots_for ?? [];
  if (changedFiles.some((p) => !TEST_FILE.test(p) && globs.some((g) => minimatch(p, g, OPTS)))) {
    const s = section(body, 'Evidence');
    if (s === null || !MEDIA.test(s)) missing.push('Evidence');
  }

  if (ev.standard_template === true) {
    for (const name of STANDARD_SECTIONS) {
      if (missing.includes(name)) continue;
      if (name === 'Tests' && (testsExempt || !needsTests)) continue;
      const s = section(body, name);
      if (s === null || !s.trim()) missing.push(name);
    }
  }

  if (ev.invariants === true && tier === 'high') {
    const s = section(body, 'Invariants');
    if (s === null || !s.trim()) missing.push('Invariants');
  }

  return { ok: missing.length === 0, missing, notes };
}

export const TIERS = ['low', 'normal', 'high'];

export function assertTier(tier) {
  if (!TIERS.includes(tier)) throw new Error(`HARNESS_TIER must be one of ${TIERS.join('|')}, got "${tier}"`);
  return tier;
}
