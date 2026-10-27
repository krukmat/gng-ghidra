import {test} from 'node:test';
import assert from 'node:assert/strict';
import {findJumpTables,jumpTableSeeds} from '../src/v3_b3_jump_tables.mjs';

function image(bytesAt){
  const fixed=new Uint8Array(0x10000),banks=new Uint8Array(5*0x2000);
  for(const [a,bytes] of bytesAt){
    if(a>=0x6000)fixed.set(bytes,a);else banks.set(bytes,3*0x2000+a-0x4000);
  }
  return {fixed,banks,ramOverlays:[]};
}

test('object dispatch table (GnG 0xEAC0 shape) yields every handler', () => {
  // 0x8000: LDB 5,X; ASLB; LDU #$8008; JMP [B,U]; table of 3; code at 0x800e
  const code=image([[0x8000,[0xe6,0x05,0x58,0xce,0x80,0x08,0x6e,0xd5,
    0x80,0x0e,0x80,0x20,0x80,0x0e, 0x39]]]);
  const [t]=findJumpTables(code);
  assert.equal(t.site,0x8006);
  assert.equal(t.base,0x8008);
  assert.deepEqual(t.targets,[0x800e,0x8020,0x800e]);
  assert.deepEqual(jumpTableSeeds(code),[{bank:null,pc:0x800e},{bank:null,pc:0x8020}]);
});

test('banked table keeps its bank; fixed sites never seed banked targets', () => {
  // bank 3 at 0x5000: LDX #$5006; JSR [A,X]; table -> 0x5010 (banked), 0x9000 (fixed)
  const code=image([[0x5000,[0x8e,0x50,0x06,0xad,0x96,0x39,0x50,0x10,0x90,0x00,0x00,0x00]],
    // fixed: LDY #$7006; JMP [B,Y]; table word 0x5000 is not fixed code: no table
    [0x7000,[0x10,0x8e,0x70,0x06,0x6e,0xb5,0x50,0x00]]]);
  assert.deepEqual(jumpTableSeeds(code),[{bank:3,pc:0x5010},{bank:null,pc:0x9000}]);
});
