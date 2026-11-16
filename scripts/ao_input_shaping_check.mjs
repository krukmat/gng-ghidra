#!/usr/bin/env node
/** Private check of the P1 input shaping in the real app (build assets
 * first; Chromium stays headless). Fingers -> page -> engine worker -> the
 * MC6809's reads, taken from the exported session tape:
 *   instant taps on Jump are each read for two frames or more;
 *   Fire taps faster than the game takes them wait their turn, 10 frames apart;
 *   the zone around Fire and Jump answers, and a finger slides between them;
 *   the stick diagonal from rest reads the direction a frame before Jump;
 *   with "Disparo sostenido", a held Fire presses again every 10 frames.
 */
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {resolve,join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createAssetServer} from './ao_serve.mjs';
import {chromium} from 'playwright-core';
import {CYCLES_PER_FRAME} from '../boards/gng/runtime.mjs';
import {P1_SHAPING} from '../games/gngb/inputs.mjs';

const ROOT=resolve(fileURLToPath(import.meta.url),'../..');
const ASSETS=join(ROOT,'out/android/assets'),CHECK=join(ROOT,'out/android/check');
const RIGHT=0x01,FIRE=0x10,JUMP=0x20,EVERY=P1_SHAPING.fire.every;
const server=createAssetServer(ASSETS);
const report={schema:'gng.ao.input-shaping-check.v1'};
let browser;
try{
  mkdirSync(CHECK,{recursive:true,mode:0o700});
  await new Promise(ok=>server.listen(0,'127.0.0.1',ok));
  browser=await chromium.launch({channel:'chromium',headless:true});
  const page=await browser.newPage({viewport:{width:900,height:400},hasTouch:true});
  const probes=[],bad=[];
  page.on('console',msg=>{
    const m=/^(AO_\w+) (.*)$/s.exec(msg.text());if(!m)return;
    if(m[1]==='AO_INPUT')probes.push(JSON.parse(m[2]));
    if(['AO_ERROR','AO_HALT','AO_AUDIO_STOP'].includes(m[1]))bad.push(msg.text());
  });
  page.on('pageerror',e=>bad.push(String(e)));
  // The frame of the next probe: a boundary between two parts of the check.
  const mark=async()=>{
    const seen=probes.length,end=Date.now()+20000;
    while(probes.length===seen){
      assert.equal(bad.length,0,bad.join('\n'));
      if(Date.now()>end)throw Error('AO_SHAPING_PROBE_TIMEOUT');
      await page.waitForTimeout(25);
    }
    return probes.at(-1).frame;
  };
  const box=async id=>{
    const b=await page.locator('#'+id).boundingBox();assert.ok(b,id);return b;
  };
  const centre=b=>[b.x+b.width/2,b.y+b.height/2];
  await page.goto('http://127.0.0.1:'+server.address().port+'/index.html?inputCheck=1');
  await page.waitForFunction(()=>!document.getElementById('coin').disabled);
  await page.locator('#coin').tap();
  await page.waitForFunction(()=>!document.getElementById('start').disabled);
  await page.locator('#start').tap();
  await page.waitForFunction(()=>!document.getElementById('attack').disabled);
  const attack=await box('attack'),jump=await box('jump'),marks=[await mark()];
  // 1. Instant taps: touchscreen.tap sends the touch and its end together.
  for(let k=0;k<8;k++){await page.touchscreen.tap(...centre(jump));await page.waitForTimeout(330);}
  marks.push(await mark());
  // 2. Twelve Fire taps about 7 frames apart.
  for(let k=0;k<12;k++){await page.touchscreen.tap(...centre(attack));await page.waitForTimeout(110);}
  marks.push(await mark());
  // 3. Outside the buttons, inside the zone: right of Fire, above Fire, right of Jump.
  const [ax,ay]=centre(attack),[jx,jy]=centre(jump);
  for(const [x,y] of [[attack.x+attack.width+40,ay],[ax,attack.y-40],[jump.x+jump.width+40,jy]]){
    await page.touchscreen.tap(x,y);await page.waitForTimeout(330);
  }
  marks.push(await mark());
  // 4. One finger slides from Fire to Jump (a mouse button is a pointer too).
  const held=()=>page.evaluate(()=>['attack','jump'].filter(id=>
    document.getElementById(id).classList.contains('held')));
  await page.mouse.move(ax,ay);await page.mouse.down();
  const onFire=await held();
  await page.mouse.move(jx,jy,{steps:4});
  const onJump=await held();
  await page.mouse.up();
  assert.deepEqual([onFire,onJump,await held()],[['attack'],['jump'],[]]);
  report.slide='PASS';
  marks.push(await mark());
  // 5. The stick from rest straight into the upper right diagonal.
  const zone=await box('stick-zone'),sx=zone.x+zone.width*.55,sy=zone.y+zone.height*.6;
  await page.mouse.move(sx,sy);await page.mouse.down();
  await page.mouse.move(sx+32,sy-32);
  await page.waitForTimeout(300);await page.mouse.up();
  marks.push(await mark());
  // 6. Disparo sostenido: Fire held for a second and a half.
  await page.locator('#options-open').tap();
  await page.locator('input[name=autofire][value="1"]+span').tap();
  await page.locator('#options-cancel').tap();
  assert.equal(await page.evaluate(()=>localStorage.getItem('gng-autofire')),'1');
  await page.mouse.move(ax,ay);await page.mouse.down();
  await page.waitForTimeout(1500);await page.mouse.up();
  marks.push(await mark());
  await page.screenshot({path:join(CHECK,'ao-input-shaping.png')});
  const [download]=await Promise.all([page.waitForEvent('download'),
    page.keyboard.press('KeyT')]);
  const tapePath=join(CHECK,'ao-input-shaping-tape.json');await download.saveAs(tapePath);
  const tape=JSON.parse(readFileSync(tapePath,'utf8'));
  assert.equal(bad.length,0,bad.join('\n'));

  // P1 as read, frame by frame, between two marks.
  const p1=tape.changes.filter(c=>c[0]===1).map(([,cycle,value])=>
    ({frame:Math.floor(cycle/CYCLES_PER_FRAME),value}));
  const part=k=>{
    const out=[];let value=0xff,i=0;
    for(let f=0;f<marks[k];f++){
      while(i<p1.length&&p1[i].frame<=f){value=p1[i].value;i++;}
      if(f>=marks[k-1])out.push({frame:f,value});
    }
    return out;
  };
  // Runs of frames with `bit` pressed: [{frame, frames, value at its first frame}].
  const presses=(frames,bit)=>{
    const runs=[];let run=null;
    for(const {frame,value} of frames){
      if(value&bit){run=null;continue;}
      if(run)run.frames++;else runs.push(run={frame,frames:1,value});
    }
    return runs;
  };
  const gaps=runs=>runs.slice(1).map((r,k)=>r.frame-runs[k].frame);

  const taps=presses(part(1),JUMP);
  assert.equal(taps.length,8,'instant Jump taps read');
  assert.ok(taps.every(r=>r.frames>=P1_SHAPING.jump.frames));
  report.instantTaps={status:'PASS',taps:8,read:taps.length,frames:taps.map(r=>r.frames)};

  const shots=presses(part(2),FIRE);
  assert.ok(shots.length>=9&&shots.length<=12,'Fire presses read: '+shots.length);
  assert.ok(gaps(shots).every(g=>g>=EVERY),'Fire edges '+gaps(shots));
  report.fastFire={status:'PASS',taps:12,read:shots.length,gaps:gaps(shots)};

  const around=part(3);
  assert.deepEqual([presses(around,FIRE).length,presses(around,JUMP).length],[2,1]);
  report.zone='PASS';

  const diagonal=part(5),run=presses(diagonal,RIGHT)[0],leap=presses(diagonal,JUMP)[0];
  assert.ok(run&&leap,'diagonal read');
  assert.equal(leap.frame-run.frame,P1_SHAPING.jump.afterDirection);
  assert.equal(leap.value&RIGHT,0);
  report.diagonalFromRest={status:'PASS',directionFrame:run.frame,jumpFrame:leap.frame};

  const repeat=presses(part(6),FIRE);
  assert.ok(repeat.length>=7,'held Fire presses: '+repeat.length);
  assert.ok(gaps(repeat).every(g=>g===EVERY),'held Fire edges '+gaps(repeat));
  report.repeat={status:'PASS',presses:repeat.length,gaps:gaps(repeat)};
  report.status='PASS';
  console.log('AO_SHAPING=PASS '+JSON.stringify({jumpTaps:taps.length,
    fireOf12:shots.length,fireGaps:gaps(shots),repeat:repeat.length}));
}catch(e){
  report.status='FAIL';report.error=String(e?.stack??e);
  console.error('AO_SHAPING=FAIL '+report.error);process.exitCode=1;
}finally{
  writeFileSync(join(CHECK,'ao-input-shaping-report.json'),JSON.stringify(report,null,2)+'\n');
  await browser?.close();server.close();
}
