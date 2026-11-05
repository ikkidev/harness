import { execFileSync } from 'node:child_process';
import { parse } from 'yaml';

export const gh = (...args) => execFileSync('gh', args, { encoding: 'utf8' });

export const CONTENT_JQ = '.content';

export function readConfig(repo, baseRef, configPath, exec = gh) {
  const encoded = exec('api', `repos/${repo}/contents/${configPath}?ref=${baseRef}`, '--jq', CONTENT_JQ);
  return parse(Buffer.from(encoded, 'base64').toString('utf8')) ?? {};
}

export const CHANGED_FILES_JQ = '.[] | .filename, (.previous_filename // empty)';
export const STATUSES_JQ = '.[] | [.context, .description, .creator.login] | @tsv';
export const TIER_CREATOR = 'github-actions[bot]';

export function changedFiles(repo, number, exec = gh) {
  const out = exec('api', '--paginate', `repos/${repo}/pulls/${number}/files`, '--jq', CHANGED_FILES_JQ);
  return [...new Set(out.split('\n').filter(Boolean))];
}

export function postStatus(repo, sha, context, state, description) {
  gh('api', '-X', 'POST', `repos/${repo}/statuses/${sha}`,
    '-f', `state=${state}`, '-f', `context=${context}`, '-f', `description=${description.slice(0, 140)}`);
}

/* GH_REPO wins (cloud sessions have no GraphQL, which `gh repo view` needs). */
export const currentRepo = (env = process.env, exec = gh) =>
  (env.GH_REPO || exec('repo', 'view', '--json', 'nameWithOwner', '--jq', '.nameWithOwner')).trim();

/* PR head SHA over REST. */
export const prHeadSha = (repo, pr, exec = gh) => exec('api', `repos/${repo}/pulls/${pr}`, '--jq', '.head.sha').trim();

export function statusDescription(repo, sha, context, { creator, exec = gh } = {}) {
  const out = exec('api', '--paginate', `repos/${repo}/commits/${sha}/statuses`, '--jq', STATUSES_JQ);
  for (const line of out.split('\n')) {
    const [ctx, description = '', login = ''] = line.split('\t');
    if (ctx === context && (creator === undefined || login.trim() === creator)) return description.trim();
  }
  return null;
}
