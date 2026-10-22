import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,rm,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {compileAt,compileUnaryReg,compileShortBranch,emitStaticModule}
  from '../scripts/r3_static_trace_probe.mjs';

function privateRom(){
  const rom=new Uint8Array(65536);
  rom[0xfffe]=0x60;rom[0xffff]=0;
  return rom;
}
function regs(pc,A=0,B=0,CC=0,X=0){
  return {PC:pc,A,B,X,Y:0,U:0,S:0x2000,DP:0,CC};
}
async function generated(rom,pcs,callback){
  await mkdir('out/r3',{recursive:true});
  const dir=await mkdtemp(resolve('out/r3/a0-families-'));
  try{
    const specs=pcs.map(pc=>compileAt(rom,pc));
    assert.ok(specs.every(Boolean),'every candidate must be statically supported');
    const file=resolve(dir,'generated-family-batch.mjs');
    const source=emitStaticModule(specs);
    assert.doesNotMatch(source,/rom\[r.PC\]|decodeOpcode|interpreter|opcodeTable/);
    await writeFile(file,source);
    const {compiledStep}=await import(pathToFileURL(file).href);
    await callback(compiledStep,specs,source);
  }finally{await rm(dir,{recursive:true,force:true});}
}
const allowed=new Map([
  [0,'NEG'],[3,'COM'],[4,'LSR'],[6,'ROR'],[7,'ASR'],
  [8,'ASL'],[9,'ROL'],[10,'DEC'],[12,'INC'],[13,'TST'],[15,'CLR']
]);
function unaryOracle(code,v,cc){
  const n=code&15;
  let value=v,carry=cc&1,overflow=cc&2;
  if(n===0){value=(-v)&255;carry=v===0?0:1;overflow=v===128?2:0;}
  else if(n===3){value=(~v)&255;carry=1;overflow=0;}
  else if(n===4){carry=v&1;value=v>>>1;}
  else if(n===6){carry=v&1;value=(v>>>1)|((cc&1)<<7);}
  else if(n===7){carry=v&1;value=(v>>>1)|(v&128);}
  else if(n===8){carry=(v>>7)&1;value=(v*2)&255;
    overflow=(((v^value)&128)!==0)?2:0;}
  else if(n===9){carry=(v>>7)&1;value=((v<<1)|(cc&1))&255;
    overflow=(((v^value)&128)!==0)?2:0;}
  else if(n===10){value=(v+255)&255;overflow=v===128?2:0;}
  else if(n===12){value=(v+1)&255;overflow=v===127?2:0;}
  else if(n===13){overflow=0;}
  else if(n===15){value=0;carry=0;overflow=0;}
  const nz=(value===0?4:0)|((value&128)?8:0);
  let mask=0x0e; // N/Z/V, carry remains for INC DEC TST.
  if([0,3,4,6,7,8,9,15].includes(n))mask|=1;
  const bits=nz|overflow|carry;
  return {value,cc:(cc&~mask)|(bits&mask)};
}
test('A0.2: compile every documented A/B unary opcode, and reject invalid slots',()=>{
  const r=privateRom(),pcs=[];
  for(let bank=0;bank<2;bank++){
    for(let n=0;n<16;n++){
      const op=0x40+(bank<<4)+n,pc=0x6100+bank*64+n*2;
      r[pc]=op;
      const spec=compileAt(r,pc);
      if(allowed.has(n)){
        assert.equal(spec?.name,allowed.get(n)+'_'+(bank?'B':'A'));
        assert.equal(spec?.len,1);
        pcs.push(pc);
      }else{
        assert.equal(compileUnaryReg(op),null);
        assert.equal(spec,null);
      }
    }
  }
  assert.equal(pcs.length,22);
});
test('A0.2: 22 generated unary variants agree with independent 8-bit flag oracle',async()=>{
  const r=privateRom(),pcs=[],opByPc=new Map();
  for(const bank of [0,1]){
    for(const n of allowed.keys()){
      const pc=0x6100+bank*64+n*2,op=0x40+(bank<<4)+n;
      r[pc]=op;pcs.push(pc);opByPc.set(pc,op);
    }
  }
  await generated(r,pcs,compiledStep=>{
    const ccs=[0,1,2,0x10,0x21,0x40,0x81,0xff];
    let compared=0;
    for(const pc of pcs){
      const op=opByPc.get(pc),onB=op>=0x50;
      for(let value=0;value<256;value++){
        for(const cc of ccs){
          const before=regs(pc,onB?0xa7:value,onB?value:0x39,cc,0x2345);
          const expected=unaryOracle(op,value,cc);
          const after=compiledStep(before);
          assert.equal(after.PC,pc+1,'PC increments by one');
          assert.equal(after.CC,expected.cc,
            'CC mismatched opcode='+op.toString(16)+' data='+value+' cc='+cc);
          assert.equal(onB?after.B:after.A,expected.value,
            '8-bit result mismatched opcode='+op.toString(16)+' data='+value);
          assert.equal(onB?after.A:after.B,onB?0xa7:0x39);
          assert.equal(after.X,0x2345);
          assert.equal(before.PC,pc);
          compared++;
        }
      }
    }
    assert.equal(compared,45056);
  });
});
function branchCondition(low,cc){
  const C=(cc&1)!==0,V=(cc&2)!==0,Z=(cc&4)!==0,N=(cc&8)!==0;
  switch(low){
    case 0:return true;case 1:return false;
    case 2:return !C&&!Z;case 3:return C||Z;
    case 4:return !C;case 5:return C;
    case 6:return !Z;case 7:return Z;
    case 8:return !V;case 9:return V;
    case 10:return !N;case 11:return N;
    case 12:return N===V;case 13:return N!==V;
    case 14:return !Z&&N===V;case 15:return Z||N!==V;
  }
}
test('A0.2: all 16 short-branch conditions use compile-time predicates (every CC)',async()=>{
  const r=privateRom(),pcs=[];
  for(let low=0;low<16;low++){
    const pc=0x6300+low*8;
    r.set([0x20+low,0xfc],pc);
    pcs.push(pc);
  }
  await generated(r,pcs,(compiledStep,specs)=>{
    assert.equal(specs.length,16);
    let count=0;
    for(const pc of pcs){
      const op=r[pc],low=op&15;
      for(let cc=0;cc<=255;cc++){
        const before=regs(pc,0x8a,0x31,cc,0x1234);
        const expectedPc=branchCondition(low,cc)?(pc-2):pc+2;
        const after=compiledStep(before);
        assert.deepEqual(after,{...before,PC:expectedPc},
          'branch opcode='+op.toString(16)+' cc='+cc);
        count++;
      }
    }
    assert.equal(count,4096);
  });
  assert.equal(compileShortBranch(0x1f,0x6000,0),null);
  assert.equal(compileShortBranch(0x30,0x6000,0),null);
});
test('A0.2: CMPX immediate preserves X and models signed overflow/unsigned carry',async()=>{
  const r=privateRom();
  const cases=[{pc:0x6500,operand:0x8000},
    {pc:0x6504,operand:0x7fff},
    {pc:0x6508,operand:0x0000}];
  for(const {pc,operand} of cases){
    r.set([0x8c,operand>>8,operand&255],pc);
  }
  await generated(r,cases.map(c=>c.pc),compiledStep=>{
    let compared=0;
    for(const {pc,operand} of cases){
      for(const X of [0,1,0x7fff,0x8000,0xffff,operand]){
        for(const CC of [0,0x10,0x20,0xff]){
          const before=regs(pc,20,30,CC,X);
          const delta=(X-operand)&65535;
          const flags=((delta&0x8000)?8:0)|(delta===0?4:0)|
            (((X^operand)&(X^delta)&0x8000)?2:0)|
            (X<operand?1:0);
          const after=compiledStep(before);
          assert.deepEqual(after,{...before,PC:pc+3,
            CC:(CC&~15)|flags});
          compared++;
        }
      }
    }
    assert.equal(compared,72);
  });
});
test('A0.2: opcode-family support does not imply bus or game runtime coverage',()=>{
  const r=privateRom();
  r[0x601d]=0x4a; // synthetic: DECA, not asserted real ROM opcode
  assert.equal(compileAt(r,0x601d).name,'DEC_A');
  assert.equal(compileAt(r,0x601d).writesSpriteWord,false);
  r[0x6041]=0xa7;
  assert.equal(compileAt(r,0x6041),null);
  r[0x6055]=0xe7;
  assert.equal(compileAt(r,0x6055),null);
});
