/** H3 paso 1: journal del registrador MAME (scripts/h3_tape_recorder.lua)
 * -> cinta externa B3. Fail-closed ante lecturas de CPU distintas de lo
 * anotado, DIPs no estándar, bits sin control o entradas activas al inicio.
 * Lo anotado en el notificador del frame c rige desde el ciclo
 * c*CYCLES_PER_FRAME (inverso del shift -1 de v3_b3_oracle.lua).
 */
import {createHash} from 'node:crypto';
import {INPUT_CONTROLS,INPUT_DEFAULTS,INPUT_PORTS,defineInputSchedule,
  readScheduledPorts} from './gngb_input_contract.mjs';
import {CYCLES_PER_FRAME} from './gngb_runtime.mjs';
import {B3_TAPE_SCHEMA} from './v3_b3_tapes.mjs';

export const H3_TAPE_PROFILE='mame-recording';
const PORT_NAMES=Object.keys(INPUT_PORTS);
const fail=s=>{throw Error('H3_JOURNAL_'+s);};

/** "R k" (rebobinado) descarta los frames >= k y sus discrepancias. */
export function parseJournal(text){
  let frames=[],violations=[],ended=false,rewinds=0;
  for(const line of text.split('\n')){
    if(!line)continue;
    if(ended)fail('AFTER_END');
    const [kind,...f]=line.split(' ');
    if(kind==='F'){
      if(f.length!==8||Number(f[0])!==frames.length)fail('FRAME_SEQUENCE');
      frames.push({bytes:f.slice(2,7).map(h=>parseInt(h,16)),hash:f[7]});
    }else if(kind==='V')violations.push({frame:Number(f[0]),line});
    else if(kind==='R'){
      const k=Number(f[0]);
      if(!Number.isInteger(k)||k<1||k>frames.length)fail('REWIND_INVALID');
      frames=frames.slice(0,k);
      violations=violations.filter(v=>v.frame<k);
      rewinds++;
    }else if(kind==='X')fail('FOREIGN_LOAD');
    else if(kind==='E')ended=true;
    else fail('LINE_INVALID');
  }
  return {frames,violations,ended,rewinds};
}

export function journalToTape({frames,violations,ended}){
  if(!ended)fail('NOT_CLOSED');
  if(violations.length)
    fail('CPU_READ_MISMATCH '+violations.length+' '+violations[0].line);
  if(frames.length<2)fail('EMPTY');
  const used=[0,0,0];
  for(const {port,bit} of Object.values(INPUT_CONTROLS))
    used[PORT_NAMES.indexOf(port)]|=bit;
  const events=[];
  for(const [c,{bytes}] of frames.entries()){
    if(bytes[3]!==INPUT_DEFAULTS[3]||bytes[4]!==INPUT_DEFAULTS[4])fail('DIP_MISMATCH');
    for(let p=0;p<3;p++)
      if((bytes[p]|used[p])!==(INPUT_DEFAULTS[p]|used[p]))fail('UNMAPPED_BITS');
    if(!c&&bytes.some((b,p)=>b!==INPUT_DEFAULTS[p]))fail('INITIAL_INPUT_ACTIVE');
    const prev=c?frames[c-1].bytes:INPUT_DEFAULTS;
    for(const [control,{port,bit}] of Object.entries(INPUT_CONTROLS)){
      const p=PORT_NAMES.indexOf(port),now=!(bytes[p]&bit);
      if(now!==!(prev[p]&bit))events.push({cycle:c*CYCLES_PER_FRAME,control,pressed:now});
    }
  }
  const schedule=defineInputSchedule(events);
  for(const [c,{bytes}] of frames.entries())
    if(readScheduledPorts(schedule,c*CYCLES_PER_FRAME).some((b,p)=>b!==bytes[p]))
      fail('SELF_CHECK_FRAME_'+c);
  const metadata={schema:B3_TAPE_SCHEMA,profile:H3_TAPE_PROFILE,
    frames:frames.length,events:schedule.events};
  return Object.freeze({...metadata,
    sha256:createHash('sha256').update(JSON.stringify(metadata)).digest('hex')});
}
