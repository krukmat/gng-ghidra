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
    case 0x09: case 0x19: case 0x29: case 0x39: return 'ADD_HL_RR';
    case 0x02: case 0x0a: case 0x12: case 0x1a: return 'LD_ACCUMULATOR_INDIRECT';
    case 0x07: case 0x0f: case 0x17: case 0x1f: return 'ROTATE_ACCUMULATOR';
    case 0xe9: return 'JP_INDIRECT';
    case 0xf9: return 'LD_SP_HL';
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

/**
 * Static classifier for DD/FD SECOND byte, no opcode/operand values in reports.
 * This is NOT indexed instruction execution, and never implies parity.
 */
export function classifyZ80IndexedInstruction(second) {
  if(!Number.isInteger(second)||second<0||second>255)
    throw new Z80StaticError('AUDIO_Z80_INDEX_DIAGNOSTIC_INVALID');
  if(second===0x21)return 'INDEX_LD_RR_IMMEDIATE';
  if(second===0x22||second===0x2a)return 'INDEX_LD_RR_ABSOLUTE';
  if(second===0x23||second===0x2b)return 'INDEX_INC_DEC_RR';
  if([0x09,0x19,0x29,0x39].includes(second))return 'INDEX_ADD_RR';
  if([0x24,0x25,0x26,0x2c,0x2d,0x2e].includes(second))
    return 'INDEX_HIGH_LOW_REGISTER';
  if([0x34,0x35,0x36].includes(second))return 'INDEX_DISPLACEMENT_UPDATE';
  if((second&0xc7)===0x46 && second!==0x76)
    return 'INDEX_DISPLACEMENT_LOAD';
  if((second&0xf8)===0x70 && second!==0x76)
    return 'INDEX_DISPLACEMENT_STORE';
  if((second&0xc7)===0x86)return 'INDEX_DISPLACEMENT_ALU';
  if(second===0xcb)return 'INDEX_BIT_ROTATE_DISPLACEMENT';
  if([0xe1,0xe3,0xe5,0xe9,0xf9].includes(second))
    return 'INDEX_STACK_JUMP_TRANSFER';
  if(second===0xdd||second===0xfd)return 'INDEX_PREFIX_CHAIN';
  return 'INDEX_UNHANDLED_SECOND_OPCODE';
}

export function compileZ80Prefix(rom, {entry=0, entries=null, limit=512}={}) {
  if(!(rom instanceof Uint8Array) || rom.length!==0x8000)
    throw new Z80StaticError('AUDIO_Z80_ROM_IMAGE_INVALID');
  if(!Number.isInteger(entry)||entry<0||entry>=rom.length ||
     !Number.isInteger(limit)||limit<1||limit>16384)
    throw new Z80StaticError('AUDIO_Z80_COMPILE_ARGS_INVALID');
  // Multiple roots may ONLY come from operator-provided native evidence.
  // This compiler does not assume arbitrary ROM offsets are code.
  const roots=entries===null?[entry]:entries;
  if(!Array.isArray(roots) || roots.length<1 || roots.length>64 ||
     roots.some(pc=>!Number.isInteger(pc)||pc<0||pc>=rom.length))
    throw new Z80StaticError('AUDIO_Z80_SEEDS_INVALID');
  const entrypoints=[...new Set(roots)];
  const pending=[...entrypoints], visited=new Map(), blockers=[], attempted=new Set();
  const read8=(pc,i)=>{
    if(pc+i>=rom.length)throw new Z80StaticError('AUDIO_Z80_ROM_BOUNDARY',{pc});
    return rom[pc+i];
  };
  while(pending.length && visited.size<limit) {
    const pc=pending.shift();
    if(attempted.has(pc))continue;
    attempted.add(pc);
    if(pc<0 || pc>=0x8000){
      blockers.push({pc,reason:'OUTSIDE_SOUND_ROM'});continue;
    }
    const opcode=rom[pc],next=n=>(pc+n)&0xffff;
    let lines=[],targets=[],length=1;
    const w16=()=>read8(pc,1)|(read8(pc,2)<<8);
    // Only DD/FD 21 (LD IX/IY,nn) is admitted by this narrowly
    // native-backed batch. All other indexed instructions remain blocked.
    if(opcode===0xdd||opcode===0xfd) {
      const second=read8(pc,1);
      if(second===0x21) {
        const nn=read8(pc,2)|(read8(pc,3)<<8);
        const reg=opcode===0xdd?'ix':'iy';
        length=4;
        lines=['$.'+reg+'='+nn+';','$.pc='+next(4)+';','$.t+=14;'];
        targets=[next(4)];
      } else if((second&0xc7)===0x46 && second!==0x76) {
        // DD/FD LD r,(IX/IY+d): only the seven destination registers,
        // never the invalid HALT-form. H/L target regular H/L, not IXH/IXL.
        const index=opcode===0xdd?'ix':'iy';
        const displacement=sign8(read8(pc,2));
        const dst=(second>>>3)&7;
        length=3;
        lines=[
          'const effective=($.'+index+'+('+displacement+'))&65535;',
          'const value=bus.read8(effective,$.t+19);',
          r8WriteSource[dst],
          '$.pc='+next(3)+';','$.t+=19;'
        ];
        targets=[next(3)];
      } else {
        blockers.push({pc,reason:'UNSUPPORTED_Z80_OPCODE',
          family:opcode===0xdd?'DD_IX_PREFIX':'FD_IY_PREFIX',
          indexed_instruction:classifyZ80IndexedInstruction(second)});
        continue;
      }
    } else switch(opcode) {
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
        } else if(kind==='ED_BLOCK_TRANSFER') {
          // LDI/LDD/LDIR/LDDR: one byte transfer per compiled step.
          // Repeating forms retain PC on BC != 0, so the scheduler can
          // service interrupts between iterations (scheduler NOT certified).
          const delta=(ext===0xa0||ext===0xb0)?1:-1;
          const repeat=ext===0xb0||ext===0xb8;
          length=2;
          lines=[
            'const byte=bus.read8($.hl,$.t+8);',
            'bus.write8($.de,byte,$.t+11);',
            '$.hl=($.hl+'+delta+')&65535;',
            '$.de=($.de+'+delta+')&65535;',
            '$.bc=($.bc-1)&65535;',
            // Z80 undocumented F5 is bit 1 of A+byte; F3 is bit 3.
            // S,Z,C are preserved; H,N reset; P/V follows new BC.
            'const sum=($.a+byte)&255;',
            '$.f=($.f&0xc1)|(sum&8)|((sum&2)<<4)|($.bc!==0?4:0);',
            repeat?
              '$.pc=($.bc!==0?'+pc+':'+next(2)+');$.t+=($.bc!==0?21:16);':
              '$.pc='+next(2)+';$.t+=16;'
          ];
          targets=repeat?[pc,next(2)]:[next(2)];
        } else {
          blockers.push({pc,reason:'UNSUPPORTED_Z80_ED_INSTRUCTION',
            family:'ED_EXTENDED_PREFIX',ed_instruction:kind});
          continue;
        }
        break;
      }
      case 0x00: lines=['$.pc='+next(1)+';','$.t+=4;'];targets=[next(1)];break;
      case 0xfb: {
        // Zilog Z80 EI: IFF1/IFF2 set immediately, maskable INT cannot be
        // acknowledged until AFTER the following instruction completes.
        // eiDelay=2 is consumed by the optional audio-only boundary helper.
        // No IRQ service, R-register fetches or native parity implied.
        lines=['$.iff1=true;$.iff2=true;$.eiDelay=2;',
          '$.pc='+next(1)+';','$.t+=4;'];
        targets=[next(1)];break;
      }
      case 0xf3: lines=['$.iff1=false;$.iff2=false;$.eiDelay=0;$.pc='+next(1)+';','$.t+=4;'];targets=[next(1)];break;
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
      case 0x09: case 0x19: case 0x29: case 0x39: {
        // ADD HL,BC/DE/HL/SP: preserve S/Z/PV, reset N,
        // set H from bit 11, C from bit 15, F3/F5 from result high byte.
        const source=opcode===0x09?'$.bc':opcode===0x19?'$.de':
          opcode===0x29?'$.hl':'$.sp';
        lines=[
          'const left=$.hl;const right='+source+';',
          'const sum=left+right;const result=sum&65535;',
          '$.f=($.f&0xc4)|((result>>>8)&0x28)|',
          '(((left&4095)+(right&4095)>4095)?16:0)|(sum>65535?1:0);',
          '$.hl=result;',
          '$.pc='+next(1)+';','$.t+=11;'
        ];
        targets=[next(1)];
        break;
      }
      case 0xc1: case 0xd1: case 0xe1: case 0xf1: {
        // POP BC/DE/HL/AF: two reads in little-endian stack order.
        // AF is split into A and F; it does not use a synthetic AF field.
        const reg=opcode===0xc1?'bc':opcode===0xd1?'de':'hl';
        lines=[
          'const lo=bus.read8($.sp,$.t+7);$.sp=($.sp+1)&65535;',
          'const hi=bus.read8($.sp,$.t+10);$.sp=($.sp+1)&65535;',
          opcode===0xf1?'$.a=hi;$.f=lo;':'$.'+reg+'=(hi<<8)|lo;',
          '$.pc='+next(1)+';','$.t+=10;'
        ];
        targets=[next(1)];
        break;
      }
      case 0xaf: lines=['$.a=0;$.f=0x44;','$.pc='+next(1)+';','$.t+=4;'];targets=[next(1)];break;
      case 0x02: case 0x0a: case 0x12: case 0x1a: {
        // LD (BC),A / LD A,(BC) / LD (DE),A / LD A,(DE).
        // One external 8-bit memory access, always 7 T; flags unchanged.
        const addr=(opcode&0x10)?'$.de':'$.bc';
        const load=(opcode&0x08)!==0;
        lines=[load?'$.a=bus.read8('+addr+',$.t+7);':
          'bus.write8('+addr+',$.a,$.t+7);',
          '$.pc='+next(1)+';','$.t+=7;'];
        targets=[next(1)];
        break;
      }
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
      case 0xc7: case 0xcf: case 0xd7: case 0xdf:
      case 0xe7: case 0xef: case 0xf7: case 0xff: {
        // RST p: one-byte CALL into a fixed 8-byte vector. Push the
        // address of the NEXT instruction, high byte then low byte.
        // M1=5T, stack writes=3T each; total 11 T-states.
        const vector=opcode&0x38,ret=next(1);
        lines=[
          '$.sp=($.sp-1)&65535;bus.write8($.sp,'+(ret>>>8)+',$.t+8);',
          '$.sp=($.sp-1)&65535;bus.write8($.sp,'+(ret&255)+',$.t+11);',
          '$.pc='+vector+';','$.t+=11;'
        ];
        targets=[vector,ret];
        break;
      }
      default:
        if(opcode>=0x40 && opcode<=0x7f && opcode!==0x76) {
          // LD r,r'; HALT remains unsupported. 4T reg, 7T memory.
          const dst=(opcode>>>3)&7,src=opcode&7;
          const memory=dst===6||src===6;
          const from=src===6?'bus.read8($.hl,$.t+7)':r8ReadSource[src];
          const write=dst===6?'bus.write8($.hl,value,$.t+7);':r8WriteSource[dst];
          lines=['const value='+from+';',write,
            '$.pc='+next(1)+';','$.t+='+String(memory?7:4)+';'];
          targets=[next(1)];
          break;
        }
        if(opcode>=0x80 && opcode<=0xbf) {
          // ADD/ADC/SUB/SBC/AND/XOR/OR/CP A,r; static operand selection.
          const alu=(opcode>>>3)&7,src=opcode&7;
          const memory=src===6;
          const from=memory?'bus.read8($.hl,$.t+7)':r8ReadSource[src];
          lines=['const rhs='+from+';','const a=$.a;'];
          if(alu<=3 || alu===7) {
            const sub=alu===2||alu===3||alu===7;
            const carry=(alu===1||alu===3)?'($.f&1)':'0';
            lines.push('const carry='+carry+';');
            if(sub)lines.push(
              'const raw=a-rhs-carry;const result=raw&255;',
              'const h=(a&15)<((rhs&15)+carry);',
              'const ov=(((a^rhs)&(a^result)&128)!==0);',
              '$.f='+(alu===7?'(rhs&0xa8)':'(result&0xa8)')+
                '|(result===0?64:0)|(h?16:0)|(ov?4:0)|2|(raw<0?1:0);'
            );
            else lines.push(
              'const raw=a+rhs+carry;const result=raw&255;',
              'const h=((a&15)+(rhs&15)+carry)>15;',
              'const ov=(((~(a^rhs))&(a^result)&128)!==0);',
              '$.f=(result&0xa8)|(result===0?64:0)|(h?16:0)|(ov?4:0)|(raw>255?1:0);'
            );
            if(alu!==7)lines.push('$.a=result;');
          } else {
            const expr=alu===4?'a&rhs':alu===5?'a^rhs':'a|rhs';
            lines.push(
              'const result=('+expr+')&255;',
              'let parity=result;parity^=parity>>>4;parity^=parity>>>2;parity^=parity>>>1;',
              '$.f=(result&0xa8)|(result===0?64:0)|'+(alu===4?'16':'0')+'|((parity&1)===0?4:0);',
              '$.a=result;'
            );
          }
          lines.push('$.pc='+next(1)+';','$.t+='+String(memory?7:4)+';');
          targets=[next(1)];
          break;
        }
        if((opcode&0xc7)===0xc0) {
          // RET NZ/Z/NC/C/PO/PE/P/M: 5T miss; 11T return.
          const condition=(opcode>>>3)&7;
          const mask=[64,64,1,1,4,4,128,128][condition];
          const set=(condition&1)===1;
          lines=[
            'const take=(($.f&'+mask+')!==0)==='+String(set)+';',
            'if(take){',
            'const lo=bus.read8($.sp,$.t+5);$.sp=($.sp+1)&65535;',
            'const hi=bus.read8($.sp,$.t+8);$.sp=($.sp+1)&65535;',
            '$.pc=(hi<<8)|lo;$.t+=11;',
            '}else{$.pc='+next(1)+';$.t+=5;}'
          ];
          targets=[next(1)];
          break;
        }
        if((opcode&0xc7)===0xc6) {
          // ADD/ADC/SUB/SBC/AND/XOR/OR/CP A,n, exactly 7 T-states.
          // Immediate is decoded offline, never from ROM at runtime.
          const alu=(opcode>>>3)&7;
          const rhs=read8(pc,1);
          length=2;
          lines=['const rhs='+rhs+';','const a=$.a;'];
          if(alu<=3 || alu===7) {
            const sub=alu===2||alu===3||alu===7;
            const carry=(alu===1||alu===3)?'($.f&1)':'0';
            lines.push('const carry='+carry+';');
            if(sub) lines.push(
              'const raw=a-rhs-carry;const result=raw&255;',
              'const h=(a&15)<((rhs&15)+carry);',
              'const ov=(((a^rhs)&(a^result)&128)!==0);',
              '$.f='+(alu===7?'(rhs&0xa8)':'(result&0xa8)')+
                '|(result===0?64:0)|(h?16:0)|(ov?4:0)|2|(raw<0?1:0);'
            );
            else lines.push(
              'const raw=a+rhs+carry;const result=raw&255;',
              'const h=((a&15)+(rhs&15)+carry)>15;',
              'const ov=(((~(a^rhs))&(a^result)&128)!==0);',
              '$.f=(result&0xa8)|(result===0?64:0)|(h?16:0)|(ov?4:0)|(raw>255?1:0);'
            );
            if(alu!==7)lines.push('$.a=result;');
          } else {
            const expr=alu===4?'a&rhs':alu===5?'a^rhs':'a|rhs';
            lines.push(
              'const result=('+expr+')&255;',
              'let parity=result;parity^=parity>>>4;parity^=parity>>>2;parity^=parity>>>1;',
              '$.f=(result&0xa8)|(result===0?64:0)|'+(alu===4?'16':'0')+
                '|((parity&1)===0?4:0);',
              '$.a=result;'
            );
          }
          lines.push('$.pc='+next(2)+';','$.t+=7;');
          targets=[next(2)];
          break;
        }
        if((opcode&0xc7)===0x06) {
          // LD r,n: B/C/D/E/H/L/A = 7 T; LD (HL),n = 10 T.
          // Operand and register selection are resolved at build time.
          const index=(opcode>>>3)&7, value=read8(pc,1);
          const memory=index===6;
          length=2;
          lines=[
            memory ? 'bus.write8($.hl,'+value+',$.t+10);' :
              'const value='+value+';'+r8WriteSource[index],
            '$.pc='+next(2)+';',
            '$.t+='+String(memory?10:7)+';'
          ];
          targets=[next(2)];
          break;
        }
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
  return {status,source,compiled:visited.size,blockers,pending:pending.length,
    entrypoints,visitedPcs:[...visited.keys()].sort((a,b)=>a-b),
    truncated:pending.length>0};
}
