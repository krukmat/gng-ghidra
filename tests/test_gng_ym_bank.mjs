import {test} from 'node:test';
import assert from 'node:assert/strict';
import {existsSync,readFileSync} from 'node:fs';
import {dirname,join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {loadYm2203} from '../src/ao_ym2203_wasm.mjs';
import {createGngYm} from '../boards/gng/audio/ym2203.mjs';
import {applyCommand} from '../src/ao_audio_commands.mjs';

// ROM-free: the GnG wiring of the base YM2203 bank against the reference
// dual-YM WASM on synthetic register streams, including GYM1 cross restore.
const ROOT=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const REFERENCE=join(ROOT,'out/android/audio/ym2203.wasm');
const BANK=join(ROOT,'out/android/ym2203-bank/ym2203.wasm');
const skip=!existsSync(REFERENCE)?'run scripts/ao_build_audio_wasm.sh':
  !existsSync(BANK)?'build base/src/devices/ym2203 into out/android/ym2203-bank':false;

const W=(tick,a,value)=>({kind:'W',tick,addr:0xe000+a,value});
const setup=[[0x28,0],[0xa4,0x22],[0xa0,0x69],[0xb0,0x32],[0x30,0x71],
  [0x40,0x05],[0x50,0x1f],[0x28,0x10]].flatMap(([r,v])=>[W(0,0,r),W(0,1,v)])
  .concat([[0,64],[1,0],[7,62],[8,15]].flatMap(([r,v])=>[W(0,2,r),W(0,3,v)]));
function stream(seed){
  const rnd=n=>(seed=(seed*1103515245+12345)>>>0)%n;
  const out=[...setup];let t=0;
  for(let i=0;i<300;i++){
    const k=rnd(10);
    if(k<7){const chip=rnd(2);out.push(W(t,chip*2,rnd(256)),W(t,chip*2+1,rnd(256)));}
    else if(k<9)out.push({kind:'U',tick:t+=rnd(60000)+1});
    else out.push({kind:'R',tick:t});
  }
  out.push({kind:'U',tick:t+192});
  return out;
}
async function run(make,commands,from=null){
  const ym=await make();
  const blocks=[];
  try{
    if(from)ym.load(from);
    for(const c of commands){
      const b=applyCommand(ym,c);
      if(b)blocks.push([b.firstSample,Buffer.from(b.samples.buffer).toString('base64')]);
    }
    return {blocks,code:null,state:ym.save()};
  }catch(e){return {blocks,code:e.code};}
  finally{ym.destroy();}
}

test('GnG bank equals the reference synthesizer and its GYM1 bytes',{skip},async()=>{
  const reference=await loadYm2203(readFileSync(REFERENCE));
  const bank=readFileSync(BANK);
  const ref=()=>reference.create(),gng=()=>createGngYm(bank);
  for(const seed of [1,2,3]){
    const commands=stream(seed);
    const [a,b]=[await run(ref,commands),await run(gng,commands)];
    assert.deepEqual(b.blocks,a.blocks);
    assert.ok(Buffer.from(a.state).equals(Buffer.from(b.state)));
    // Save at a render on one build, continue on the other.
    const cut=commands.findIndex((c,i)=>c.kind==='U'&&i>commands.length/2);
    const head=await run(ref,commands.slice(0,cut+1));
    const tail=await run(gng,commands.slice(cut+1),head.state);
    assert.deepEqual(tail.blocks,a.blocks.slice(a.blocks.length-tail.blocks.length));
  }
});
test('GnG decode stops outside 0xe000-0xe003 like the reference',{skip},async()=>{
  const ym=await createGngYm(readFileSync(BANK));
  assert.equal(ym.sampleRate,62500);
  assert.throws(()=>ym.write(10,0xe004,0),{code:'AUDIO_YM_WRITE_INVALID'});
  assert.throws(()=>ym.render(192),{code:'AUDIO_YM_STOPPED'});
  ym.destroy();
  // Odd addresses convert like the reference's i32 parameter.
  const reference=await loadYm2203(readFileSync(REFERENCE)),bank=readFileSync(BANK);
  const code=(chip,addr)=>{
    try{chip.write(10,addr,0);return null;}catch(e){return e.code;}finally{chip.destroy();}
  };
  for(const addr of [NaN,undefined,Infinity,'x',0xdfff+0.5,0xe003+0.5,0xe000+2**32])
    assert.equal(code(await createGngYm(bank),addr),code(reference.create(),addr),String(addr));
});
