#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import { appendFileSync, readFileSync } from 'node:fs';
import { parse } from 'yaml';
import { resolveTier } from '../lib/tier.mjs';
import { parseEvent, riskLabelSpec, staleRiskLabels } from '../lib/tier-status.mjs';

const gh = (...args) => execFileSync('gh', args, { encoding: 'utf8' });

function main() {
  const repo = process.env.GITHUB_REPOSITORY;
  const eventPath = process.env.GITHUB_EVENT_PATH;
  if (!repo || !eventPath) throw new Error('GITHUB_REPOSITORY and GITHUB_EVENT_PATH are required');
  const configPath = process.env.HARNESS_CONFIG_PATH || 'harness.yml';

  const { number, baseRef, headSha } = parseEvent(JSON.parse(readFileSync(eventPath, 'utf8')));

  const encoded = gh('api', `repos/${repo}/contents/${configPath}?ref=${baseRef}`, '--jq', '.content');
  const config = parse(Buffer.from(encoded, 'base64').toString('utf8')) ?? {};

  const files = gh('api', '--paginate', `repos/${repo}/pulls/${number}/files`, '--jq', '.[].filename')
    .split('\n')
    .filter(Boolean);
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

  gh('api', '-X', 'POST', `repos/${repo}/statuses/${headSha}`,
    '-f', 'state=success', '-f', 'context=harness/tier', '-f', `description=tier=${tier}`);

  console.log(`tier=${tier}`);
  if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `tier=${tier}\n`);
}

try {
  main();
} catch (err) {
  console.error(`ERROR: ${err.message}`);
  process.exit(1);
}
