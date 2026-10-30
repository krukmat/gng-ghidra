/** Active-low touch input: one direction and independent fingers.
 * No keyboard, shared memory or CPU state changes. The 4-way rule and the
 * Continue combination come from the game (games/gngb/inputs.mjs).
 */
import {INPUT_CONTROLS,INPUT_DEFAULTS} from './gngb_input_contract.mjs';
import {CONTINUE_CONTROLS,fourWayConflict} from '../games/gngb/inputs.mjs';
export const PULSE_MS=100,PULSE_GAP_MS=200;
export const isDirection=key=>/^p1\.(up|down|left|right)$/.test(key);
const HOLDS=new Set(['p1.up','p1.down','p1.left','p1.right','p1.button1','p1.button2']);
// The game names the Continue combination.
const PULSES={coin1:['coin1'],start1:['start1'],continue1:CONTINUE_CONTROLS};
const PORTS=['SYSTEM','P1','P2','DSW1','DSW2'];

export function createTouchControls(onChange){
  const held=new Map(),pulses=new Map();
  let enabled=false;
  const publish=()=>{
    const keys=[...new Set(held.values())],ports=[...INPUT_DEFAULTS];
    for(const key of keys){
      const {port,bit}=INPUT_CONTROLS[key];ports[PORTS.indexOf(port)]&=~bit;
    }
    onChange(ports,keys);
  };
  const release=source=>{if(held.delete(source))publish();};
  const releaseAll=()=>{
    for(const pulse of pulses.values())clearTimeout(pulse.timer);
    pulses.clear();held.clear();publish();
  };
  const hold=(source,key)=>{
    if(!enabled||!HOLDS.has(key))return false;
    if(isDirection(key)&&fourWayConflict(new Set([key,...[...held]
      .filter(([id])=>id!==source).map(([,k])=>k)])))return false;
    if(held.get(source)!==key){held.set(source,key);publish();}
    return true;
  };
  const pulse=key=>{
    if(!enabled||!Object.hasOwn(PULSES,key))return false;
    let state=pulses.get(key);
    if(state){state.queued++;return true;}
    state={queued:0,timer:null};pulses.set(key,state);
    const press=()=>{
      for(const control of PULSES[key])held.set('pulse:'+key+':'+control,control);
      publish();
      state.timer=setTimeout(()=>{
        for(const control of PULSES[key])held.delete('pulse:'+key+':'+control);
        publish();
        state.timer=setTimeout(()=>{
          if(state.queued>0){state.queued--;press();}
          else pulses.delete(key);
        },PULSE_GAP_MS);
      },PULSE_MS);
    };
    press();return true;
  };
  return {hold,release,pulse,releaseAll,
    setEnabled(value){enabled=!!value;if(!enabled)releaseAll();}};
}
