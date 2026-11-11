import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fingerprint } from './fingerprint.mjs';

/* A throwaway repo. CI runners have no git identity, so the test supplies one through the environment. */
const IDENTITY = {
  GIT_AUTHOR_NAME: 'fixture', GIT_AUTHOR_EMAIL: 'fixture@example.invalid',
  GIT_COMMITTER_NAME: 'fixture', GIT_COMMITTER_EMAIL: 'fixture@example.invalid',
};

function repo() {
  const cwd = mkdtempSync(join(tmpdir(), 'fp-'));
  const git = (...args) => execFileSync('git', args, { cwd, encoding: 'utf8', env: { ...process.env, ...IDENTITY } }).trim();
  const write = (file, text) => writeFileSync(join(cwd, file), text);
  const commit = (msg) => { git('add', '-A'); git('commit', '-q', '--allow-empty', '-m', msg); return git('rev-parse', 'HEAD'); };
  git('init', '-q', '-b', 'main');
  write('app.yml', 'a:\n  b: 1\n');
  commit('init');
  return { cwd, git, write, commit };
}

const fp = (r, base, head) => fingerprint({ cwd: r.cwd, base, head });

test('an empty commit on top keeps the fingerprint', () => {
  const r = repo();
  r.git('checkout', '-q', '-b', 'feat');
  r.write('feature.txt', 'hello\n');
  const first = r.commit('feature');
  const second = r.commit('re-run CI');
  assert.notEqual(first, second);
  assert.equal(fp(r, 'main', second), fp(r, 'main', first));
});

test('a rebase onto a moved base keeps the fingerprint', () => {
  const r = repo();
  r.git('checkout', '-q', '-b', 'feat');
  r.write('feature.txt', 'hello\n');
  const before = r.commit('feature');
  const fpBefore = fp(r, 'main', before);
  r.git('checkout', '-q', 'main');
  r.write('other.txt', 'unrelated\n');
  r.commit('unrelated');
  r.git('rebase', '-q', 'main', 'feat');
  const after = r.git('rev-parse', 'HEAD');
  assert.notEqual(after, before);
  assert.equal(fp(r, 'main', after), fpBefore);
});

test('retargeting a stacked branch after its parent merged with a merge commit keeps the fingerprint', () => {
  const r = repo();
  r.git('checkout', '-q', '-b', 'parent');
  r.write('parent.txt', 'parent\n');
  r.commit('parent');
  r.git('checkout', '-q', '-b', 'child');
  r.write('child.txt', 'child\n');
  const child = r.commit('child');
  const stacked = fp(r, 'parent', child);
  r.git('checkout', '-q', 'main');
  r.git('merge', '-q', '--no-ff', '-m', 'merge parent', 'parent');
  assert.equal(fp(r, 'main', child), stacked);
});

test('retargeting a stacked branch whose parent did not merge changes the fingerprint', () => {
  const r = repo();
  r.git('checkout', '-q', '-b', 'parent');
  r.write('parent.txt', 'parent\n');
  r.commit('parent');
  r.git('checkout', '-q', '-b', 'child');
  r.write('child.txt', 'child\n');
  const child = r.commit('child');
  assert.notEqual(fp(r, 'main', child), fp(r, 'parent', child));
});

test('a whitespace-only change changes the fingerprint', () => {
  const r = repo();
  r.git('checkout', '-q', '-b', 'feat');
  r.write('feature.txt', 'hello\n');
  const before = r.commit('feature');
  r.write('app.yml', 'a:\n   b: 1\n');
  const after = r.commit('re-indent');
  assert.notEqual(fp(r, 'main', after), fp(r, 'main', before));
});

test('a one-character change changes the fingerprint', () => {
  const r = repo();
  r.git('checkout', '-q', '-b', 'feat');
  r.write('feature.txt', 'hello\n');
  const before = r.commit('feature');
  r.write('feature.txt', 'hellp\n');
  const after = r.commit('typo');
  assert.notEqual(fp(r, 'main', after), fp(r, 'main', before));
});

test('no changes fingerprint as empty', () => {
  const r = repo();
  assert.equal(fp(r, 'main', 'main'), 'empty');
});

test('an unknown commit gives null', () => {
  const r = repo();
  assert.equal(fp(r, 'main', 'f'.repeat(40)), null);
});

/* These repos squash-merge: after the parent lands as one new commit, the child's diff against main still
   includes the parent's changes, so a stacked retarget asks for a re-review rather than carrying. */
test('retargeting a stacked branch after its parent was squash-merged changes the fingerprint', () => {
  const r = repo();
  r.git('checkout', '-q', '-b', 'parent');
  r.write('parent.txt', 'parent\n');
  r.commit('parent');
  r.git('checkout', '-q', '-b', 'child');
  r.write('child.txt', 'child\n');
  const child = r.commit('child');
  const stacked = fp(r, 'parent', child);
  r.git('checkout', '-q', 'main');
  r.git('merge', '-q', '--squash', 'parent');
  r.commit('parent (squashed)');
  assert.notEqual(fp(r, 'main', child), stacked);
});
