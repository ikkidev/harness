import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

/* Catches broken imports and syntax in the bin scripts, which only load in a live run.
   PATH is an empty directory, so no gh or git can run: a script may fail, but never on loading. */
const BIN = fileURLToPath(new URL('../bin/', import.meta.url));
const LOAD_ERROR = /SyntaxError|ReferenceError|does not provide an export named|Cannot find module|ERR_MODULE_NOT_FOUND/;
const NO_VARS = { PATH: mkdtempSync(join(tmpdir(), 'empty-path-')) };

for (const file of readdirSync(BIN).filter((f) => f.endsWith('.mjs'))) {
  test(`bin/${file} loads`, () => {
    const r = spawnSync(process.execPath, [`${BIN}${file}`], { env: NO_VARS, encoding: 'utf8', timeout: 10_000 });
    assert.equal(r.error, undefined);
    assert.doesNotMatch(`${r.stdout}\n${r.stderr}`, LOAD_ERROR);
  });
}
