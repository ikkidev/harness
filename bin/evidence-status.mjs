#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { assertTier, checkEvidence } from '../lib/evidence.mjs';
import { changedFiles, gh, postStatus, readConfig } from '../lib/gh.mjs';
import { parseEvent } from '../lib/tier-status.mjs';

function main() {
  const repo = process.env.GITHUB_REPOSITORY;
  const eventPath = process.env.GITHUB_EVENT_PATH;
  const tier = process.env.HARNESS_TIER;
  if (!repo || !eventPath) throw new Error('GITHUB_REPOSITORY and GITHUB_EVENT_PATH are required');
  assertTier(tier);
  const configPath = process.env.HARNESS_CONFIG_PATH || 'harness.yml';

  const { number, baseRef, headSha } = parseEvent(JSON.parse(readFileSync(eventPath, 'utf8')));
  const config = readConfig(repo, baseRef, configPath);
  const files = changedFiles(repo, number);
  const pr = JSON.parse(gh('pr', 'view', String(number), '--repo', repo, '--json', 'body,labels'));

  const { ok, missing } = checkEvidence({
    body: pr.body,
    tier,
    changedFiles: files,
    labels: pr.labels.map((l) => l.name),
    config,
  });
  const description = ok ? 'ok' : `missing: ${missing.join(', ')}`;
  postStatus(repo, headSha, 'harness/evidence', ok ? 'success' : 'failure', description);
  console.log(`evidence ${description}`);
}

try {
  main();
} catch (err) {
  console.error(`ERROR: ${err.message}`);
  process.exit(1);
}
