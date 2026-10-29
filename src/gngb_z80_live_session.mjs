/** Persistent sound CPU driven only by current MC6809 bus events. */
import {compileZ80Prefix} from './gngb_z80_static_codegen.mjs';
import {createZ80SoundBus} from './gngb_z80_sound_bus.mjs';
import {createZ80SchedulerLab} from './gngb_z80_scheduler_lab.mjs';

export class AudioLiveStop extends Error {
  constructor(code){super(code);this.code=code;}
}
export async function createZ80LiveSession(rom,{onYmEvent=()=>{},
  maxStepsPerFrame=300000}={}) {
  if(!(rom instanceof Uint8Array)||rom.length!==0x8000||
     typeof onYmEvent!=='function'||
     !Number.isInteger(maxStepsPerFrame)||maxStepsPerFrame<1)
    throw new AudioLiveStop('AUDIO_LIVE_CONFIG_INVALID');
  const compiled=compileZ80Prefix(rom,{entries:[0,0x38],limit:16384});
  const generated=await import('data:text/javascript,'+
    encodeURIComponent(compiled.source));
  const blocks=new Map(generated.z80AotBlocks);
  let resolutions=0,ymWrites=0,latchReads=0,maxOvershoot=0;
  const resolved=[];
  const bus=createZ80SoundBus(rom,{
    onYmWrite:e=>{ymWrites++;onYmEvent({kind:'W',tick:e.tick12m,
      addr:e.addr,value:e.value});},
    onReset:e=>{if(e.resetAsserted)onYmEvent({kind:'R',tick:e.tick12m});},
    onLatchRead:()=>{latchReads++;}
  });
  const resolveUncompiledPc=(pc,map)=>{
    if(++resolutions>4096)
      throw new AudioLiveStop('AUDIO_LIVE_DYNAMIC_BUDGET_STOP');
    if(!Number.isInteger(pc)||pc<0||pc>=rom.length)
      throw new AudioLiveStop('AUDIO_LIVE_PC_OUTSIDE_ROM');
    const single=compileZ80Prefix(rom,{entry:pc,limit:1});
    if(single.compiled!==1){
      const first=single.blockers[0];
      const tag=first?.indexed_instruction??first?.cb_instruction??
        first?.ed_instruction??first?.family??first?.reason??'UNKNOWN';
      const rotate={15:'RRCA',23:'RLA',31:'RRA'};
      const reg={66:'BC',82:'DE',98:'HL',114:'SP'};
      const ext=rom[pc+3],group=ext>>>6;
      const indexedCb=tag==='INDEX_BIT_ROTATE_DISPLACEMENT'?
        'INDEX_CB_'+(rom[pc]===0xdd?'IX':'IY')+'_'+
        (group===0?['RLC','RRC','RL','RR','SLA','SRA','SLL','SRL']
          [(ext>>>3)&7]:group===1?'BIT'+((ext>>>3)&7):
          group===2?'RES'+((ext>>>3)&7):'SET'+((ext>>>3)&7))+'_'+
        ((ext&7)===6?'MEM':'REGISTER'):null;
      const indexedTransfer={225:'POP',227:'EX_SP',229:'PUSH',
        233:'JP',249:'LD_SP'};
      const indexedStack=tag==='INDEX_STACK_JUMP_TRANSFER'?
        'INDEX_'+(indexedTransfer[rom[pc+1]]??'UNKNOWN')+'_'+
        (rom[pc]===0xdd?'IX':'IY'):null;
      const indexedUpdate=tag==='INDEX_DISPLACEMENT_UPDATE'?
        'INDEX_'+({52:'INC',53:'DEC',54:'LD'}[rom[pc+1]]??'UNKNOWN')+
        '_'+(rom[pc]===0xdd?'IX':'IY')+'_DISP':null;
      const cb=rom[pc+1],cbRegs=['B','C','D','E','H','L','HL_MEM','A'];
      const cbBit=tag==='CB_BIT_TEST'?
        'CB_BIT'+((cb>>>3)&7)+'_'+cbRegs[cb&7]:null;
      const specific=tag==='ROTATE_ACCUMULATOR'?
        (rotate[rom[pc]]??tag):
        tag==='ED_SBC_HL_RR'?'ED_SBC_HL_'+(reg[rom[pc+1]]??'UNKNOWN'):
        indexedCb??indexedStack??indexedUpdate??cbBit??tag;
      const family=/^[A-Z0-9_]{1,48}$/.test(specific)?specific:'UNKNOWN';
      throw new AudioLiveStop('AUDIO_LIVE_OPCODE_UNSUPPORTED_'+family);
    }
    const prefix='export const z80AotBlocks=';
    if(!single.source.includes(prefix))
      throw new AudioLiveStop('AUDIO_LIVE_CODE_FORMAT_STOP');
    let one;
    try{one=new Function(single.source.replace(prefix,'return '))();}
    catch{throw new AudioLiveStop('AUDIO_LIVE_CODE_FORMAT_STOP');}
    const fn=one.get(pc);
    if(typeof fn!=='function')
      throw new AudioLiveStop('AUDIO_LIVE_CODE_FORMAT_STOP');
    map.set(pc,fn);
    resolved.push(pc);
  };
  const z80=createZ80SchedulerLab(blocks,bus,{maxStepsPerAdvance:1000000,
    resolveUncompiledPc});
  let lastCycle=-1,frontierCycle=0,mainCommands=0,resetTransitions=0;
  const advanceToCycle=cycle=>{
    const target=cycle*2;
    if(!Number.isSafeInteger(target)||target<z80.state.t)
      throw new AudioLiveStop('AUDIO_LIVE_CLOCK_REORDERED');
    if(bus.resetAsserted)z80.advanceResetClockTo(target);
    else {
      const before=z80.snapshot().executedSteps;
      while(z80.state.t<target){
        const cap=Math.min(target,z80.state.t+1000000);
        z80.advanceTo(cap,{maxSteps:1000000});
        if(z80.snapshot().executedSteps-before>maxStepsPerFrame)
          throw new AudioLiveStop('AUDIO_LIVE_STEP_BUDGET_STOP');
      }
    }
    maxOvershoot=Math.max(maxOvershoot,z80.state.t-target);
  };
  const apply=e=>{
    if(!e||!['SOUNDLATCH_WRITE','AUDIO_RESET_LINE'].includes(e.kind)||
       !Number.isSafeInteger(e.cycle)||e.cycle<lastCycle||
       e.cycle<frontierCycle||!Number.isInteger(e.value)||
       e.value<0||e.value>255||
       (e.kind==='AUDIO_RESET_LINE'&&e.value>1))
      throw new AudioLiveStop('AUDIO_LIVE_EVENT_INVALID');
    // A sound instruction crossing a main event completes before latch/reset
    // becomes visible to the next instruction. Its original tick is retained.
    if(e.cycle*2>z80.state.t)advanceToCycle(e.cycle);
    maxOvershoot=Math.max(maxOvershoot,z80.state.t-e.cycle*2);
    bus.applyMainEvent(e);
    if(e.kind==='AUDIO_RESET_LINE'){
      z80.syncBoardReset();resetTransitions++;
    }else mainCommands++;
    lastCycle=e.cycle;
  };
  const completeThrough=cycle=>{
    if(!Number.isSafeInteger(cycle)||cycle<frontierCycle||
       cycle<lastCycle)throw new AudioLiveStop('AUDIO_LIVE_FRONTIER_INVALID');
    if(cycle*2>z80.state.t)advanceToCycle(cycle);
    frontierCycle=cycle;
    return snapshot();
  };
  const snapshot=()=>Object.freeze({mainCommands,resetTransitions,
    latchReads,ymWrites,irqRequests:z80.snapshot().irqRequests,
    irqAcknowledged:z80.snapshot().irqAcknowledged,
    executedSteps:z80.snapshot().executedSteps,
    dynamicResolutions:resolutions,maxOvershootTStates:maxOvershoot,
    tStates:z80.state.t,frontierCycle,inReset:bus.resetAsserted});
  // Checkpoint after completeThrough(): bus, Z80 and counters. The
  // single-instruction blocks resolved so far are compiled again on import.
  const exportState=()=>({bus:bus.exportState(),z80:z80.exportState(),
    resolved:[...resolved],resolutions,ymWrites,latchReads,maxOvershoot,
    lastCycle,frontierCycle,mainCommands,resetTransitions});
  const importState=s=>{
    if(frontierCycle!==0||mainCommands||resetTransitions||
       !Array.isArray(s?.resolved)||!Number.isSafeInteger(s.frontierCycle))
      throw new AudioLiveStop('AUDIO_LIVE_STATE_INVALID');
    for(const pc of s.resolved)if(!blocks.has(pc))resolveUncompiledPc(pc,blocks);
    bus.importState(s.bus);z80.importState(s.z80);
    ({resolutions,ymWrites,latchReads,maxOvershoot,lastCycle,frontierCycle,
      mainCommands,resetTransitions}=s);
  };
  return Object.freeze({apply,completeThrough,snapshot,exportState,importState});
}
