import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseEvent, staleRiskLabels } from './tier-status.mjs';

test('parseEvent extracts number, base ref and head sha', () => {
  const event = { pull_request: { number: 7, base: { ref: 'main' }, head: { sha: 'abc123' } } };
  assert.deepEqual(parseEvent(event), { number: 7, baseRef: 'main', headSha: 'abc123' });
});

test('parseEvent rejects a non-PR event', () => {
  assert.throws(() => parseEvent({ push: {} }), /pull_request/);
});

test('staleRiskLabels keeps the wanted label and ignores non-risk labels', () => {
  const labels = ['risk:low', 'risk:high', 'bug', 'risk:normal'];
  assert.deepEqual(staleRiskLabels(labels, 'high'), ['risk:low', 'risk:normal']);
});
