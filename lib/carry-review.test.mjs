import { test } from 'node:test';
import assert from 'node:assert/strict';
import { carryEvent, decideCarry, parseTrusted } from './carry-review.mjs';

const pr = { number: 7, base: { ref: 'dev' }, head: { sha: 'b'.repeat(40) } };

test('carryEvent reads a synchronize as a new head on the same base', () => {
  assert.deepEqual(carryEvent({ action: 'synchronize', before: 'a'.repeat(40), after: 'b'.repeat(40), pull_request: pr }),
    { kind: 'sync', number: 7, before: 'a'.repeat(40), after: 'b'.repeat(40), base: 'dev' });
});

test('carryEvent reads an edit of the base branch as a retarget', () => {
  assert.deepEqual(carryEvent({ action: 'edited', changes: { base: { ref: { from: 'feat/parent' } } }, pull_request: pr }),
    { kind: 'retarget', number: 7, head: 'b'.repeat(40), fromBase: 'feat/parent', toBase: 'dev' });
});

test('carryEvent ignores an edit that leaves the base alone', () => {
  assert.equal(carryEvent({ action: 'edited', changes: { title: { from: 'old' } }, pull_request: pr }), null);
});

test('carryEvent ignores other actions', () => {
  assert.equal(carryEvent({ action: 'opened', pull_request: pr }), null);
});

const trusted = parseTrusted('github-actions[bot],seatsnags-harness[bot],ikkidev');
const approved = { state: 'success', description: 'approved by ikkidev', creator: 'github-actions[bot]' };
const sha = '1234567890abcdef1234567890abcdef12345678';

test('decideCarry carries a trusted success when the changes are the same', () => {
  assert.deepEqual(decideCarry({ prior: approved, priorSha: sha, beforeFp: 'x', afterFp: 'x', trusted }),
    { action: 'success', description: 'carried from 1234567: approved by ikkidev' });
});

test('decideCarry asks for a re-review when the changes differ', () => {
  assert.deepEqual(decideCarry({ prior: approved, priorSha: sha, beforeFp: 'x', afterFp: 'y', trusted }),
    { action: 'failure', description: 'changes since 1234567 (approved by ikkidev); re-review needed' });
});

test('decideCarry does nothing when the prior review was not a success', () => {
  const prior = { ...approved, state: 'failure' };
  assert.deepEqual(decideCarry({ prior, priorSha: sha, beforeFp: 'x', afterFp: 'x', trusted }), { action: 'none' });
});

test('decideCarry does nothing for a success from an untrusted creator', () => {
  const prior = { ...approved, creator: 'mallory' };
  assert.deepEqual(decideCarry({ prior, priorSha: sha, beforeFp: 'x', afterFp: 'x', trusted }), { action: 'none' });
});

test('decideCarry does nothing when there was no prior review', () => {
  assert.deepEqual(decideCarry({ prior: null, priorSha: sha, beforeFp: 'x', afterFp: 'x', trusted }), { action: 'none' });
});

test('decideCarry does nothing when a fingerprint could not be computed', () => {
  assert.deepEqual(decideCarry({ prior: approved, priorSha: sha, beforeFp: 'x', afterFp: null, trusted }), { action: 'none' });
  assert.deepEqual(decideCarry({ prior: approved, priorSha: sha, beforeFp: null, afterFp: 'x', trusted }), { action: 'none' });
});

test('decideCarry keeps carrying a review that was itself carried', () => {
  const prior = { ...approved, description: 'carried from abcdef0: round 1: approved' };
  assert.deepEqual(decideCarry({ prior, priorSha: sha, beforeFp: 'x', afterFp: 'x', trusted }),
    { action: 'success', description: 'carried from 1234567: carried from abcdef0: round 1: approved' });
});

test('parseTrusted trims names and drops empty entries', () => {
  assert.deepEqual([...parseTrusted(' github-actions[bot], ikkidev ,, ')], ['github-actions[bot]', 'ikkidev']);
});
