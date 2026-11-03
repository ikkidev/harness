#!/usr/bin/env node
import { currentRepo, postStatus, statusDescription } from '../lib/gh.mjs';
import { assertLocalTier, parseArgs, statusFor } from '../lib/review-status.mjs';

function main() {
  const { sha, verdict, round } = parseArgs(process.argv.slice(2));
  const repo = currentRepo();
  const description = statusDescription(repo, sha, 'harness/tier');
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
