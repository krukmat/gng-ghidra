// Verify the real-ROM boot PREFIX ONLY, using an independently-decoded memory invariant.
import assert from 'node:assert/strict';
import { runRoutine } from '../out/generated/boot-prefix.mjs';
const memory = new Uint8Array(65536).fill(0xa5);
const initial = memory.slice();
const result = runRoutine(memory, new Uint8Array(256), 10000);
assert.equal(result.pc, 0x6016, 'must suspend before SYNC');
assert.equal(result.status, 'suspended-before-SYNC');
for (let address = 0; address < memory.length; address++) {
  const expected = address >= 0x1e00 && address < 0x1f80 ? 0xf8 : initial[address];
  assert.equal(memory[address], expected, 'memory differs at 0x' + address.toString(16));
}
console.log('GNG_BOOT_PREFIX_MEMORY=PASS steps=' + result.steps + ' bytes_written=384 boundary=0x6016');
