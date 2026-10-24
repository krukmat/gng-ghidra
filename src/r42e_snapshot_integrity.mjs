import {createHash} from 'node:crypto';
const sha=b=>createHash('sha256').update(b).digest('hex');
const lengths={foreground:2048,background:2048,sprites:512,palette:1024};
const names={foreground:'foreground.bin',background:'background.bin',
  sprites:'sprites-buffered.bin',palette:'palette-rgba.bin',reference:'reference.png'};
const integer=(x,min,max)=>Number.isSafeInteger(x)&&x>=min&&x<=max;
export function verifyR42eSnapshot({manifest,state,files}){
  if(manifest?.schema!=='gng.mame-video-capture.v1'||
     manifest.status!=='NATIVE_REFERENCE_CAPTURED_NOT_JS_EQUIVALENCE'||
     manifest.source!=='MAME reference frame only'||
     manifest.sprite_dma_observed!==true||
     manifest.native_video_state_validated!==true||
     manifest.generated_js_frame_equivalent!==false||
     manifest.product_uses_mame!==false||
     !['gng','gngb'].includes(manifest.system)||
     state?.schema!=='gng.mame-video-state.v1'||
     state.driver!==manifest.system||
     state.source!=='MAME independent native frame, not translated JS'||
     state.sprite_buffer_source!=='CPU write tap 0x3c00')
    throw Error('R42E_CAPTURE_MANIFEST_CONTRACT_INVALID');
  if(!integer(manifest.frame,2,7200)||state.frame!==manifest.frame||
     !integer(manifest.sprite_dma_count,1,Number.MAX_SAFE_INTEGER)||
     manifest.sprite_dma_count!==state.dma_count)
    throw Error('R42E_FRAME_DMA_METADATA_MISMATCH');
  const sc=state.scroll_bytes;
  if(!Array.isArray(sc)||sc.length!==4||sc.some(v=>!integer(v,0,255))||
     sc[0]+256*sc[1]!==manifest.scroll_x||
     sc[2]+256*sc[3]!==manifest.scroll_y||
     state.scroll_x!==manifest.scroll_x||state.scroll_y!==manifest.scroll_y)
    throw Error('R42E_SCROLL_METADATA_MISMATCH');
  if(!files||!manifest.artifacts)throw Error('R42E_ARTIFACTS_REQUIRED');
  const digest={};
  for(const [key,name] of Object.entries(names)){
    const bytes=files[key],meta=manifest.artifacts[key];
    if(!(bytes instanceof Uint8Array)||meta?.filename!==name||
       (key in lengths&&(bytes.length!==lengths[key]||meta.bytes!==lengths[key])))
      throw Error('R42E_ARTIFACT_LENGTH_OR_NAME_INVALID_'+key);
    if(key==='reference'){
      const sig=[137,80,78,71,13,10,26,10];
      if(bytes.length<33||!sig.every((v,i)=>bytes[i]===v)||
         Buffer.from(bytes).toString('ascii',12,16)!=='IHDR'||
         Buffer.from(bytes).readUInt32BE(16)!==256||
         Buffer.from(bytes).readUInt32BE(20)!==224||
         meta.width!==256||meta.height!==224)
        throw Error('R42E_PNG_HEADER_INVALID');
    }
    if(!/^[0-9a-f]{64}$/.test(meta.sha256||'')||sha(bytes)!==meta.sha256)
      throw Error('R42E_ARTIFACT_HASH_MISMATCH_'+key);
    digest[key]=meta.sha256;
  }
  return Object.freeze({
    schema:'gng.r42e.reference-integrity.v1',
    status:'REFERENCE_BYTES_MATCH_MANIFEST_ORIGIN_UNATTESTED',
    claimed_driver:manifest.system,frame:manifest.frame,
    dma_count:manifest.sprite_dma_count,
    video_ram_sha256:sha(Buffer.concat([files.foreground,files.background])),
    buffered_sprite_sha256:digest.sprites,palette_sha256:digest.palette,
    png_sha256:digest.reference,
    scroll:Object.freeze({x:manifest.scroll_x,y:manifest.scroll_y}),
    source_self_reported:true,independent_capture_attested:false,
    native_event_timeline_available:false,
    native_vblank_correlated:false,native_pixel_equivalence_verified:false
  });
}
