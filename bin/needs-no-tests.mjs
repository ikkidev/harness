#!/usr/bin/env node
/*
 * Prints "no-tests" when the diff against <base> changes non-doc files but no
 * test file, else nothing. Exits 2 (and prints nothing on stdout) when it
 * cannot diff, so callers never mistake a failure for "no label needed".
 */
import { execFileSync } from 'node:child_process';
import { needsNoTestsLabel } from '../lib/evidence.mjs';

const base = process.argv[2];
if (!base) {
  console.error('usage: needs-no-tests.mjs <base-ref>   (e.g. origin/main; git fetch first)');
  process.exit(2);
}
let out;
try {
  out = execFileSync('git', ['diff', '--name-only', `${base}...HEAD`], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
} catch {
  console.error(`ERROR: cannot diff against ${base} (missing ref or no merge base); do not guess the label`);
  process.exit(2);
}
if (needsNoTestsLabel(out.split('\n').filter(Boolean))) console.log('no-tests');
