/** Live-only keyboard state mapped to the same gngb active-low inputs.
 * This is merely an I/O adapter; it never generates an engine frame.
 */
import {INPUT_CONTROLS,INPUT_DEFAULTS} from './gngb_input_contract.mjs';
const PORTS=['SYSTEM','P1','P2'];
const ALLOWED=new Set(['coin1','start1','p1.up','p1.down','p1.left',
  'p1.right','p1.button1','p1.button2']);
const isDirection=key=>/^p1\.(?:up|down|left|right)$/.test(key);
export function createLiveControls(){
  const inputs=new Int32Array(new SharedArrayBuffer(12));
  for(let i=0;i<3;i++)Atomics.store(inputs,i,INPUT_DEFAULTS[i]);
  const held=new Set();
  const apply=(key,pressed)=>{
    if(!ALLOWED.has(key)||typeof pressed!=='boolean')return false;
    if(held.has(key)===pressed)return true;
    if(pressed&&isDirection(key)&&[...held].some(isDirection))return false;
    const {port,bit}=INPUT_CONTROLS[key],index=PORTS.indexOf(port);
    if(index<0)return false;
    if(pressed){held.add(key);Atomics.and(inputs,index,~bit);}
    else{held.delete(key);Atomics.or(inputs,index,bit);}
    return true;
  };
  const release=()=>{for(const key of [...held])apply(key,false);};
  const snapshot=()=>Object.freeze([...held]);
  return Object.freeze({inputs,apply,release,snapshot});
}
