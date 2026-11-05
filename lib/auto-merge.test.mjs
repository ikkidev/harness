import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ghArgs, parseBases, planAutoMerge, runAutoMerge } from './auto-merge.mjs';

const SHA = 'a'.repeat(40);
const approved = { verdict: 'approved', sha: SHA };
const pr = { base: 'dev', head: SHA, draft: false };
const base = { verdict: approved, pr, bases: ['dev'], method: 'merge' };

test('parseBases splits commas and spaces', () => {
  assert.deepEqual(parseBases('dev, main  x'), ['dev', 'main', 'x']);
  assert.deepEqual(parseBases(''), []);
});

test('planAutoMerge: only an approved, non-draft PR on its reviewed head into an allowed base is enabled', () => {
  assert.equal(planAutoMerge(base).action, 'enable');
  assert.equal(planAutoMerge({ ...base, pr: { ...pr, base: 'main' } }).action, 'skip');
  assert.equal(planAutoMerge({ ...base, bases: [] }).action, 'skip');
  assert.equal(planAutoMerge({ ...base, pr: { ...pr, draft: true } }).action, 'skip');
  assert.equal(planAutoMerge({ ...base, pr: { ...pr, head: 'b'.repeat(40) } }).action, 'skip');
  assert.equal(planAutoMerge({ ...base, method: 'fast-forward' }).action, 'skip');
  assert.equal(planAutoMerge({ ...base, verdict: { ...approved, verdict: 'changes-requested' } }).action, 'disable');
});

test('ghArgs pins the reviewed commit when enabling', () => {
  assert.deepEqual(ghArgs({ action: 'enable', repo: 'o/r', number: 5, sha: SHA, method: 'merge' }),
    ['pr', 'merge', '5', '--repo', 'o/r', '--auto', '--merge', '--match-head-commit', SHA]);
  assert.deepEqual(ghArgs({ action: 'disable', repo: 'o/r', number: 5, sha: SHA, method: 'merge' }),
    ['pr', 'merge', '5', '--repo', 'o/r', '--disable-auto']);
});

function fakeDeps(over = {}) {
  const calls = { exec: [], log: [], mint: 0, getPr: 0 };
  return {
    calls,
    d: {
      getPr: () => (calls.getPr++, pr),
      mint: async () => (calls.mint++, 'TOKEN'),
      exec: (args, extra) => calls.exec.push({ args, extra }),
      log: (m) => calls.log.push(m),
      ...over,
    },
  };
}
const run = { verdict: approved, bases: ['dev'], method: 'merge', repo: 'o/r', number: 5, haveCredentials: true };

test('runAutoMerge enables with the App token, masks it, and never enables on changes requested', async () => {
  const a = fakeDeps();
  await runAutoMerge(run, a.d);
  assert.equal(a.calls.exec.length, 1);
  assert.equal(a.calls.exec[0].extra.GH_TOKEN, 'TOKEN');
  assert.ok(a.calls.exec[0].args.includes('--auto'));
  assert.ok(a.calls.log.includes('::add-mask::TOKEN'));

  const b = fakeDeps();
  await runAutoMerge({ ...run, verdict: { ...approved, verdict: 'changes-requested' } }, b.d);
  assert.ok(b.calls.exec[0].args.includes('--disable-auto'));
  assert.ok(!b.calls.exec[0].args.includes('--auto'));
});

test('runAutoMerge makes no network call when off or without credentials, and never mints on a skip', async () => {
  const a = fakeDeps();
  await runAutoMerge({ ...run, bases: [] }, a.d);
  await runAutoMerge({ ...run, haveCredentials: false }, a.d);
  assert.deepEqual([a.calls.getPr, a.calls.mint, a.calls.exec.length], [0, 0, 0]);

  const b = fakeDeps({ getPr: () => ({ ...pr, base: 'main' }) });
  await runAutoMerge(run, b.d);
  assert.deepEqual([b.calls.mint, b.calls.exec.length], [0, 0]);
});

test('runAutoMerge uses the freshly fetched head, and swallows failures', async () => {
  const moved = fakeDeps({ getPr: () => ({ ...pr, head: 'b'.repeat(40) }) });
  assert.equal((await runAutoMerge(run, moved.d)).why, 'head moved since the review');

  const broken = fakeDeps({ getPr: () => { throw new Error('HTTP 502'); } });
  assert.equal((await runAutoMerge(run, broken.d)).action, 'error');
  assert.match(broken.calls.log.at(-1), /^WARNING: auto-merge step failed: HTTP 502$/);

  const c = fakeDeps({ mint: async () => { throw new Error('HTTP 401\nmore'); } });
  assert.equal((await runAutoMerge(run, c.d)).action, 'error');
  assert.match(c.calls.log.at(-1), /^WARNING: auto-merge enable failed: HTTP 401$/);

  const d = fakeDeps({ exec: () => { throw new Error('not enabled'); } });
  await runAutoMerge({ ...run, verdict: { ...approved, verdict: 'changes-requested' } }, d.d);
  assert.match(d.calls.log.at(-1), /^auto-merge: nothing to disable/);
});
