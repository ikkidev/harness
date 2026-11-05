#!/usr/bin/env node
/* Turns the cloud reviewer's verdict comment into the harness/review status. */
import { readFileSync } from 'node:fs';
import { gh, postStatus, prHeadSha, statusDescription, TIER_CREATOR } from '../lib/gh.mjs';
import { commentEvent, decide, parseReviewComment } from '../lib/review-comment.mjs';
import { parseTier, statusFor } from '../lib/review-status.mjs';

function main() {
  const repo = process.env.GITHUB_REPOSITORY;
  const eventPath = process.env.GITHUB_EVENT_PATH;
  const reviewer = process.env.HARNESS_REVIEWER_LOGIN;
  if (!repo || !eventPath || !reviewer) throw new Error('GITHUB_REPOSITORY, GITHUB_EVENT_PATH and HARNESS_REVIEWER_LOGIN are required');

  const ev = commentEvent(JSON.parse(readFileSync(eventPath, 'utf8')), reviewer);
  if (!ev) return console.log('ignored: not a new PR comment by the reviewer');
  const verdict = parseReviewComment(ev.body);
  if (!verdict) return console.log('ignored: not a verdict comment');

  const head = prHeadSha(repo, ev.number);
  const tier = parseTier(statusDescription(repo, verdict.sha, 'harness/tier', { creator: TIER_CREATOR }));
  const d = decide(verdict, head, tier);
  if (!d.act) return console.log(`ignored: ${d.why}`);

  const status = statusFor(verdict);
  postStatus(repo, verdict.sha, 'harness/review', status.state, status.description);
  if (d.label) gh('api', '-X', 'POST', `repos/${repo}/issues/${ev.number}/labels`, '-f', 'labels[]=needs-human');
  console.log(`harness/review ${status.description} on ${verdict.sha}`);
}

try {
  main();
} catch (err) {
  console.error(`ERROR: ${err.message}`);
  process.exit(1);
}
