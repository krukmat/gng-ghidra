/**
 * R4.2.G — incremental, fail-closed *structural* replay of R4.2.F JSONL.
 *
 * This never promotes a Lua write tap log into a native CPU/raster witness.
 * Bootstrap is optional but must be explicitly declared and SHA-256 bound.
 * No missing pre-tap bytes, missing DMA or graphics are synthesized.
 * State persists across windows (unlike the 40K-event synthetic D replay).
 */
import {createHash} from 'node:crypto';
import {createGngbBoardMemory} from './gngb_board_memory.mjs';
import {renderGngbBoardFrame} from './gngb_frame_pipeline.mjs';

const MAX=1_000_000,WINDOW=40_000;
const hash=x=>createHash('sha256').update(x).digest('hex');
const digest=x=>typeof x==='string'&&/^[0-9a-f]{64}$/.test(x);
const int=(x,lo,hi)=>Number.isSafeInteger(x)&&x>=lo&&x<=hi;
const LAYOUT=[
  ['sprite_ram',512,0x1e00],
  ['video_ram',4096,0x2000],
  ['palette_ext',256,0x3800],
  ['palette_base',256,0x3900],
  ['scroll_bytes',4,0x3b08],
];
function canonicalKeys(obj,required){
  return obj&&typeof obj==='object'&&!Array.isArray(obj)&&
    Object.keys(obj).length===required.length&&
    required.every(k=>Object.prototype.hasOwnProperty.call(obj,k));
}
function validTimeline(t){
  if(t?.schema!=='gng.r42f.native-timeline-validation.v1'||
     t.status!=='STRUCTURAL_TIMELINE_VERIFIED_ORIGIN_UNATTESTED'||
     t.source!=='MAME_LUA_WRITE_TAP_CLAIM_UNATTESTED'||
     t.coverage!=='POST_AUTOBOOT_TAP_INSTALL_ONLY'||
     t.raster_precision!=='UNAVAILABLE_LUA_DOCUMENTED_API'||
     t.instruction_alignment_verified!==false||
     t.bank_identity_verified!==false||
     t.native_vblank_alignment_verified!==false||
     t.native_pixel_equivalence_verified!==false||
     !/^[0-9a-f]{32}$/.test(t.run_id||'')||
     !digest(t.jsonl_sha256)||!digest(t.metadata_sha256)||
     !int(t.target_frame,2,7200)||!int(t.last_frame,t.target_frame,7200)||
     !int(t.events,1,MAX)||!int(t.writes,0,MAX)||
     !int(t.dma,1,MAX)||t.checkpoints!==1||
     t.events!==t.writes+t.dma+1)
    throw Error('R42G_F_TIMELINE_VALIDATION_REQUIRED');
}
export function r42gBootstrapDigest(seed){
  if(seed?.schema!=='gng.r42g.bootstrap.v1'||
     !['LAB_SYNTHETIC','PRE_TAP_UNATTESTED'].includes(seed.origin))
    throw Error('R42G_BOOTSTRAP_PROVENANCE_INVALID');
  const d=createHash('sha256');
  d.update(Buffer.from(seed.schema+'|'+seed.origin+'|','utf8'));
  for(const [key,len] of LAYOUT){
    const bytes=seed[key];
    if(!(bytes instanceof Uint8Array)||bytes.length!==len)
      throw Error('R42G_BOOTSTRAP_REGION_INCOMPLETE_'+key);
    d.update(bytes);
  }
  return d.digest('hex');
}
function bootstrapBoard(board,seed,coverage){
  if(seed===undefined||seed===null)return 'NONE';
  const actual=r42gBootstrapDigest(seed);
  if(!digest(seed.sha256)||actual!==seed.sha256)
    throw Error('R42G_BOOTSTRAP_DIGEST_MISMATCH');
  for(const [key,,addr] of LAYOUT){
    for(let i=0;i<seed[key].length;i++)board.write8(addr+i,seed[key][i]);
  }
  coverage.sprite.fill(1);coverage.video.fill(1);
  coverage.ext.fill(1);coverage.base.fill(1);coverage.scroll.fill(1);
  return seed.origin;
}
function coverageReport(c,hasDma){
  const count=a=>a.reduce((sum,n)=>sum+n,0);
  return Object.freeze({
    sprite_ram:count(c.sprite),video_ram:count(c.video),
    palette_ext:count(c.ext),palette_base:count(c.base),
    scroll_registers:count(c.scroll),dma_since_capture_start:hasDma,
    full_state:hasDma&&count(c.sprite)===512&&count(c.video)===4096&&
      count(c.ext)===256&&count(c.base)===256&&count(c.scroll)===4,
  });
}
/** Distinct semantic adapter. Outputs never bear R4.2.D's synthetic schema. */
export function mapR42fVideoEvent(event,expectedSeq,previous){
  const fields=['seq','kind','frame','emu_seconds','raster_vpos','raster_hpos',
    'raster_unobserved','address','data','mask'];
  if(!canonicalKeys(event,fields)||event.seq!==expectedSeq||
     !int(event.frame,0,7200)||
     typeof event.emu_seconds!=='number'||
     !Number.isFinite(event.emu_seconds)||event.emu_seconds<0||
     event.frame<previous.frame||event.emu_seconds<previous.time||
     event.raster_vpos!==null||event.raster_hpos!==null||
     event.raster_unobserved!==true)
    throw Error('R42G_EVENT_ENVELOPE_OR_ORDER_INVALID');
  if(event.kind==='CHECKPOINT'){
    if(event.address!==null||event.data!==null||event.mask!==null)
      throw Error('R42G_CHECKPOINT_FIELDS_INVALID');
    return Object.freeze({seq:expectedSeq,kind:'CHECKPOINT',frame:event.frame,
      time:event.emu_seconds});
  }
  if(!int(event.address,0,65535)||!int(event.data,0,255)||event.mask!==255)
    throw Error('R42G_BUS_WIDTH_OR_MASK_INVALID');
  const addr=event.address;
  if(event.kind==='DMA'){
    if(addr!==0x3c00)throw Error('R42G_DMA_ADDRESS_INVALID');
  }else if(event.kind==='WRITE8'){
    if(!((addr>=0x1e00&&addr<=0x2fff)||
         (addr>=0x3800&&addr<=0x39ff)||
         (addr>=0x3b08&&addr<=0x3b0b)))
      throw Error('R42G_WRITE_ADDRESS_INVALID');
  }else throw Error('R42G_EVENT_KIND_INVALID');
  return Object.freeze({seq:expectedSeq,kind:event.kind,address:addr,
    value:event.data,frame:event.frame,time:event.emu_seconds});
}
function track(c,address){
  if(address>=0x1e00&&address<=0x1fff)c.sprite[address-0x1e00]=1;
  else if(address>=0x2000&&address<=0x2fff)c.video[address-0x2000]=1;
  else if(address>=0x3800&&address<=0x38ff)c.ext[address-0x3800]=1;
  else if(address>=0x3900&&address<=0x39ff)c.base[address-0x3900]=1;
  else if(address>=0x3b08&&address<=0x3b0b)c.scroll[address-0x3b08]=1;
}
function firstByteMismatch(a,b,region){
  if(!(a instanceof Uint8Array)||!(b instanceof Uint8Array)||a.length!==b.length)
    throw Error('R42G_R0_RAW_REGION_INVALID_'+region);
  for(let i=0;i<a.length;i++)if(a[i]!==b[i]){
    return Object.freeze({region,byte_offset:i,
      address:region==='VRAM'?0x2000+i:null,
      channel:region==='PALETTE_RGBA'?['R','G','B','A'][i%4]:null});
  }
  return null;
}
function compareR0(states,reference,referenceBytes,actualBytes){
  if(reference===undefined||reference===null)return null;
  if(reference.schema!=='gng.r42e.reference-integrity.v1'||
     reference.status!=='REFERENCE_BYTES_MATCH_MANIFEST_ORIGIN_UNATTESTED'||
     reference.independent_capture_attested!==false||
     reference.native_event_timeline_available!==false)
    throw Error('R42G_R0_INTEGRITY_REFERENCE_REQUIRED');
  const matching={
    video_ram:states.video_ram_sha256===reference.video_ram_sha256,
    sprites_dma:states.buffered_sprite_sha256===reference.buffered_sprite_sha256,
    palette:states.palette_sha256===reference.palette_sha256,
    scroll_x:states.scroll.x===reference.scroll.x,
    scroll_y:states.scroll.y===reference.scroll.y,
  };
  const differing=Object.keys(matching).filter(k=>!matching[k]);
  let firstMismatch=null;
  if(referenceBytes!==undefined){
    if(!(referenceBytes?.video_ram instanceof Uint8Array)||
       !(referenceBytes?.buffered_sprites instanceof Uint8Array)||
       !(referenceBytes?.palette instanceof Uint8Array)||
       referenceBytes.video_ram.length!==4096||
       referenceBytes.buffered_sprites.length!==512||
       referenceBytes.palette.length!==1024||
       hash(referenceBytes.video_ram)!==reference.video_ram_sha256||
       hash(referenceBytes.buffered_sprites)!==reference.buffered_sprite_sha256||
       hash(referenceBytes.palette)!==reference.palette_sha256)
      throw Error('R42G_R0_RAW_BYTES_HASH_UNVERIFIED');
    firstMismatch=
      firstByteMismatch(actualBytes.video_ram,referenceBytes.video_ram,'VRAM')||
      firstByteMismatch(actualBytes.buffered_sprites,referenceBytes.buffered_sprites,'SPRITE_DMA')||
      firstByteMismatch(actualBytes.palette,referenceBytes.palette,'PALETTE_RGBA')||
      (states.scroll.x!==reference.scroll.x?
        Object.freeze({region:'SCROLL_X',byte_offset:null,address:0x3b08,channel:null}):
       states.scroll.y!==reference.scroll.y?
        Object.freeze({region:'SCROLL_Y',byte_offset:null,address:0x3b0a,channel:null}):null);
  }
  return Object.freeze({
    status:differing.length?'SNAPSHOT_COMPONENT_MISMATCH':
      'COMPONENTS_EQUAL_TEMPORAL_ALIGNMENT_UNVERIFIED',
    matching:Object.freeze(matching),differing:Object.freeze(differing),
    first_byte_mismatch:firstMismatch,
    raw_bytes_compared:referenceBytes!==undefined,
    pixels_compared:false,origin_attested:false,timing_proven:false
  });
}
/**
 * rawLines is a stream/iterable of complete UTF-8 JSON lines INCLUDING \n.
 * Backpressure is caller-controlled. Only aggregate output is returned.
 */
export async function replayR42gTimeline({rawLines,timeline,bootstrap,reference,referenceBytes,graphics}){
  validTimeline(timeline);
  if(rawLines==null||typeof rawLines[Symbol.asyncIterator]!=='function'&&
     typeof rawLines[Symbol.iterator]!=='function')
    throw Error('R42G_LINE_STREAM_REQUIRED');
  if(graphics!==undefined&&
    (!(graphics?.chars instanceof Uint8Array)||graphics.chars.length!==0x4000||
     !(graphics?.tiles instanceof Uint8Array)||graphics.tiles.length!==0x18000||
     !(graphics?.sprites instanceof Uint8Array)||graphics.sprites.length!==0x20000))
    throw Error('R42G_GRAPHICS_ASSETS_INVALID');
  const board=createGngbBoardMemory();
  const c={sprite:new Uint8Array(512),video:new Uint8Array(4096),
    ext:new Uint8Array(256),base:new Uint8Array(256),scroll:new Uint8Array(4)};
  const bootstrap_origin=bootstrapBoard(board,bootstrap,c);
  const h=createHash('sha256');
  let seq=0,writes=0,dmas=0,checkpoints=0,lastFrame=-1,lastTime=-1;
  for await (const raw of rawLines){
    if(!Buffer.isBuffer(raw)&&typeof raw!=='string')
      throw Error('R42G_LINE_TYPE_INVALID');
    const bytes=Buffer.isBuffer(raw)?raw:Buffer.from(raw,'utf8');
    if(bytes.length<2||bytes.length>512||bytes[bytes.length-1]!==10||
       bytes.includes(13))
      throw Error('R42G_LINE_BOUNDARY_OR_SIZE_INVALID');
    if(seq>=MAX||seq>=timeline.events)
      throw Error('R42G_EVENT_COUNT_EXCEEDED');
    h.update(bytes);
    let event;
    try{event=JSON.parse(bytes.toString('utf8'))}
    catch{throw Error('R42G_JSONL_INVALID')}
    const e=mapR42fVideoEvent(event,seq,{frame:lastFrame,time:lastTime});
    if(checkpoints)throw Error('R42G_EVENTS_AFTER_CHECKPOINT');
    if(e.kind==='CHECKPOINT'){
      checkpoints++;
      if(e.frame!==timeline.last_frame)
        throw Error('R42G_FINAL_FRAME_MISMATCH');
    }else{
      try{board.write8(e.address,e.value)}
      catch(err){
        if(e.kind==='DMA'&&/SOURCE_INCOMPLETE/.test(err.message))
          throw Error('R42G_DMA_SOURCE_MISSING_PRETAP_BYTES');
        throw err;
      }
      if(e.kind==='DMA')dmas++;
      else {writes++;track(c,e.address)}
    }
    seq++;lastFrame=e.frame;lastTime=e.time;
  }
  if(seq!==timeline.events||writes!==timeline.writes||
     dmas!==timeline.dma||checkpoints!==1||
     h.digest('hex')!==timeline.jsonl_sha256)
    throw Error('R42G_TRACE_OR_DIGEST_MISMATCH');
  const coverage=coverageReport(c,dmas>0);
  const result={
    schema:'gng.r42g.incremental-replay.v1',
    status:coverage.full_state?'STATE_REPLAYED_TEMPORAL_PROOF_MISSING':
      'BLOCKED_PRETAP_INITIAL_STATE_INCOMPLETE',
    event_count:seq,window_size:WINDOW,window_count:Math.ceil(seq/WINDOW),
    target_frame:timeline.target_frame,last_frame:lastFrame,
    bootstrap_origin,coverage,
    components:null,reference_comparison:null,frame_sha256:null,
    native_origin_attested:false,native_instruction_alignment_verified:false,
    native_raster_vblank_verified:false,native_pixel_equivalence_verified:false,
    autonomous_cpu_frame_rendered:false,game_playable:false
  };
  if(!coverage.full_state)return Object.freeze(result);
  if(referenceBytes!==undefined&&reference===undefined)
    throw Error('R42G_R0_RAW_BYTES_REQUIRE_AUDIT');
  const video=board.snapshotAddressSpace({requireVideoInitialized:true})
    .slice(0x2000,0x3000);
  const registers=board.snapshotVideoRegisters();
  const states=Object.freeze({
    video_ram_sha256:hash(video),
    buffered_sprite_sha256:hash(board.snapshotBufferedSprites()),
    palette_sha256:hash(registers.palette),
    scroll:Object.freeze({...registers.scroll})
  });
  result.components=states;
  result.reference_comparison=compareR0(states,reference,referenceBytes,{
    video_ram:video,buffered_sprites:board.snapshotBufferedSprites(),
    palette:registers.palette
  });
  if(graphics!==undefined){
    const frame=renderGngbBoardFrame({board,...graphics});
    result.frame_sha256=hash(frame.rgba);
  }
  return Object.freeze(result);
}
