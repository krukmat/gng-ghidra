/** Shared block identity; must not import the MC6809 AOT compiler at runtime. */
export const FIXED_START=0x6000,BANK_START=0x4000,RAM_KEY=0x100000;
export function blockKey(bank,pc,overlay=null){
  if(overlay!==null)return RAM_KEY+overlay*0x10000+pc;
  if(pc>=FIXED_START)return pc;
  if(pc>=BANK_START&&bank!==null&&bank>=0)return (bank+1)*0x10000+pc;
  return -1;
}
