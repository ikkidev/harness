import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseArgs, parseTier, statusFor } from './review-status.mjs';

const SHA = 'abc1234def5678';

test('parseArgs accepts both verdict words', () => {
  assert.equal(parseArgs(['12', SHA, 'approved']).verdict, 'approved');
  assert.equal(parseArgs(['12', SHA, 'changes-requested']).verdict, 'changes-requested');
});

test('parseArgs rejects any other verdict word', () => {
  assert.throws(() => parseArgs(['12', SHA, 'lgtm']), /verdict/);
});

test('parseArgs defaults round to 1 and parses an explicit round', () => {
  assert.deepEqual(parseArgs(['12', SHA, 'approved']), { pr: 12, sha: SHA, verdict: 'approved', round: 1 });
  assert.equal(parseArgs(['12', SHA, 'approved', '3']).round, 3);
});

test('parseArgs rejects a non-integer PR or round', () => {
  assert.throws(() => parseArgs(['x', SHA, 'approved']), /PR number/);
  assert.throws(() => parseArgs(['12', SHA, 'approved', '1.5']), /round/);
  assert.throws(() => parseArgs(['12', SHA, 'approved', '0']), /round/);
});

test('parseArgs rejects a SHA that is not 7-40 hex chars', () => {
  assert.throws(() => parseArgs(['12', 'abc12', 'approved']), /SHA/);
  assert.throws(() => parseArgs(['12', 'zzzzzzzz', 'approved']), /SHA/);
  assert.throws(() => parseArgs(['12', 'a'.repeat(41), 'approved']), /SHA/);
});

test('statusFor maps verdicts to state and description', () => {
  assert.deepEqual(statusFor({ verdict: 'approved', round: 1 }), { state: 'success', description: 'round 1: approved' });
  assert.deepEqual(statusFor({ verdict: 'changes-requested', round: 2 }), {
    state: 'failure',
    description: 'round 2: changes-requested',
  });
});

test('parseTier reads the tier from a status description', () => {
  assert.equal(parseTier('tier=high'), 'high');
  assert.equal(parseTier('tier=low'), 'low');
  assert.equal(parseTier(''), null);
  assert.equal(parseTier(undefined), null);
});
