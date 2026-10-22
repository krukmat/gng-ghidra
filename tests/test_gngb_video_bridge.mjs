import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdir,mkdtemp,writeFile,rm} from 'node:fs/promises';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {compileAt,emitStaticModule} from '../scripts/r3_static_trace_probe.mjs';
import {replayNativeVerifiedVideoToBoard} from '../src/gngb_video_bridge.mjs';

const pcs=[0x6041,0x6043,0x6055,0x6057];
const rom=()=>{
  const image=new Uint8Array(65536);
  image[0xfffe]=0x60;image[0xffff]=0;
  for(const [pc,opcode,index] of [[0x6041,0xa7,0x80],
    [0x6043,0xe7,0xa0],[0x6055,0xe7,0x80],[0x6057,0xa7,0xa0]])
    image.set([opcode,index],pc);
  return image;
};
const regs=(PC,X=0x2000,Y=0x2800,CC=0,A=0x12,B=0x80)=>({
  PC,X,Y,CC,A,B,U:0,S:0x4000,DP:0
});
const makeRows=()=>{
  const rows=[];
  const add=state=>rows.push({schema:'gng.r2.pre-instruction.v1',
    kind:'pre_instruction',origin:'mame-native-tracelog',
    seq:rows.length,pc:state.PC,before:state});
  add(regs(0x6016));add(regs(0x6000));
  add(regs(0x6016));add(regs(0x6017));
  for(let i=0;i<1024;i++){
    add(regs(0x6041,0x2000+i,0x2800+i));
    add(regs(0x6043,0x2001+i,0x2800+i));
    add(regs(0x6045,0x2001+i,0x2801+i,8));
  }
  for(let i=0;i<1024;i++){
    add(regs(0x6055,0x2400+i,0x2c00+i));
    add(regs(0x6057,0x2401+i,0x2c00+i,8));
    add(regs(0x6059,0x2401+i,0x2c01+i));
  }
  return rows;
};
const nativeVideo=()=>{
  const events=[];
  for(let i=0;i<1024;i++){
    events.push({address:0x2000+i,data:0x12,mask:255});
    events.push({address:0x2800+i,data:0x80,mask:255});
  }
  for(let i=0;i<1024;i++){
    events.push({address:0x2400+i,data:0x80,mask:255});
    events.push({address:0x2c00+i,data:0x12,mask:255});
  }
  return events;
};
const nativeGate=()=>({
  status:'NATIVE_VIDEO_WRITES_MATCH_GENERATED_STATIC_JS',
  native_segment_uniquely_matched:true,
  matched_native_video_byte_writes:4096,
  native_video_writes_before_reset:0,
  native_video_writes_after_reset:4096
});
const sync=()=>({status:'SYNC_BYTE_AND_WAIT_BARRIER_PREPARED',
  epochs:[{}, {sync_prestate_seq:2}]});
async function fixture(fn){
  await mkdir('out/r3',{recursive:true});
  const dir=await mkdtemp(resolve('out/r3/a05-bridge-'));
  try{
    const image=rom();
    const specs=pcs.map(pc=>compileAt(image,pc));
    assert.ok(specs.every(x=>x?.writesRamByte));
    const js=emitStaticModule(specs);
    assert.doesNotMatch(js,/opcodeTable|decodeOpcode|interpreterLoop/);
    const path=resolve(dir,'generated-static.mjs');
    await writeFile(path,js);
    const {compiledStep}=await import(pathToFileURL(path).href);
    return await fn({rows:makeRows(),sync:sync(),compiledStep,
      nativeVideoWrites:nativeVideo(),nativeGate:nativeGate()});
  } finally {await rm(dir,{recursive:true,force:true});}
}
test('native write-gated 4,096 static CPU stores yield 4,096 identical board VRAM bytes and 2,048 decoded tiles',async()=>{
  await fixture(args=>{
    const result=replayNativeVerifiedVideoToBoard(args);
    assert.equal(result.status,'NATIVE_VRAM_IMAGE_MATCHED_STATIC_JS_BOARD_AND_TILE_DECODER');
    assert.equal(result.generated_static_js_video_steps_applied,4096);
    assert.equal(result.native_final_video_ram_bytes_equal_generated_board,4096);
    assert.equal(result.foreground_ram_bytes,2048);
    assert.equal(result.background_ram_bytes,2048);
    assert.equal(result.existing_tile_decoder_records_verified,2048);
    assert.equal(result.js_cpu_execution_autonomous_from_reset,false);
    assert.equal(result.pixels_or_frames_rendered_or_compared,false);
    assert.equal(result.game_playable,false);
    assert.doesNotMatch(JSON.stringify(result),/"data"|"address"|"A"|"B"/);
  });
});
test('cannot replay without independent real VRAM bus gate, valid epoch or all 4096 events',async()=>{
  await fixture(args=>{
    assert.throws(()=>replayNativeVerifiedVideoToBoard({
      ...args,nativeGate:{...args.nativeGate,native_segment_uniquely_matched:false}
    }),/A05_NATIVE_A04_BUS_GATE_REQUIRED/);
    assert.throws(()=>replayNativeVerifiedVideoToBoard({
      ...args,sync:{status:'SYNC_BYTE_AND_WAIT_BARRIER_PREPARED',epochs:[]}
    }),/A05_MISSING_PRIVATE_REPLAY_INPUT/);
    assert.throws(()=>replayNativeVerifiedVideoToBoard({
      ...args,nativeVideoWrites:args.nativeVideoWrites.slice(1)
    }),/A05_MISSING_PRIVATE_REPLAY_INPUT/);
  });
});
test('VRAM duplicate, address outside range and byte-mask mismatch fail closed',async()=>{
  await fixture(args=>{
    const errors=[
      {address:args.nativeVideoWrites[1].address},
      {address:0x3000},
      {data:256},
      {mask:0}
    ];
    for(const patch of errors){
      const changed=args.nativeVideoWrites.map(x=>({...x}));
      Object.assign(changed[0],patch);
      assert.throws(()=>replayNativeVerifiedVideoToBoard({
        ...args,nativeVideoWrites:changed
      }),/A05_INVALID_NATIVE_VIDEO_EVENT|A05_DUPLICATED_OR_MISSING_VRAM_ADDRESS/);
    }
  });
});
test('native VRAM wrong data fails independent final memory comparison',async()=>{
  await fixture(args=>{
    const changed=args.nativeVideoWrites.map(x=>({...x}));
    changed[3900].data^=1;
    assert.throws(()=>replayNativeVerifiedVideoToBoard({...args,
      nativeVideoWrites:changed}),/A05_BOARD_VIDEO_BYTE_DIFFERS_FROM_NATIVE/);
  });
});
test('a mismatched native next PC/register blocks replay, never counts as a frame',async()=>{
  await fixture(args=>{
    const rows=makeRows();rows[5].before.X+=3;
    assert.throws(()=>replayNativeVerifiedVideoToBoard({...args,rows}),
      /A05_STATIC_STEP_NATIVE_REGISTER_DIVERGENCE/);
    const changed=makeRows();changed[5].seq=2;
    assert.throws(()=>replayNativeVerifiedVideoToBoard({...args,rows:changed}),
      /A05_NATIVE_CHECKPOINT_SEQUENCE_INVALID/);
  });
});
