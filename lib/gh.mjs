import { execFileSync } from 'node:child_process';
import { parse } from 'yaml';

export const gh = (...args) => execFileSync('gh', args, { encoding: 'utf8' });

export function readConfig(repo, baseRef, configPath) {
  const encoded = gh('api', `repos/${repo}/contents/${configPath}?ref=${baseRef}`, '--jq', '.content');
  return parse(Buffer.from(encoded, 'base64').toString('utf8')) ?? {};
}

export function changedFiles(repo, number) {
  return gh('api', '--paginate', `repos/${repo}/pulls/${number}/files`, '--jq', '.[].filename')
    .split('\n')
    .filter(Boolean);
}

export function postStatus(repo, sha, context, state, description) {
  gh('api', '-X', 'POST', `repos/${repo}/statuses/${sha}`,
    '-f', `state=${state}`, '-f', `context=${context}`, '-f', `description=${description.slice(0, 140)}`);
}

export const currentRepo = () => gh('repo', 'view', '--json', 'nameWithOwner', '--jq', '.nameWithOwner').trim();

export function statusDescription(repo, sha, context) {
  return gh('api', `repos/${repo}/commits/${sha}/status`, '--jq',
    `.statuses[] | select(.context=="${context}") | .description`).trim();
}
