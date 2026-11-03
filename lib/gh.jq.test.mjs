import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { TIER_CREATOR, changedFiles, readConfig, statusDescription } from './gh.mjs';

let hasJq = true;
try {
  execFileSync('jq', ['--version'], { stdio: 'ignore' });
} catch {
  hasJq = false;
}
const opts = hasJq ? {} : { skip: 'jq is not on PATH' };

const execWith = (json) => (...args) => {
  const filter = args[args.indexOf('--jq') + 1];
  return execFileSync('jq', ['-r', filter], { input: JSON.stringify(json), encoding: 'utf8' });
};

test('STATUSES_JQ: statusDescription selects by creator with real jq', opts, () => {
  const exec = execWith([
    { context: 'harness/tier', description: 'tier=low', creator: { login: 'ikkidev' } },
    { context: 'ci/other', description: 'ok', creator: { login: 'github-actions[bot]' } },
    { context: 'harness/tier', description: 'tier=high', creator: { login: 'github-actions[bot]' } },
  ]);
  assert.equal(statusDescription('o/r', 'sha', 'harness/tier', { creator: TIER_CREATOR, exec }), 'tier=high');
  assert.equal(statusDescription('o/r', 'sha', 'harness/tier', { exec }), 'tier=low');
  assert.equal(statusDescription('o/r', 'sha', 'missing', { exec }), null);
});

test('CHANGED_FILES_JQ: renames yield both names, deduped, with real jq', opts, () => {
  const exec = execWith([
    { filename: 'src/lib/x.ts', previous_filename: 'src/server/x.ts' },
    { filename: 'README.md' },
    { filename: 'README.md' },
  ]);
  assert.deepEqual(changedFiles('o/r', 1, exec), ['src/lib/x.ts', 'src/server/x.ts', 'README.md']);
});

test('CONTENT_JQ: readConfig decodes base64 containing a newline with real jq', opts, () => {
  const yaml = 'default: normal\ntiers:\n  high: ["src/server/**"]\n';
  const b64 = Buffer.from(yaml).toString('base64');
  const content = `${b64.slice(0, 10)}\n${b64.slice(10)}`;
  const exec = execWith({ content });
  assert.deepEqual(readConfig('o/r', 'main', 'harness.yml', exec), { default: 'normal', tiers: { high: ['src/server/**'] } });
});
