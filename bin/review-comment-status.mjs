#!/usr/bin/env node
/* Turns the cloud reviewer's verdict comment into the harness/review status. */
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { installationToken } from '../lib/app-token.mjs';
import { parseBases, runAutoMerge } from '../lib/auto-merge.mjs';
import { gh, postStatus, prHeadSha, statusDescription, TIER_CREATOR } from '../lib/gh.mjs';
import { commentEvent, decide, parseReviewComment, stripFooterBestEffort } from '../lib/review-comment.mjs';
import { parseTier, statusFor } from '../lib/review-status.mjs';

async function main() {
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
  stripFooterBestEffort(repo, ev, { exec: gh });
  await autoMergeStep(repo, ev.number, verdict);
}

async function autoMergeStep(repo, number, verdict) {
  const vars = process.env;
  await runAutoMerge({
    verdict, repo, number,
    bases: parseBases(vars.HARNESS_AUTO_MERGE_BASES),
    method: vars.HARNESS_MERGE_METHOD || 'merge',
    haveCredentials: Boolean(vars.HARNESS_APP_ID && vars.HARNESS_APP_KEY),
  }, {
    getPr: () => JSON.parse(gh('api', `repos/${repo}/pulls/${number}`, '--jq', '{base: .base.ref, head: .head.sha, draft: .draft}')),
    mint: () => installationToken({ appId: vars.HARNESS_APP_ID, key: vars.HARNESS_APP_KEY, repo }),
    exec: (args, extra) => execFileSync('gh', args, { encoding: 'utf8', env: { ...vars, HARNESS_APP_KEY: '', ...extra } }),
    log: (m) => console.log(m),
  });
}

main().catch((err) => {
  console.error(`ERROR: ${err.message}`);
  process.exit(1);
});
