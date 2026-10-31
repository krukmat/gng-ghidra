/** GnG code mapping; all addresses and banks remain owned by the board. */
import {validateCodeIdentity} from '../../base/src/contracts/index.mjs';

const fixed=pc=>({space:'fixed',context:'main',overlayVersion:0,pc});
const banked=(bank,pc)=>({space:'bank',context:`bank_${bank}`,overlayVersion:0,pc});
const overlaid=(id,pc)=>({space:'ram',context:`overlay_${id}`,overlayVersion:id+1,pc});
const context=x=>`${x.space}\u0000${x.context}\u0000${x.overlayVersion}`;

export function createGngCodeView(code){
  if(!(code.fixed instanceof Uint8Array)||code.fixed.length!==0x10000||
     !(code.banks instanceof Uint8Array)||code.banks.length!==0xa000)
    throw Error('GNG_CODE_IMAGE_INVALID');
  const overlays=code.ramOverlays??[];
  const identity=x=>{
    validateCodeIdentity(x);
    return `${context(x)}\u0000${x.pc}`;
  };
  const resolve=({from,pc})=>{
    if(!Number.isInteger(pc)||pc<0||pc>0xffff)return null;
    if(from.space==='ram'){
      const id=from.overlayVersion-1,ov=overlays[id];
      if(ov&&pc>=ov.start&&pc<ov.start+ov.bytes.length)return overlaid(id,pc);
      return null;
    }
    if(pc>=0x6000)return fixed(pc);
    if(pc>=0x4000&&from.space==='bank'){
      const bank=Number(from.context.slice(5));
      if(Number.isInteger(bank)&&bank>=0&&bank<5)return banked(bank,pc);
    }
    return null;
  };
  const read=(x,length)=>{
    validateCodeIdentity(x);
    if(!Number.isSafeInteger(length)||length<1)throw Error('GNG_CODE_READ_LENGTH');
    const end=x.pc+length;
    if(x.space==='fixed'&&x.context==='main'&&x.overlayVersion===0&&
       x.pc>=0x6000&&end<=0x10000)return code.fixed.slice(x.pc,end);
    if(x.space==='bank'&&x.overlayVersion===0&&x.pc>=0x4000&&end<=0x6000){
      const bank=Number(x.context.slice(5));
      if(Number.isInteger(bank)&&bank>=0&&bank<5)
        return code.banks.slice(bank*0x2000+x.pc-0x4000,bank*0x2000+end-0x4000);
    }
    if(x.space==='ram'){
      const id=x.overlayVersion-1,ov=overlays[id];
      if(ov&&x.context===`overlay_${id}`&&x.pc>=ov.start&&
         end<=ov.start+ov.bytes.length)return ov.bytes.slice(x.pc-ov.start,end-ov.start);
    }
    throw Error('GNG_CODE_OUTSIDE_MAPPING');
  };
  const seed=(bank,pc,overlay=null)=>overlay!==null?overlaid(overlay,pc):
    pc>=0x6000?fixed(pc):banked(bank,pc);
  const at=(pc,bank,overlay=null)=>{
    if(overlay!==null)return overlaid(overlay,pc);
    if(pc>=0x6000)return fixed(pc);
    if(pc>=0x4000&&bank!==null)return banked(bank,pc);
    return null;
  };
  // Discovery: fixed code reaching the window may run with any bank.
  const banks=code.banks.length/0x2000;
  const targets=({from,pc})=>{
    if(from.space==='fixed'&&pc>=0x4000&&pc<0x6000)
      return Array.from({length:banks},(_,b)=>banked(b,pc));
    const x=resolve({from,pc});
    return x?[x]:[];
  };
  const scanRanges=()=>[{from:fixed(0x6000),start:0x6000,end:0x10000},
    ...Array.from({length:banks},(_,b)=>({from:banked(b,0x4000),start:0x4000,end:0x6000}))];
  return {identity,resolve,read,seed,at,context,targets,scanRanges};
}

/** Translate the frozen program's legacy numeric keys at the board edge. */
export function mapGngFrozenBlocks(code,blocks){
  if(!(blocks instanceof Map))throw Error('GNG_BLOCKS_INVALID');
  const view=createGngCodeView(code),mapped=new Map();
  for(const [key,fn] of blocks){
    if(!Number.isSafeInteger(key)||typeof fn!=='function')
      throw Error('GNG_BLOCK_KEY_INVALID');
    const pc=key&0xffff;
    const at=key>=0x100000?
      view.at(pc,null,Math.floor((key-0x100000)/0x10000)):
      key>=0x10000?view.at(pc,Math.floor(key/0x10000)-1):
        view.at(pc,null);
    if(!at)throw Error('GNG_BLOCK_KEY_INVALID');
    const id=view.identity(at);
    if(mapped.has(id))throw Error('GNG_BLOCK_KEY_DUPLICATE');
    mapped.set(id,fn);
  }
  return mapped;
}
