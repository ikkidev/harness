#!/usr/bin/env node
/*
 * Posts harness/depends-on on one PR (pull_request events) or on every open PR
 * (any other event: schedule, repository_dispatch, workflow_dispatch).
 * The body and head are read from the API, never the event payload: a re-run of
 * an old event would otherwise judge a body that has since gained a dependency.
 */
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { DEPENDS_ON_CONTEXT, gatePrs, upstreamApi } from '../lib/depends-on.mjs';
import { TIER_CREATOR, gh, postStatus } from '../lib/gh.mjs';

const PR_JQ = '{number, state, headSha: .head.sha, body: (.body // "")} | @json';

function main() {
  const repo = process.env.GITHUB_REPOSITORY;
  const upstreamRepo = process.env.HARNESS_UPSTREAM_REPO;
  if (!repo || !upstreamRepo) throw new Error('GITHUB_REPOSITORY and HARNESS_UPSTREAM_REPO are required');
  const branch = process.env.HARNESS_UPSTREAM_BRANCH || 'main';
  const deployedBranch = process.env.HARNESS_DEPLOYED_BRANCH ?? '';
  const upstreamToken = process.env.HARNESS_UPSTREAM_TOKEN;

  const readPr = (number) => JSON.parse(gh('api', `repos/${repo}/pulls/${number}`, '--jq', PR_JQ));
  let prs;
  if (process.env.GITHUB_EVENT_NAME?.startsWith('pull_request')) {
    const number = JSON.parse(readFileSync(process.env.GITHUB_EVENT_PATH, 'utf8')).pull_request?.number;
    if (!number) throw new Error('event payload has no pull_request number');
    prs = [{ number }];
  } else {
    prs = gh('api', '--paginate', `repos/${repo}/pulls?state=open&per_page=100`, '--jq', `.[] | ${PR_JQ}`)
      .split('\n').filter(Boolean).map((l) => JSON.parse(l));
  }

  const upstreamGh = (...args) => execFileSync('gh', args, {
    encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, GH_TOKEN: upstreamToken },
  });
  if (!upstreamToken) console.log('NOTE: no upstream token; PRs with a dependency will fail');

  const statuses = (sha) => gh('api', `repos/${repo}/commits/${sha}/statuses?per_page=100`, '--jq',
    `[.[] | select(.context == "${DEPENDS_ON_CONTEXT}" and .creator.login == "${TIER_CREATOR}")][0] // empty | {state, description} | @json`).trim();

  const errors = gatePrs({
    prs,
    upstreamRepo,
    branch,
    deployedBranch,
    upstream: upstreamToken ? upstreamApi(upstreamRepo, upstreamGh) : null,
    currentStatus: (sha) => {
      const s = statuses(sha);
      return s ? JSON.parse(s) : null;
    },
    post: (sha, state, description) => postStatus(repo, sha, DEPENDS_ON_CONTEXT, state, description),
    refresh: (pr) => {
      const now = readPr(pr.number);
      return now.state === 'open' ? now : null;
    },
  });
  if (errors) throw new Error(`${errors} PR(s) could not be checked`);
}

try {
  main();
} catch (err) {
  console.error(`ERROR: ${err.message}`);
  process.exit(1);
}
