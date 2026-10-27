import test from 'node:test';
import assert from 'node:assert/strict';
import {compileZ80Prefix,classifyZ80Family,Z80StaticError} from '../src/gngb_z80_static_codegen.mjs';

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

test('ROM-private frontier gives instruction family but never opcode bytes',()=>{
  const examples=new Map([
    [0xcb,'CB_BIT_ROTATE_PREFIX'],[0xed,'ED_EXTENDED_PREFIX'],
    [0xdd,'DD_IX_PREFIX'],[0xfd,'FD_IY_PREFIX'],
    [0x76,'HALT'],[0xfb,'EI'],[0xd3,'IO_PORT'],
    [0x41,'LD_R_R'],[0x06,'LD_R_IMMEDIATE'],
    [0xc5,'PUSH_RR'],[0xe1,'POP_RR'],[0x20,'JR_CONDITIONAL']
  ]);
  for(const [opcode,expected] of examples)
    assert.equal(classifyZ80Family(opcode),expected);
  const rom=new Uint8Array(0x8000);
  rom[0]=0xed;
  const result=compileZ80Prefix(rom);
  assert.deepEqual(result.blockers,[{pc:0,reason:'UNSUPPORTED_Z80_OPCODE',
    family:'ED_EXTENDED_PREFIX'}]);
  assert.doesNotMatch(JSON.stringify(result.blockers),/"opcode"|"bytes"/);
  assert.throws(()=>classifyZ80Family(-1),Z80StaticError);
  assert.throws(()=>classifyZ80Family(256),Z80StaticError);
});
