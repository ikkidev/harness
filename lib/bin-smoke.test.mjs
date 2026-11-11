import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

/* Catches broken imports and syntax in the bin scripts, which only load in a live run.
   PATH is an empty directory, so no gh or git can run: a script may fail, but never on loading. */
const BIN = fileURLToPath(new URL('../bin/', import.meta.url));
const LOAD_ERROR = /SyntaxError|ReferenceError|does not provide an export named|Cannot find module|ERR_MODULE_NOT_FOUND/;
const NO_VARS = { PATH: mkdtempSync(join(tmpdir(), 'empty-path-')) };

for (const file of readdirSync(BIN).filter((f) => f.endsWith('.mjs'))) {
  test(`bin/${file} loads`, () => {
    const r = spawnSync(process.execPath, [`${BIN}${file}`], { env: NO_VARS, encoding: 'utf8', timeout: 10_000 });
    assert.equal(r.error, undefined);
    assert.doesNotMatch(`${r.stdout}\n${r.stderr}`, LOAD_ERROR);
  });
}

/* evidence-status with a fake gh on PATH: the automated status is looked up only when configured, and last. */
function runEvidenceStatus(evidenceCfg, { failStatuses = false } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'fake-gh-'));
  const log = join(dir, 'calls.log');
  const cfg = Buffer.from(`default: normal\nevidence:\n${evidenceCfg}`).toString('base64');
  const script = `#!/bin/sh
echo "$*" >> "${log}"
case "$*" in
  *"--jq .content"*) echo "${cfg}" ;;
  *"/pulls/7/files"*) echo "src/a.tsx" ;;
  *"pr view"*) cat "${join(dir, 'pr.json')}" ;;
  *"/commits/"*"/statuses"*) ${failStatuses ? 'echo "HTTP 502" >&2; exit 1' : "printf 'preview/screens\\tx\\tgithub-actions[bot]\\tsuccess\\n'"} ;;
esac
`;
  writeFileSync(join(dir, 'pr.json'), JSON.stringify({ body: 'Closes #1\n\n## Screens\n/event/1\n', labels: [{ name: 'no-tests' }] }));
  writeFileSync(join(dir, 'gh'), script, { mode: 0o755 });
  const event = join(dir, 'event.json');
  writeFileSync(event, JSON.stringify({ pull_request: { number: 7, base: { ref: 'main' }, head: { sha: 'a'.repeat(40) } } }));
  const env = { PATH: `${dir}:/usr/bin:/bin`, GITHUB_REPOSITORY: 'o/r', GITHUB_EVENT_PATH: event, HARNESS_TIER: 'normal' };
  const r = spawnSync(process.execPath, [`${BIN}evidence-status.mjs`], { env, encoding: 'utf8', timeout: 10_000 });
  const calls = readFileSync(log, 'utf8').trim().split('\n');
  return { r, calls };
}

test('evidence-status looks up the automated status last, right before posting, when configured', () => {
  const { r, calls } = runEvidenceStatus('  screenshots_for: ["src/**/*.tsx"]\n  automated_status: preview/screens\n  automated_screens_section: Screens\n');
  const lookup = calls.findIndex((c) => c.includes('/statuses') && !c.includes('-X POST'));
  const post = calls.findIndex((c) => c.includes('-X POST'));
  assert.ok(lookup >= 0, r.stderr);
  assert.equal(lookup, post - 1);
  assert.match(r.stdout, /automated evidence \(preview\/screens\)/);
});

test('evidence-status makes no status lookup when automation is not configured', () => {
  const { r, calls } = runEvidenceStatus('  screenshots_for: ["src/**/*.tsx"]\n');
  assert.equal(r.status, 0, r.stderr);
  assert.equal(calls.some((c) => c.includes('/commits/') && !c.includes('-X POST')), false);
  assert.ok(calls.some((c) => c.includes('-X POST')));
  assert.match(r.stdout, /evidence missing: Evidence/);
});

test('evidence-status treats a failed automated status lookup as no evidence and still posts', () => {
  const cfg = '  screenshots_for: ["src/**/*.tsx"]\n  automated_status: preview/screens\n  automated_screens_section: Screens\n';
  const { r, calls } = runEvidenceStatus(cfg, { failStatuses: true });
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stderr, /NOTE: automated status lookup failed: Error/);
  assert.match(r.stdout, /evidence missing: Evidence/);
  assert.ok(calls.some((c) => c.includes('-X POST')));
});
