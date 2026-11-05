#!/usr/bin/env node
import { currentRepo, prHeadSha, TIER_CREATOR, postStatus, statusDescription } from '../lib/gh.mjs';
import { assertHead, assertLocalTier, parseArgs, statusFor } from '../lib/review-status.mjs';

function main() {
  const { pr, sha, verdict, round } = parseArgs(process.argv.slice(2));
  const repo = currentRepo();
  assertHead(pr, sha, prHeadSha(repo, pr));
  const description = statusDescription(repo, sha, 'harness/tier', { creator: TIER_CREATOR });
  assertLocalTier(description);

  const status = statusFor({ verdict, round });
  postStatus(repo, sha, 'harness/review', status.state, status.description);
  console.log(`harness/review ${status.description}`);
}

try {
  main();
} catch (err) {
  console.error(`ERROR: ${err.message}`);
  process.exit(1);
}
