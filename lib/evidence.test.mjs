import { test } from 'node:test';
import assert from 'node:assert/strict';
import { assertTier, checkEvidence } from './evidence.mjs';

const config = { evidence: { screenshots_for: ['src/**/*.tsx'], invariants: false } };
const base = { tier: 'normal', changedFiles: ['src/a.ts', 'src/a.test.ts'], labels: [], config };

const body = (parts = {}) => {
  const s = {
    issue: 'Closes #12',
    tests: 'src/a.test.ts passes',
    evidence: '![shot](https://x.test/a.png)',
    ...parts,
  };
  let out = `${s.issue}\n\n`;
  if (s.tests !== null) out += `## Tests\n${s.tests}\n\n`;
  if (s.evidence !== null) out += `## Evidence\n${s.evidence}\n\n`;
  if (s.invariants) out += `## Invariants\n${s.invariants}\n`;
  return out;
};

test('complete body passes', () => {
  assert.deepEqual(checkEvidence({ ...base, body: body() }), { ok: true, missing: [] });
});

test('placeholders left in Tests and Evidence fail', () => {
  const b = 'Closes #1\n\n## Tests\n<!-- paths -->\n\n## Evidence\n<!-- screenshot -->\n';
  const r = checkEvidence({ ...base, body: b, changedFiles: ['src/a.tsx', 'src/a.test.ts'] });
  assert.deepEqual(r, { ok: false, missing: ['Tests', 'Evidence'] });
});

test('docs-only change passes without Tests', () => {
  const r = checkEvidence({ ...base, body: 'Closes #1\n', changedFiles: ['docs/a.md', 'README.md'] });
  assert.deepEqual(r, { ok: true, missing: [] });
});

test('high tier with invariants false does not require Invariants', () => {
  const r = checkEvidence({ ...base, tier: 'high', body: body() });
  assert.equal(r.ok, true);
});

test('high tier with invariants true and no section fails', () => {
  const r = checkEvidence({
    ...base, tier: 'high', body: body(),
    config: { evidence: { invariants: true } },
  });
  assert.deepEqual(r, { ok: false, missing: ['Invariants'] });
});

test('invariants not required below high tier', () => {
  const r = checkEvidence({ ...base, body: body(), config: { evidence: { invariants: true } } });
  assert.equal(r.ok, true);
});

test('invariants section with content passes', () => {
  const r = checkEvidence({
    ...base, tier: 'high', body: body({ invariants: 'money never negative' }),
    config: { evidence: { invariants: true } },
  });
  assert.equal(r.ok, true);
});

test('no-issue label satisfies the issue rule', () => {
  const r = checkEvidence({ ...base, body: body({ issue: '' }), labels: ['no-issue'] });
  assert.equal(r.ok, true);
});

test('missing issue reference fails with Issue', () => {
  const r = checkEvidence({ ...base, body: body({ issue: '' }) });
  assert.deepEqual(r, { ok: false, missing: ['Issue'] });
});

for (const kw of ['Closes #12', 'Fixes #12', 'resolves #12', 'FIXES #12']) {
  test(`issue rule accepts "${kw}"`, () => {
    assert.equal(checkEvidence({ ...base, body: body({ issue: kw }) }).ok, true);
  });
}

test('Tests naming a path that is not a test path fails', () => {
  const r = checkEvidence({ ...base, body: body({ tests: 'src/a.ts changed' }) });
  assert.deepEqual(r, { ok: false, missing: ['Tests'] });
});

test('Tests naming an unchanged path fails', () => {
  const r = checkEvidence({ ...base, body: body({ tests: 'src/other.test.ts' }) });
  assert.deepEqual(r, { ok: false, missing: ['Tests'] });
});

test('non-doc change with no Tests section fails', () => {
  const r = checkEvidence({ ...base, body: body({ tests: null }) });
  assert.deepEqual(r, { ok: false, missing: ['Tests'] });
});

test('screenshots_for match without an image in Evidence fails', () => {
  const r = checkEvidence({
    ...base, changedFiles: ['src/a.tsx', 'src/a.test.ts'], body: body({ evidence: 'looks fine' }),
  });
  assert.deepEqual(r, { ok: false, missing: ['Evidence'] });
});

test('Evidence accepts video links and artifact URLs', () => {
  const files = ['src/a.tsx', 'src/a.test.ts'];
  for (const e of [
    'https://x.test/clip.mp4',
    'https://github.com/o/r/actions/runs/123/artifacts/9',
    '<img src="x">',
  ]) {
    assert.equal(checkEvidence({ ...base, changedFiles: files, body: body({ evidence: e }) }).ok, true, e);
  }
});

test('Evidence not required when no screenshots_for glob matches', () => {
  const r = checkEvidence({ ...base, body: body({ evidence: null }) });
  assert.equal(r.ok, true);
});

test('section headings match case-insensitively and stop at the next heading', () => {
  const b = 'Closes #1\n\n## tests\nsrc/a.test.ts\n\n## Notes\n<!-- unrelated -->\n';
  assert.equal(checkEvidence({ ...base, body: b }).ok, true);
});

test('missing order is fixed', () => {
  const r = checkEvidence({
    ...base, tier: 'high', changedFiles: ['src/a.tsx'], body: '',
    config: { evidence: { screenshots_for: ['src/**/*.tsx'], invariants: true } },
  });
  assert.deepEqual(r.missing, ['Issue', 'Tests', 'Evidence', 'Invariants']);
});

test('empty config and null body do not throw', () => {
  assert.deepEqual(checkEvidence({ ...base, body: null, config: {}, changedFiles: [] }),
    { ok: false, missing: ['Issue'] });
});

test('no-tests label exempts Tests for low and normal only', () => {
  const base = { body: 'Closes #1', changedFiles: ['src/a.ts'], labels: ['no-tests'] };
  assert.deepEqual(checkEvidence({ ...base, tier: 'normal' }), { ok: true, missing: [] });
  assert.deepEqual(checkEvidence({ ...base, tier: 'low' }), { ok: true, missing: [] });
  assert.deepEqual(checkEvidence({ ...base, tier: 'high' }).missing, ['Tests']);
});

test('assertTier accepts low|normal|high only', () => {
  for (const t of ['low', 'normal', 'high']) assert.equal(assertTier(t), t);
  assert.throws(() => assertTier('medium'), /HARNESS_TIER must be one of/);
  assert.throws(() => assertTier(undefined), /HARNESS_TIER/);
});
