import assert from 'node:assert/strict';
import { test } from 'node:test';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
import { existsSync } from 'node:fs';

const path = resolve(process.env.POC_OUT || 'out', 'sprite-init.mjs');
test('generated routine executes without MAME or 6809 emulator', async (t) => {
  if (!existsSync(path)) {
    t.skip('No local ROM-derived output. Run: python3 src/poc.py --rom path/to/gng.zip');
    return;
  }
  const { initializeSpriteRam } = await import(pathToFileURL(path));
  const ram = new Uint8Array(65536).fill(0xa5);
  const result = initializeSpriteRam(ram);
  assert.deepEqual(result, { nextX: 0x1f80, nextY: 0 });
  for (let i = 0x1e00; i < 0x1f80; i++) assert.equal(ram[i], 0xf8);
  assert.equal(ram[0x1dff], 0xa5);
  assert.equal(ram[0x1f80], 0xa5);
  assert.throws(() => initializeSpriteRam(new Uint8Array(100)), RangeError);
});
