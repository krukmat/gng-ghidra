import test from 'node:test';
import assert from 'node:assert/strict';
import {compileZ80Prefix,Z80StaticError} from '../src/gngb_z80_static_codegen.mjs';

test('compiled instructions are static JavaScript with private ROM provenance',()=>{
  const rom=new Uint8Array(0x8000);
  // JP 0100 ; LD SP,c7ff ; LD A,42 ; LD (e001),A ; RET.
  rom.set([0xc3,0x00,0x01],0);
  rom.set([0x31,0xff,0xc7,0x3e,0x42,0x32,0x01,0xe0,0xc9],0x100);
  const x=compileZ80Prefix(rom);
  assert.equal(x.status,'SUPPORTED_PREFIX_ONLY');
  assert.equal(x.compiled,5);
  assert.match(x.source,/bus.write8\(57345,\$\.a,\$\.t\+13\)/);
  assert.doesNotMatch(x.source,/decodeOpcode|eval\(/);
});
test('unsupported opcode is an explicit blocked frontier',()=>{
  const rom=new Uint8Array(0x8000);
  rom[0]=0xcb; // Z80 CB-prefixed family intentionally not yet implemented
  const x=compileZ80Prefix(rom);
  assert.equal(x.status,'PARTIAL_UNCERTIFIED');
  assert.equal(x.compiled,0);
  assert.equal(x.blockers[0].pc,0);
});
test('invalid ROM images or run limits fail closed',()=>{
  assert.throws(()=>compileZ80Prefix(new Uint8Array(10)),Z80StaticError);
  assert.throws(()=>compileZ80Prefix(new Uint8Array(0x8000),{limit:0}),Z80StaticError);
});
