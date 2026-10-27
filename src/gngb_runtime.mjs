/**
 * R3.5.B2.T5: gngb board runtime for AOT-compiled MC6809 blocks.
 *
 * Runs from a cold reset only: no oracle state, register or memory is
 * injected. Board behaviour follows MAME 0.289 gng.cpp (gng_main_map,
 * machine_reset) and the T4.4 decision: one VBLANK IRQ per frame,
 * irq0_line_hold (asserted until acknowledged), SYNC per base6x09.lst.
 *
 * Unknown values fail closed: registers MAME's reset leaves untouched
 * (A,B,X,Y,U,S and CC bits other than I/F), RAM never written and the
 * bank window before the first bank write. Push/pull/TFR/EXG carry
 * per-bit known masks; any other use of an unknown value throws.
 */
import {CC_E,CC_I,CC_F} from './mc6809_aot_lib.mjs';
import {blockKey} from './gngb_block_key.mjs';

export const CYCLES_PER_FRAME=25152;          // 384x262 @ 6 MHz, CPU 1.5 MHz
export const PORT_DEFAULTS=[0xff,0xff,0xff,0xdf,0xfb]; // SYSTEM,P1,P2,DSW1,DSW2
export const RECORD_BYTES=0x3800;

export class GngbRuntimeError extends Error{
  constructor(code,detail){super(code);this.code=code;this.detail=detail;}
}

export function createBoard(code,blocks,{frames,onFrame,cyclesPerFrame=CYCLES_PER_FRAME,
  portRead=null,onPortRead=null,onAudioEvent=null}={}){
  if(!Number.isInteger(cyclesPerFrame)||cyclesPerFrame<1)
    throw Error('V2_B1_INVALID_IRQ_PERIOD');
  if(portRead!==null&&typeof portRead!=='function')
    throw Error('V3_B2A_INVALID_PORT_READER');
  if(onPortRead!==null&&typeof onPortRead!=='function')
    throw Error('V3_B2A_INVALID_PORT_OBSERVER');
  if(onAudioEvent!==null&&typeof onAudioEvent!=='function')
    throw Error('AUDIO_EVENT_HANDLER_INVALID');
  const mem=new Uint8Array(0x3000),km=new Uint8Array(0x3000);
  const palExt=new Uint8Array(0x100),pal=new Uint8Array(0x100);
  // machine_reset: palette RAM filled with 00/55/aa/ff, scroll zeroed.
  for(let i=0;i<0x100;i++)palExt[i]=pal[i]=[0x00,0x55,0xaa,0xff][i&3];
  const $={
    a:0,b:0,dp:0,x:0,y:0,u:0,s:0,cc:CC_I|CC_F,PC:0,
    ka:0,kb:0,kdp:255,kx:0,ky:0,ku:0,ks:0,kcc:CC_I|CC_F,
    C:0,T:cyclesPerFrame-1,st:null,ipc:0,lk:0,
    irq:false,sync:false,bank:null,
    scroll:[0,0,0,0],latch:new Array(8).fill(null),soundlatch:null,
    dma:null,dmaMask:null,snapped:false,
    events:[],records:[],frame:0,
    writes:{dma:0,scroll:0,bank:0,latch:0},
  };
  const fail=(c,d={})=>{throw new GngbRuntimeError(c,{pc:$.ipc,cycles:$.C,...d});};
  $.unknown=(what,bits)=>fail('R35_T5_UNKNOWN_VALUE',{what,bits});
  $.bad=why=>fail('R35_T5_UNSUPPORTED',{why});
  const ev=(kind,...f)=>$.events.push([kind,...f]);
  // Observation-only sound bus tap. Never executes or synthesizes sound.
  const audioEvent=(kind,value,prev)=>{
    if(onAudioEvent===null)return;
    const cycle=$.C+prev;
    if(!Number.isSafeInteger(prev)||prev<0||!Number.isSafeInteger(cycle)||cycle<0)
      fail('AUDIO_EVENT_CYCLE_INVALID',{kind,prev});
    onAudioEvent(Object.freeze({kind,value,cycle,
      frame:Math.floor(cycle/cyclesPerFrame),pc:$.ipc}));
  };

  const romByte=a=>{
    if(a>=0x6000)return code.fixed[a];
    if($.bank===null)fail('R35_T5_BANK_UNSELECTED_READ',{addr:a});
    return code.banks[$.bank*0x2000+a-0x4000];
  };
  // Data read that must be known.
  // New AOT code supplies the exact bus-read offset relative to the
  // current instruction. No provider = byte-for-byte legacy V2 behavior.
  $.rd=(a,offset)=>{
    if(a<0x3000){
      if(km[a]!==255)fail('R35_T5_UNKNOWN_READ',{addr:a,mask:km[a]});
      return mem[a];
    }
    if(a<0x3005){
      if(portRead!==null&&a<0x3003){
        if(!Number.isSafeInteger(offset)||offset<0||offset>64)
          fail('V3_B2A_READ_CYCLE_OFFSET_MISSING',{addr:a});
        const cycle=$.C+offset;
        if(!Number.isSafeInteger(cycle)||cycle<0)
          fail('V3_B2A_READ_CYCLE_INVALID',{addr:a});
        const value=portRead(a,cycle);
        if(!Number.isInteger(value)||value<0||value>255)
          fail('V3_B2A_PORT_VALUE_INVALID',{addr:a,cycle});
        if(onPortRead)onPortRead({addr:a,cycle,pc:$.ipc,value});
        return value;
      }
      return PORT_DEFAULTS[a-0x3000];
    }
    if(a<0x4000)return 0; // write-only or unmapped: reads 0 (T4 native)
    return romByte(a);
  };
  // Stack read that carries its known mask in $.lk.
  $.rk=(a,offset)=>{
    if(a<0x3000){$.lk=km[a];return mem[a];}
    $.lk=255;return $.rd(a,offset);
  };
  const snapshot=()=>{
    const r=new Uint8Array(RECORD_BYTES),k=new Uint8Array(RECORD_BYTES);
    r.set(mem.subarray(0,0x1e00),0);k.set(km.subarray(0,0x1e00),0);
    r.set(mem.subarray(0x1e00,0x2000),0x1e00);k.set(km.subarray(0x1e00,0x2000),0x1e00);
    if($.dma){r.set($.dma,0x2000);k.set($.dmaMask,0x2000);}
    else k.fill(255,0x2000,0x2200); // no DMA yet: reference stores zeros
    r.set(mem.subarray(0x2000,0x3000),0x2200);k.set(km.subarray(0x2000,0x3000),0x2200);
    r.set(palExt,0x3200);r.set(pal,0x3300);k.fill(255,0x3200,0x3800);
    for(let i=0;i<256;i++){
      // RGBx_444 word = ext<<8 | base (verified on 600 MAME frames).
      const o=0x3400+i*4;
      r[o]=(palExt[i]>>4)*17;r[o+1]=(palExt[i]&15)*17;r[o+2]=(pal[i]>>4)*17;r[o+3]=255;
    }
    $.records.push({index:$.records.length+1,record:r,known:k,
      scroll:[...$.scroll],bank:$.bank,latch:[...$.latch],
      sprite_buffer_valid:!!$.dma,writes:$.writes});
    $.writes={dma:0,scroll:0,bank:0,latch:0};
    $.snapped=true;
    if(onFrame)onFrame($.records[$.records.length-1]);
  };
  const apply=(a,v,mask,prev)=>{
    if(a<0x3000){mem[a]=v;km[a]=mask;return;}
    if(mask!==255)fail('R35_T5_UNKNOWN_IO_WRITE',{addr:a});
    if(a>=0x3800&&a<0x3900)palExt[a-0x3800]=v;
    else if(a>=0x3900&&a<0x3a00)pal[a-0x3900]=v;
    else if(a===0x3a00){$.soundlatch=v;audioEvent('SOUNDLATCH_WRITE',v,prev);}
    else if(a>=0x3b08&&a<=0x3b0b){$.scroll[a-0x3b08]=v;$.writes.scroll++;}
    else if(a===0x3c00){
      $.dma=mem.slice(0x1e00,0x2000);$.dmaMask=km.slice(0x1e00,0x2000);
      $.writes.dma++;
    }else if(a>=0x3d00&&a<=0x3d07){
      const line=a-0x3d00, bit=v&1, previous=$.latch[line];
      $.latch[line]=bit;$.writes.latch++;
      // LS259 Q1: 0 asserts Z80 RESET and resets both YM2203s; 1 releases.
      if(line===1&&previous!==bit)audioEvent('AUDIO_RESET_LINE',bit,prev);
    }
    else if(a===0x3e00){$.bank=v===4?4:v&3;$.writes.bank++;}
    // ROM and unmapped writes are ignored, as on the board.
  };
  // A write after the MAME suspension point belongs to the next frame:
  // take the snapshot first (prev = last stop offset before this write).
  $.wk=(a,v,mask,prev)=>{
    if(!$.snapped&&$.C+prev>=$.T)snapshot();
    apply(a,v,mask,prev);
  };
  $.w=(a,v,prev)=>$.wk(a,v,255,prev);
  $.syncEnter=pc=>{ev('SYNC_ENTER',pc,$.cc,$.C);$.sync=true;};

  const boundary=()=>{
    // Suspension point: first '@' stop of the straddling path at or past T.
    let at=$.C;
    if($.st){
      const start=$.C-$.st[$.st.length-1];
      for(const p of $.st)if(start+p>=$.T){at=start+p;break;}
    }
    if(!$.snapped)snapshot();
    $.irq=true;
    ev('LINE_DELIVERED','IRQ',1,at);
    $.frame++;
    $.T=($.frame+1)*cyclesPerFrame-1;
    $.snapped=false;
  };
  const push=(v,k,prev)=>{
    if($.ks!==65535)$.unknown('S');
    $.s=($.s-1)&0xffff;$.wk($.s,v,k,prev);
  };
  const irqEntry=()=>{
    ev('IRQ_ENTRY','IRQ',$.PC,$.cc,$.C);
    $.ipc=$.PC;
    let c=3;
    $.cc|=CC_E;$.kcc|=CC_E;
    const word=(v,k)=>{push(v&255,k&255,c);c++;push(v>>8,k>>8,c);c++;};
    word($.PC,65535);word($.u,$.ku);word($.y,$.ky);word($.x,$.kx);
    push($.dp,$.kdp,c);c++;push($.b,$.kb,c);c++;push($.a,$.ka,c);c++;
    push($.cc,$.kcc,c);c++;
    $.cc|=CC_I;
    $.irq=false; // HOLD_LINE cleared by standard_irq_callback
    ev('LINE_DELIVERED','IRQ',0,$.C+c);
    $.PC=code.fixed[0xfff8]<<8|code.fixed[0xfff9];
    ev('VECTOR_FETCH',0xfff8,$.PC,$.C+c+3);
    $.st=[1,2,3,...Array.from({length:12},(_,i)=>4+i),16,17,18,19];
    $.C+=19;
  };

  const reset=()=>{
    ev('CPU_RESET',0);
    $.PC=code.fixed[0xfffe]<<8|code.fixed[0xffff];
    ev('VECTOR_FETCH',0xfffe,$.PC,3);
    $.C=4;$.st=null;
  };
  const misses=new Set();
  // RAM code runs only if RAM holds exactly the ROM bytes it was compiled
  // from; any other content fails closed (no code is decoded at run time).
  const overlays=code.ramOverlays??[];
  const overlayAt=pc=>{
    for(const [id,ov] of overlays.entries()){
      if(pc<ov.start||pc>=ov.start+ov.bytes.length)continue;
      let same=true;
      for(let i=0;i<ov.bytes.length&&same;i++)
        same=km[ov.start+i]===255&&mem[ov.start+i]===ov.bytes[i];
      if(same)return id;
    }
    return -1;
  };
  $.ramBytes=(a,n)=>({bytes:mem.slice(a,a+n),known:km.slice(a,a+n)});
  const run=()=>{
    reset();
    for(;;){
      if($.C>=$.T){
        boundary();
        if($.records.length>=frames)return {status:'FRAMES_DONE'};
      }
      if($.sync){
        if($.irq){
          ev('SYNC_EXIT',$.PC,$.cc,1,0,0,$.C);
          $.C+=1;$.sync=false;$.st=null;
        }else{$.C=$.T;$.st=null;continue;}
      }
      if($.irq){
        if(!($.kcc&CC_I))$.unknown('CC.I');
        if(!($.cc&CC_I)){irqEntry();continue;}
      }
      let key;
      if($.PC<0x3000){
        const id=overlayAt($.PC);
        if(id<0)return {status:'RAM_CODE_UNMAPPED',pc:$.PC};
        key=blockKey(null,$.PC,id);
      }else{
        if($.PC<0x4000)fail('R35_T5_EXEC_OUTSIDE_ROM',{target:$.PC});
        if($.PC<0x6000&&$.bank===null)fail('R35_T5_BANK_UNSELECTED_EXEC',{target:$.PC});
        key=blockKey($.PC<0x6000?$.bank:null,$.PC);
      }
      const fn=blocks.get(key);
      if(!fn){
        misses.add(key);
        return {status:'UNCOMPILED',bank:$.PC<0x6000?$.bank:null,pc:$.PC,
          overlay:$.PC<0x3000?overlayAt($.PC):null};
      }
      fn($);
    }
  };
  return {state:$,run};
}

/** gngb CPU code view from ROM_START(gngb): fixed 0x6000-0xffff + 5 banks. */
export function gngbCodeImage(read){
  const g4=read('gg4.bin'),g3=read('gg3.bin'),g5=read('gg5.bin');
  if(g4.length!==0x4000||g3.length!==0x8000||g5.length!==0x8000)
    throw Error('R35_T5_PROGRAM_ROM_SIZE');
  const region=new Uint8Array(0x18000);
  region.set(g4,0x4000);region.set(g3,0x8000);region.set(g5,0x10000);
  const fixed=new Uint8Array(0x10000);
  fixed.set(region.subarray(0x6000,0x10000),0x6000);
  const banks=new Uint8Array(5*0x2000);
  banks.set(region.subarray(0x10000,0x18000),0);
  banks.set(region.subarray(0x4000,0x6000),4*0x2000);
  return {fixed,banks};
}
