/*
 * GitHub App installation tokens. A merge made with the default GITHUB_TOKEN
 * does not trigger push workflows (deploys), so auto-merge is enabled with an
 * App token instead; the App's merge then fires them like a person's would.
 */
import crypto from 'node:crypto';

export function buildJwt(key, appId, now = Math.floor(Date.now() / 1000)) {
  const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
  const body = `${b64({ alg: 'RS256', typ: 'JWT' })}.${b64({ iat: now - 60, exp: now + 540, iss: String(appId) })}`;
  return `${body}.${crypto.createSign('RSA-SHA256').update(body).sign(key, 'base64url')}`;
}

async function call(fetchImpl, path, auth, method = 'GET', body = undefined) {
  const r = await fetchImpl(`https://api.github.com${path}`, {
    method,
    headers: { authorization: `Bearer ${auth}`, accept: 'application/vnd.github+json' },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(15000),
  });
  if (!r.ok) throw new Error(`${method} ${path} -> HTTP ${r.status}`);
  return r.json();
}

/* Token for the App's installation on `repo` (owner/name), scoped to that one repo. */
export async function installationToken({ appId, key, repo }, fetchImpl = fetch) {
  const jwt = buildJwt(key, appId);
  const inst = await call(fetchImpl, `/repos/${repo}/installation`, jwt);
  const t = await call(fetchImpl, `/app/installations/${inst.id}/access_tokens`, jwt, 'POST', { repositories: [repo.split('/')[1]], permissions: { contents: 'write', pull_requests: 'write' } });
  return t.token;
}
