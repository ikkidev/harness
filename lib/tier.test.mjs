import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parse } from 'yaml';
import { resolveTier } from './tier.mjs';

const config = {
  default: 'normal',
  tiers: { high: ['src/server/**', '.github/**'], low: ['docs/**', '**/*.md'] },
};

test('one high path among ten low paths resolves high', () => {
  const paths = Array.from({ length: 10 }, (_, i) => `docs/page-${i}.md`);
  paths.push('src/server/auth.rb');
  assert.equal(resolveTier(paths, config), 'high');
});

test('unmatched path resolves to the default tier', () => {
  assert.equal(resolveTier(['lib/other.js'], config), 'normal');
});

test('empty list resolves to the default tier', () => {
  assert.equal(resolveTier([], config), 'normal');
});

test('all-low paths resolve low', () => {
  assert.equal(resolveTier(['docs/a.md', 'README.md'], config), 'low');
});

test('a path matching several tiers takes the highest', () => {
  const cfg = { default: 'low', tiers: { high: ['src/**'], normal: ['**/*.md'], low: ['**'] } };
  assert.equal(resolveTier(['src/notes.md'], cfg), 'high');
  assert.equal(resolveTier(['notes.md'], cfg), 'normal');
});

test('explicit normal list beats a low match', () => {
  const cfg = { default: 'low', tiers: { normal: ['app/**'], low: ['**'] } };
  assert.equal(resolveTier(['app/x.ts'], cfg), 'normal');
});

test('dotfile paths match with dot: true', () => {
  assert.equal(resolveTier(['.github/workflows/ci.yml'], config), 'high');
});

test('template marks .github, harness.yml and CODEOWNERS high', () => {
  const template = parse(readFileSync(new URL('../templates/harness.yml', import.meta.url), 'utf8'));
  for (const p of ['.github/workflows/ci.yml', 'harness.yml', 'CODEOWNERS']) {
    assert.equal(resolveTier([p], template), 'high', p);
  }
});
