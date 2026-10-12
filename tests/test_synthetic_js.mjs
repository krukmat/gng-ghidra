import { test } from 'node:test';
import assert from 'node:assert/strict';
import { initializeSpriteRam } from '../out-synthetic/sprite-init.mjs';
test('generated synthetic translation is executable and bounded', () => {
  const memory = new Uint8Array(65536).fill(0xa5);
  const result = initializeSpriteRam(memory);
  assert.deepEqual(result, { nextX: 0x1e28, nextY: 0 });
  for(let addr=0x1e20;addr<0x1e28;addr++)
    assert.equal(memory[addr], addr%2 ? 0x34 : 0x12);
  assert.equal(memory[0x1e1f], 0xa5);
  assert.equal(memory[0x1e28], 0xa5);
});
