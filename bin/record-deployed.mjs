#!/usr/bin/env node
/*
 * Moves the deployed branch (default deployed/production) to the commit every
 * production process runs, read from a detailed /health report. Writes
 * moved=true|false and sha=<sha> to GITHUB_OUTPUT. The health token is sent as a
 * header only and never printed.
 */
import { appendFileSync } from 'node:fs';
import { recordDeployed, upstreamApi } from '../lib/depends-on.mjs';
import { gh } from '../lib/gh.mjs';

async function main() {
  const repo = process.env.GITHUB_REPOSITORY;
  const url = process.env.HARNESS_HEALTH_URL;
  const token = process.env.HARNESS_HEALTH_TOKEN;
  if (!repo || !url || !token) throw new Error('GITHUB_REPOSITORY, HARNESS_HEALTH_URL and HARNESS_HEALTH_TOKEN are required');
  const header = process.env.HARNESS_HEALTH_HEADER || 'X-Health-Token';
  const branch = process.env.HARNESS_BRANCH || 'main';
  const deployedBranch = process.env.HARNESS_DEPLOYED_BRANCH || 'deployed/production';
  const waitFor = process.env.HARNESS_WAIT_FOR || '';
  const minutes = Number(process.env.HARNESS_WAIT_MINUTES || 20);

  const readHealth = async () => {
    const r = await fetch(url, { headers: { [header]: token, accept: 'application/json' }, signal: AbortSignal.timeout(20_000) });
    if (!r.ok) throw new Error(`GET /health -> HTTP ${r.status}`);
    return r.json();
  };
  const setBranch = (sha, exists) => {
    if (exists) gh('api', '-X', 'PATCH', `repos/${repo}/git/refs/heads/${deployedBranch}`, '-f', `sha=${sha}`, '-F', 'force=true');
    else gh('api', '-X', 'POST', `repos/${repo}/git/refs`, '-f', `ref=refs/heads/${deployedBranch}`, '-f', `sha=${sha}`);
  };

  const out = await recordDeployed({
    readHealth, api: upstreamApi(repo, gh), setBranch, branch, deployedBranch,
    waitFor, deadline: Date.now() + minutes * 60_000,
  });
  console.log(`${deployedBranch} ${out.moved ? 'moved to' : 'already at'} ${out.sha}`);
  if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `moved=${out.moved}\nsha=${out.sha}\n`);
  if (out.timedOut) throw new Error(`production did not reach ${waitFor.slice(0, 7)} within ${minutes} min; recorded ${out.sha.slice(0, 7)}`);
}

main().catch((err) => {
  console.error(`ERROR: ${err.message}`);
  process.exit(1);
});
