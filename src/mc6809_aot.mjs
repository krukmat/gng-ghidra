/**
 * R3.5.B2.T5: ahead-of-time MC6809 -> JavaScript compiler for gngb.
 *
 * ROM bytes are decoded HERE, at build time, into one JS function per
 * basic block (keyed by bank and PC). The generated module never reads an
 * opcode: at run time the board only dispatches to compiled blocks.
 * Semantics and bus-cycle order follow MAME 0.289 m6809.lst/base6x09.lst.
 *
 * Cycle model: every bus access is one cycle. MAME may suspend an
 * instruction only at its '@' lines, so each compiled path records those
 * offsets ("stops") and every write carries the last stop before it; the
 * board uses them to cut a frame snapshot exactly where MAME does.
 *
 * Fail closed: undocumented or 6309-only opcodes, illegal index modes,
 * unknown registers/flags/memory and code outside ROM throw at run time.
 */
import {FIXED_START,BANK_START,blockKey} from './gngb_block_key.mjs';
export {FIXED_START,BANK_START,RAM_KEY,blockKey} from './gngb_block_key.mjs';
const h=n=>'0x'+n.toString(16);
const REG16=new Set(['x','y','u','s']);

class Path{
  constructor(){this.c=0;this.last=0;this.stops=[];this.out=[];}
  acc(n=1){this.c+=n;}
  stop(){this.stops.push(this.c);this.last=this.c;}
  line(s){this.out.push(s);}
  clone(){
    const p=new Path();
    p.c=this.c;p.last=this.last;p.stops=[...this.stops];
    return p;
  }
}

/**
 * Compiles one instruction at `pc`. Returns {code,len,end,succ,writes}.
 * `byte(addr)` reads a code byte in the block's bank context, or throws.
 */
function genInsn(byte,pc,stopsTable){
  let p=pc;
  const next8=()=>{const v=byte(p&0xffff);p=(p+1)&0xffff;return v;};
  const e=new Path();
  const succ=[];
  let writes=false;
  const sx8=v=>v&0x80?v-256:v;
  const sx16=v=>v&0x8000?v-65536:v;
  const code=[`$.ipc=${h(pc)};`];
  const fin=(path)=>{
    const stops=[...path.stops];
    if(stops[stops.length-1]!==path.c)stops.push(path.c);
    const key=stops.join(',');
    if(!stopsTable.has(key))stopsTable.set(key,stopsTable.size);
    return `$.st=S${stopsTable.get(key)};$.C+=${path.c};`;
  };
  const bad=(why)=>({code:[...code,...e.out,`$.bad(${JSON.stringify(why)});`],
    len:(p-pc)&0xffff||1,end:true,succ:[],writes:false});

  // Register access with known-value checks.
  const need=(r)=>{
    if(r==='d'){e.line(`if($.ka!==255||$.kb!==255)$.unknown('D');`);return '($.a<<8|$.b)';}
    if(r==='pc')return null;
    const full=REG16.has(r)?65535:255;
    e.line(`if($.k${r}!==${full})$.unknown(${JSON.stringify(r.toUpperCase())});`);
    return `$.${r}`;
  };
  const set8=(r,expr)=>e.line(`$.${r}=${expr};$.k${r}=255;`);
  const set16=(r,expr)=>{
    if(r==='d')e.line(`t=${expr};$.a=t>>8;$.b=t&255;$.ka=255;$.kb=255;`);
    else e.line(`$.${r}=${expr};$.k${r}=65535;`);
  };

  // --- addressing (MAME DIRECT / EXTENDED / INDEXED) -----------------
  const direct=()=>{
    const dp=need('dp');
    const off=next8();e.acc();e.stop();
    e.acc();e.stop(); // dummy_vma(1)
    e.line(`ea=${dp}<<8|${h(off)};`);
  };
  let constEa=null;
  const extended=()=>{
    const hi=next8();e.acc();e.stop();
    const lo=next8();e.acc();e.stop();
    e.acc();e.stop();
    constEa=hi<<8|lo;
    e.line(`ea=${h(constEa)};`);
  };
  // Returns false on an illegal postbyte (fail closed).
  const indexed=()=>{
    const pb=next8();e.acc();e.stop();
    const r=['x','y','u','s'][(pb>>5)&3];
    if(!(pb&0x80)){
      let off=pb&0x1f;if(off&0x10)off-=32;
      const R=need(r);
      e.line(`ea=(${R}+${off})&65535;`);
      e.acc();e.stop();e.acc();e.stop();
      e.stop();
      return true;
    }
    const ind=!!(pb&0x10);
    switch(pb&0x0f){
      case 0x0:
        if(ind)return false;
        need(r);e.line(`ea=$.${r};$.${r}=($.${r}+1)&65535;`);
        e.acc();e.stop();e.acc(2);e.stop();break;
      case 0x1:
        need(r);e.line(`ea=$.${r};$.${r}=($.${r}+2)&65535;`);
        e.acc();e.stop();e.acc(3);e.stop();break;
      case 0x2:
        if(ind)return false;
        need(r);e.line(`$.${r}=($.${r}-1)&65535;ea=$.${r};`);
        e.acc();e.stop();e.acc(2);e.stop();break;
      case 0x3:
        need(r);e.line(`$.${r}=($.${r}-2)&65535;ea=$.${r};`);
        e.acc();e.stop();e.acc(3);e.stop();break;
      case 0x4:
        e.line(`ea=${need(r)};`);e.acc();e.stop();break;
      case 0x5:{
        const R=need(r),B=need('b');
        e.line(`ea=(${R}+(${B}<<24>>24))&65535;`);
        e.acc();e.stop();e.acc();e.stop();break;
      }
      case 0x6:{
        const R=need(r),A=need('a');
        e.line(`ea=(${R}+(${A}<<24>>24))&65535;`);
        e.acc();e.stop();e.acc();e.stop();break;
      }
      case 0x8:{
        const R=need(r);
        const off=sx8(next8());e.acc();e.stop();
        e.acc();e.stop();
        e.line(`ea=(${R}+${off})&65535;`);break;
      }
      case 0x9:{
        const R=need(r);
        const hi=next8();e.acc();e.stop();
        const lo=next8();e.acc();e.stop();
        e.acc(3);e.stop();
        e.line(`ea=(${R}+${sx16(hi<<8|lo)})&65535;`);break;
      }
      case 0xb:{
        const R=need(r),D=need('d');
        e.line(`ea=(${R}+${D})&65535;`);
        e.acc();e.stop();e.acc();e.stop();e.acc(3);e.stop();break;
      }
      case 0xc:{
        const off=sx8(next8());e.acc();e.stop();
        e.line(`ea=${h((p+off)&0xffff)};`);
        e.acc();e.stop();break;
      }
      case 0xd:{
        const hi=next8();e.acc();e.stop();
        const lo=next8();e.acc();e.stop();
        e.line(`ea=${h((p+sx16(hi<<8|lo))&0xffff)};`);
        e.acc(4);e.stop();break;
      }
      case 0xf:{
        if(!ind)return false;
        const hi=next8();e.acc();e.stop();
        const lo=next8();e.acc();e.stop();
        e.acc();e.stop();
        e.line(`ea=${h(hi<<8|lo)};`);break;
      }
      default:return false;
    }
    if(ind){
      e.line('t=$.rd(ea);');e.acc();e.stop();
      e.line('ea=t<<8|$.rd((ea+1)&65535);');e.acc();e.stop();
      e.acc();e.stop();
    }
    e.stop(); // @set_ea
    return true;
  };
  const address=(mode)=>{
    if(mode==='dir')direct();
    else if(mode==='ext')extended();
    else if(mode==='idx')return indexed();
    return true;
  };

  // --- operands -------------------------------------------------------
  // read_operand(); `at` is whether MAME's line is an '@' suspension point.
  const read8=(mode,at)=>{
    let v;
    if(mode==='imm'){v=h(next8());e.acc();}
    else if(mode==='a'||mode==='b'){v=need(mode);}
    else{e.line('v=$.rd(ea);');e.acc();v='v';}
    if(at)e.stop();
    return v;
  };
  const write8=(mode,expr,at)=>{
    if(mode==='a'||mode==='b')set8(mode,expr);
    else{e.line(`$.w(ea,${expr},${e.last});`);e.acc();writes=true;}
    if(at)e.stop();
  };
  const read16=(mode)=>{
    if(mode==='imm'){
      const hi=next8();e.acc();e.stop();
      const lo=next8();e.acc();e.stop();
      return h(hi<<8|lo);
    }
    e.line('t=$.rd(ea)<<8;');e.acc();e.stop();
    e.line('t|=$.rd((ea+1)&65535);');e.acc();e.stop();
    return 't';
  };

  // --- stack -----------------------------------------------------------
  const pushByte=(sp,val,mask)=>{
    e.line(`$.${sp}=($.${sp}-1)&65535;$.wk($.${sp},${val},${mask},${e.last});`);
    e.acc();e.stop();writes=true;
  };
  const pushRegs=(sp,m,pcNext)=>{
    const other=sp==='s'?'u':'s';
    const word=(v,k)=>{pushByte(sp,`(${v})&255`,`(${k})&255`);pushByte(sp,`(${v})>>8`,`(${k})>>8`);};
    if(m&0x80)word(h(pcNext),'65535');
    if(m&0x40)word(`$.${other}`,`$.k${other}`);
    if(m&0x20)word('$.y','$.ky');
    if(m&0x10)word('$.x','$.kx');
    if(m&0x08)pushByte(sp,'$.dp','$.kdp');
    if(m&0x04)pushByte(sp,'$.b','$.kb');
    if(m&0x02)pushByte(sp,'$.a','$.ka');
    if(m&0x01)pushByte(sp,'$.cc','$.kcc');
  };
  // Returns true when PC was pulled (caller exits to $.PC).
  const pullRegs=(path,sp,m)=>{
    const other=sp==='s'?'u':'s';
    const one=()=>{
      path.line(`v=$.rk($.${sp});k=$.lk;$.${sp}=($.${sp}+1)&65535;`);
      path.acc();path.stop();
    };
    const byteTo=r=>{one();path.line(`$.${r}=v;$.k${r}=k;`);};
    const wordTo=r=>{
      one();path.line('t=v<<8;kt=k<<8;');
      one();
      if(r==='pc')path.line('$.PC=t|v;if((kt|k)!==65535)$.unknown("PC");');
      else path.line(`$.${r}=t|v;$.k${r}=kt|k;`);
    };
    if(m&0x01)byteTo('cc');
    if(m&0x02)byteTo('a');
    if(m&0x04)byteTo('b');
    if(m&0x08)byteTo('dp');
    if(m&0x10)wordTo('x');
    if(m&0x20)wordTo('y');
    if(m&0x40)wordTo(other);
    if(m&0x80)wordTo('pc');
    path.acc();path.stop(); // @(void)read_memory(S)
    return !!(m&0x80);
  };
  const subroutine=(target)=>{
    // GOTO_SUBROUTINE: push PC low then high; jump.
    need('s');
    pushByte('s',h(p&255),'255');
    pushByte('s',h(p>>8),'255');
    if(target===null){e.line('$.PC=ea;');}
    succ.push(p);
    if(target!==null)succ.push(target);
    e.line(fin(e)+(target===null?'return;':`$.PC=${h(target)};return;`));
    return {code:[...code,...e.out],len:(p-pc)&0xffff,end:true,succ,writes:true};
  };
  const done=(end=false)=>{
    e.line(fin(e));
    return {code:[...code,...e.out],len:(p-pc)&0xffff,end,succ,writes};
  };

  // --- dispatch (m6809.lst MAIN / DISPATCH10 / DISPATCH11) ------------
  let op=next8();e.acc();e.stop();
  let page=0;
  if(op===0x10||op===0x11){page=op;op=next8();e.acc();e.stop();}

  const RMW={0x0:'neg8',0x1:'neg8',0x3:'com8',0x4:'lsr8',0x5:'lsr8',0x6:'ror8',
    0x7:'asr8',0x8:'asl8',0x9:'rol8',0xa:'dec8',0xc:'inc8'};
  const MODE_LO={0x0:'dir',0x4:'a',0x5:'b',0x6:'idx',0x7:'ext'};

  if(page===0&&op<0x80&&MODE_LO[op>>4]){
    const mode=MODE_LO[op>>4],lo=op&0x0f;
    const mem=mode!=='a'&&mode!=='b';
    if(mem&&!address(mode))return bad('ILLEGAL_INDEXED');
    if(RMW[lo]){
      const v=read8(mode,true);
      e.line(`v=L.${RMW[lo]}($,${v});`);
      e.acc();e.stop(); // dummy_read_opcode_arg
      write8(mode,'v',true);
      return done();
    }
    if(lo===0xd){ // TST
      const v=read8(mode,true);
      e.line(`L.tst8($,${v});`);
      e.acc();e.stop();
      if(mem){e.acc();e.stop();}
      return done();
    }
    if(lo===0xf){ // CLR: the operand read is a discarded bus cycle.
      if(mem)e.acc();
      e.stop();
      e.line('L.clr($);');
      e.acc();e.stop();
      write8(mode,'0',true);
      return done();
    }
    if(lo===0xe&&mem){ // JMP
      e.line(fin(e)+'$.PC=ea;return;');
      if(mode==='ext')succ.push(constEa);
      return {code:[...code,...e.out],len:(p-pc)&0xffff,end:true,succ,writes};
    }
    return bad('UNSUPPORTED_OPCODE_'+h(op));
  }

  if(page===0&&op>=0x20&&op<=0x2f){ // BRANCH
    const off=sx8(next8());e.acc();e.stop();
    e.acc();e.stop();
    const target=(p+off)&0xffff;
    succ.push(target);
    if(op===0x20){e.line(fin(e)+`$.PC=${h(target)};return;`);
      return {code:[...code,...e.out],len:(p-pc)&0xffff,end:true,succ,writes};}
    if(op===0x21)return done();
    e.line(`if(L.cond($,${op&0xf})){${fin(e)}$.PC=${h(target)};return;}`);
    succ.push(p);
    return done();
  }
  if((page===0&&op===0x16)||(page===0x10&&op>=0x20&&op<=0x2f)){ // LBRANCH
    const hi=next8();e.acc();e.stop();
    const lo=next8();e.acc();e.stop();
    e.acc();e.stop();
    const target=(p+sx16(hi<<8|lo))&0xffff;
    const taken=e.clone();taken.acc();taken.stop();
    succ.push(target);
    if(page===0||op===0x20){
      e.line(fin(taken)+`$.PC=${h(target)};return;`);
      return {code:[...code,...e.out],len:(p-pc)&0xffff,end:true,succ,writes};
    }
    if(op===0x21)return done();
    e.line(`if(L.cond($,${op&0xf})){${fin(taken)}$.PC=${h(target)};return;}`);
    succ.push(p);
    return done();
  }

  if(page===0){
    switch(op){
      case 0x12: case 0x1b: e.acc();e.stop();return done();  // NOP
      case 0x13:                                             // SYNC
        e.acc();e.stop();
        e.line(fin(e)+`$.syncEnter(${h(pc)});$.PC=${h(p)};return;`);
        succ.push(p);
        return {code:[...code,...e.out],len:(p-pc)&0xffff,end:true,succ,writes};
      case 0x17:{                                            // LBSR
        const hi=next8();e.acc();e.stop();
        const lo=next8();e.acc();e.stop();
        e.acc(4);e.stop();
        return subroutine((p+sx16(hi<<8|lo))&0xffff);
      }
      case 0x19:{                                            // DAA
        const A=need('a');
        set8('a',`L.daa($,${A})`);e.acc();e.stop();return done();
      }
      case 0x1a: case 0x1c:{                                 // ORCC / ANDCC
        const v=next8();e.acc();
        if(op===0x1a)e.line(`$.cc|=${h(v)};$.kcc|=${h(v)};`);
        else e.line(`$.cc&=${h(v)};$.kcc|=${h(~v&0xff)};`);
        e.acc();e.stop();
        succ.push(p);
        e.line(fin(e)+`$.PC=${h(p)};return;`); // I may change: re-check IRQ
        return {code:[...code,...e.out],len:(p-pc)&0xffff,end:true,succ,writes};
      }
      case 0x1d:{                                            // SEX
        const B=need('b');
        set16('d',`L.sex($,${B})`);e.acc();e.stop();return done();
      }
      case 0x1e: case 0x1f:{                                 // EXG / TFR
        const pb=next8();e.acc();
        e.acc(op===0x1e?6:4);e.stop();
        const NAMES={0:'d',1:'x',2:'y',3:'u',4:'s',5:'pc',8:'a',9:'b',10:'cc',11:'dp'};
        const src=NAMES[pb>>4],dst=NAMES[pb&15];
        if(!src||!dst)return bad('TFR_EXG_REGISTER');
        const wide=r=>!['a','b','cc','dp'].includes(r);
        if(wide(src)!==wide(dst))return bad('TFR_EXG_MIXED_SIZE');
        const val=r=>r==='d'?['($.a<<8|$.b)','($.ka<<8|$.kb)']:
          r==='pc'?[h(p),'65535']:[`$.${r}`,`$.k${r}`];
        const put=(r,v,k)=>{
          if(r==='d')e.line(`$.a=(${v})>>8;$.b=(${v})&255;$.ka=(${k})>>8;$.kb=(${k})&255;`);
          else if(r==='pc')e.line(`$.PC=${v};if((${k})!==65535)$.unknown("PC");`);
          else e.line(`$.${r}=${v};$.k${r}=${k};`);
        };
        const [sv,sk]=val(src);
        if(op===0x1f)put(dst,sv,sk);
        else{
          const [dv,dk]=val(dst);
          e.line(`t=${sv};kt=${sk};v=${dv};k=${dk};`);
          put(src,'v','k');put(dst,'t','kt');
        }
        if(dst==='pc'||(op===0x1e&&src==='pc')){
          e.line(fin(e)+'return;');
          return {code:[...code,...e.out],len:(p-pc)&0xffff,end:true,succ,writes};
        }
        if(dst==='cc'||(op===0x1e&&src==='cc')){
          succ.push(p);e.line(fin(e)+`$.PC=${h(p)};return;`);
          return {code:[...code,...e.out],len:(p-pc)&0xffff,end:true,succ,writes};
        }
        return done();
      }
      case 0x30: case 0x31: case 0x32: case 0x33:{           // LEA
        if(!address('idx'))return bad('ILLEGAL_INDEXED');
        const r=['x','y','s','u'][op&3];
        if(op<0x32)set16(r,'L.leaZ($,ea)');else set16(r,'ea');
        e.acc();e.stop();
        return done();
      }
      case 0x34: case 0x36:{                                 // PSHS / PSHU
        const sp=op===0x34?'s':'u';
        const m=next8();e.acc();e.stop();
        e.acc(2);e.stop();
        need(sp);
        e.acc();e.stop(); // @(void)read_memory(S)
        pushRegs(sp,m,p);
        return done();
      }
      case 0x35: case 0x37:{                                 // PULS / PULU
        const sp=op===0x35?'s':'u';
        const m=next8();e.acc();e.stop();
        e.acc(2);e.stop();
        need(sp);
        const jumped=pullRegs(e,sp,m);
        if(jumped){e.line(fin(e)+'return;');
          return {code:[...code,...e.out],len:(p-pc)&0xffff,end:true,succ,writes};}
        if(m&1){succ.push(p);e.line(fin(e)+`$.PC=${h(p)};return;`);
          return {code:[...code,...e.out],len:(p-pc)&0xffff,end:true,succ,writes};}
        return done();
      }
      case 0x39:                                             // RTS
        e.acc();e.stop();need('s');
        pullRegs(e,'s',0x80);
        e.line(fin(e)+'return;');
        return {code:[...code,...e.out],len:(p-pc)&0xffff,end:true,succ,writes};
      case 0x3a:{                                            // ABX
        const X=need('x'),B=need('b');
        e.line(`$.x=(${X}+${B})&65535;`);
        e.acc();e.stop();e.acc();e.stop();
        return done();
      }
      case 0x3b:{                                            // RTI
        e.acc();e.stop();need('s');
        e.line('v=$.rk($.s);k=$.lk;$.s=($.s+1)&65535;$.cc=v;$.kcc=k;');
        e.acc();e.stop();
        e.line('if(!($.kcc&128))$.unknown("CC.E");');
        const full=e.clone(),part=e.clone();
        pullRegs(full,'s',0xfe);pullRegs(part,'s',0x80);
        e.line(`if($.cc&128){${full.out.join('')}${fin(full)}return;}`);
        e.line(`${part.out.join('')}${fin(part)}return;`);
        return {code:[...code,...e.out],len:(p-pc)&0xffff,end:true,succ,writes};
      }
      case 0x3d:{                                            // MUL
        const A=need('a'),B=need('b');
        set16('d',`L.mul($,${A},${B})`);
        e.acc();e.stop();e.acc(9);e.stop();
        return done();
      }
      case 0x8d:{                                            // BSR
        const off=sx8(next8());e.acc();e.stop();
        e.acc(3);e.stop();
        return subroutine((p+off)&0xffff);
      }
      default:break;
    }
  }

  // 0x80-0xFF columns (and their page 2/3 forms).
  if(op>=0x80){
    const mode=['imm','dir','idx','ext'][(op>>4)&3];
    const lo=op&0x0f,bSide=op>=0xc0;
    const r8=bSide?'b':'a';
    const opImm=mode==='imm';
    let kind=null,reg=null;
    if(page===0){
      const ALU8={0x0:'sub8',0x1:'cmp8',0x2:'sbc8',0x4:'and8',0x5:'bit8',
        0x6:'ld8',0x7:'st8',0x8:'eor8',0x9:'adc8',0xa:'or8',0xb:'add8'};
      if(ALU8[lo]){kind=ALU8[lo];reg=r8;}
      else if(lo===0x3){kind=bSide?'add16':'sub16';reg='d';}
      else if(lo===0xc){kind=bSide?'ld16':'cmp16';reg=bSide?'d':'x';}
      else if(lo===0xd){kind=bSide?'st16':'jsr';reg='d';}
      else if(lo===0xe){kind='ld16';reg=bSide?'u':'x';}
      else if(lo===0xf){kind='st16';reg=bSide?'u':'x';}
    }else if(page===0x10){
      const T={0x83:['cmp16','d'],0x8c:['cmp16','y'],0x8e:['ld16','y'],0x8f:['st16','y'],
        0xce:['ld16','s'],0xcf:['st16','s']};
      const t=T[op&0xcf];
      if(t){[kind,reg]=t;}
    }else{
      const T={0x83:['cmp16','u'],0x8c:['cmp16','s']};
      const t=T[op&0xcf];
      if(t&&!bSide){[kind,reg]=t;}
    }
    if(!kind||(opImm&&(kind==='st8'||kind==='st16'||kind==='jsr'))||
       (page===0&&op===0xcd))
      return bad('UNSUPPORTED_OPCODE_'+(page?h(page)+':':'')+h(op));
    if(!opImm&&!address(mode))return bad('ILLEGAL_INDEXED');
    if(kind==='jsr'){
      e.acc();e.stop();e.acc();e.stop();
      // Direct-page and indexed targets are dispatched at run time.
      return subroutine(mode==='ext'?constEa:null);
    }
    if(kind==='st8'){
      const R=need(reg);
      e.line(`L.ld8($,${R});$.w(ea,${R},${e.last});`);e.acc();writes=true;
      return done();
    }
    if(kind==='st16'){
      const R=need(reg);
      e.line(`t=${R};`);
      e.line(`$.w(ea,t>>8,${e.last});`);e.acc();e.stop();
      e.line(`$.w((ea+1)&65535,t&255,${e.last});`);e.acc();e.stop();
      e.line('L.ld16($,t);');
      writes=true;
      return done();
    }
    if(kind==='ld16'){
      const v=read16(opImm?'imm':'mem');
      set16(reg,`L.ld16($,${v})`);
      return done();
    }
    if(kind==='add16'||kind==='sub16'||kind==='cmp16'){
      const v=read16(opImm?'imm':'mem');
      const R=need(reg);
      if(kind==='cmp16')e.line(`L.cmp16($,${R},${v});`);
      else set16(reg,`L.${kind}($,${R},${v})`);
      e.acc();e.stop();
      return done();
    }
    // 8-bit ALU: the operand read is not an '@' line.
    const v=read8(opImm?'imm':'mem',false);
    const R=kind==='ld8'?null:need(reg);
    if(kind==='ld8')set8(reg,`L.ld8($,${v})`);
    else if(kind==='cmp8'||kind==='bit8')e.line(`L.${kind}($,${R},${v});`);
    else set8(reg,`L.${kind}($,${R},${v})`);
    return done();
  }
  return bad('UNSUPPORTED_OPCODE_'+(page?h(page)+':':'')+h(op));
}

/** Compiles one basic block starting at (bank, pc). */
function compileBlock(code,bank,pc,stopsTable,overlay=null,maxInsns=256){
  const ov=overlay===null?null:code.ramOverlays[overlay];
  const byte=a=>{
    if(ov){
      if(a>=ov.start&&a<ov.start+ov.bytes.length)return ov.bytes[a-ov.start];
      throw Error('R35_T5_CODE_OUTSIDE_OVERLAY');
    }
    if(a>=FIXED_START)return code.fixed[a];
    if(a>=BANK_START&&bank!==null&&bank>=0)return code.banks[bank*0x2000+a-BANK_START];
    throw Error('R35_T5_CODE_OUTSIDE_ROM');
  };
  const lines=[];
  const succ=[];
  let p=pc,ended=false;
  for(let n=0;n<maxInsns&&!ended;n++){
    if(n>0)lines.push(`if($.C>=$.T){$.PC=${h(p)};return;}`);
    let ins;
    try{ins=genInsn(byte,p,stopsTable);}
    catch{lines.push(`$.ipc=${h(p)};$.bad("CODE_OUTSIDE_ROM");`);ended=true;break;}
    lines.push(...ins.code);
    succ.push(...ins.succ);
    const nextPc=(p+ins.len)&0xffff;
    if(ins.end){ended=true;break;}
    if(bank!==null&&ins.writes&&nextPc<FIXED_START)
      lines.push(`if($.bank!==${bank}){$.PC=${h(nextPc)};return;}`);
    if(nextPc<p){lines.push(`$.PC=${h(nextPc)};return;`);ended=true;break;}
    p=nextPc;
  }
  if(!ended)lines.push(`$.PC=${h(p)};return;`);
  return {body:lines.join('\n'),succ};
}

/**
 * Compiles every block reachable by direct control flow from `seeds`
 * ([{bank,pc}], bank null in the fixed region) into an ES module source.
 * Branch targets in the banked window inherit the block's bank; targets
 * reached from fixed code through the window are left to run-time seeds.
 */
export function compileProgram(code,seeds,{libUrl}){
  const stopsTable=new Map();
  const done=new Map();
  const queue=[...seeds];
  while(queue.length){
    const {bank,pc,overlay=null}=queue.shift();
    const ov=overlay===null?null:code.ramOverlays[overlay];
    const inOv=a=>ov&&a>=ov.start&&a<ov.start+ov.bytes.length;
    const b=pc>=FIXED_START||ov?null:bank;
    const key=blockKey(b,pc,inOv(pc)?overlay:null);
    if(key<0||done.has(key))continue;
    const block=compileBlock(code,b,pc,stopsTable,inOv(pc)?overlay:null);
    done.set(key,block.body);
    for(const t of block.succ){
      if(inOv(t))queue.push({bank:null,pc:t,overlay});
      else if(t>=FIXED_START)queue.push({bank:null,pc:t});
      else if(t>=BANK_START&&b!==null)queue.push({bank:b,pc:t});
    }
  }
  const out=[
    '// GENERATED by src/mc6809_aot.mjs from private ROM bytes. Do not commit.',
    `import * as L from ${JSON.stringify(libUrl)};`];
  for(const [key,i] of stopsTable)out.push(`const S${i}=[${key}];`);
  out.push('export const blocks=new Map();');
  for(const [key,body] of [...done].sort((a,b)=>a[0]-b[0]))
    out.push(`blocks.set(${h(key)},function($){let ea=0,v=0,k=0,t=0,kt=0;\n${body}\n});`);
  return {source:out.join('\n')+'\n',blockCount:done.size};
}
