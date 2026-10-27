import test from 'node:test';
import assert from 'node:assert/strict';
import {compileZ80Prefix,classifyZ80Family,classifyZ80EdInstruction,Z80StaticError} from '../src/gngb_z80_static_codegen.mjs';

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
  assert.deepEqual(result.blockers,[{pc:0,reason:'UNSUPPORTED_Z80_ED_INSTRUCTION',
    family:'ED_EXTENDED_PREFIX',ed_instruction:'ED_UNASSIGNED_OR_UNDOCUMENTED'}]);
  assert.doesNotMatch(JSON.stringify(result.blockers),/"opcode"|"bytes"/);
  assert.throws(()=>classifyZ80Family(-1),Z80StaticError);
  assert.throws(()=>classifyZ80Family(256),Z80StaticError);
});


test('ED interrupt modes (documented and alias) advance two bytes in eight T-states',async()=>{
  for(const [second,im] of [[0x46,0],[0x4e,0],[0x66,0],[0x6e,0],
                             [0x56,1],[0x76,1],[0x5e,2],[0x7e,2]]) {
    const rom=new Uint8Array(0x8000);
    rom.set([0xed,second,0xcb],0);
    const result=compileZ80Prefix(rom);
    assert.equal(result.compiled,1);
    assert.equal(result.blockers[0].pc,2);
    const module=await import('data:text/javascript,'+encodeURIComponent(result.source));
    const state={pc:0,im:null,t:0};
    module.z80AotBlocks.get(0)(state,{});
    assert.deepEqual([state.pc,state.im,state.t],[2,im,8]);
  }
});

test('ED NEG sign, halfcarry, parity-overflow and undocumented F5/F3 flags',async()=>{
  for(const second of [0x44,0x4c,0x54,0x5c,0x64,0x6c,0x74,0x7c]) {
    const rom=new Uint8Array(0x8000);
    rom.set([0xed,second,0xcb],0);
    const result=compileZ80Prefix(rom);
    assert.equal(result.compiled,1);
    const module=await import('data:text/javascript,'+encodeURIComponent(result.source));
    for(const [a,want,flags] of [[0x80,0x80,0x87],[1,255,0xbb],[0,0,0x42]]) {
      const state={pc:0,a,f:0,t:5};
      module.z80AotBlocks.get(0)(state,{});
      assert.deepEqual([state.pc,state.a,state.f,state.t],[2,want,flags,13]);
    }
  }
});

test('ED LD I,A has 9 T-states and preserves flags',async()=>{
  const rom=new Uint8Array(0x8000);
  rom.set([0xed,0x47,0xcb],0);
  const result=compileZ80Prefix(rom);
  assert.equal(result.compiled,1);
  const module=await import('data:text/javascript,'+encodeURIComponent(result.source));
  const state={pc:0,i:0,a:0x42,f:0x81,t:0};
  module.z80AotBlocks.get(0)(state,{});
  assert.deepEqual([state.pc,state.i,state.f,state.t],[2,0x42,0x81,9]);
});

test('unimplemented ED retains semantic label, no instruction bytes exported',()=>{
  const examples=[[0xb1,'ED_BLOCK_COMPARE'],
                  [0x4d,'ED_RETI'],[0x40,'ED_IN_PORT'],[0x41,'ED_OUT_PORT']];
  for(const [second,expected] of examples){
    assert.equal(classifyZ80EdInstruction(second),expected);
    const rom=new Uint8Array(0x8000);
    rom.set([0xed,second],0);
    const result=compileZ80Prefix(rom);
    assert.deepEqual(result.blockers,[{
      pc:0,reason:'UNSUPPORTED_Z80_ED_INSTRUCTION',
      family:'ED_EXTENDED_PREFIX',ed_instruction:expected
    }]);
    assert.equal(Object.keys(result.blockers[0]).includes('opcode'),false);
  }
});


test('ED 16-bit register-pair instruction classifier respects register selection',()=>{
  for(const [second,kind] of [
    [0x42,'ED_SBC_HL_RR'],[0x52,'ED_SBC_HL_RR'],
    [0x4a,'ED_ADC_HL_RR'],[0x7a,'ED_ADC_HL_RR'],
    [0x43,'ED_LD_DIRECT_RR'],[0x73,'ED_LD_DIRECT_RR'],
    [0x4b,'ED_LD_RR_DIRECT'],[0x7b,'ED_LD_RR_DIRECT']
  ]) assert.equal(classifyZ80EdInstruction(second),kind);
});

test('DJNZ branches on B after wrapping decrement and preserves C, flags and A', async()=>{
  const rom=new Uint8Array(0x8000);
  // LD BC, 0x0107 ; DJNZ +2 -> 0x0007 ; NOP fallthrough ; RET at target.
  rom.set([0x01,0x07,0x01,0x10,0x02,0x00,0x00,0xc9],0);
  const compiled=compileZ80Prefix(rom);
  assert.equal(compiled.blockers.length,0);
  const output=await import('data:text/javascript,'+encodeURIComponent(compiled.source));
  const jump=output.z80AotBlocks.get(3);
  assert.equal(typeof jump,'function');
  const options=[
    {bc:0x0207,expectedBC:0x0107,target:7,cycles:13},
    {bc:0x0107,expectedBC:0x0007,target:5,cycles:8},
    {bc:0x0007,expectedBC:0xff07,target:7,cycles:13}
  ];
  for(const x of options){
    const state={pc:3,bc:x.bc,f:0xd7,a:0x89,t:41};
    jump(state,{});
    assert.deepEqual(
      [state.pc,state.bc,state.f,state.a,state.t],
      [x.target,x.expectedBC,0xd7,0x89,41+x.cycles]
    );
  }
  assert.equal(output.z80AotBlocks.has(5),true);
  assert.equal(output.z80AotBlocks.has(7),true);
});

test('DJNZ negative displacement loops safely, including self-loop',async()=>{
  const rom=new Uint8Array(0x8000);
  rom.set([0x10,0xfe,0xc9],0); // DJNZ -2 (back to PC 0), or fallthrough at 2
  const result=compileZ80Prefix(rom);
  assert.equal(result.blockers.length,0);
  assert.equal(result.compiled,2);
  const module=await import('data:text/javascript,'+encodeURIComponent(result.source));
  const step=module.z80AotBlocks.get(0);
  const state={pc:0,bc:0x0201,t:0,f:0xa5};
  step(state,{});
  assert.deepEqual([state.pc,state.bc,state.t,state.f],[0,0x0101,13,0xa5]);
  step(state,{});
  assert.deepEqual([state.pc,state.bc,state.t,state.f],[2,0x0001,21,0xa5]);
});


test('DEC r decrements all seven registers without collateral state changes',async()=>{
  const cases=[
    {opcode:0x05,key:'bc',expected:0x7f34},
    {opcode:0x0d,key:'bc',expected:0x8033},
    {opcode:0x15,key:'de',expected:0x7f34},
    {opcode:0x1d,key:'de',expected:0x8033},
    {opcode:0x25,key:'hl',expected:0x7f34},
    {opcode:0x2d,key:'hl',expected:0x8033},
    {opcode:0x3d,key:'a',expected:0x7f}
  ];
  for(const {opcode,key,expected} of cases){
    const rom=new Uint8Array(0x8000);
    rom.set([opcode,0xc9],0);
    const compiled=compileZ80Prefix(rom);
    assert.equal(compiled.status,'SUPPORTED_PREFIX_ONLY');
    assert.equal(compiled.compiled,2);
    const generated=await import('data:text/javascript,'+encodeURIComponent(compiled.source));
    const state={pc:0,bc:0x8034,de:0x8034,hl:0x8034,a:0x80,f:1,t:100};
    const prior={...state};
    generated.z80AotBlocks.get(0)(state,{});
    assert.equal(state[key],expected);
    for(const other of ['bc','de','hl','a'])
      if(other!==key)assert.equal(state[other],prior[other]);
    assert.equal(state.pc,1);
    assert.equal(state.t,104);
    assert.equal(state.f,key==='a'||opcode===0x05||opcode===0x15||opcode===0x25?0x3f:0x23);
  }
});

test('DEC 8-bit Z80 flags handle borrow, overflow, zero, sign and carry preservation',async()=>{
  const rom=new Uint8Array(0x8000);
  rom.set([0x3d,0xc9],0);
  const result=compileZ80Prefix(rom);
  const module=await import('data:text/javascript,'+encodeURIComponent(result.source));
  for(const [input,carry,output,flags] of [
    [0x00,1,0xff,0xbb],
    [0x01,1,0x00,0x43],
    [0x80,1,0x7f,0x3f],
    [0x10,1,0x0f,0x1b],
    [0x7f,1,0x7e,0x2b],
    [0x00,0,0xff,0xba],
    [0x01,0,0x00,0x42]
  ]){
    const state={pc:0,a:input,f:carry,t:4};
    module.z80AotBlocks.get(0)(state,{});
    assert.deepEqual([state.a,state.f,state.pc,state.t],[output,flags,1,8]);
  }
});

test('DEC (HL) and INC (HL) use read/modify/write bus timings, 11 T-states',async()=>{
  for(const [opcode,readValue,written,flags] of [
    [0x35,0x00,0xff,0xbb],
    [0x34,0x7f,0x80,0x95]
  ]){
    const rom=new Uint8Array(0x8000);
    rom.set([opcode,0xc9],0);
    const result=compileZ80Prefix(rom);
    assert.equal(result.status,'SUPPORTED_PREFIX_ONLY');
    const module=await import('data:text/javascript,'+encodeURIComponent(result.source));
    const calls=[];
    const bus={
      read8(addr,t){calls.push(['read',addr,t]);return readValue;},
      write8(addr,value,t){calls.push(['write',addr,value,t]);}
    };
    const state={pc:0,bc:0x1234,de:0xabcd,hl:0xc012,a:0x91,f:1,t:20};
    module.z80AotBlocks.get(0)(state,bus);
    assert.deepEqual(calls,[['read',0xc012,24],['write',0xc012,written,28]]);
    assert.deepEqual(
      [state.pc,state.bc,state.de,state.hl,state.a,state.f,state.t],
      [1,0x1234,0xabcd,0xc012,0x91,flags,31]
    );
  }
});

test('INC r handles overflow, halfcarry, sign and unchanged carry',async()=>{
  const rom=new Uint8Array(0x8000);
  rom.set([0x3c,0xc9],0);
  const result=compileZ80Prefix(rom);
  const module=await import('data:text/javascript,'+encodeURIComponent(result.source));
  for(const [input,carry,output,flags] of [
    [0x7f,1,0x80,0x95],
    [0xff,1,0x00,0x51],
    [0x0f,1,0x10,0x11],
    [0x00,1,0x01,0x01],
    [0x7f,0,0x80,0x94],
    [0xff,0,0x00,0x50]
  ]){
    const state={pc:0,a:input,f:carry,t:0};
    module.z80AotBlocks.get(0)(state,{});
    assert.deepEqual([state.pc,state.a,state.f,state.t],[1,output,flags,4]);
  }
});


test('JR NZ/Z/NC/C AOT: both outcomes, zero/carry flag combinations, 7/12 T-states',async()=>{
  const conditions=[
    {opcode:0x20,name:'NZ',bit:0x40,invert:true},
    {opcode:0x28,name:'Z', bit:0x40,invert:false},
    {opcode:0x30,name:'NC',bit:0x01,invert:true},
    {opcode:0x38,name:'C', bit:0x01,invert:false}
  ];
  for(const {opcode,name,bit,invert} of conditions){
    const rom=new Uint8Array(0x8000);
    // JR cond,+2 => PC 4; not taken => PC 2. RET at each edge.
    rom.set([opcode,0x02,0xc9,0x00,0xc9],0);
    const result=compileZ80Prefix(rom);
    assert.equal(result.status,'SUPPORTED_PREFIX_ONLY',name);
    assert.equal(result.blockers.length,0,name);
    const bundle=await import('data:text/javascript,'+encodeURIComponent(result.source));
    assert.equal(bundle.z80AotBlocks.has(2),true,name+' fallthrough present');
    assert.equal(bundle.z80AotBlocks.has(4),true,name+' branch target present');
    assert.equal(bundle.z80AotBlocks.has(0),true,name+' branch source present');
    for(const flags of [0,1,0x40,0x41,0xd7,0xff]){
      const taken=((flags&bit)!==0)!==invert;
      const state={pc:0,f:flags,bc:0x1234,de:0x5678,hl:0x9abc,a:0xde,t:30};
      bundle.z80AotBlocks.get(0)(state,{});
      assert.deepEqual([state.pc,state.f,state.bc,state.de,state.hl,state.a,state.t],
        [taken?4:2,flags,0x1234,0x5678,0x9abc,0xde,30+(taken?12:7)],
        name+' with flags 0x'+flags.toString(16));
    }
  }
});

test('JR conditional signed negative displacement creates a static self-loop and exit',async()=>{
  const rom=new Uint8Array(0x8000);
  rom.set([0x20,0xfe,0xc9],0); // JR NZ,-2 loops; JR NZ not-taken exits at 2
  const result=compileZ80Prefix(rom);
  assert.equal(result.status,'SUPPORTED_PREFIX_ONLY');
  assert.equal(result.compiled,2);
  const module=await import('data:text/javascript,'+encodeURIComponent(result.source));
  const step=module.z80AotBlocks.get(0);
  const state={pc:0,f:0x01,t:100};
  step(state,{});
  assert.deepEqual([state.pc,state.f,state.t],[0,0x01,112]);
  state.f=0x41;
  step(state,{});
  assert.deepEqual([state.pc,state.f,state.t],[2,0x41,119]);
});

test('JR conditional target outside audio ROM is never silently certified',()=>{
  const rom=new Uint8Array(0x8000);
  rom.set([0x20,0xfc,0xc9],0); // negative target = 0xfffe, outside sound ROM
  const result=compileZ80Prefix(rom);
  assert.equal(result.status,'PARTIAL_UNCERTIFIED');
  assert.deepEqual(result.blockers,[{pc:0xfffe,reason:'OUTSIDE_SOUND_ROM'}]);
  assert.equal(result.compiled,2);
});


test('B0 LD r,n compiles all seven register destinations, immediate byte, 7T, no flags',async()=>{
  const cases=[
    [0x06,'bc',0xa534],[0x0e,'bc',0x12a5],
    [0x16,'de',0xa578],[0x1e,'de',0x56a5],
    [0x26,'hl',0xa5bc],[0x2e,'hl',0x9aa5],
    [0x3e,'a',0xa5]
  ];
  for(const [opcode,register,expected] of cases){
    const rom=new Uint8Array(0x8000);
    rom.set([opcode,0xa5,0xc9],0);
    const result=compileZ80Prefix(rom);
    assert.equal(result.status,'SUPPORTED_PREFIX_ONLY');
    assert.equal(result.compiled,2);
    const generated=await import('data:text/javascript,'+encodeURIComponent(result.source));
    const before={pc:0,bc:0x1234,de:0x5678,hl:0x9abc,a:0xfe,
      f:0xd7,t:123,sp:0xc7ff};
    const state={...before};
    const bus={read8(){throw Error('LD_R_IMMEDIATE_READ')},
      write8(){throw Error('LD_R_IMMEDIATE_WRITE')}};
    generated.z80AotBlocks.get(0)(state,bus);
    for(const key of ['bc','de','hl','a'])
      assert.equal(state[key],key===register?expected:before[key],opcode.toString(16));
    assert.equal(state.pc,2);
    assert.equal(state.t,130);
    assert.equal(state.f,0xd7);
    assert.equal(state.sp,0xc7ff);
  }
});

test('B0 LD (HL),n emits a single bus write, 10T, no flag or register change',async()=>{
  const rom=new Uint8Array(0x8000);
  rom.set([0x36,0xe3,0xc9],0);
  const result=compileZ80Prefix(rom);
  assert.equal(result.compiled,2);
  assert.equal(result.status,'SUPPORTED_PREFIX_ONLY');
  const generated=await import('data:text/javascript,'+encodeURIComponent(result.source));
  const state={pc:0,hl:0xc123,bc:0x1111,de:0x2222,a:0x75,f:0x93,t:50};
  const calls=[];
  generated.z80AotBlocks.get(0)(state,{
    read8(){throw Error('UNEXPECTED_READ')},
    write8(addr,val,t){calls.push({addr,val,t})}
  });
  assert.deepEqual(calls,[{addr:0xc123,val:0xe3,t:60}]);
  assert.deepEqual(state,{pc:2,hl:0xc123,bc:0x1111,de:0x2222,a:0x75,f:0x93,t:60});
});

test('B0 LD r,n respects immediate 0x00 / 0xff and refuses truncated ROM instruction',async()=>{
  for(const imm of [0,255]){
    const rom=new Uint8Array(0x8000);
    rom.set([0x3e,imm,0xc9],0);
    const built=compileZ80Prefix(rom);
    const result=await import('data:text/javascript,'+encodeURIComponent(built.source));
    const state={pc:0,a:17,f:0xff,t:0};
    result.z80AotBlocks.get(0)(state,{});
    assert.deepEqual(state,{pc:2,a:imm,f:0xff,t:7});
  }
  const rom=new Uint8Array(0x8000);
  rom[0x7fff]=0x06;
  assert.throws(()=>compileZ80Prefix(rom,{entry:0x7fff}),
    e=>e instanceof Z80StaticError&&e.code==='AUDIO_Z80_ROM_BOUNDARY');
});

test('B1 multiple independent roots expose multiple true frontiers, not blind resync',()=>{
  const rom=new Uint8Array(0x8000);
  rom.set([0xcb,0x11],0x0000);
  rom.set([0xdd,0x21],0x0100);
  rom.set([0xed,0xb1],0x0200);
  const result=compileZ80Prefix(rom,{entries:[0,0x100,0x200,0x100]});
  assert.equal(result.status,'PARTIAL_UNCERTIFIED');
  assert.equal(result.compiled,0);
  assert.equal(result.pending,0);
  assert.deepEqual(result.entrypoints,[0,0x100,0x200]);
  assert.deepEqual(result.blockers,[
    {pc:0,reason:'UNSUPPORTED_Z80_OPCODE',family:'CB_BIT_ROTATE_PREFIX'},
    {pc:0x100,reason:'UNSUPPORTED_Z80_OPCODE',family:'DD_IX_PREFIX',
      indexed_instruction:'INDEX_LD_RR_IMMEDIATE'},
    {pc:0x200,reason:'UNSUPPORTED_Z80_ED_INSTRUCTION',
      family:'ED_EXTENDED_PREFIX',ed_instruction:'ED_BLOCK_COMPARE'}
  ]);
  assert.deepEqual(result.visitedPcs,[]);
});

test('B1 reached static branches reveal multiple blockers; convergence de-duplicates',()=>{
  const rom=new Uint8Array(0x8000);
  // JR NZ,+2 to PC 4; fallthrough PC 2; CB and DD unknown families.
  rom.set([0x20,0x02,0xcb,0x00,0xdd,0x21],0);
  const result=compileZ80Prefix(rom);
  assert.equal(result.compiled,1);
  assert.deepEqual(result.visitedPcs,[0]);
  assert.deepEqual(result.blockers.map(b=>[b.pc,b.family]),[
    [2,'CB_BIT_ROTATE_PREFIX'],[4,'DD_IX_PREFIX']]);
  const merged=compileZ80Prefix(rom,{entries:[0,2,4,2]});
  assert.deepEqual(merged.blockers,result.blockers);
});

test('B1 seed validation, safety cap and no unsupported fallthrough',()=>{
  const rom=new Uint8Array(0x8000);
  for(const entries of [[],Array(65).fill(0),[-1],[0x8000],[0,1.5],['0']])
    assert.throws(()=>compileZ80Prefix(rom,{entries}),Z80StaticError);
  rom.set([0x00,0x00,0x00,0xc9],0);
  const capped=compileZ80Prefix(rom,{entries:[0],limit:2});
  assert.equal(capped.status,'PARTIAL_UNCERTIFIED');
  assert.equal(capped.truncated,true);
  assert.deepEqual(capped.visitedPcs,[0,1]);
  assert.equal(capped.pending,1);
});


test('B2 ED LDI and LDD copy one memory byte with 16T and accurate Z80 flags',async()=>{
  for(const [ed,delta] of [[0xa0,1],[0xa8,-1]]) {
    const rom=new Uint8Array(0x8000);
    rom.set([0xed,ed,0xc9]);
    const c=compileZ80Prefix(rom);
    assert.equal(c.status,'SUPPORTED_PREFIX_ONLY');
    assert.equal(c.compiled,2);
    const {z80AotBlocks}=await import('data:text/javascript,'+encodeURIComponent(c.source));
    const state={pc:0,hl:delta===1?0xffff:0,de:delta===1?0xffff:0,
      bc:2,a:0x11,f:0xc1,t:50};
    const reads=[],writes=[];
    const bus={
      read8(addr,t){reads.push({addr,t});return 0x25},
      write8(addr,value,t){writes.push({addr,value,t})}
    };
    z80AotBlocks.get(0)(state,bus);
    assert.deepEqual(reads,[{addr:delta===1?0xffff:0,t:58}]);
    assert.deepEqual(writes,[{addr:delta===1?0xffff:0,value:0x25,t:61}]);
    assert.deepEqual(state,{pc:2,hl:delta===1?0:0xffff,de:delta===1?0:0xffff,
      bc:1,a:0x11,f:0xe5,t:66});
    assert.equal(z80AotBlocks.has(2),true);
  }
});

test('B2 ED LDIR repeats one transfer per CPU step (21T), then exits (16T)',async()=>{
  const rom=new Uint8Array(0x8000);rom.set([0xed,0xb0,0xc9]);
  const c=compileZ80Prefix(rom);
  assert.equal(c.status,'SUPPORTED_PREFIX_ONLY');
  assert.equal(c.compiled,2);
  const {z80AotBlocks}=await import('data:text/javascript,'+encodeURIComponent(c.source));
  const buffer=new Map([[0xc000,0x25],[0xc001,0x10]]);
  const calls=[];
  const bus={
    read8(addr,t){calls.push(['r',addr,t]);return buffer.get(addr)??0},
    write8(addr,value,t){calls.push(['w',addr,value,t]);buffer.set(addr,value)}
  };
  const s={pc:0,hl:0xc000,de:0xc100,bc:2,a:0x11,f:0x41,t:0};
  z80AotBlocks.get(0)(s,bus);
  assert.deepEqual(s,{pc:0,hl:0xc001,de:0xc101,bc:1,a:0x11,f:0x65,t:21});
  z80AotBlocks.get(0)(s,bus);
  assert.deepEqual(s,{pc:2,hl:0xc002,de:0xc102,bc:0,a:0x11,f:0x41,t:37});
  assert.deepEqual(calls,[
    ['r',0xc000,8],['w',0xc100,0x25,11],
    ['r',0xc001,29],['w',0xc101,0x10,32]
  ]);
  assert.equal(buffer.get(0xc100),0x25);
  assert.equal(buffer.get(0xc101),0x10);
});

test('B2 ED LDDR decrements pointers, wraps BC=0 to 0xffff, and stays repeatable',async()=>{
  const rom=new Uint8Array(0x8000);rom.set([0xed,0xb8,0xc9]);
  const c=compileZ80Prefix(rom);
  assert.equal(c.status,'SUPPORTED_PREFIX_ONLY');
  const {z80AotBlocks}=await import('data:text/javascript,'+encodeURIComponent(c.source));
  const calls=[];
  const state={pc:0,hl:0,de:0,bc:0,a:0,f:0xff,t:9};
  z80AotBlocks.get(0)(state,{
    read8(addr,t){calls.push(['r',addr,t]);return 0},
    write8(addr,value,t){calls.push(['w',addr,value,t])}
  });
  assert.deepEqual(state,{pc:0,hl:0xffff,de:0xffff,bc:0xffff,a:0,f:0xc5,t:30});
  assert.deepEqual(calls,[['r',0,17],['w',0,0,20]]);
});

test('B2 ED block transfer undocumented F3/F5 derive from A+byte, not the byte alone',async()=>{
  const rom=new Uint8Array(0x8000);rom.set([0xed,0xa0,0xc9]);
  const c=compileZ80Prefix(rom);
  const {z80AotBlocks}=await import('data:text/javascript,'+encodeURIComponent(c.source));
  for(const [a,byte,bc,f,expected] of [
    [0x00,0x00,1,0xff,0xc1],
    [0x01,0x01,2,0x00,0x24],
    [0x06,0x02,1,0xff,0xc9],
    [0xfd,0x05,2,0x00,0x24]
  ]) {
    const s={pc:0,a,bc,hl:0xc000,de:0xc001,f,t:0};
    z80AotBlocks.get(0)(s,{read8(){return byte},write8(){}});
    assert.equal(s.f,expected);
    assert.equal(s.f&0xc1,f&0xc1);
  }
});
