import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { createServer } from 'node:http';
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

/* depends-on-status in PR mode with a fake gh: the body comes from the API, not the (stale) event payload. */
test('depends-on-status reads the PR body from the API and fails a dependency it cannot check', () => {
  const dir = mkdtempSync(join(tmpdir(), 'fake-gh-'));
  const log = join(dir, 'calls.log');
  const pr = JSON.stringify({ number: 7, state: 'open', headSha: 'a'.repeat(40), body: 'Depends on Seatsnags/seatsnags-mvp#221' });
  writeFileSync(join(dir, 'pr.json'), `${pr}\n`);
  writeFileSync(join(dir, 'gh'), `#!/bin/sh
echo "$*" >> "${log}"
case "$*" in
  *"/pulls/7 "*) cat "${join(dir, 'pr.json')}" ;;
  *"-X POST"*) ;;
  *"/statuses"*) ;;
esac
`, { mode: 0o755 });
  const event = join(dir, 'event.json');
  writeFileSync(event, JSON.stringify({ pull_request: { number: 7, body: 'stale body, no dependency' } }));
  const env = {
    PATH: `${dir}:/usr/bin:/bin`, GITHUB_REPOSITORY: 'Seatsnags/fe', GITHUB_EVENT_NAME: 'pull_request',
    GITHUB_EVENT_PATH: event, HARNESS_UPSTREAM_REPO: 'Seatsnags/seatsnags-mvp', HARNESS_DEPLOYED_BRANCH: 'deployed/production',
  };
  const r = spawnSync(process.execPath, [`${BIN}depends-on-status.mjs`], { env, encoding: 'utf8', timeout: 10_000 });
  assert.equal(r.status, 0, r.stderr);
  const calls = readFileSync(log, 'utf8');
  assert.match(calls, /-X POST repos\/Seatsnags\/fe\/statuses\/a{40} -f state=failure -f context=harness\/depends-on/);
  assert.match(r.stdout, /cannot read Seatsnags\/seatsnags-mvp to check #221/);
});

/* depends-on-status in sweep mode: lists open PRs, re-reads each, posts per PR. */
test('depends-on-status sweep re-reads each listed PR and posts for each', () => {
  const dir = mkdtempSync(join(tmpdir(), 'fake-gh-'));
  const log = join(dir, 'calls.log');
  const row = (n, body) => JSON.stringify({ number: n, state: 'open', headSha: String(n).repeat(40), body });
  writeFileSync(join(dir, 'list'), `${row(1, 'old body')}\n${row(2, 'x')}\n`);
  writeFileSync(join(dir, 'pr1'), `${row(1, 'Depends on seatsnags-mvp#5')}\n`);
  writeFileSync(join(dir, 'pr2'), `${row(2, 'x')}\n`);
  writeFileSync(join(dir, 'gh'), `#!/bin/sh
echo "$*" >> "${log}"
case "$*" in
  *"pulls?state=open"*) cat "${join(dir, 'list')}" ;;
  *"/pulls/1 "*) cat "${join(dir, 'pr1')}" ;;
  *"/pulls/2 "*) cat "${join(dir, 'pr2')}" ;;
esac
`, { mode: 0o755 });
  const env = {
    PATH: `${dir}:/usr/bin:/bin`, GITHUB_REPOSITORY: 'Seatsnags/fe', GITHUB_EVENT_NAME: 'repository_dispatch',
    HARNESS_UPSTREAM_REPO: 'Seatsnags/seatsnags-mvp', HARNESS_DEPLOYED_BRANCH: 'deployed/production',
  };
  const r = spawnSync(process.execPath, [`${BIN}depends-on-status.mjs`], { env, encoding: 'utf8', timeout: 10_000 });
  assert.equal(r.status, 0, r.stderr);
  const calls = readFileSync(log, 'utf8');
  assert.match(calls, /statuses\/1{40} -f state=failure -f context=harness\/depends-on/);
  assert.match(calls, /statuses\/2{40} -f state=success -f context=harness\/depends-on/);
});

/* record-deployed against a local /health and a fake gh: the refs calls, outputs and the exit code. */
async function runRecord({ ref, wait = '' }) {
  const dir = mkdtempSync(join(tmpdir(), 'fake-gh-'));
  const log = join(dir, 'calls.log');
  const out = join(dir, 'output');
  const A = 'a'.repeat(40);
  const report = { service: { commit: A, valid: true }, workers: { ok: true, count: 1, processes: [{ commit: A, valid: true }] } };
  let header;
  const server = createServer((req, res) => { header = req.headers['x-health-token']; res.end(JSON.stringify(report)); });
  await new Promise((ok) => server.listen(0, '127.0.0.1', ok));
  writeFileSync(join(dir, 'gh'), `#!/bin/sh
echo "$*" >> "${log}"
case "$*" in
  *"/compare/${'c'.repeat(40)}"*) echo behind ;;
  *"/compare/"*) echo identical ;;
  *"git/ref/heads/"*) ${ref ? `echo ${ref}` : 'echo "gh: Not Found (HTTP 404)" >&2; exit 1'} ;;
esac
`, { mode: 0o755 });
  const env = {
    PATH: `${dir}:/usr/bin:/bin`, GITHUB_REPOSITORY: 'o/api', GITHUB_OUTPUT: out,
    HARNESS_HEALTH_URL: `http://127.0.0.1:${server.address().port}/health`, HARNESS_HEALTH_TOKEN: 'tok-fixture',
    HARNESS_WAIT_FOR: wait, HARNESS_WAIT_MINUTES: '0',
  };
  const child = spawn(process.execPath, [`${BIN}record-deployed.mjs`], { env });
  let stdout = '';
  let stderr = '';
  child.stdout.on('data', (d) => { stdout += d; });
  child.stderr.on('data', (d) => { stderr += d; });
  const status = await new Promise((ok) => child.on('close', ok));
  server.close();
  let calls = '';
  try { calls = readFileSync(log, 'utf8'); } catch { /* no calls */ }
  let output = '';
  try { output = readFileSync(out, 'utf8'); } catch { /* no output */ }
  return { status, stdout, stderr, calls, output, header, A };
}

test('record-deployed creates the branch when missing and writes outputs', async () => {
  const r = await runRecord({ ref: '' });
  assert.equal(r.status, 0, r.stderr);
  assert.equal(r.header, 'tok-fixture');
  assert.match(r.calls, new RegExp(`-X POST repos/o/api/git/refs -f ref=refs/heads/deployed/production -f sha=${r.A}`));
  assert.equal(r.output, `moved=true\nsha=${r.A}\n`);
  assert.doesNotMatch(r.stdout + r.stderr, /tok-fixture/);
});

test('record-deployed force-moves an existing branch with a typed boolean', async () => {
  const r = await runRecord({ ref: 'b'.repeat(40) });
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.calls, new RegExp(`-X PATCH repos/o/api/git/refs/heads/deployed/production -f sha=${r.A} -F force=true`));
});

test('record-deployed fails after recording when production never reaches wait-for', async () => {
  const r = await runRecord({ ref: 'b'.repeat(40), wait: 'c'.repeat(40) });
  assert.equal(r.status, 1);
  assert.match(r.stderr, /ERROR: production did not reach ccccccc within 0 min; recorded aaaaaaa/);
  assert.equal(r.output, `moved=true\nsha=${r.A}\n`);
});
