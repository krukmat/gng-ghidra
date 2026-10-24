import {createHash} from 'node:crypto';
const sha=v=>createHash('sha256').update(v).digest('hex');
export function makeR42eReference(){
  const files={
    foreground:Buffer.alloc(2048,0x22),background:Buffer.alloc(2048,0x45),
    sprites:Buffer.alloc(512,0xf8),palette:Buffer.alloc(1024,0),
    reference:Buffer.alloc(33)
  };
  files.reference.set([137,80,78,71,13,10,26,10],0);
  files.reference.writeUInt32BE(13,8);
  files.reference.write('IHDR',12,'ascii');
  files.reference.writeUInt32BE(256,16);
  files.reference.writeUInt32BE(224,20);
  files.reference[24]=8;files.reference[25]=2;
  const state={
    schema:'gng.mame-video-state.v1',driver:'gngb',frame:600,dma_count:8,
    scroll_x:304,scroll_y:32,scroll_bytes:[48,1,32,0],
    source:'MAME independent native frame, not translated JS',
    sprite_buffer_source:'CPU write tap 0x3c00'
  };
  const names={foreground:'foreground.bin',background:'background.bin',
    sprites:'sprites-buffered.bin',palette:'palette-rgba.bin',
    reference:'reference.png'};
  const artifacts={};
  for(const [key,name] of Object.entries(names)){
    artifacts[key]={filename:name,sha256:sha(files[key])};
    if(key!=='reference')artifacts[key].bytes=files[key].length;
    else Object.assign(artifacts[key],{width:256,height:224});
  }
  const manifest={
    schema:'gng.mame-video-capture.v1',
    status:'NATIVE_REFERENCE_CAPTURED_NOT_JS_EQUIVALENCE',
    system:'gngb',frame:600,sprite_dma_count:8,
    scroll_x:304,scroll_y:32,
    source:'MAME reference frame only',
    sprite_dma_observed:true,native_video_state_validated:true,
    generated_js_frame_equivalent:false,product_uses_mame:false,
    artifacts
  };
  return {manifest,state,files};
}
export function makeR42eLabReport(verified){
  return {
    schema:'gng.r42.visual-lab-report.v1',
    status:'ROM_FREE_REPLAY_AND_DIVERGENCE_LAB_PASS',
    checkpoints:1,native_mame_trace_consumed:false,
    native_vblank_correlated:false,native_pixel_equivalence_verified:false,
    autonomous_cpu_frame_rendered:false,game_playable:false,
    frames:[{
      id:'synthetic-test',seq:0,
      frame_sha256:sha(Buffer.from('not-pixel-evidence')),
      video_ram_sha256:verified.video_ram_sha256,
      buffered_sprite_sha256:verified.buffered_sprite_sha256,
      palette_sha256:verified.palette_sha256,
      scroll:{...verified.scroll}
    }]
  };
}
