import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {mkdir,mkdtemp,writeFile,readFile,rm} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {r42gBootstrapDigest} from '../src/r42g_incremental_timeline.mjs';
import {runR42gLocal,readR42gJsonlLines} from '../scripts/r42g_replay_timeline.mjs';

function seed(){
  const out={
    schema:'gng.r42g.bootstrap.v1',origin:'LAB_SYNTHETIC',
    sprite_ram:new Uint8Array(512).fill(0xf8),
    video_ram:new Uint8Array(4096),
    palette_ext:new Uint8Array(256),
    palette_base:new Uint8Array(256),
    scroll_bytes:new Uint8Array(4)
  };
  out.sha256=r42gBootstrapDigest(out);
  return out;
}
function linesAndManifest(){
  const base={frame:600,raster_vpos:null,raster_hpos:null,raster_unobserved:true};
  const events=[
    {seq:0,kind:'DMA',address:0x3c00,data:0,mask:255,emu_seconds:0.5,...base},
    {seq:1,kind:'CHECKPOINT',address:null,data:null,mask:null,
      emu_seconds:0.6,...base}
  ];
  const lines=events.map(e=>JSON.stringify(e)+'\n').join('');
  const digest=createHash('sha256').update(lines).digest('hex');
  const timeline={
    schema:'gng.r42f.native-timeline-validation.v1',
    status:'STRUCTURAL_TIMELINE_VERIFIED_ORIGIN_UNATTESTED',
    source:'MAME_LUA_WRITE_TAP_CLAIM_UNATTESTED',
    run_id:'a'.repeat(32),driver:'gngb',target_frame:600,last_frame:600,
    events:2,writes:0,dma:1,checkpoints:1,jsonl_sha256:digest,
    metadata_sha256:'1'.repeat(64),
    coverage:'POST_AUTOBOOT_TAP_INSTALL_ONLY',
    raster_precision:'UNAVAILABLE_LUA_DOCUMENTED_API',
    instruction_alignment_verified:false,bank_identity_verified:false,
    native_vblank_alignment_verified:false,native_pixel_equivalence_verified:false
  };
  return {lines,manifest:{
    schema:'gng.mame-video-capture.v1',r42f_native_timeline:timeline}};
}
async function makeDirectory(){
  const root=resolve('out/r3');await mkdir(root,{recursive:true});
  return mkdtemp(join(root,'r42g-synthetic-cli-'));
}
async function writeFixture(dir){
  const src=linesAndManifest(),ref=join(dir,'reference'),out=join(dir,'aggregate.json');
  await mkdir(ref);
  await writeFile(join(ref,'manifest.json'),JSON.stringify(src.manifest));
  await writeFile(join(ref,'r42f-native-events.jsonl'),src.lines);
  const s=seed(),serialized={schema:s.schema,origin:s.origin,sha256:s.sha256};
  for(const key of ['sprite_ram','video_ram','palette_ext','palette_base','scroll_bytes'])
    serialized[key]=Buffer.from(s[key]).toString('base64');
  const seedFile=join(dir,'seed.json');
  await writeFile(seedFile,JSON.stringify(serialized));
  return {ref,seedFile,out};
}
test('G3/G5 private CLI streams valid synthetic JSONL and writes aggregate only',async()=>{
  const dir=await makeDirectory();
  try{
    const f=await writeFixture(dir);
    const result=await runR42gLocal({
      referenceDir:f.ref,bootstrapPath:f.seedFile,outputPath:f.out
    });
    assert.equal(result.status,'STATE_REPLAYED_TEMPORAL_PROOF_MISSING');
    assert.equal(result.event_count,2);
    assert.equal(result.bootstrap_origin,'LAB_SYNTHETIC');
    assert.equal(result.native_origin_attested,false);
    const report=JSON.parse(await readFile(f.out,'utf8'));
    assert.equal(report.status,result.status);
    assert.match(report.components.buffered_sprite_sha256,/^[a-f0-9]{64}$/);
    assert.equal(report.native_pixel_equivalence_verified,false);
    assert.ok(!('events' in report));
  }finally{await rm(dir,{recursive:true,force:true});}
});
test('G3/G5 rejects stale SHA, absent bootstrap and unvalidated F manifest',async()=>{
  const dir=await makeDirectory();
  try{
    const f=await writeFixture(dir);
    await assert.rejects(runR42gLocal({referenceDir:f.ref,outputPath:f.out}),
      /R42G_DMA_SOURCE_MISSING_PRETAP_BYTES/);
    await writeFile(join(f.ref,'r42f-native-events.jsonl'),
      linesAndManifest().lines.replace('"data":0','"data":1'));
    await assert.rejects(runR42gLocal({
      referenceDir:f.ref,bootstrapPath:f.seedFile,outputPath:f.out
    }),/R42G_TRACE_OR_DIGEST_MISMATCH/);
    await writeFile(join(f.ref,'manifest.json'),'{}');
    await assert.rejects(runR42gLocal({
      referenceDir:f.ref,bootstrapPath:f.seedFile,outputPath:f.out
    }),/R42G_F_VALIDATED_MANIFEST_REQUIRED/);
  }finally{await rm(dir,{recursive:true,force:true});}
});
test('G5 reject any input/output path outside private ignored out',async()=>{
  await assert.rejects(runR42gLocal({referenceDir:'docs'}),
    /R42G_PRIVATE_PATH_OUT_REQUIRED/);
  await assert.rejects(runR42gLocal({outputPath:'docs/r42g-public.json'}),
    /R42G_PRIVATE_PATH_OUT_REQUIRED/);
});
test('G3 line reader rejects unfinished line and overlong events',async()=>{
  const dir=await makeDirectory();
  try{
    const file=join(dir,'events.jsonl');
    await writeFile(file,Buffer.from('{"seq":0}'));
    await assert.rejects(async()=>{
      for await (const _ of readR42gJsonlLines(file)){}
    },/R42G_TRUNCATED_FINAL_LINE/);
    await writeFile(file,Buffer.from('x'.repeat(513)+'\n'));
    await assert.rejects(async()=>{
      for await (const _ of readR42gJsonlLines(file)){}
    },/R42G_JSONL_LINE_TOO_LONG/);
  }finally{await rm(dir,{recursive:true,force:true});}
});
