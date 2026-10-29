/**
 * G5 A2: isolated Z80 sound board bus for statically compiled Z80 instructions.
 * NO Z80 opcode interpreter, no YM synthesis, no automatic CPU scheduler.
 * ROM must be hash-verified by the private audio_extract_sound_rom.py step.
 */
export const Z80_SOUND_HARDWARE=Object.freeze({
  masterHz:12000000,mainHz:1500000,z80Hz:3000000,
  masterTicksPerMain:8,masterTicksPerZ80:4,
  z80IrqHz:240,z80IrqPeriodTStates:12500,
  ymAddresses:[0xe000,0xe001,0xe002,0xe003]
});
export class SoundBusStop extends Error {
  constructor(code,detail={}) {super(code);this.code=code;this.detail=detail;}
}
export function createZ80SoundBus(rom,{onYmWrite=null,onReset=null,
    onLatchRead=null,mainCycleAnchor=0,masterTickAnchor=0}={}) {
  if(!(rom instanceof Uint8Array)||rom.length!==0x8000)
    throw new SoundBusStop('AUDIO_Z80_BAD_ROM_SHAPE');
  if((onYmWrite!==null&&typeof onYmWrite!=='function')||
     (onReset!==null&&typeof onReset!=='function')||
     (onLatchRead!==null&&typeof onLatchRead!=='function'))
    throw new SoundBusStop('AUDIO_Z80_BAD_OBSERVER');
  for(const n of [mainCycleAnchor,masterTickAnchor])
    if(!Number.isSafeInteger(n)||n<0)
      throw new SoundBusStop('AUDIO_BAD_CLOCK_ANCHOR');
  const ram=new Uint8Array(0x800),events=[];
  let latch=0,resetAsserted=true,lastMainCycle=-1;
  const valid8=(x)=>Number.isInteger(x)&&x>=0&&x<=255;
  const validAddr=(x)=>Number.isInteger(x)&&x>=0&&x<=0xffff;
  const clock=(t)=>{
    if(!Number.isSafeInteger(t)||t<0)
      throw new SoundBusStop('AUDIO_Z80_INVALID_TSTATE');
    const ticks=masterTickAnchor+4*t;
    if(!Number.isSafeInteger(ticks))
      throw new SoundBusStop('AUDIO_Z80_TICK_OVERFLOW');
    return ticks;
  };
  const requireReleased=()=>{
    if(resetAsserted)throw new SoundBusStop('AUDIO_Z80_IN_RESET');
  };
  const read8=(addr,tState)=>{
    requireReleased();clock(tState);
    if(!validAddr(addr))throw new SoundBusStop('AUDIO_Z80_ADDRESS_INVALID');
    if(addr<0x8000)return rom[addr];
    if(addr>=0xc000&&addr<0xc800)return ram[addr-0xc000];
    if(addr===0xc800){
      // Observer receives *time only*, never the private command byte.
      if(onLatchRead)onLatchRead(Object.freeze({z80TState:tState}));
      return latch;
    }
    throw new SoundBusStop('AUDIO_Z80_UNMAPPED_READ',{addr});
  };
  const write8=(addr,value,tState)=>{
    requireReleased();
    const tick12m=clock(tState);
    if(!validAddr(addr)||!valid8(value))
      throw new SoundBusStop('AUDIO_Z80_BAD_WRITE',{addr});
    if(addr>=0xc000&&addr<0xc800){ram[addr-0xc000]=value;return;}
    if(addr>=0xe000&&addr<=0xe003){
      const ev=Object.freeze({kind:'YM2203_WRITE',addr,value,tick12m,z80TState:tState});
      if(onYmWrite)onYmWrite(ev);
      return;
    }
    throw new SoundBusStop('AUDIO_Z80_UNMAPPED_WRITE',{addr});
  };
  const applyMainEvent=e=>{
    if(!e||!['SOUNDLATCH_WRITE','AUDIO_RESET_LINE'].includes(e.kind)||
       !Number.isSafeInteger(e.cycle)||e.cycle<mainCycleAnchor||
       e.cycle<lastMainCycle || !valid8(e.value))
      throw new SoundBusStop('AUDIO_Z80_BAD_MAIN_EVENT');
    if(e.kind==='AUDIO_RESET_LINE'&&e.value!==0&&e.value!==1)
      throw new SoundBusStop('AUDIO_Z80_BAD_RESET');
    const tick12m=masterTickAnchor+8*(e.cycle-mainCycleAnchor);
    if(!Number.isSafeInteger(tick12m))
      throw new SoundBusStop('AUDIO_Z80_TICK_OVERFLOW');
    lastMainCycle=e.cycle;
    if(e.kind==='SOUNDLATCH_WRITE')latch=e.value; // hardware holds last value, not FIFO
    else {
      resetAsserted=(e.value===0);
      if(onReset)onReset(Object.freeze({resetAsserted,tick12m}));
    }
    return {kind:e.kind,tick12m};
  };
  // Checkpoint: the whole bus state between main-CPU events.
  const exportState=()=>({ram:ram.slice(),latch,resetAsserted,lastMainCycle});
  const importState=s=>{
    if(!(s?.ram instanceof Uint8Array)||s.ram.length!==ram.length||
       !valid8(s.latch)||typeof s.resetAsserted!=='boolean'||
       !Number.isSafeInteger(s.lastMainCycle))
      throw new SoundBusStop('AUDIO_Z80_STATE_INVALID');
    ram.set(s.ram);latch=s.latch;resetAsserted=s.resetAsserted;
    lastMainCycle=s.lastMainCycle;
  };
  return {read8,write8,applyMainEvent,exportState,importState,
    get soundLatch(){return latch},
    get resetAsserted(){return resetAsserted}};
}
