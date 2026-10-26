/**
 * R3.5.B2.T5: flag and ALU helpers called by code that mc6809_aot.mjs
 * compiles ahead of time from ROM bytes. Semantics follow MAME 0.289
 * m6809 (base6x09.lst / m6809inl.h set_flags, rotate, daa, mul).
 *
 * Every helper takes the CPU state `$` and keeps `$.kcc`, a per-bit mask
 * of condition-code bits whose value is known. A helper that READS a flag
 * the program never established fails closed instead of assuming zero.
 */
export const CC_C=1,CC_V=2,CC_Z=4,CC_N=8,CC_I=16,CC_H=32,CC_F=64,CC_E=128;
const NZV=CC_N|CC_Z|CC_V,NZVC=NZV|CC_C,HNZVC=NZVC|CC_H,NZ=CC_N|CC_Z;

export function needCC($,bits){
  if(($.kcc&bits)!==bits)$.unknown('CC',bits);
}

// MAME set_flags<T>(mask,a,b,r): r is uint32 arithmetic on promoted ints.
function flags($,mask,a,b,r,hi){
  r=r>>>0;
  let cc=$.cc&~mask;
  if((mask&CC_H)&&((a^b^r)&0x10))cc|=CC_H;
  if((mask&CC_N)&&(r&hi))cc|=CC_N;
  if((mask&CC_Z)&&(r&(hi*2-1))===0)cc|=CC_Z;
  if((mask&CC_V)&&((a^b^r^(r>>>1))&hi))cc|=CC_V;
  if((mask&CC_C)&&(r&(hi*2)))cc|=CC_C;
  $.cc=cc;$.kcc|=mask;
  return r&(hi*2-1);
}
const f8=($,mask,a,b,r)=>flags($,mask,a,b,r,0x80);
const f16=($,mask,a,b,r)=>flags($,mask,a,b,r,0x8000);
const setC=($,on)=>{$.cc=on?$.cc|CC_C:$.cc&~CC_C;$.kcc|=CC_C;};
const carry=$=>{needCC($,CC_C);return $.cc&CC_C;};

export const neg8=($,m)=>f8($,NZVC,0,m,-m);
export function com8($,m){
  $.cc=($.cc&~CC_V)|CC_C;$.kcc|=CC_V|CC_C;
  const r=~m&0xff;
  return f8($,NZ,0,r,r);
}
export function lsr8($,m){setC($,m&1);return f8($,NZ,0,m>>1,m>>1);}
export function ror8($,m){
  const r=(m>>1)|(carry($)?0x80:0);
  setC($,m&1);
  return f8($,NZ,0,r,r);
}
export function asr8($,m){
  setC($,m&1);
  const r=(m>>1)|(m&0x80);
  return f8($,NZ,0,r,r);
}
export const asl8=($,m)=>f8($,NZVC,m,m,m<<1);
export function rol8($,m){
  const r=(m<<1)|(carry($)?1:0);
  setC($,m&0x80);
  return f8($,NZV,m,m,r);
}
export const dec8=($,m)=>f8($,NZV,m,1,m-1);
export const inc8=($,m)=>f8($,NZV,m,1,m+1);
export const tst8=($,m)=>{f8($,NZV,0,m,m);};
export function clr($){$.cc=($.cc&~NZVC)|CC_Z;$.kcc|=NZVC;return 0;}
export const sub8=($,a,m)=>f8($,NZVC,a,m,a-m);
export const cmp8=($,a,m)=>{f8($,NZVC,a,m,a-m);};
export function sbc8($,a,m){const c=carry($)?1:0;return f8($,NZVC,a,m,a-m-c);}
function logic($,r){$.cc&=~CC_V;$.kcc|=CC_V;return f8($,NZ,0,r,r);}
export const and8=($,a,m)=>logic($,a&m);
export const bit8=($,a,m)=>{logic($,a&m);};
export const eor8=($,a,m)=>logic($,a^m);
export const or8=($,a,m)=>logic($,a|m);
export function adc8($,a,m){const c=carry($)?1:0;return f8($,HNZVC,a,m,a+m+c);}
export const add8=($,a,m)=>f8($,HNZVC,a,m,a+m);
export const ld8=($,v)=>f8($,NZV,0,v,v);
export const add16=($,a,m)=>f16($,NZVC,a,m,a+m);
export const sub16=($,a,m)=>f16($,NZVC,a,m,a-m);
export const cmp16=($,a,m)=>{f16($,NZVC,a,m,a-m);};
export const ld16=($,v)=>f16($,NZV,0,v,v);
export const leaZ=($,v)=>f16($,CC_Z,0,v,v);
export function sex($,b){const r=(b&0x80)?0xff00|b:b;return f16($,NZ,0,r,r);}
export function mul($,a,b){
  const d=a*b;
  f16($,CC_Z,0,d,d);
  setC($,d&0x80);
  return d;
}
export function daa($,a){
  needCC($,CC_H|CC_C);
  let cf=0;
  const msn=a&0xf0,lsn=a&0x0f;
  if(lsn>9||($.cc&CC_H))cf|=0x06;
  if(msn>0x80&&lsn>9)cf|=0x60;
  if(msn>0x90||($.cc&CC_C))cf|=0x60;
  const t=a+cf;
  $.cc&=~CC_V;$.kcc|=CC_V;
  if(t&0x100)$.cc|=CC_C;
  return f8($,NZ,0,t&0xff,t&0xff);
}

const COND_NEED=[0,0,CC_Z|CC_C,CC_C,CC_Z,CC_V,CC_N,CC_N|CC_V,CC_N|CC_V|CC_Z];
/** Branch condition for the low nibble of 0x2X (MAME cond_* helpers). */
export function cond($,n){
  const kind=n>>1;
  needCC($,COND_NEED[kind+1]);
  const cc=$.cc;
  let t;
  switch(kind){
    case 0:t=true;break;
    case 1:t=!(cc&(CC_Z|CC_C));break;
    case 2:t=!(cc&CC_C);break;
    case 3:t=!(cc&CC_Z);break;
    case 4:t=!(cc&CC_V);break;
    case 5:t=!(cc&CC_N);break;
    case 6:t=!!(cc&CC_N)===!!(cc&CC_V);break;
    default:t=(!!(cc&CC_N)===!!(cc&CC_V))&&!(cc&CC_Z);
  }
  return n&1?!t:t;
}
