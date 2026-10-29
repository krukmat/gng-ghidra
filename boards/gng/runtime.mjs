/**
 * R3.5.B2.T5: gngb board runtime for AOT-compiled MC6809 blocks.
 *
 * Runs from a cold reset or an exact frame-boundary checkpoint. Board
 * behaviour follows MAME 0.289 gng.cpp (gng_main_map,
 * machine_reset) and the T4.4 decision: one VBLANK IRQ per frame,
 * irq0_line_hold (asserted until acknowledged), SYNC per base6x09.lst.
 *
 * Unknown values fail closed: registers MAME's reset leaves untouched
 * (A,B,X,Y,U,S and CC bits other than I/F), RAM never written and the
 * bank window before the first bank write. Push/pull/TFR/EXG carry
 * per-bit known masks; any other use of an unknown value throws.
 */
import {createMc6809State,createMc6809Executor} from '../../base/src/cpu/mc6809/executor.mjs';
import {createGngCodeView} from './code-view.mjs';

export const CYCLES_PER_FRAME=25152;          // 384x262 @ 6 MHz, CPU 1.5 MHz
export const PORT_DEFAULTS=[0xff,0xff,0xff,0xdf,0xfb]; // SYSTEM,P1,P2,DSW1,DSW2
export const RECORD_BYTES=0x3800;

export class GngbRuntimeError extends Error{
  constructor(code,detail){super(code);this.code=code;this.detail=detail;}
}

export function createBoard(code,blocks,{frames,onFrame,cyclesPerFrame=CYCLES_PER_FRAME,
  portRead=null,onPortRead=null,onAudioEvent=null,onAudioComplete=null}={}){
  if(!Number.isInteger(cyclesPerFrame)||cyclesPerFrame<1)
    throw Error('V2_B1_INVALID_IRQ_PERIOD');
  if(portRead!==null&&typeof portRead!=='function')
    throw Error('V3_B2A_INVALID_PORT_READER');
  if(onPortRead!==null&&typeof onPortRead!=='function')
    throw Error('V3_B2A_INVALID_PORT_OBSERVER');
  if(onAudioEvent!==null&&typeof onAudioEvent!=='function')
    throw Error('AUDIO_EVENT_HANDLER_INVALID');
  if(onAudioComplete!==null&&typeof onAudioComplete!=='function')
    throw Error('AUDIO_COMPLETE_HANDLER_INVALID');
  const mem=new Uint8Array(0x3000),km=new Uint8Array(0x3000);
  const palExt=new Uint8Array(0x100),pal=new Uint8Array(0x100);
  // machine_reset: palette RAM filled with 00/55/aa/ff, scroll zeroed.
  for(let i=0;i<0x100;i++)palExt[i]=pal[i]=[0x00,0x55,0xaa,0xff][i&3];
  const $={
    ...createMc6809State(cyclesPerFrame),bank:null,
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
  const view=createGngCodeView(code);
  const codeAt=pc=>{
    if(pc<0x3000){
      const id=overlayAt(pc);
      return id<0?null:view.at(pc,null,id);
    }
    if(pc<0x4000)fail('R35_T5_EXEC_OUTSIDE_ROM',{target:pc});
    if(pc<0x6000&&$.bank===null)fail('R35_T5_BANK_UNSELECTED_EXEC',{target:pc});
    return view.at(pc,$.bank);
  };
  // An identity depends only on (overlay, bank, pc): build and validate each
  // one once instead of on every dispatched block; the bank/ROM checks still
  // run. Cached keys are the blocks' own strings, so the executor's lookup
  // compares identical objects instead of characters.
  const keys=new Map(),own=new Map([...blocks.keys()].map(k=>[k,k]));
  const slot=pc=>{
    if(pc<0x3000){
      const id=overlayAt(pc);
      return id<0?-1:0x100000+id*0x10000+pc;
    }
    if(pc<0x4000)fail('R35_T5_EXEC_OUTSIDE_ROM',{target:pc});
    if(pc<0x6000&&$.bank===null)fail('R35_T5_BANK_UNSELECTED_EXEC',{target:pc});
    return pc<0x6000?($.bank+1)*0x10000+pc:pc;
  };
  const cpu=createMc6809Executor($,{blocks,cyclesPerFrame,
    readVector:a=>code.fixed[a]<<8|code.fixed[a+1],
    codeKey:pc=>{
      const n=slot(pc);
      if(n<0)return null;
      let key=keys.get(n);
      if(key===undefined){
        const at=codeAt(pc);
        if(at){key=view.identity(at);key=own.get(key)??key;}else key=null;
        keys.set(n,key);
      }
      return key;
    },
    codeContext:pc=>{const at=codeAt(pc);return at?view.context(at):'';},
    onBoundary:at=>{
      if(!$.snapped)snapshot();
      $.irq=true;
      ev('LINE_DELIVERED','IRQ',1,at);
    },
    onInstructionComplete:()=>{
      if(onAudioComplete)onAudioComplete(Object.freeze({
        cycle:$.C,frames:$.records.length}));
    },onEvent:(...args)=>ev(...args)});
  const CK_SCALARS=['a','b','dp','x','y','u','s','cc','PC','ka','kb','kdp',
    'kx','ky','ku','ks','kcc','C','T','ipc','lk','irq','sync','bank',
    'soundlatch','snapped','frame'];
  const exportState=()=>({
    cpu:Object.fromEntries(CK_SCALARS.map(k=>[k,$[k]])),
    st:$.st&&[...$.st],scroll:[...$.scroll],latch:[...$.latch],
    writes:{...$.writes},frames:$.records.length,
    mem:mem.slice(),km:km.slice(),palExt:palExt.slice(),pal:pal.slice(),
    dma:$.dma&&$.dma.slice(),dmaMask:$.dmaMask&&$.dmaMask.slice()});
  const importState=s=>{
    if(cpu.hasStarted()||$.C!==0||$.events.length)throw Error('CK_IMPORT_AFTER_START');
    const bytes=(v,n)=>v instanceof Uint8Array&&v.length===n;
    if(!s||!bytes(s.mem,0x3000)||!bytes(s.km,0x3000)||
       !bytes(s.palExt,0x100)||!bytes(s.pal,0x100)||
       (s.dma===null)!==(s.dmaMask===null)||
       (s.dma!==null&&(!bytes(s.dma,0x200)||!bytes(s.dmaMask,0x200)))||
       !CK_SCALARS.every(k=>k in s.cpu)||!Number.isSafeInteger(s.frames)||
       s.frames<0||s.scroll?.length!==4||s.latch?.length!==8)
      throw Error('CK_STATE_INVALID');
    for(const k of CK_SCALARS)$[k]=s.cpu[k];
    $.st=s.st&&[...s.st];$.scroll=[...s.scroll];$.latch=[...s.latch];
    $.writes={...s.writes};
    mem.set(s.mem);km.set(s.km);palExt.set(s.palExt);pal.set(s.pal);
    $.dma=s.dma&&s.dma.slice();$.dmaMask=s.dmaMask&&s.dmaMask.slice();
    $.records.length=s.frames;
    cpu.restoreCpu();
  };
  const run=(until=frames)=>cpu.runUntilFrame(until);
  return {state:$,run,advance:cpu.advance,exportState,importState};
}
