/**
 * R4.2.D — deterministic video event stream, not a CPU/clock emulator.
 * One strictly ordered stream replays via the existing gngb board and
 * shared R1 compositor. No native-trace identity, VBlank or raster timing.
 *
 * Input schema:
 *  {seq,kind:'WRITE8',address:0..0x2fff|mapped-video-MMIO,value:0..255}
 *  {seq,kind:'DMA',address:0x3c00,value:0..255}
 *  {seq,kind:'CHECKPOINT',id:'unique-string'}
 */
import {createHash} from 'node:crypto';
import {createGngbBoardMemory} from './gngb_board_memory.mjs';
import {renderGngbBoardFrame} from './gngb_frame_pipeline.mjs';
import {isGngVideoRegisterWrite} from './gngb_video_registers.mjs';

export const R42D_EVENT_SCHEMA='gng.r42.visual-events.v1';
const LIMIT=40000,FRAME_BYTES=256*224*4;
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
function keysOnly(event,fields){
  const keys=Object.keys(event).sort();
  return keys.length===fields.length &&
    fields.every(k=>Object.prototype.hasOwnProperty.call(event,k));
}
function validate(events){
  if(!Array.isArray(events)||events.length===0||events.length>LIMIT)
    throw Error('R42D_EVENT_STREAM_LENGTH_INVALID');
  let checkpoints=0;const ids=new Set();
  return events.map((e,seq)=>{
    if(!e||typeof e!=='object'||Array.isArray(e)||
       !Number.isSafeInteger(e.seq)||e.seq!==seq)
      throw Error('R42D_EVENT_SEQUENCE_INVALID');
    if(e.kind==='CHECKPOINT'){
      if(!keysOnly(e,['seq','kind','id'])||
         typeof e.id!=='string'||! /^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,63}$/.test(e.id)||
         ids.has(e.id))
        throw Error('R42D_CHECKPOINT_CONTRACT_INVALID');
      ids.add(e.id);checkpoints++;
      return Object.freeze({seq,kind:e.kind,id:e.id});
    }
    if(!keysOnly(e,['seq','kind','address','value'])||
       !Number.isInteger(e.address)||!Number.isInteger(e.value)||
       e.value<0||e.value>255)
      throw Error('R42D_EVENT_CONTRACT_INVALID');
    if(e.kind==='DMA'){
      if(e.address!==0x3c00)throw Error('R42D_DMA_ADDRESS_INVALID');
    }else if(e.kind==='WRITE8'){
      if(e.address<0||!(e.address<=0x2fff||isGngVideoRegisterWrite(e.address)))
        throw Error('R42D_UNSUPPORTED_BUS_WRITE');
    }else throw Error('R42D_EVENT_KIND_UNSUPPORTED');
    return Object.freeze({seq,kind:e.kind,address:e.address,value:e.value});
  });
}
function witness(e){
  return hash(Buffer.from(e.kind==='CHECKPOINT'
    ? `${e.seq}|CHECKPOINT|${e.id}`
    : `${e.seq}|${e.kind}|${e.address}|${e.value}`,'utf8'));
}
function capturedCheckpoint(id,seq,board,frame){
  const raw=frame.rgba.slice();
  if(raw.length!==FRAME_BYTES)throw Error('R42D_FRAME_SIZE_INVALID');
  const video=board.snapshotAddressSpace({requireVideoInitialized:true})
    .slice(0x2000,0x3000);
  const sprite=board.snapshotBufferedSprites();
  const regs=board.snapshotVideoRegisters();
  const scroll=Object.freeze({...regs.scroll});
  const sha=hash(raw);
  return Object.freeze({
    id,seq,width:frame.width,height:frame.height,
    frame_sha256:sha,video_ram_sha256:hash(video),
    buffered_sprite_sha256:hash(sprite),palette_sha256:hash(regs.palette),
    scroll,
    get rgba(){return raw.slice();},
    get video_ram(){return video.slice();},
    get buffered_sprites(){return sprite.slice();},
    get palette(){return regs.palette.slice();}
  });
}
/** Executes an already validated, ROM-free logical event stream. */
export function replayGngbVisualEvents({events,chars,tiles,sprites,source='SYNTHETIC_LAB'}){
  // Reject false native provenance; native capture ingestion requires a
  // separately authenticated adapter and is outside this ROM-free gate.
  if(source!=='SYNTHETIC_LAB')throw Error('R42D_NATIVE_SOURCE_NOT_AUTHENTICATED');
  const normalized=validate(events);
  if(!(chars instanceof Uint8Array)||chars.length!==0x4000||
     !(tiles instanceof Uint8Array)||tiles.length!==0x18000||
     !(sprites instanceof Uint8Array)||sprites.length!==0x20000)
    throw Error('R42D_GRAPHICS_ASSETS_REQUIRED');
  // Own source graphics for this replay: no mutation-induced nondeterminism.
  const gfx={chars:chars.slice(),tiles:tiles.slice(),sprites:sprites.slice()};
  const board=createGngbBoardMemory();
  const eventsDigest=[];
  const checkpoints=[];
  for(const e of normalized){
    if(e.kind==='CHECKPOINT'){
      const frame=renderGngbBoardFrame({board,...gfx});
      if(frame.video_state_source!=='BOARD_MMIO')
        throw Error('R42D_BOARD_STATE_REQUIRED');
      checkpoints.push(capturedCheckpoint(e.id,e.seq,board,frame));
    }else board.write8(e.address,e.value);
    eventsDigest.push(Object.freeze({seq:e.seq,kind:e.kind,sha256:witness(e)}));
  }
  if(checkpoints.length===0)throw Error('R42D_CHECKPOINT_REQUIRED');
  return Object.freeze({
    schema:'gng.r42.visual-replay.v1',
    status:'SYNTHETIC_LOGICAL_REPLAY_ONLY',
    source:'ROM_FREE_EVENT_LAB',
    event_count:normalized.length,
    checkpoint_count:checkpoints.length,
    input_graphics_sha256:Object.freeze({
      chars:hash(gfx.chars),tiles:hash(gfx.tiles),sprites:hash(gfx.sprites)
    }),
    events:Object.freeze(eventsDigest),
    checkpoints:Object.freeze(checkpoints),
    native_vblank_correlated:false,
    native_pixel_equivalence_verified:false,
    autonomous_cpu_frame_rendered:false,
    game_playable:false
  });
}
/**
 * Compare two replays independently. Input differences and frame differences
 * are distinct; changed inputs can legitimately produce identical pixels.
 * First visible mismatch is reported as pixel coordinates/channel, no values.
 */
export function compareGngbVisualReplays(left,right){
  if(left?.schema!=='gng.r42.visual-replay.v1'||
     right?.schema!=='gng.r42.visual-replay.v1'||
     left.source!=='ROM_FREE_EVENT_LAB'||right.source!=='ROM_FREE_EVENT_LAB')
    throw Error('R42D_REPLAY_SCHEMA_INVALID');
  const L=left.events,R=right.events;
  const max=Math.max(L.length,R.length);
  let firstEvent=null;
  for(let i=0;i<max;i++){
    if(L[i]?.seq!==R[i]?.seq||L[i]?.sha256!==R[i]?.sha256){
      firstEvent=Object.freeze({seq:i,left_kind:L[i]?.kind??null,
        right_kind:R[i]?.kind??null});
      break;
    }
  }
  let firstFrame=null;
  const count=Math.max(left.checkpoints.length,right.checkpoints.length);
  for(let i=0;i<count;i++){
    const l=left.checkpoints[i],r=right.checkpoints[i];
    if(!l||!r||l.id!==r.id||l.seq!==r.seq){
      firstFrame=Object.freeze({checkpoint_index:i,checkpoint_id:l?.id??r?.id??null,
        reason:'CHECKPOINT_ID_OR_ORDER'});
      break;
    }
    if(l.frame_sha256===r.frame_sha256)continue;
    const a=l.rgba,b=r.rgba;
    let p=0;while(p<a.length&&p<b.length&&a[p]===b[p])p++;
    firstFrame=Object.freeze({
      checkpoint_index:i,checkpoint_id:l.id,
      reason:'RGBA_CHANNEL_DIFFERENCE',
      pixel_index:Math.floor(p/4),
      x:Math.floor(p/4)%256,y:Math.floor(Math.floor(p/4)/256),
      channel:['R','G','B','A'][p%4]
    });
    break;
  }
  const graphicsSame=['chars','tiles','sprites'].every(
    k=>left.input_graphics_sha256[k]===right.input_graphics_sha256[k]);
  const equal=!firstEvent&&!firstFrame&&graphicsSame;
  return Object.freeze({
    schema:'gng.r42.visual-replay-diff.v1',
    status:equal?'IDENTICAL_SYNTHETIC_REPLAY':'SYNTHETIC_REPLAY_DIVERGENCE',
    inputs_equal:firstEvent===null&&graphicsSame,
    graphics_equal:graphicsSame,
    frames_equal:firstFrame===null,
    first_event_divergence:firstEvent,
    first_frame_divergence:firstFrame,
    native_comparison_performed:false,
    native_pixel_equivalence_verified:false
  });
}
