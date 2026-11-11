import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CHANGED_FILES_JQ, REVIEW_STATUS_JQ, STATUSES_JQ, changedFiles, currentRepo, latestStatus, prHeadSha, statusDescription, statusState } from './gh.mjs';

test('jq constants are exact (escape regressions fail here)', () => {
  assert.equal(CHANGED_FILES_JQ, '.[] | .filename, (.previous_filename // empty)');
  assert.equal(STATUSES_JQ, '.[] | [.context, .description, .creator.login, .state] | @tsv');
});

test('changedFiles passes the jq filter and dedupes renames', () => {
  let args;
  const exec = (...a) => { args = a; return 'src/lib/x.ts\nsrc/server/x.ts\nsrc/lib/x.ts\n\n'; };
  assert.deepEqual(changedFiles('o/r', 7, exec), ['src/lib/x.ts', 'src/server/x.ts']);
  assert.ok(args.includes(CHANGED_FILES_JQ));
  assert.ok(args.includes('repos/o/r/pulls/7/files'));
});

const out = [
  'harness/tier\ttier=high\tsomeone',
  'harness/tier\ttier=normal\tgithub-actions[bot]',
  'harness/tier\ttier=low\tgithub-actions[bot]',
  'harness/review\tround 1: approved\tdev',
].join('\n');

test('statusDescription picks the newest entry matching context and creator', () => {
  const exec = () => out;
  assert.equal(statusDescription('o/r', 'a'.repeat(40), 'harness/tier', { creator: 'github-actions[bot]', exec }), 'tier=normal');
});

test('statusDescription without creator takes the first context match', () => {
  assert.equal(statusDescription('o/r', 'sha', 'harness/tier', { exec: () => out }), 'tier=high');
});

test('statusDescription returns null with no match, and keeps an empty description', () => {
  assert.equal(statusDescription('o/r', 'sha', 'harness/tier', { creator: 'nobody', exec: () => out }), null);
  assert.equal(statusDescription('o/r', 'sha', 'x', { exec: () => 'x\t\tbot' }), '');
  assert.equal(statusDescription('o/r', 'sha', 'x', { exec: () => '' }), null);
});

test('currentRepo prefers GH_REPO and never calls gh then', () => {
  assert.equal(currentRepo({ GH_REPO: 'o/r' }, () => { throw new Error('called'); }), 'o/r');
  assert.equal(currentRepo({}, () => 'x/y\n'), 'x/y');
});

test('prHeadSha reads the PR head over REST', () => {
  const calls = [];
  const sha = prHeadSha('o/r', 7, (...a) => { calls.push(a); return 'abc\n'; });
  assert.equal(sha, 'abc');
  assert.deepEqual(calls[0], ['api', 'repos/o/r/pulls/7', '--jq', '.head.sha']);
});

const BOT = 'github-actions[bot]';
const row = (state, login) => `preview/screens\tdesc\t${login}\t${state}`;

test('statusState returns the state of the newest status by the creator', () => {
  const rows = [row('success', 'someone'), row('success', BOT), row('failure', BOT)].join('\n');
  const exec = (...a) => { assert.ok(a.includes('repos/o/r/commits/sha/statuses')); return rows; };
  assert.equal(statusState('o/r', 'sha', 'preview/screens', { creator: BOT, exec }), 'success');
});

test('statusState: a newer failure beats an older success, other creators are ignored, none is null', () => {
  const newestFirst = [row('failure', BOT), row('success', BOT)].join('\n');
  assert.equal(statusState('o/r', 'sha', 'preview/screens', { creator: BOT, exec: () => newestFirst }), 'failure');
  assert.equal(statusState('o/r', 'sha', 'preview/screens', { creator: BOT, exec: () => row('success', 'someone') }), null);
  assert.equal(statusState('o/r', 'sha', 'preview/screens', { creator: BOT, exec: () => '' }), null);
});

const reviewRows = [
  'harness/tier\ttier=low\tgithub-actions[bot]\tsuccess\t2026-11-11T19:00:00Z',
  'harness/review\tapproved by ikkidev\tgithub-actions[bot]\tsuccess\t2026-11-11T20:00:00Z',
  'harness/review\tround 1: changes-requested\tikkidev\tfailure\t2026-11-11T18:00:00Z',
].join('\n');

test('latestStatus returns the newest row for the context with its creator and time, whoever posted it', () => {
  let args;
  const exec = (...a) => { args = a; return reviewRows; };
  assert.deepEqual(latestStatus('o/r', 'sha', 'harness/review', { exec }),
    { state: 'success', description: 'approved by ikkidev', creator: 'github-actions[bot]', createdAt: '2026-11-11T20:00:00Z' });
  assert.ok(args.includes(REVIEW_STATUS_JQ));
});

test('latestStatus returns null when the context has no status', () => {
  assert.equal(latestStatus('o/r', 'sha', 'harness/evidence', { exec: () => reviewRows }), null);
});
