import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { chmodSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

/* Runs the real bin script against a stub `gh`: an approved verdict must reach the auto-merge step. */
const SCRIPT = fileURLToPath(new URL('../bin/review-comment-status.mjs', import.meta.url));
const SHA = 'b'.repeat(40);

const STUB = `#!/usr/bin/env node
const fs = require('node:fs');
const args = process.argv.slice(2);
fs.appendFileSync(process.env.STUB_LOG, JSON.stringify(args) + '\\n');
const path = args.find((a) => a.startsWith('repos/')) ?? '';
if (path.endsWith('/statuses') && args.includes('--paginate')) process.stdout.write('harness/tier\\ttier=low\\tgithub-actions[bot]\\n');
else if (/\\/pulls\\/\\d+$/.test(path)) process.stdout.write('${SHA}\\n');
`;

test('an approved verdict posts the status, strips the footer and reaches auto-merge', () => {
  const dir = mkdtempSync(join(tmpdir(), 'rcs-'));
  writeFileSync(join(dir, 'gh'), STUB);
  chmodSync(join(dir, 'gh'), 0o755);
  const log = join(dir, 'gh.log');
  writeFileSync(log, '');
  const event = join(dir, 'event.json');
  writeFileSync(event, JSON.stringify({
    action: 'created',
    issue: { number: 5, pull_request: {} },
    comment: { id: 9, user: { login: 'reviewer' },
      body: `Automated review (bot, tier: low, round 1): approved\nCommit ${SHA}.\n\n---\nGenerated with [Claude Code](https://claude.ai/code)` },
  }));
  const vars = {
    PATH: `${dir}:${dirname(process.execPath)}`,
    STUB_LOG: log,
    GITHUB_REPOSITORY: 'o/r',
    GITHUB_EVENT_PATH: event,
    HARNESS_REVIEWER_LOGIN: 'reviewer',
    HARNESS_AUTO_MERGE_BASES: 'main',
  };
  const r = spawnSync(process.execPath, [SCRIPT], { env: vars, encoding: 'utf8', timeout: 10_000 });
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /auto-merge: skipped \(no App credentials\)/);
  const calls = readFileSync(log, 'utf8').trim().split('\n').map((l) => JSON.parse(l));
  assert.ok(calls.some((a) => a.includes(`repos/o/r/statuses/${SHA}`)), 'posts harness/review');
  assert.ok(calls.some((a) => a.includes('PATCH') && a.includes('repos/o/r/issues/comments/9')), 'strips the footer');
});
