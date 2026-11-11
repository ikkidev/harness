#!/usr/bin/env node
/* Keeps harness/review on a PR whose head or base changed but whose changes did not: posts success
   ("carried from") when they match the reviewed head, failure ("re-review needed") when they differ.
   Runs in a checkout with full history (actions/checkout fetch-depth: 0). On a new head any doubt posts
   nothing (the head has no review, so the PR stays blocked); on a new base, where the old review already
   sits on the head, any doubt posts failure. */
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { baseChangedSince, carryEvent, decideCarry, decideRetarget, parseTrusted } from '../lib/carry-review.mjs';
import { fingerprint } from '../lib/fingerprint.mjs';
import { gh, latestStatus, postStatus } from '../lib/gh.mjs';

const CONTEXT = 'harness/review';

/* One fetch per ref: a ref that is gone (a deleted parent branch) must not stop the others. */
function fetchRefs(refs) {
  for (const ref of refs) {
    try {
      execFileSync('git', ['fetch', '--no-tags', '--quiet', 'origin', ref], { stdio: 'pipe' });
    } catch (err) {
      console.log(`NOTE: git fetch ${ref} failed (${String(err.message).split('\n')[0]}); using what the checkout has`);
    }
  }
}

const baseChangeTimes = (repo, number) => gh('api', '--paginate', `repos/${repo}/issues/${number}/timeline`,
  '--jq', '.[] | select(.event == "base_ref_changed") | .created_at').split('\n').filter(Boolean);

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
    // Both heads are compared against today's base; if the base moved since the review, that is not the
    // diff that was reviewed (a retarget run may not have marked it yet), so nothing carries.
    if (prior && baseChangedSince(baseChangeTimes(repo, ev.number), prior.createdAt)) {
      return console.log(`no carry from ${ev.before.slice(0, 7)}: base changed since the review`);
    }
    const d = decideCarry({ prior, priorSha: ev.before, beforeFp: fp(`origin/${ev.base}`, ev.before),
      afterFp: fp(`origin/${ev.base}`, ev.after), trusted, current: latestStatus(repo, ev.after, CONTEXT) });
    if (d.action === 'none') return console.log(`no carry from ${ev.before.slice(0, 7)}: ${noneReason(prior, trusted)}`);
    postStatus(repo, ev.after, CONTEXT, d.action, d.description);
    return console.log(`${CONTEXT} ${d.action} on ${ev.after}: ${d.description}`);
  }

  fetchRefs([ev.head, `+refs/heads/${ev.fromBase}:refs/remotes/origin/${ev.fromBase}`,
    `+refs/heads/${ev.toBase}:refs/remotes/origin/${ev.toBase}`]);
  const prior = latestStatus(repo, ev.head, CONTEXT);
  const d = decideRetarget({ prior, priorSha: ev.head, fromFp: fp(`origin/${ev.fromBase}`, ev.head),
    toFp: fp(`origin/${ev.toBase}`, ev.head), trusted });
  if (d.action !== 'failure') return console.log(`retarget ${ev.fromBase} -> ${ev.toBase}: ${d.action === 'stands' ? 'same changes, review stands' : 'no trusted review to check'}`);
  postStatus(repo, ev.head, CONTEXT, 'failure', d.description);
  console.log(`${CONTEXT} failure on ${ev.head}: ${d.description}`);
}

function noneReason(prior, trusted) {
  if (!prior) return 'no review on the old head';
  if (prior.state !== 'success' || !trusted.has(prior.creator)) return `old head's review is ${prior.state} by ${prior.creator}`;
  return 'a fingerprint could not be computed, or the new head already has its own verdict';
}

try {
  main();
} catch (err) {
  console.error(`ERROR: ${err.message}`);
  process.exit(1);
}
