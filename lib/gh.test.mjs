import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CHANGED_FILES_JQ, STATUSES_JQ, changedFiles, statusDescription } from './gh.mjs';

test('jq constants are exact (escape regressions fail here)', () => {
  assert.equal(CHANGED_FILES_JQ, '.[] | .filename, (.previous_filename // empty)');
  assert.equal(STATUSES_JQ, '.[] | [.context, .description, .creator.login] | @tsv');
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
