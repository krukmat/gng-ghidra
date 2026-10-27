import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {CYCLES_PER_FRAME} from '../src/gngb_runtime.mjs';
import {parseJournal,journalToTape} from '../src/h3_tape_convert.mjs';
import {resolveB3LabTape} from '../src/v3_b3_external_tape.mjs';

const hex=b=>b.toString(16).padStart(2,'0');
const F=(c,sys=0xff,p1=0xff,dip1=0xdf)=>
  `F ${c} ${c+7} ${hex(sys)} ${hex(p1)} ff ${hex(dip1)} fb 0123456789abcdef`;
const closed=lines=>parseJournal([...lines,'E'].join('\n'));

test('cambio anotado en el frame c -> evento en c*CYCLES_PER_FRAME',()=>{
  const tape=journalToTape(closed([F(0),F(1),F(2,0xbf),F(3,0xbf),F(4,0xff,0xfe),F(5)]));
  assert.deepEqual(tape.events.map(e=>[e.cycle/CYCLES_PER_FRAME,e.control,e.pressed]),
    [[2,'coin1',true],[4,'coin1',false],[4,'p1.right',true],[5,'p1.right',false]]);
  const file=join(mkdtempSync(join(tmpdir(),'h3-')),'tape.json');
  writeFileSync(file,JSON.stringify(tape));
  assert.equal(resolveB3LabTape(file).sha256,tape.sha256);
});

test('fail-closed ante journals no representables',()=>{
  const bad=[[[F(0),F(1),'V 1 3000 bf ff'],/CPU_READ_MISMATCH/],
    [[F(0),F(1,0xfb)],/UNMAPPED_BITS/],[[F(0),F(1,0xff,0xff,0xdd)],/DIP_MISMATCH/],
    [[F(0,0xbf),F(1)],/INITIAL_INPUT_ACTIVE/],[[F(0),F(1,0xff,0xf6)],/FOUR_WAY/]];
  for(const [lines,error] of bad)assert.throws(()=>journalToTape(closed(lines)),error);
  assert.throws(()=>journalToTape(parseJournal([F(0),F(1)].join('\n'))),/NOT_CLOSED/);
  assert.throws(()=>parseJournal([F(0),F(2)].join('\n')),/FRAME_SEQUENCE/);
});

test('rebobinado: R k descarta frames >= k y sus discrepancias; X es fail-closed',()=>{
  const j=closed([F(0),F(1),F(2,0xbf),'V 2 3000 ff bf','R 2',F(2),F(3)]);
  assert.equal(j.rewinds,1);
  assert.deepEqual(journalToTape(j).events,[]);
  assert.throws(()=>closed([F(0),F(1),'X 1']),/FOREIGN_LOAD/);
});
