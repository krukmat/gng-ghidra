#!/usr/bin/env node
/** H3: registrador MAME gngb -> cinta B3 externa (laboratorio; salida en out/h3).
 * Uso: node scripts/h3_tape.mjs selftest         paso 1: cinta conocida -> mismos eventos
 *      node scripts/h3_tape.mjs selftest-rewind  paso 2: guardar/cargar guionizado
 *      node scripts/h3_tape.mjs record           sesión humana (K guarda, L vuelve)
 *      node scripts/h3_tape.mjs convert <journal.txt> <tape.json>
 * Ida y vuelta (selftest-rewind, record): la cinta convertida se reproduce
 * desde reset en MAME y cada frame debe dar el mismo hash de RAM y puertos.
 */
import {execFileSync} from 'node:child_process';
import {readFileSync,writeFileSync,mkdirSync,mkdtempSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {CYCLES_PER_FRAME} from '../src/gngb_runtime.mjs';
import {b3Tape} from '../src/v3_b3_tapes.mjs';
import {parseJournal,journalToTape} from '../src/h3_tape_convert.mjs';

const ROOT=resolve(fileURLToPath(import.meta.url),'../..');
const OUT=join(ROOT,'out/h3');
// Controles que inyectan el registrador y v3_b3_oracle.lua.
const REPLAYABLE=new Set(['coin1','start1','p1.right','p1.left','p1.up',
  'p1.down','p1.button1','p1.button2']);
const spec=events=>events.map(e=>
  e.cycle/CYCLES_PER_FRAME+':'+e.control+':'+(e.pressed?1:0)).join(',');
const ev=(frame,control,pressed)=>({cycle:frame*CYCLES_PER_FRAME,control,pressed});
const newWork=prefix=>{
  mkdirSync(OUT,{recursive:true,mode:0o700});
  return mkdtempSync(join(OUT,prefix+'-'));
};

function mame(work,{tape=[],tape2=[],saveAt=0,loadAt=0,frames=0,live=false}={}){
  const args=['gngb','-rompath',join(ROOT,'roms'),
    '-cfg_directory',join(work,'cfg'),'-nvram_directory',join(work,'nvram'),
    '-state_directory',join(work,'sta'),'-skip_gameinfo',
    '-autoboot_script',join(ROOT,'scripts/h3_tape_recorder.lua'),
    ...(live?['-window']:['-video','none','-sound','none','-nothrottle',
      '-seconds_to_run',String(Math.ceil(frames/50)+30),
      // Sin ventana, foco ni teclado/ratón del operador: no interfiere.
      '-keyboardprovider','none','-mouseprovider','none',
      '-joystickprovider','none','-lightgunprovider','none'])];
  const quiet=live?{}:{SDL_VIDEODRIVER:'dummy',SDL_AUDIODRIVER:'dummy'};
  const log=execFileSync('mame',args,{env:{...process.env,...quiet,GNG_H3_DIR:work,
    GNG_H3_TAPE:spec(tape),GNG_H3_TAPE2:spec(tape2),GNG_H3_FRAMES:String(frames),
    GNG_H3_SAVE_AT:String(saveAt),GNG_H3_LOAD_AT:String(loadAt)},
    stdio:['ignore','pipe','pipe'],encoding:'utf8',...(live?{}:{timeout:120000})});
  const done=/H3_RECORDER=DONE frames=\d+ cpu_input_reads=(\d+)/.exec(log);
  if(!done)throw Error('H3_MAME_INCOMPLETE');
  return {journal:parseJournal(readFileSync(join(work,'journal.txt'),'utf8')),
    reads:Number(done[1])};
}

/** Convierte y reproduce desde reset; diff = primer frame distinto o -1. */
function roundTrip(work,journal){
  const tape=journalToTape(journal);
  const bad=tape.events.find(e=>!REPLAYABLE.has(e.control));
  if(bad)throw Error('H3_TAPE_CONTROL_NOT_REPLAYABLE_'+bad.control);
  writeFileSync(join(work,'tape.json'),JSON.stringify(tape));
  const replay=join(work,'replay');
  mkdirSync(replay);
  const {journal:again}=mame(replay,{tape:tape.events,frames:journal.frames.length-1});
  if(again.violations.length||again.frames.length!==journal.frames.length)
    throw Error('H3_ROUNDTRIP_REPLAY_INVALID');
  const diff=journal.frames.findIndex((f,i)=>f.hash!==again.frames[i].hash||
    f.bytes.join()!==again.frames[i].bytes.join());
  return {tape,diff};
}

const [cmd,...args]=process.argv.slice(2);
if(cmd==='selftest'){
  const tape=b3Tape('titleCoinStart');
  const frames=tape.events.at(-1).cycle/CYCLES_PER_FRAME+60;
  const work=newWork('selftest');
  const {journal,reads}=mame(work,{tape:tape.events,frames});
  if(reads<frames)throw Error('H3_SELFTEST_TOO_FEW_CPU_READS');
  const got=journalToTape(journal);
  const same=JSON.stringify(got.events)===JSON.stringify(tape.events);
  console.log('H3_SELFTEST_CPU_INPUT_READS='+reads+' FRAMES='+(got.frames-1)+
    ' EVENTS='+got.events.length+'/'+tape.events.length);
  if(!same)console.log(JSON.stringify({got:got.events,want:tape.events}));
  console.log('H3_SELFTEST='+(same?'PASS':'FAIL')+' DIR='+work);
  process.exitCode=same?0:1;
}else if(cmd==='selftest-rewind'){
  // Guarda en 1300, va a la derecha (camino descartado), vuelve en 1400 y
  // sigue a la izquierda: la cinta solo debe contener el camino final.
  const base=b3Tape('titleCoinStart').events;
  const work=newWork('rewind');
  const {journal,reads}=mame(work,{tape:[...base,ev(1310,'p1.right',true)],
    tape2:[ev(1320,'p1.left',true),ev(1360,'p1.left',false)],
    saveAt:1300,loadAt:1400,frames:1500});
  const {tape,diff}=roundTrip(work,journal);
  const want=[...base,ev(1320,'p1.left',true),ev(1360,'p1.left',false)];
  const same=JSON.stringify(tape.events)===JSON.stringify(want);
  const pass=same&&diff<0&&journal.rewinds===1;
  console.log('H3_REWIND rewinds='+journal.rewinds+' cpu_input_reads='+reads+
    ' events='+(same?'EXPECTED':'UNEXPECTED')+' roundtrip='+(diff<0?'MATCH':'DIFF@'+diff));
  console.log('H3_SELFTEST_REWIND='+(pass?'PASS':'FAIL')+' DIR='+work);
  process.exitCode=pass?0:1;
}else if(cmd==='record'){
  const work=newWork('rec');
  console.log('H3_RECORD: K guarda estado, L vuelve al último guardado. '+
    'No usar F7/Shift+F7 de MAME. Esc termina.');
  const {journal}=mame(work,{live:true});
  const {tape,diff}=roundTrip(work,journal);
  console.log('H3_RECORD frames='+(tape.frames-1)+' events='+tape.events.length+
    ' rewinds='+journal.rewinds+' roundtrip='+(diff<0?'MATCH':'DIFF@'+diff));
  console.log('H3_RECORD_TAPE='+join(work,'tape.json'));
  process.exitCode=diff<0?0:1;
}else if(cmd==='convert'&&args.length===2){
  const tape=journalToTape(parseJournal(readFileSync(args[0],'utf8')));
  writeFileSync(args[1],JSON.stringify(tape));
  console.log('H3_TAPE frames='+tape.frames+' events='+tape.events.length+
    ' sha256='+tape.sha256);
}else throw Error('H3_USAGE');
