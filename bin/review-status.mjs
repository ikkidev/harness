#!/usr/bin/env node
import { currentRepo, postStatus, statusDescription } from '../lib/gh.mjs';
import { parseArgs, parseTier, statusFor } from '../lib/review-status.mjs';

function main() {
  const { sha, verdict, round } = parseArgs(process.argv.slice(2));
  const repo = currentRepo();
  const description = statusDescription(repo, sha, 'harness/tier');
  if (!description) throw new Error(`no harness/tier status on ${sha}; wait for CI`);
  const tier = parseTier(description);
  if (tier === 'high') throw new Error('tier=high: the local agent must not post harness/review');
  if (!tier) throw new Error(`unrecognized harness/tier description "${description}"`);

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
