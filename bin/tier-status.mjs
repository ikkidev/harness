#!/usr/bin/env node
import { appendFileSync, readFileSync } from 'node:fs';
import { changedFiles, gh, postStatus, readConfig } from '../lib/gh.mjs';
import { resolveTier } from '../lib/tier.mjs';
import { parseEvent, riskLabelSpec, staleRiskLabels } from '../lib/tier-status.mjs';

function main() {
  const repo = process.env.GITHUB_REPOSITORY;
  const eventPath = process.env.GITHUB_EVENT_PATH;
  if (!repo || !eventPath) throw new Error('GITHUB_REPOSITORY and GITHUB_EVENT_PATH are required');
  const configPath = process.env.HARNESS_CONFIG_PATH || 'harness.yml';

  const { number, baseRef, headSha } = parseEvent(JSON.parse(readFileSync(eventPath, 'utf8')));

  const config = readConfig(repo, baseRef, configPath);
  const files = changedFiles(repo, number);
  const tier = resolveTier(files, config);

  const current = gh('pr', 'view', String(number), '--repo', repo, '--json', 'labels', '--jq', '.labels[].name')
    .split('\n')
    .filter(Boolean);
  for (const label of staleRiskLabels(current, tier)) {
    gh('pr', 'edit', String(number), '--repo', repo, '--remove-label', label);
  }
  const spec = riskLabelSpec(tier);
  gh('label', 'create', spec.name, '--repo', repo, '--force',
    '--color', spec.color, '--description', spec.description);
  gh('pr', 'edit', String(number), '--repo', repo, '--add-label', spec.name);

  postStatus(repo, headSha, 'harness/tier', 'success', `tier=${tier}`);

  console.log(`tier=${tier}`);
  if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `tier=${tier}\n`);
}

try {
  main();
} catch (err) {
  console.error(`ERROR: ${err.message}`);
  process.exit(1);
}
