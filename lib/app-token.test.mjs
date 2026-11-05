import { test } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { buildJwt, installationToken } from './app-token.mjs';

const { privateKey, publicKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
const pem = privateKey.export({ type: 'pkcs1', format: 'pem' });

test('buildJwt: RS256, issuer is the app id, under 10 minutes, verifies', () => {
  const [h, p, s] = buildJwt(pem, 42, 1_700_000_000).split('.');
  assert.deepEqual(JSON.parse(Buffer.from(p, 'base64url')), { iat: 1_699_999_940, exp: 1_700_000_540, iss: '42' });
  assert.ok(crypto.createVerify('RSA-SHA256').update(`${h}.${p}`).verify(publicKey, s, 'base64url'));
});

test('installationToken: finds the repo installation and scopes the token to that repo', async () => {
  const calls = [];
  const fake = async (url, init) => {
    calls.push([init.method, url, init.body, init.headers.authorization]);
    const json = url.endsWith('/installation') ? { id: 7 } : { token: 'tok' };
    return { ok: true, json: async () => json };
  };
  assert.equal(await installationToken({ appId: 1, key: pem, repo: 'Org/repo-a' }, fake), 'tok');
  assert.deepEqual(calls[0].slice(0, 2), ['GET', 'https://api.github.com/repos/Org/repo-a/installation']);
  assert.match(calls[0][3], /^Bearer [\w-]+\.[\w-]+\.[\w-]+$/);
  assert.equal(calls[1][3], calls[0][3]);
  assert.deepEqual(calls[1].slice(0, 3), ['POST', 'https://api.github.com/app/installations/7/access_tokens', JSON.stringify({ repositories: ['repo-a'], permissions: { contents: 'write', pull_requests: 'write' } })]);
});

test('installationToken: an HTTP error surfaces without the key', async () => {
  const fake = async () => ({ ok: false, status: 404, json: async () => ({}) });
  await assert.rejects(installationToken({ appId: 1, key: pem, repo: 'o/r' }, fake), (e) => /HTTP 404/.test(e.message) && !e.message.includes('PRIVATE'));
});
