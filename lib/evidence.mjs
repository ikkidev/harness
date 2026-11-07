import { minimatch } from 'minimatch';

const OPTS = { dot: true };
const ISSUE = /\b(closes|fixes|resolves)\s+(?:(?:[\w.-]+\/[\w.-]+)?#\d+|https:\/\/github\.com\/[\w.-]+\/[\w.-]+\/issues\/\d+)/i;
/* A reference to tracked work: an issue (#12, repo#12, owner/repo#12), a ticket key (SMF-5),
   an epic (E27), a plan file, a URL, or "the plan" / "the brief". Case-sensitive on purpose. */
const REF = /(?:^|[\s(])(?:(?:[\w.-]+\/)?[\w.-]*#\d+|[A-Z][A-Z0-9]+-\d+\b|E\d{1,3}\b|[\w./-]+\.md\b|https?:\/\/\S+|the\s+(?:plan|brief)\b)/;
const TRACKING_WORD = /\b(?:part(?:\s+\d+(?:\s+\([^)\n]{1,30}\))?)?\s+of|refs?\.?:?|tracked\s+in|plan:|relates\s+to)\s+((?:\S+[ \t]+){0,2}\S+)/gi;
const NOTION = /https?:\/\/(?:[\w-]+\.)?notion\.(?:so|site|com)\//i;
const EPIC_STEP = /\b(?:[Ss]tep|[Ss]lice|[Pp]art)\s+\d+\s+of\s+E\d{1,3}\b|\bE\d{1,3}\s+(?:step|slice|part)\b/;
export const TEST_PATH = /(^|\/)(spec|specs|test|tests|__tests__|e2e|maestro)(\/|$)|\.(spec|test)\.[cm]?[jt]sx?$|_spec\.rb$|_test\.go$/;
const TEST_FILE = /(^|\/)__tests__\/|\.(spec|test)\.[cm]?[jt]sx?$/;
const MEDIA = /!\[|<img|https?:\/\/\S+\.(png|jpe?g|gif|mp4|mov|webm)\b|https?:\/\/\S*(\/actions\/runs\/|\/artifacts\/)/i;

export const STANDARD_SECTIONS = ['Summary', 'Risk', 'Tests', 'Evidence', 'Deploy'];

export const isDoc = (p) => minimatch(p, 'docs/**', OPTS) || minimatch(p, '**/*.md', OPTS);

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

function hasTracking(body) {
  const text = String(body ?? '').replace(/<!--[\s\S]*?(-->|$)/g, '');
  if (ISSUE.test(text) || NOTION.test(text) || EPIC_STEP.test(text)) return true;
  if ([...text.matchAll(TRACKING_WORD)].some((m) => REF.test(` ${m[1]}`))) return true;
  const issue = section(text, 'Issue');
  return issue !== null && REF.test(` ${issue}`);
}

/* True when a PR changes a non-doc file but no test file: it needs the no-tests label. */
export function needsNoTestsLabel(changedFiles) {
  return changedFiles.some((p) => !isDoc(p)) && !changedFiles.some((p) => TEST_PATH.test(p));
}

export function checkEvidence({ body, tier, changedFiles, labels = [], config }) {
  const missing = [];
  const ev = config?.evidence ?? {};

  if (!hasTracking(body) && !labels.includes('no-issue')) missing.push('Issue');

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
