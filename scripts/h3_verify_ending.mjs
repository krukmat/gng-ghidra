#!/usr/bin/env node
/** H3 gate: true ending (second loop's final room 0x72=6 with 0x7f=1).
 * Replays an input-only tape from reset with the certified bundle and checks,
 * from RAM only: the second loop's final room becomes playable (0x08=1,
 * 0x7f=1, 0x71=2; the first loop's room has 0x7f=0); once the boss is spawned
 * (0xb6=1) its life 0xff6 is set to 10 and then only goes down, to 0; the room
 * closes (0x08:1→2, 0xb6=0); 0x7f goes 1→2 still in the room (0x7fb5);
 * 0x72 goes 6→0 once with 0x7f=0, 0x71=0 and 0xde=1 (branch 0x7389, not the
 * 0x7444 restart with 0x7f=1, 0x71=1); the game becomes playable again from
 * phase 0 with 0x7f=0; no life is lost from the room becoming playable to then.
 * Usage: node scripts/h3_verify_ending.mjs <tape.json>
 * Output: out/h3/phase7/ending-gate.json (private); exit 0 only on PASS.
 */
import {mkdirSync,writeFileSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {loadFrozen} from '../src/v2_b1_frozen.mjs';
import {selectB3Bundle} from '../src/v3_b3_bundle.mjs';
import {labCreateBoard} from '../src/v3_b3_lab_board.mjs';
import {resolveB3LabTape} from '../src/v3_b3_external_tape.mjs';

const ROOT=resolve(fileURLToPath(import.meta.url),'../..');
const selected=selectB3Bundle(ROOT);
if(!selected)throw Error('V3_B3_NO_CERTIFIED_BUNDLE');
const {manifest,code}=loadFrozen(selected.dir);
const {blocks}=await import(pathToFileURL(join(selected.dir,'program.mjs')).href);
const tape=resolveB3LabTape(process.argv[2]);
let room=null,close=null,flag=null,ending=null,restart=null,lives0=null,armed=null,prev=null;
const fails=[],transitions=[];
const board=await labCreateBoard(join(selected.dir,'gngb_runtime.mjs'),
  manifest.files['gngb_runtime.mjs'],code,blocks,{frames:tape.frames,portRead:tape.read,
    onFrame:r=>{
      const f=board.state.records.length,b=r.record;
      board.state.records[f-1]=null;board.state.events.length=0;
      const s={phase:b[0x72],scene:b[8],loop:b[0x71],ending:b[0x7f],seq:b[0xde],bosses:b[0xb6],hp:b[0xff6],lives:b[0x60]};
      if(room&&prev.phase!==s.phase)transitions.push({frame:f,from:prev.phase,to:s.phase});
      if(!room&&s.phase===6&&s.scene===1&&s.ending===1){
        room={frame:f,...s};lives0=s.lives;
        if(s.loop!==2)fails.push('ROOM_STATE');
      }
      if(room&&!close&&s.phase===6){
        if(armed&&s.hp>prev.hp)fails.push('HP_RISE@'+f);
        if(!armed&&s.bosses===1&&s.hp===10)armed=f;
        if(prev.scene===1&&s.scene===2)close={frame:f,...s};
      }
      if(close&&!flag&&s.phase===6&&prev.ending===1&&s.ending===2)flag={frame:f,...s};
      if(flag&&!ending&&prev.phase===6&&s.phase===0)ending={frame:f,...s};
      if(ending&&!restart&&s.phase===0&&s.scene===1)restart={frame:f,...s};
      if(room&&!restart&&s.lives<lives0)fails.push('LIFE_LOST@'+f);
      prev=s;
    }});
const status=board.lab.advanceTo(tape.frames).status;
if(status!=='FRAMES_DONE')fails.push('REPLAY_'+status);
if(!room)fails.push('NO_FINAL_ROOM');
if(!close)fails.push('NO_ROOM_CLOSE');
else if(close.hp!==0||close.bosses!==0||!armed)fails.push('CLOSE_STATE');
if(!flag)fails.push('NO_ENDING_FLAG');
if(!ending)fails.push('NO_ENDING_BRANCH');
else if(ending.ending!==0||ending.loop!==0||ending.seq!==1)fails.push('ENDING_STATE');
if(!restart)fails.push('NO_RESTART');
else if(restart.ending!==0)fails.push('RESTART_STATE');
if(transitions.filter(t=>t.from===6).length!==1)fails.push('EXIT_COUNT');
const result={gate:'h3-true-ending',verdict:fails.length?'FAIL':'PASS',fails:[...new Set(fails)],
  bundle:selected.dir.split('/').slice(-2).join('/'),tape:tape.sha256,frames:tape.frames,
  room,armed,close,flag,ending,restart,transitions};
const out=join(ROOT,'out/h3/phase7');mkdirSync(out,{recursive:true,mode:0o700});
writeFileSync(join(out,'ending-gate.json'),JSON.stringify(result,null,1)+'\n',{mode:0o600});
console.log('H3_ENDING_GATE '+JSON.stringify(result));
process.exitCode=fails.length?1:0;
