import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  evaluateDeps, gatePrs, healthCommits, mentionedRefs, parseDependsOn, pickOldest, recordDeployed, upstreamApi,
} from './depends-on.mjs';

const UP = 'Seatsnags/seatsnags-mvp';

test('inline reference', () => {
  assert.deepEqual(parseDependsOn('Depends on Seatsnags/seatsnags-mvp#221.', UP), [221]);
});

test('no dependency line, no deps', () => {
  assert.deepEqual(parseDependsOn('Closes #3\n\nSee Seatsnags/seatsnags-mvp#221 for context.', UP), []);
});

test('empty and null bodies', () => {
  assert.deepEqual(parseDependsOn('', UP), []);
  assert.deepEqual(parseDependsOn(null, UP), []);
});

test('bold paragraph followed by list items (frontend #370 shape)', () => {
  const body = [
    '## Summary',
    'Text.',
    '',
    '**Depends on.**',
    '- #369 (E27 slice 1). Based on its branch.',
    '- Seatsnags/seatsnags-mvp#221. Must reach production before this merges.',
    '',
    '## Risk',
    'Mentions Seatsnags/seatsnags-mvp#999 elsewhere.',
  ].join('\n');
  assert.deepEqual(parseDependsOn(body, UP), [221]);
});

test('heading form, colon, several refs, URL form, case-insensitive repo', () => {
  const body = [
    '## Depends on',
    '',
    '* seatsnags/SEATSNAGS-MVP#5',
    '* https://github.com/Seatsnags/seatsnags-mvp/pull/7',
    '',
    'Depends on: Seatsnags/seatsnags-mvp#9 and Seatsnags/seatsnags-mvp#5',
  ].join('\n');
  assert.deepEqual(parseDependsOn(body, UP), [5, 7, 9]);
});

test('heading block runs until the next heading, blank lines included', () => {
  const body = '## Depends on\n\nSeatsnags/seatsnags-mvp#12 must be on production.\n\nAlso Seatsnags/seatsnags-mvp#13.\n\n## Risk\nSeatsnags/seatsnags-mvp#14';
  assert.deepEqual(parseDependsOn(body, UP), [12, 13]);
});

test('"depends on" mid-sentence counts', () => {
  assert.deepEqual(parseDependsOn('This PR depends on Seatsnags/seatsnags-mvp#40 being live.', UP), [40]);
});

test('other repos, bare #N and look-alike repo names are ignored', () => {
  const body = 'Depends on #12, Seatsnags/seatsnags-mvp-frontend#3, Other/seatsnags-mvp#4, Seatsnags/seatsnags-mvp-x#5, xseatsnags-mvp#6';
  assert.deepEqual(parseDependsOn(body, UP), []);
});

test('repo name without the owner counts', () => {
  assert.deepEqual(parseDependsOn('Depends on seatsnags-mvp#221', UP), [221]);
});

test('"Blocked by" opens a block too', () => {
  assert.deepEqual(parseDependsOn('Blocked by Seatsnags/seatsnags-mvp#3', UP), [3]);
});

test('heading with the reference on the heading line (frontend #266 shape)', () => {
  assert.deepEqual(parseDependsOn('## Depends on Seatsnags/seatsnags-mvp#265\nText', UP), [265]);
});

test('one blank line between the lead line and its list, and lazy continuation lines', () => {
  const body = '**Depends on.**\n\n- Seatsnags/seatsnags-mvp#1 does a thing that is\nwrapped onto a second line.\n- Seatsnags/seatsnags-mvp#2\n\n\nSeatsnags/seatsnags-mvp#3 later';
  assert.deepEqual(parseDependsOn(body, UP), [1, 2]);
});

test('mentionedRefs finds every upstream reference, block or not', () => {
  const body = 'See Seatsnags/seatsnags-mvp#9.\n<!-- Seatsnags/seatsnags-mvp#8 -->\nDepends on seatsnags-mvp#4';
  assert.deepEqual(mentionedRefs(body, UP), [4, 9]);
});

test('HTML comments are ignored (template placeholders)', () => {
  const body = '<!-- Depends on Seatsnags/seatsnags-mvp#1 -->\nText';
  assert.deepEqual(parseDependsOn(body, UP), []);
});

test('an unterminated comment hides the rest', () => {
  assert.deepEqual(parseDependsOn('<!-- note\nDepends on Seatsnags/seatsnags-mvp#2', UP), []);
});

test('CRLF bodies', () => {
  assert.deepEqual(parseDependsOn('**Depends on**\r\n- Seatsnags/seatsnags-mvp#8\r\n', UP), [8]);
});

test('issue URL counts too, so it fails closed later as "not a pull request"', () => {
  assert.deepEqual(parseDependsOn('Depends on https://github.com/Seatsnags/seatsnags-mvp/issues/7', UP), [7]);
});

/* evaluateDeps: getPr(n) -> PR json or null (404); contains(sha, target) -> sha is contained in target. */
const MERGED = (n) => ({ number: n, state: 'closed', merged: true, merge_commit_sha: `m${n}` });
const world = ({ prs = {}, onMain = [], deployed = [] } = {}) => ({
  getPr: (n) => (n in prs ? prs[n] : null),
  contains: (sha, target) => (target === 'main' ? onMain : deployed).includes(sha),
});
const ev = (deps, w, deployedSha = 'D') => evaluateDeps({ deps, repo: UP, branch: 'main', deployedSha, ...w });

test('evaluateDeps: no deps is success, and names refs mentioned outside a Depends on block', () => {
  assert.deepEqual(ev([], world(), null), { state: 'success', description: 'no Seatsnags/seatsnags-mvp dependency' });
  assert.deepEqual(evaluateDeps({ deps: [], mentioned: [221, 3], repo: UP, branch: 'main', deployedSha: null, ...world() }),
    { state: 'success', description: 'no Seatsnags/seatsnags-mvp dependency; mentions #221, #3 outside "Depends on"' });
});

test('evaluateDeps: merged, on main and deployed is success', () => {
  const w = world({ prs: { 5: MERGED(5) }, onMain: ['m5'], deployed: ['m5'] });
  assert.deepEqual(ev([5], w), { state: 'success', description: 'Seatsnags/seatsnags-mvp#5 runs in production' });
  const w2 = world({ prs: { 5: MERGED(5), 6: MERGED(6) }, onMain: ['m5', 'm6'], deployed: ['m5', 'm6'] });
  assert.deepEqual(ev([5, 6], w2), { state: 'success', description: 'Seatsnags/seatsnags-mvp#5, #6 run in production' });
});

test('evaluateDeps: each blocking reason', () => {
  const prs = {
    1: { number: 1, state: 'open', merged: false, merge_commit_sha: 'x' },
    2: { number: 2, state: 'closed', merged: false, merge_commit_sha: 'y' },
    3: MERGED(3),
    4: MERGED(4),
  };
  const w = world({ prs, onMain: ['m4'], deployed: [] });
  // pending: waiting is the fix. failure: only a body edit fixes it.
  assert.deepEqual(ev([1], w), { state: 'pending', description: 'Seatsnags/seatsnags-mvp#1 is not merged yet' });
  assert.deepEqual(ev([2], w), { state: 'failure', description: 'Seatsnags/seatsnags-mvp#2 was closed without merging' });
  assert.deepEqual(ev([3], w), { state: 'pending', description: 'Seatsnags/seatsnags-mvp#3 is merged but not on main yet (promote dev with a merge commit)' });
  assert.deepEqual(ev([4], w), { state: 'pending', description: 'Seatsnags/seatsnags-mvp#4 is on main but not running in production yet' });
  assert.deepEqual(ev([9], w), { state: 'failure', description: 'Seatsnags/seatsnags-mvp#9 is not a pull request' });
  assert.deepEqual(ev([4], w, null), { state: 'pending', description: 'Seatsnags/seatsnags-mvp#4 is on main; the production commit is unknown' });
});

test('evaluateDeps: without a deployed ref configured, main is the target', () => {
  const w = world({ prs: { 4: MERGED(4) }, onMain: ['m4'] });
  assert.deepEqual(evaluateDeps({ deps: [4], repo: UP, branch: 'main', deployedSha: undefined, ...w }),
    { state: 'success', description: 'Seatsnags/seatsnags-mvp#4 is on main' });
});

test('evaluateDeps: merged PR without a merge commit sha fails closed', () => {
  const w = world({ prs: { 6: { number: 6, state: 'closed', merged: true, merge_commit_sha: null } } });
  assert.equal(ev([6], w).state, 'failure');
});

test('evaluateDeps: several deps report the worst blocker and a count', () => {
  const w = world({ prs: { 1: MERGED(1), 2: MERGED(2), 3: MERGED(3) }, onMain: ['m1', 'm2', 'm3'], deployed: ['m1'] });
  assert.deepEqual(ev([1, 2, 3], w),
    { state: 'pending', description: 'Seatsnags/seatsnags-mvp#2 is on main but not running in production yet (+1 more)' });
  const w2 = world({ prs: { 1: MERGED(1) }, onMain: [], deployed: [] });
  assert.deepEqual(ev([1, 7], w2), { state: 'failure', description: 'Seatsnags/seatsnags-mvp#7 is not a pull request (+1 more)' });
});

test('evaluateDeps: no upstream access with deps fails, never passes', () => {
  assert.deepEqual(evaluateDeps({ deps: [4], repo: UP, branch: 'main', deployedSha: 'D', getPr: null, contains: null }),
    { state: 'failure', description: 'cannot read Seatsnags/seatsnags-mvp to check #4 (no token)' });
});

test('evaluateDeps: an API error is an error, not a verdict', () => {
  const w = { getPr: () => { throw new Error('HTTP 502'); }, contains: () => true };
  assert.throws(() => ev([1], w), /HTTP 502/);
});

/* upstreamApi over a fake gh: argument order of compare is what makes the gate fail closed. */
const notFound = () => Object.assign(new Error('Command failed'), { stderr: 'gh: Not Found (HTTP 404)' });

test('upstreamApi.contains: compare base is the dependency, head is the target', () => {
  const calls = [];
  const exec = (...a) => { calls.push(a.join(' ')); return a[1].includes('compare/DEP...TARGET') ? 'ahead\n' : 'behind\n'; };
  const api = upstreamApi('o/r', exec);
  assert.equal(api.contains('DEP', 'TARGET'), true);
  // The dependency newer than production: GitHub says "behind" for DEP...TARGET; swapped it would be "ahead".
  assert.equal(api.contains('TARGET', 'DEP'), false);
  assert.match(calls[0], /^api repos\/o\/r\/compare\/DEP\.\.\.TARGET --jq \.status$/);
});

test('upstreamApi.contains: identical counts, diverged and errors do not', () => {
  assert.equal(upstreamApi('o/r', () => 'identical').contains('a', 'b'), true);
  assert.equal(upstreamApi('o/r', () => 'diverged').contains('a', 'b'), false);
  assert.equal(upstreamApi('o/r', () => { throw notFound(); }).contains('a', 'b'), false);
});

test('upstreamApi.getPr: json, null on 404, throws otherwise', () => {
  assert.deepEqual(upstreamApi('o/r', () => '{"merged":true}').getPr(3), { merged: true });
  assert.equal(upstreamApi('o/r', () => { throw notFound(); }).getPr(3), null);
  assert.throws(() => upstreamApi('o/r', () => { throw new Error('HTTP 502'); }).getPr(3), /502/);
});

test('upstreamApi.branchSha: sha, null on 404', () => {
  let arg;
  assert.equal(upstreamApi('o/r', (...a) => { arg = a[1]; return 'abc\n'; }).branchSha('deployed/production'), 'abc');
  assert.equal(arg, 'repos/o/r/git/ref/heads/deployed/production');
  assert.equal(upstreamApi('o/r', () => { throw notFound(); }).branchSha('x'), null);
});

const sha = (c) => c.repeat(40);
const health = (over = {}) => ({
  status: 'ok',
  service: { commit: sha('a'), valid: true },
  workers: { ok: true, count: 2, processes: [{ commit: sha('a'), valid: true }, { commit: sha('b'), valid: true }] },
  ...over,
});

test('healthCommits: web and every worker, unique', () => {
  assert.deepEqual(healthCommits(health()), [sha('a'), sha('b')]);
});

test('healthCommits: anything it cannot vouch for throws', () => {
  assert.throws(() => healthCommits({ status: 'ok' }), /detailed/);
  assert.throws(() => healthCommits(health({ service: { commit: null, valid: false } })), /web/);
  assert.throws(() => healthCommits(health({ workers: { ok: false, count: null, processes: [] } })), /worker/);
  assert.throws(() => healthCommits(health({ workers: { ok: true, count: 0, processes: [] } })), /worker/);
  assert.throws(() => healthCommits(health({ workers: { ok: true, count: 1, processes: [{ commit: 'abc', valid: false }] } })), /worker/);
});

test('pickOldest: the commit every other one contains', () => {
  const order = [sha('a'), sha('b'), sha('c')]; // linear history, oldest first
  const contains = (x, y) => order.indexOf(x) <= order.indexOf(y);
  assert.equal(pickOldest([sha('c'), sha('a'), sha('b')], contains), sha('a'));
  assert.equal(pickOldest([sha('b')], contains), sha('b'));
});

test('pickOldest: diverged commits throw', () => {
  assert.throws(() => pickOldest([sha('a'), sha('b')], (x, y) => x === y), /diverged/);
});

/* recordDeployed: a, b, c is linear history on main, oldest first. */
const LINE = [sha('a'), sha('b'), sha('c')];
const fakeRepo = ({ ref = sha('a'), onMain = LINE } = {}) => {
  const writes = [];
  return {
    writes,
    api: {
      contains: (x, y) => (y === 'main' ? onMain.includes(x) : LINE.indexOf(x) !== -1 && LINE.indexOf(x) <= LINE.indexOf(y)),
      branchSha: () => ref,
    },
    setBranch: (s, exists) => writes.push([s, exists]),
  };
};
const reportOf = (web, ...workers) => health({
  service: { commit: web, valid: true },
  workers: { ok: true, count: workers.length, processes: workers.map((c) => ({ commit: c, valid: true })) },
});

test('recordDeployed: moves the branch to the oldest running commit', async () => {
  const r = fakeRepo();
  const out = await recordDeployed({ ...r, readHealth: async () => reportOf(sha('c'), sha('b')), branch: 'main' });
  assert.deepEqual(out, { sha: sha('b'), moved: true, timedOut: false });
  assert.deepEqual(r.writes, [[sha('b'), true]]);
});

test('recordDeployed: no write when unchanged; creates the branch when missing', async () => {
  const same = fakeRepo({ ref: sha('b') });
  assert.equal((await recordDeployed({ ...same, readHealth: async () => reportOf(sha('b'), sha('b')), branch: 'main' })).moved, false);
  assert.deepEqual(same.writes, []);
  const none = fakeRepo({ ref: null });
  await recordDeployed({ ...none, readHealth: async () => reportOf(sha('a'), sha('a')), branch: 'main' });
  assert.deepEqual(none.writes, [[sha('a'), false]]);
});

test('recordDeployed: never records a commit that is not on the branch', async () => {
  const r = fakeRepo({ onMain: [sha('a')] });
  await assert.rejects(recordDeployed({ ...r, readHealth: async () => reportOf(sha('b'), sha('b')), branch: 'main' }), /not on main/);
  assert.deepEqual(r.writes, []);
});

test('recordDeployed: a bad report writes nothing', async () => {
  const r = fakeRepo();
  await assert.rejects(recordDeployed({ ...r, readHealth: async () => ({ status: 'ok' }), branch: 'main' }), /detailed/);
  assert.deepEqual(r.writes, []);
});

test('recordDeployed: waits until every process contains waitFor, polling', async () => {
  const r = fakeRepo();
  const reports = [reportOf(sha('a'), sha('a')), reportOf(sha('c'), sha('a')), reportOf(sha('c'), sha('c'))];
  let sleeps = 0;
  const out = await recordDeployed({
    ...r, branch: 'main', waitFor: sha('c'), deadline: Date.now() + 60_000,
    readHealth: async () => reports.shift(), sleep: async () => { sleeps += 1; },
  });
  assert.deepEqual(out, { sha: sha('c'), moved: true, timedOut: false });
  assert.equal(sleeps, 2);
});

test('recordDeployed: on timeout records what runs and says so', async () => {
  const r = fakeRepo();
  const out = await recordDeployed({
    ...r, branch: 'main', waitFor: sha('c'), deadline: Date.now() - 1,
    readHealth: async () => reportOf(sha('b'), sha('b')), sleep: async () => {},
  });
  assert.deepEqual(out, { sha: sha('b'), moved: true, timedOut: true });
});

test('recordDeployed: a failing poll while waiting is retried, not fatal', async () => {
  const r = fakeRepo();
  const reports = [() => { throw new Error('HTTP 502'); }, () => reportOf(sha('c'), sha('c'))];
  const out = await recordDeployed({
    ...r, branch: 'main', waitFor: sha('c'), deadline: Date.now() + 60_000,
    readHealth: async () => reports.shift()(), sleep: async () => {}, log: () => {},
  });
  assert.equal(out.sha, sha('c'));
});

test('recordDeployed: health failing until the deadline throws and writes nothing', async () => {
  const r = fakeRepo();
  await assert.rejects(recordDeployed({
    ...r, branch: 'main', waitFor: sha('c'), deadline: Date.now() - 1, log: () => {},
    readHealth: async () => { throw new Error('HTTP 503'); }, sleep: async () => {},
  }), /503/);
  assert.deepEqual(r.writes, []);
});

/* gatePrs: posts harness/depends-on per PR, only on change, and again if the deployed ref moved meanwhile. */
const gateWorld = ({ refs = ['D1'], deployed = { D1: [], D2: ['m5'] }, current = {} } = {}) => {
  const posts = [];
  const reads = [...refs];
  return {
    posts,
    upstreamRepo: UP,
    branch: 'main',
    deployedBranch: 'deployed/production',
    upstream: {
      getPr: (n) => MERGED(n),
      contains: (s, t) => (t === 'main' ? true : (deployed[t] ?? []).includes(s)),
      branchSha: () => (reads.length > 1 ? reads.shift() : reads[0]),
    },
    currentStatus: (headSha) => current[headSha] ?? null,
    post: (headSha, state, description) => posts.push([headSha, state, description]),
  };
};

test('gatePrs: posts per PR and skips an unchanged status', () => {
  const w = gateWorld({ current: { h2: { state: 'success', description: 'no Seatsnags/seatsnags-mvp dependency' } } });
  gatePrs({ ...w, prs: [{ number: 1, headSha: 'h1', body: 'Depends on Seatsnags/seatsnags-mvp#5' }, { number: 2, headSha: 'h2', body: '' }] });
  assert.deepEqual(w.posts, [['h1', 'pending', 'Seatsnags/seatsnags-mvp#5 is on main but not running in production yet']]);
});

test('gatePrs: re-evaluates when the deployed ref moved during the run', () => {
  const w = gateWorld({ refs: ['D1', 'D2'] });
  gatePrs({ ...w, prs: [{ number: 1, headSha: 'h1', body: 'Depends on Seatsnags/seatsnags-mvp#5' }] });
  assert.deepEqual(w.posts.map((p) => p[1]), ['pending', 'success']);
});

test('gatePrs: no deployed branch configured checks main only', () => {
  const w = gateWorld();
  gatePrs({ ...w, deployedBranch: '', prs: [{ number: 1, headSha: 'h1', body: 'Depends on Seatsnags/seatsnags-mvp#5' }] });
  assert.deepEqual(w.posts, [['h1', 'success', 'Seatsnags/seatsnags-mvp#5 is on main']]);
});

test('gatePrs: without upstream access, deps fail and no-deps PRs still pass', () => {
  const w = gateWorld();
  gatePrs({ ...w, upstream: null, prs: [{ number: 1, headSha: 'h1', body: 'Depends on seatsnags-mvp#5' }, { number: 2, headSha: 'h2', body: 'x' }] });
  assert.deepEqual(w.posts.map((p) => p[1]), ['failure', 'success']);
});

test('gatePrs: judges the body re-read just before evaluating, not the listed one', () => {
  const w = gateWorld();
  const fresh = { number: 1, headSha: 'h1', body: 'Depends on Seatsnags/seatsnags-mvp#5' };
  gatePrs({ ...w, refresh: () => fresh, prs: [{ number: 1, headSha: 'h1', body: 'no dependency' }] });
  assert.deepEqual(w.posts.map((p) => p[1]), ['pending']);
});

test('gatePrs: skips the post when the body or head changed while evaluating', () => {
  for (const later of [{ headSha: 'h1', body: 'Depends on Seatsnags/seatsnags-mvp#5' }, { headSha: 'h9', body: '' }]) {
    const w = gateWorld();
    const reads = [{ number: 1, headSha: 'h1', body: '' }, { number: 1, ...later }];
    gatePrs({ ...w, log: () => {}, refresh: () => reads.shift() ?? { number: 1, ...later }, prs: [{ number: 1, headSha: 'h1', body: '' }] });
    assert.deepEqual(w.posts, []);
  }
});

test('gatePrs: a closed PR (refresh null) is skipped', () => {
  const w = gateWorld();
  gatePrs({ ...w, log: () => {}, refresh: () => null, prs: [{ number: 1, headSha: 'h1', body: '' }] });
  assert.deepEqual(w.posts, []);
});

test('gatePrs: one PR erroring does not stop the others, and is reported', () => {
  const w = gateWorld();
  w.upstream.getPr = (n) => { if (n === 1) throw new Error('HTTP 502'); return MERGED(n); };
  const errors = gatePrs({ ...w, log: () => {}, prs: [
    { number: 1, headSha: 'h1', body: 'Depends on Seatsnags/seatsnags-mvp#1' },
    { number: 2, headSha: 'h2', body: 'Depends on Seatsnags/seatsnags-mvp#5' },
  ] });
  assert.equal(errors, 1);
  assert.deepEqual(w.posts.map((p) => p[0]), ['h2']);
});

test('a paragraph block ends at two blank lines or a heading', () => {
  assert.deepEqual(parseDependsOn('Depends on:\n- Seatsnags/seatsnags-mvp#1\n\n\n- Seatsnags/seatsnags-mvp#2', UP), [1]);
  assert.deepEqual(parseDependsOn('Depends on:\n- Seatsnags/seatsnags-mvp#1\n## Risk\n- Seatsnags/seatsnags-mvp#2', UP), [1]);
});
