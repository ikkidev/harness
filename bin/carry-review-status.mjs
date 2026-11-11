#!/usr/bin/env node
/* Keeps harness/review on a PR whose head or base changed but whose changes did not: posts success
   ("carried from") when they match the reviewed head, failure ("re-review needed") when they differ.
   Runs in a checkout with full history (actions/checkout fetch-depth: 0). Any doubt posts nothing. */
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { carryEvent, decideCarry, parseTrusted } from '../lib/carry-review.mjs';
import { fingerprint } from '../lib/fingerprint.mjs';
import { latestStatus, postStatus } from '../lib/gh.mjs';

const CONTEXT = 'harness/review';

function fetchRefs(refs) {
  try {
    execFileSync('git', ['fetch', '--no-tags', '--quiet', 'origin', ...refs], { stdio: 'pipe' });
  } catch (err) {
    console.log(`NOTE: git fetch failed (${String(err.message).split('\n')[0]}); using what the checkout has`);
  }
}

const fp = (base, head) => fingerprint({ cwd: process.cwd(), base, head });

function main() {
  const repo = process.env.GITHUB_REPOSITORY;
  const eventPath = process.env.GITHUB_EVENT_PATH;
  if (!repo || !eventPath) throw new Error('GITHUB_REPOSITORY and GITHUB_EVENT_PATH are required');
  const trusted = parseTrusted(process.env.HARNESS_TRUSTED_CREATORS);
  const ev = carryEvent(JSON.parse(readFileSync(eventPath, 'utf8')));
  if (!ev) return console.log('ignored: not a new head or a base change');

  if (ev.kind === 'sync') {
    fetchRefs([ev.before, ev.after, `+refs/heads/${ev.base}:refs/remotes/origin/${ev.base}`]);
    const prior = latestStatus(repo, ev.before, CONTEXT);
    const d = decideCarry({ prior, priorSha: ev.before, beforeFp: fp(`origin/${ev.base}`, ev.before),
      afterFp: fp(`origin/${ev.base}`, ev.after), trusted });
    if (d.action === 'none') return console.log(`no carry from ${ev.before.slice(0, 7)}: no trusted review, or a fingerprint failed`);
    postStatus(repo, ev.after, CONTEXT, d.action, d.description);
    return console.log(`${CONTEXT} ${d.action} on ${ev.after}: ${d.description}`);
  }

  fetchRefs([ev.head, `+refs/heads/${ev.fromBase}:refs/remotes/origin/${ev.fromBase}`,
    `+refs/heads/${ev.toBase}:refs/remotes/origin/${ev.toBase}`]);
  const prior = latestStatus(repo, ev.head, CONTEXT);
  const d = decideCarry({ prior, priorSha: ev.head, beforeFp: fp(`origin/${ev.fromBase}`, ev.head),
    afterFp: fp(`origin/${ev.toBase}`, ev.head), trusted });
  // The review on this head stands when the retarget changes nothing; only a change needs a status.
  if (d.action !== 'failure') return console.log(`retarget ${ev.fromBase} -> ${ev.toBase}: ${d.action === 'success' ? 'same changes, review stands' : 'nothing to carry'}`);
  postStatus(repo, ev.head, CONTEXT, 'failure', d.description);
  console.log(`${CONTEXT} failure on ${ev.head}: ${d.description}`);
}

try {
  main();
} catch (err) {
  console.error(`ERROR: ${err.message}`);
  process.exit(1);
}
