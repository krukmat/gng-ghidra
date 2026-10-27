/**
 * G5 A2.T2 — strict OFFLINE Z80-to-JavaScript instruction compiler.
 * This is a prefix/prototype, NOT full Z80 ISA or complete sound ROM.
 * The produced code is ROM-derived: store ONLY in out/audio/, never in git.
 * Runtime dispatches already-compiled functions by PC; no opcode interpreter.
 */
export class Z80StaticError extends Error {
  constructor(code, detail={}) { super(code); this.code=code; this.detail=detail; }
}
const sign8=x=>(x&128)?x-256:x;

/**
 * ROM-private diagnostic categories: never emit instruction bytes or operands.
 * This classifies the Z80 instruction family, not its correctness or reachability.
 */
export function classifyZ80Family(opcode) {
  if (!Number.isInteger(opcode) || opcode<0 || opcode>255)
    throw new Z80StaticError('AUDIO_Z80_DIAGNOSTIC_BAD_OPCODE');
  switch(opcode) {
    case 0xcb: return 'CB_BIT_ROTATE_PREFIX';
    case 0xed: return 'ED_EXTENDED_PREFIX';
    case 0xdd: return 'DD_IX_PREFIX';
    case 0xfd: return 'FD_IY_PREFIX';
    case 0x76: return 'HALT';
    case 0xfb: return 'EI';
    case 0xf3: return 'DI';
    case 0x10: return 'DJNZ';
    case 0x18: return 'JR';
    case 0x20: case 0x28: case 0x30: case 0x38: return 'JR_CONDITIONAL';
    case 0xc3: return 'JP';
    case 0xc9: return 'RET';
    case 0xcd: return 'CALL';
    case 0xdb: case 0xd3: return 'IO_PORT';
    case 0x08: case 0xd9: case 0xeb: case 0xe3: return 'EXCHANGE';
    case 0x27: case 0x2f: case 0x37: case 0x3f: return 'ALU_FLAG_MISC';
    case 0x22: case 0x2a: case 0x32: case 0x3a: return 'LD_DIRECT';
    case 0x00: return 'NOP';
  }
  if(opcode>=0x40&&opcode<=0x7f)return 'LD_R_R';
  if(opcode>=0x80&&opcode<=0xbf)return 'ALU_REGISTER';
  if((opcode&0xc7)===0x06)return 'LD_R_IMMEDIATE';
  if((opcode&0xc7)===0x04)return 'INC_R';
  if((opcode&0xc7)===0x05)return 'DEC_R';
  if((opcode&0xcf)===0x01)return 'LD_RR_IMMEDIATE';
  if((opcode&0xcf)===0x03)return 'INC_RR';
  if((opcode&0xcf)===0x0b)return 'DEC_RR';
  if((opcode&0xc7)===0xc6)return 'ALU_IMMEDIATE';
  if((opcode&0xc7)===0xc2)return 'JP_CONDITIONAL';
  if((opcode&0xc7)===0xc4)return 'CALL_CONDITIONAL';
  if((opcode&0xc7)===0xc0)return 'RET_CONDITIONAL';
  if((opcode&0xcf)===0xc5)return 'PUSH_RR';
  if((opcode&0xcf)===0xc1)return 'POP_RR';
  if((opcode&0xc7)===0xc7)return 'RST';
  return 'Z80_OTHER';
}
export function compileZ80Prefix(rom, {entry=0, limit=512}={}) {
  if(!(rom instanceof Uint8Array) || rom.length!==0x8000)
    throw new Z80StaticError('AUDIO_Z80_ROM_IMAGE_INVALID');
  if(!Number.isInteger(entry)||entry<0||entry>=rom.length ||
     !Number.isInteger(limit)||limit<1||limit>16384)
    throw new Z80StaticError('AUDIO_Z80_COMPILE_ARGS_INVALID');
  const pending=[entry], visited=new Map(), blockers=[];
  const read8=(pc,i)=>{
    if(pc+i>=rom.length)throw new Z80StaticError('AUDIO_Z80_ROM_BOUNDARY',{pc});
    return rom[pc+i];
  };
  while(pending.length && visited.size<limit) {
    const pc=pending.shift();
    if(visited.has(pc))continue;
    if(pc<0 || pc>=0x8000){
      blockers.push({pc,reason:'OUTSIDE_SOUND_ROM'});continue;
    }
    const opcode=rom[pc],next=n=>(pc+n)&0xffff;
    let lines=[],targets=[],length=1;
    const w16=()=>read8(pc,1)|(read8(pc,2)<<8);
    switch(opcode) {
      case 0x00: lines=['$.pc='+next(1)+';','$.t+=4;'];targets=[next(1)];break;
      case 0xf3: lines=['$.iff1=false;$.iff2=false;$.pc='+next(1)+';','$.t+=4;'];targets=[next(1)];break;
      case 0x31: {
        const v=w16();length=3;lines=['$.sp='+v+';','$.pc='+next(3)+';','$.t+=10;'];targets=[next(3)];break;
      }
      case 0x21: case 0x11: case 0x01: {
        const v=w16(), reg=opcode===0x21?'hl':opcode===0x11?'de':'bc';length=3;
        lines=['$.'+reg+'='+v+';','$.pc='+next(3)+';','$.t+=10;'];targets=[next(3)];break;
      }
      case 0x3e: {
        const v=read8(pc,1);length=2;lines=['$.a='+v+';','$.pc='+next(2)+';','$.t+=7;'];targets=[next(2)];break;
      }
      case 0xaf: lines=['$.a=0;$.f=0x44;','$.pc='+next(1)+';','$.t+=4;'];targets=[next(1)];break;
      case 0x23:case 0x2b: {
        const delta=opcode===0x23?1:-1;
        lines=['$.hl=($.hl+'+delta+')&65535;','$.pc='+next(1)+';','$.t+=6;'];
        targets=[next(1)];break;
      }
      case 0x77:case 0x7e: {
        const v=opcode===0x77?'bus.write8($.hl,$.a,$.t+7);':'$.a=bus.read8($.hl,$.t+7);';
        lines=[v,'$.pc='+next(1)+';','$.t+=7;'];targets=[next(1)];break;
      }
      case 0x32:case 0x3a:{
        const addr=w16();length=3;
        const v=opcode===0x32?'bus.write8('+addr+',$.a,$.t+13);':'$.a=bus.read8('+addr+',$.t+13);';
        lines=[v,'$.pc='+next(3)+';','$.t+=13;'];targets=[next(3)];break;
      }
      case 0xc3: {
        const addr=w16();length=3;lines=['$.pc='+addr+';','$.t+=10;'];targets=[addr];break;
      }
      case 0x18: {
        const dest=next(2+sign8(read8(pc,1)));length=2;
        lines=['$.pc='+dest+';','$.t+=12;'];targets=[dest];break;
      }
      case 0xcd: {
        const dest=w16(),ret=next(3);length=3;
        lines=['$.sp=($.sp-1)&65535;bus.write8($.sp,'+(ret>>8)+',$.t+11);',
          '$.sp=($.sp-1)&65535;bus.write8($.sp,'+(ret&255)+',$.t+14);',
          '$.pc='+dest+';','$.t+=17;'];targets=[dest,ret];break;
      }
      case 0xc9:
        lines=['const lo=bus.read8($.sp,$.t+4);$.sp=($.sp+1)&65535;',
          'const hi=bus.read8($.sp,$.t+7);$.sp=($.sp+1)&65535;',
          '$.pc=(hi<<8)|lo;$.t+=10;'];targets=[];break;
      default:
        blockers.push({pc,reason:'UNSUPPORTED_Z80_OPCODE',family:classifyZ80Family(opcode)});
        continue;
    }
    const source='($,bus)=>{'+lines.join('')+'}';
    visited.set(pc,{pc,length,source});
    for(const t of targets)if(!visited.has(t)&&!pending.includes(t))pending.push(t);
  }
  const status=(blockers.length || pending.length)?'PARTIAL_UNCERTIFIED':'SUPPORTED_PREFIX_ONLY';
  const source='// ROM-derived private Z80 AOT prefix; NOT a full audio engine.\n'+
    'export const z80AotBlocks=new Map([\n'+
    [...visited.values()].sort((a,b)=>a.pc-b.pc).map(x=>'  ['+x.pc+','+x.source+']').join(',\n')+
    '\n]);\n';
  return {status,source,compiled:visited.size,blockers,pending:pending.length};
}
