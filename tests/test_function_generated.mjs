import assert from 'node:assert/strict';
import { test } from 'node:test';
import { runRoutine as write } from '../out-synthetic/functions/generated/routine_7000.mjs';
import { runRoutine as counter } from '../out-synthetic/functions/generated/routine_7010.mjs';
import { runRoutine as addition } from '../out-synthetic/functions/generated/routine_7020.mjs';

test('typed P-code STORE writes one byte to RAM', () => {
  const mem=new Uint8Array(65536).fill(0x77);
  const { steps, registers }=write(mem);
  assert.equal(steps,1);
  assert.equal(mem[0x1e00],0xab);
  assert.equal(mem[0x1dff],0x77);
  assert.equal(mem[0x1e01],0x77);
  assert.equal(registers[0],0x1e);
  assert.equal(registers[1],0);
});
test('P-code conditional loop runs four iterations and terminates', () => {
  const mem=new Uint8Array(65536);
  const { steps, registers }=counter(mem);
  assert.equal(steps,6);
  assert.equal(registers[10],0);
  assert.equal(registers[11],0);
  assert.throws(() => counter(mem,new Uint8Array(256),3), /budget exceeded/);
});
test('big endian LOAD/STORE and INT_ADD preserve word width', () => {
  const mem=new Uint8Array(65536);
  mem[0x2000]=0xff; mem[0x2001]=0xff;
  addition(mem);
  assert.equal(mem[0x2000],0);
  assert.equal(mem[0x2001],0);
});