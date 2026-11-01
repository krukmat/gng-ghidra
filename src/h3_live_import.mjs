/** Live tape (CPU port reads at exact cycles) as B3 control events at frame
 * starts: the explorer's one-value-per-port-per-frame model. Each port is
 * read once per frame (measured 01/11/2026 on three tapes), so a change
 * counts from the start of its frame; the last change in a frame wins.
 * Callers must still replay the result against the tape's own check.
 */
import {INPUT_PORTS,INPUT_CONTROLS,INPUT_DEFAULTS} from './gngb_input_contract.mjs';
import {CYCLES_PER_FRAME} from './gngb_runtime.mjs';

const PORT_NAMES=Object.keys(INPUT_PORTS);
const fail=m=>{throw Error('H3_LIVE_'+m);};

export function liveToEvents(changes,endFrame=Infinity){
  const per=PORT_NAMES.map(()=>[]);let prev=-1;
  for(const [port,cycle,value] of changes){
    if(!Number.isInteger(port)||port<0||port>=PORT_NAMES.length||!Number.isSafeInteger(cycle)||
       cycle<prev||!Number.isInteger(value)||value<0||value>255)fail('TAPE_INVALID');
    prev=cycle;
    const f=Math.floor(cycle/CYCLES_PER_FRAME);
    if(f>=endFrame)break;
    if(port>2){if(value!==INPUT_DEFAULTS[port])fail('DIP_NOT_DEFAULT');continue;}
    const list=per[port];
    if(list.length&&list.at(-1)[0]===f)list.at(-1)[1]=value;else list.push([f,value]);
  }
  const events=[];
  per.forEach((list,i)=>{
    const port=PORT_NAMES[i],controls=Object.entries(INPUT_CONTROLS).filter(([,c])=>c.port===port);
    const mapped=controls.reduce((m,[,c])=>m|c.bit,0);
    let last=INPUT_DEFAULTS[i];
    for(const [f,value] of list){
      if((value|mapped)!==0xff)fail('UNMAPPED_BIT');
      for(const [control,{bit}] of controls)
        if((last^value)&bit)events.push({cycle:f*CYCLES_PER_FRAME,control,pressed:!(value&bit)});
      last=value;
    }
  });
  return events.sort((a,b)=>a.cycle-b.cycle||(a.control<b.control?-1:a.control>b.control?1:0));
}
