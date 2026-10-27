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

const r8ReadSource=[
  '($.bc>>>8)&255','$.bc&255','($.de>>>8)&255','$.de&255',
  '($.hl>>>8)&255','$.hl&255',null,'$.a'
];
const r8WriteSource=[
  '$.bc=(($.bc&255)|(value<<8));',
  '$.bc=(($.bc&65280)|value);',
  '$.de=(($.de&255)|(value<<8));',
  '$.de=(($.de&65280)|value);',
  '$.hl=(($.hl&255)|(value<<8));',
  '$.hl=(($.hl&65280)|value);',
  null,
  '$.a=value;'
];
// Selected at offline compile-time. Generated functions contain no opcode decode.
function compileIncDecR(opcode,next) {
  const index=(opcode>>>3)&7,increment=(opcode&7)===4;
  const memory=index===6;
  const old=memory?'bus.read8($.hl,$.t+4)':r8ReadSource[index];
  const updated=increment?'(old+1)&255':'(old-1)&255';
  const half=increment?'(old&15)===15':'(old&15)===0';
  const overflow=increment?'old===127':'old===128';
  const lines=[
    'const old='+old+';',
    'const value='+updated+';',
    '$.f=($.f&1)|(value&0xa8)|(value===0?0x40:0)|('+
      half+'?0x10:0)|('+overflow+'?0x04:0)'+(increment?'':'|0x02')+';',
    memory?'bus.write8($.hl,value,$.t+8);':r8WriteSource[index],
    '$.pc='+next+';',
    '$.t+='+String(memory?11:4)+';'
  ];
  return lines;
}


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

/**
 * Classify the SECOND byte of ED for private frontier diagnostics.
 * Only mnemonic/family names leave the Mac; no ROM-derived bytes are logged.
 */
export function classifyZ80EdInstruction(second) {
  if(!Number.isInteger(second)||second<0||second>255)
    throw new Z80StaticError('AUDIO_Z80_ED_DIAGNOSTIC_INVALID');
  if([0x46,0x4e,0x66,0x6e].includes(second))return 'ED_IM_0';
  if([0x56,0x76].includes(second))return 'ED_IM_1';
  if([0x5e,0x7e].includes(second))return 'ED_IM_2';
  if([0x44,0x4c,0x54,0x5c,0x64,0x6c,0x74,0x7c].includes(second))return 'ED_NEG';
  if(second===0x4d)return 'ED_RETI';
  if([0x45,0x55,0x5d,0x65,0x6d,0x75,0x7d].includes(second))return 'ED_RETN';
  if(second===0x47)return 'ED_LD_I_A';
  if(second===0x4f)return 'ED_LD_R_A';
  if(second===0x57)return 'ED_LD_A_I';
  if(second===0x5f)return 'ED_LD_A_R';
  if(second===0x67)return 'ED_RRD';
  if(second===0x6f)return 'ED_RLD';
  if([0xa0,0xa8,0xb0,0xb8].includes(second))return 'ED_BLOCK_TRANSFER';
  if([0xa1,0xa9,0xb1,0xb9].includes(second))return 'ED_BLOCK_COMPARE';
  if([0xa2,0xaa,0xb2,0xba].includes(second))return 'ED_BLOCK_INPUT';
  if([0xa3,0xab,0xb3,0xbb].includes(second))return 'ED_BLOCK_OUTPUT';
  if((second&0xc7)===0x40)return 'ED_IN_PORT';
  if((second&0xc7)===0x41)return 'ED_OUT_PORT';
  if((second&0xcf)===0x42)return 'ED_SBC_HL_RR';
  if((second&0xcf)===0x4a)return 'ED_ADC_HL_RR';
  if((second&0xcf)===0x43)return 'ED_LD_DIRECT_RR';
  if((second&0xcf)===0x4b)return 'ED_LD_RR_DIRECT';
  return 'ED_UNASSIGNED_OR_UNDOCUMENTED';
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
      case 0xed: {
        const ext=read8(pc,1);
        const kind=classifyZ80EdInstruction(ext);
        if(kind==='ED_IM_0'||kind==='ED_IM_1'||kind==='ED_IM_2') {
          const mode=Number(kind[kind.length-1]);
          length=2;
          lines=['$.im='+mode+';','$.pc='+next(2)+';','$.t+=8;'];
          targets=[next(2)];
        } else if(kind==='ED_NEG') {
          length=2;
          lines=[
            'const old=$.a;const value=(-old)&255;',
            // S, Z, F5, H, F3, P/V, N, C. No Z80 R/I handling claimed.
            '$.f=(value&0xa8)|(value===0?0x40:0)|',
            '((old&15)!==0?0x10:0)|(old===128?0x04:0)|0x02|(old!==0?1:0);',
            '$.a=value;$.pc='+next(2)+';','$.t+=8;'];
          targets=[next(2)];
        } else if(kind==='ED_LD_I_A') {
          length=2;
          lines=['$.i=$.a;','$.pc='+next(2)+';','$.t+=9;'];
          targets=[next(2)];
        } else {
          blockers.push({pc,reason:'UNSUPPORTED_Z80_ED_INSTRUCTION',
            family:'ED_EXTENDED_PREFIX',ed_instruction:kind});
          continue;
        }
        break;
      }
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
      case 0x20: case 0x28: case 0x30: case 0x38: {
        // JR NZ/Z/NC/C,e. Only F.Z (0x40) or F.C (0x01) is inspected.
        // Flags and registers are unchanged. Taken=12 T; not taken=7 T.
        const fallthrough=next(2), dest=next(2+sign8(read8(pc,1)));
        const mask=(opcode===0x20||opcode===0x28)?0x40:0x01;
        const wantSet=(opcode===0x28||opcode===0x38);
        length=2;
        lines=[
          'const take='+(wantSet?'(($.f&'+mask+')!==0);':'(($.f&'+mask+')===0);'),
          '$.pc=(take?'+dest+':'+fallthrough+');',
          '$.t+=(take?12:7);'
        ];
        targets=[fallthrough,dest];
        break;
      }
      case 0x10: {
        // DJNZ e: decrement B (high byte of BC) modulo 256, leave flags intact.
        // Not taken: 8 T-states; taken: 13 T-states. Explore BOTH static edges.
        const fallthrough=next(2),dest=next(2+sign8(read8(pc,1)));
        length=2;
        lines=[
          'const b=((($.bc>>>8)-1)&255);',
          '$.bc=((b<<8)|($.bc&255));',
          '$.pc=(b!==0?'+dest+':'+fallthrough+');',
          '$.t+=(b!==0?13:8);'
        ];
        targets=[fallthrough,dest];
        break;
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
        if((opcode&0xc7)===0x05 || (opcode&0xc7)===0x04) {
          // DEC/INC B,C,D,E,H,L,(HL),A: signed-8-bit flag semantics.
          // Register operand: 4 T-states; (HL): 11 T-states.
          lines=compileIncDecR(opcode,next(1));
          targets=[next(1)];
          break;
        }
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
