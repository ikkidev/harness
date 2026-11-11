import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { assertTier, checkEvidence, needsNoTestsLabel, TEST_PATH } from './evidence.mjs';

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
  assert.deepEqual(checkEvidence({ ...base, body: body() }), { ok: true, missing: [], notes: [] });
});

test('placeholders left in Tests and Evidence fail', () => {
  const b = 'Closes #1\n\n## Tests\n<!-- paths -->\n\n## Evidence\n<!-- screenshot -->\n';
  const r = checkEvidence({ ...base, body: b, changedFiles: ['src/a.tsx', 'src/a.test.ts'] });
  assert.deepEqual(r, { ok: false, missing: ['Tests', 'Evidence'], notes: [] });
});

test('docs-only change passes without Tests', () => {
  const r = checkEvidence({ ...base, body: 'Closes #1\n', changedFiles: ['docs/a.md', 'README.md'] });
  assert.deepEqual(r, { ok: true, missing: [], notes: [] });
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
  assert.deepEqual(r, { ok: false, missing: ['Invariants'], notes: [] });
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
  assert.deepEqual(r, { ok: false, missing: ['Issue'], notes: [] });
});

for (const kw of ['Closes #12', 'Fixes #12', 'resolves #12', 'FIXES #12']) {
  test(`issue rule accepts "${kw}"`, () => {
    assert.equal(checkEvidence({ ...base, body: body({ issue: kw }) }).ok, true);
  });
}

for (const ref of [
  'Part of #229',
  'Refs Seatsnags/seatsnags-mvp#221',
  'Tracked in SMF-5 (Current); there is no GitHub issue for it.',
  'Part of E27 (slice 1)',
  'Tracked in docs/exec-plans/active/e27-seo.md',
  'Plan: https://www.notion.so/seatsnags/E27-40a7ba04f36f817b9715fc392daceb0c',
  'https://app.notion.com/p/40a7ba04f36f817b9715fc392daceb0c',
  '## Issue\nSMF-5 (Current), no GitHub issue.',
  'Refs: #12',
  'Ref. #12',
  'Part of seatsnags-mvp#221',
  'Tracked in Linear SMF-5',
  'Relates to #12',
  'Closes Seatsnags/seatsnags-mvp#12',
  'Closes https://github.com/Seatsnags/seatsnags-mvp/issues/12',
  'Account at desktop (E25 step 4)',
  'Step 7 of E25, from board G.',
  'No tracking issue in this repo: E27 slice 1 is tracked in the plan.',
  'This is part 1 (backend) of the brief "Bid page: say when a section has no row info".',
]) {
  test(`issue rule accepts a tracking reference: "${ref.split('\n')[0]}"`, () => {
    assert.equal(checkEvidence({ ...base, body: body({ issue: ref }) }).ok, true);
  });
}

for (const ref of [
  'Closes #',
  'Part of the work',
  'Tracked in',
  '## Issue\n<!-- Closes #N, Part of #N, Tracked in <ticket>, or a Notion link -->',
  'see UTF-8 handling',
  'https://notion.example.com/page',
  'Runs the E2E suite on e2 hardware',
  'part 1 of 3',
  'Fixes flake8 E501 warnings',
  'Drop the E1 retry path',
  '## Issue\nnone',
  '## Issue\nn/a',
  '<!-- Part of #12 -->',
  'Part of top-10 list work',
  'part of e27',
  'We plan to fix #12 later',
]) {
  test(`issue rule rejects "${ref.split('\n')[0]}"`, () => {
    assert.deepEqual(checkEvidence({ ...base, body: body({ issue: ref }) }).missing, ['Issue']);
  });
}

test('Tests naming a path that is not a test path fails', () => {
  const r = checkEvidence({ ...base, body: body({ tests: 'src/a.ts changed' }) });
  assert.deepEqual(r, { ok: false, missing: ['Tests'], notes: [] });
});

test('Tests naming an unchanged path fails', () => {
  const r = checkEvidence({ ...base, body: body({ tests: 'src/other.test.ts' }) });
  assert.deepEqual(r, { ok: false, missing: ['Tests'], notes: [] });
});

test('non-doc change with no Tests section fails', () => {
  const r = checkEvidence({ ...base, body: body({ tests: null }) });
  assert.deepEqual(r, { ok: false, missing: ['Tests'], notes: [] });
});

test('screenshots_for match without an image in Evidence fails', () => {
  const r = checkEvidence({
    ...base, changedFiles: ['src/a.tsx', 'src/a.test.ts'], body: body({ evidence: 'looks fine' }),
  });
  assert.deepEqual(r, { ok: false, missing: ['Evidence'], notes: [] });
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
    { ok: false, missing: ['Issue'], notes: [] });
});

test('no-tests label exempts Tests on low and normal with no note', () => {
  const base = { body: 'Closes #1', changedFiles: ['src/a.ts'], labels: ['no-tests'] };
  assert.deepEqual(checkEvidence({ ...base, tier: 'normal' }), { ok: true, missing: [], notes: [] });
  assert.deepEqual(checkEvidence({ ...base, tier: 'low' }), { ok: true, missing: [], notes: [] });
});

test('no-tests label is accepted on high with a note', () => {
  const base = { body: 'Closes #1', changedFiles: ['src/a.ts'], labels: ['no-tests'] };
  assert.deepEqual(checkEvidence({ ...base, tier: 'high' }),
    { ok: true, missing: [], notes: ['no-tests on high'] });
});

test('assertTier accepts low|normal|high only', () => {
  for (const t of ['low', 'normal', 'high']) assert.equal(assertTier(t), t);
  assert.throws(() => assertTier('medium'), /HARNESS_TIER must be one of/);
  assert.throws(() => assertTier(undefined), /HARNESS_TIER/);
});

test('TEST_PATH rejects substring-only matches', () => {
  for (const p of ['src/latest.ts', 'src/lib/respect.ts', 'src/contest/x.ts']) {
    assert.equal(TEST_PATH.test(p), false, p);
  }
});

test('TEST_PATH accepts test files and directories', () => {
  for (const p of ['src/a.test.ts', 'src/a.spec.tsx', 'spec/models/x_spec.rb', 'e2e/x.spec.ts',
    'maestro/flows/demo.yaml', 'src/__tests__/x.ts', 'tests/x.py']) {
    assert.equal(TEST_PATH.test(p), true, p);
  }
});

const stdConfig = { evidence: { screenshots_for: ['src/{app,components}/**/!(*.test).tsx'], standard_template: true } };
const stdBody = (over = {}) => {
  const s = {
    Summary: 'Bid page shows the fee.\n\nCloses #3',
    Risk: 'Tier: normal\nLook at: src/lib/fee.ts',
    Tests: 'src/a.test.ts',
    Evidence: 'n/a: no visible change',
    Deploy: 'none',
    ...over,
  };
  return Object.entries(s).filter(([, v]) => v !== null).map(([k, v]) => `## ${k}\n${v}\n`).join('\n');
};
const std = { tier: 'normal', changedFiles: ['src/lib/a.ts', 'src/a.test.ts'], labels: [], config: stdConfig };

test('standard template: complete body passes', () => {
  assert.deepEqual(checkEvidence({ ...std, body: stdBody() }), { ok: true, missing: [], notes: [] });
});

test('standard template: missing or comment-only sections are named', () => {
  const r = checkEvidence({ ...std, body: stdBody({ Risk: null, Deploy: '<!-- env, migrations -->' }) });
  assert.deepEqual(r.missing, ['Risk', 'Deploy']);
});

test('standard template: empty Summary fails even with Closes elsewhere', () => {
  const b = 'Closes #3\n\n' + stdBody({ Summary: '' });
  assert.deepEqual(checkEvidence({ ...std, body: b }).missing, ['Summary']);
});

test('standard template off: Summary/Risk/Deploy not required', () => {
  const r = checkEvidence({ ...base, body: body() });
  assert.equal(r.ok, true);
});

test('screenshots_for negation skips test files', () => {
  const r = checkEvidence({ ...std, changedFiles: ['src/components/Bid.test.tsx'], body: stdBody({ Tests: 'src/components/Bid.test.tsx' }) });
  assert.equal(r.ok, true);
});

test('screenshots_for negation still catches screen files', () => {
  const r = checkEvidence({ ...std, changedFiles: ['src/app/x/page.tsx', 'src/app/x/page.test.tsx'], body: stdBody({ Tests: 'src/app/x/page.test.tsx' }) });
  assert.deepEqual(r.missing, ['Evidence']);
});

test('filled section with the placeholder comment left in passes', () => {
  const b = 'Closes #1\n\n## Tests\n<!-- paths -->\nsrc/a.test.ts\n';
  assert.equal(checkEvidence({ ...base, body: b }).ok, true);
});

test('standard template: docs-only PR needs no Tests content', () => {
  const r = checkEvidence({ ...std, tier: 'low', changedFiles: ['docs/a.md'], body: stdBody({ Tests: '<!-- paths -->' }) });
  assert.equal(r.ok, true);
});

test('standard template: no-tests label exempts the Tests section', () => {
  const r = checkEvidence({ ...std, labels: ['no-tests'], body: stdBody({ Tests: '' }) });
  assert.equal(r.ok, true);
});

test('standard template: Evidence must say something even with no screen change', () => {
  assert.deepEqual(checkEvidence({ ...std, body: stdBody({ Evidence: '<!-- shots -->' }) }).missing, ['Evidence']);
});

test('standard template: blank template with an issue link fails every section', () => {
  const tpl = readFileSync(new URL('../templates/pull_request_template.md', import.meta.url), 'utf8').replace('Closes #', 'Closes #5');
  const r = checkEvidence({ ...std, body: tpl });
  assert.deepEqual(r.missing, ['Tests', 'Summary', 'Risk', 'Evidence', 'Deploy']);
});

test('standard template off: Summary, Risk and Deploy are not required', () => {
  const b = 'Closes #1\n\n## Tests\nsrc/a.test.ts\n';
  assert.equal(checkEvidence({ ...base, body: b }).ok, true);
});

test('unterminated comment hides the rest of the section and fails it', () => {
  const b = 'Closes #1\n\n## Tests\n<!-- oops\nsrc/a.test.ts\n';
  assert.deepEqual(checkEvidence({ ...base, body: b }).missing, ['Tests']);
});

test('a heading inside a comment does not split sections', () => {
  const b = 'Closes #1\n\n## Tests\n<!--\n## Evidence\n-->\nsrc/a.test.ts\n';
  assert.equal(checkEvidence({ ...base, body: b }).ok, true);
});

test('Evidence with a leftover comment and media passes', () => {
  const b = 'Closes #1\n\n## Tests\nsrc/a.test.ts\n\n## Evidence\n<!-- shots -->\n![a](https://x.test/a.png)\n';
  assert.equal(checkEvidence({ ...base, changedFiles: ['src/a.tsx', 'src/a.test.ts'], body: b }).ok, true);
});

test('Invariants with a leftover comment and content passes; comment only fails', () => {
  const cfg = { evidence: { invariants: true } };
  const ok = 'Closes #1\n\n## Tests\nsrc/a.test.ts\n\n## Invariants\n<!-- x -->\ntotal never negative\n';
  assert.equal(checkEvidence({ ...base, tier: 'high', config: cfg, body: ok }).ok, true);
  const bad = 'Closes #1\n\n## Tests\nsrc/a.test.ts\n\n## Invariants\n<!-- x -->\n';
  assert.deepEqual(checkEvidence({ ...base, tier: 'high', config: cfg, body: bad }).missing, ['Invariants']);
});

test('headings match case-insensitively', () => {
  assert.equal(checkEvidence({ ...base, body: 'Closes #1\n\n## tests\nsrc/a.test.ts\n' }).ok, true);
});

test('test files never trigger the screenshots rule, even under a plain glob', () => {
  for (const f of ['src/components/__tests__/listing-card.test.tsx', 'src/app/x.spec.tsx', 'src/components/__tests__/Helper.tsx']) {
    const r = checkEvidence({ ...base, changedFiles: [f], body: `Closes #1\n\n## Tests\n${f}\n` });
    assert.equal(r.missing.includes('Evidence'), false, f);
  }
});

test('a screen file next to a changed test still needs Evidence', () => {
  const files = ['src/components/Card.tsx', 'src/components/__tests__/Card.test.tsx'];
  const r = checkEvidence({ ...base, changedFiles: files, body: 'Closes #1\n\n## Tests\nsrc/components/__tests__/Card.test.tsx\n' });
  assert.deepEqual(r.missing, ['Evidence']);
});

test('a screen under a test-named directory still needs Evidence', () => {
  for (const f of ['src/tests/index.tsx', 'src/features/e2e/Viewer.tsx']) {
    const r = checkEvidence({ ...base, changedFiles: [f, 'src/a.test.ts'], body: 'Closes #1\n\n## Tests\nsrc/a.test.ts\n' });
    assert.deepEqual(r.missing, ['Evidence'], f);
  }
});

test('needsNoTestsLabel: config-only change needs it; test or docs-only change does not', () => {
  assert.equal(needsNoTestsLabel(['.github/CODEOWNERS', 'harness.yml']), true);
  assert.equal(needsNoTestsLabel(['src/a.ts', 'src/a.test.ts']), false);
  assert.equal(needsNoTestsLabel(['docs/x.md', 'README.md']), false);
  assert.equal(needsNoTestsLabel(['spec/services/x_spec.rb']), false);
  assert.equal(needsNoTestsLabel([]), false);
});

const autoConfig = { evidence: { screenshots_for: ['src/**/*.tsx'], automated_status: 'preview/screens', automated_screens_section: 'Screens' } };
const auto = { ...base, changedFiles: ['src/a.tsx', 'src/a.test.ts'], config: autoConfig };
const autoBody = (screens, evidence = null) => `${body({ evidence })}${screens === null ? '' : `## Screens\n${screens}\n`}`;

test('automated evidence satisfies a screenshots_for match with a Screens page path', () => {
  const r = checkEvidence({ ...auto, automatedEvidence: true, body: autoBody('- `/event/1`: ok') });
  assert.deepEqual(r, { ok: true, missing: [], notes: ['automated evidence (preview/screens)'] });
  assert.equal(checkEvidence({ ...auto, automatedEvidence: true, body: autoBody('/event/1') }).ok, true);
});

test('automated evidence without a Screens section or a path line stays missing', () => {
  for (const screens of [null, 'no pages here', '']) {
    const r = checkEvidence({ ...auto, automatedEvidence: true, body: autoBody(screens) });
    assert.deepEqual(r.missing, ['Evidence'], String(screens));
  }
});

test('automated evidence is ignored when false or unset', () => {
  assert.deepEqual(checkEvidence({ ...auto, body: autoBody('/event/1') }).missing, ['Evidence']);
  assert.deepEqual(checkEvidence({ ...auto, automatedEvidence: false, body: autoBody('/event/1') }).missing, ['Evidence']);
});

test('body media passes without automation and adds no note', () => {
  const r = checkEvidence({ ...auto, body: autoBody(null, '![s](https://x.test/a.png)') });
  assert.deepEqual(r, { ok: true, missing: [], notes: [] });
});

test('automation needs both config keys', () => {
  for (const ev of [{ automated_status: 'preview/screens' }, { automated_screens_section: 'Screens' }]) {
    const config = { evidence: { screenshots_for: ['src/**/*.tsx'], ...ev } };
    const r = checkEvidence({ ...auto, config, automatedEvidence: true, body: autoBody('/event/1') });
    assert.deepEqual(r.missing, ['Evidence']);
  }
});

test('standard template still needs a non-empty Evidence section under automation', () => {
  const config = { evidence: { ...autoConfig.evidence, standard_template: true } };
  const b = stdBody({ Evidence: '' }) + '\n## Screens\n/event/1\n';
  const r = checkEvidence({ ...std, changedFiles: ['src/components/a.tsx', 'src/a.test.ts'], config, automatedEvidence: true, body: b });
  assert.deepEqual(r.missing, ['Evidence']);
});
