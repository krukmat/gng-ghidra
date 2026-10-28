#!/usr/bin/env node
/** Private stick check on an Android device or emulator: real OS touches
 * (adb input motionevent) on the installed APK. Coin, Start, run right,
 * raise the thumb ~20 px into the jump diagonal, back to running, release.
 * The CPU's own port reads (?inputCheck probes) must show Right, then
 * Right+Jump, then Right, then neutral; screenshots show the jump.
 * Usage: node scripts/ao_stick_android_check.mjs [adb serial]
 */
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {mkdirSync,writeFileSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {homedir} from 'node:os';
import {_android} from 'playwright-core';

const ROOT=resolve(fileURLToPath(import.meta.url),'../..');
const APK=join(ROOT,'out/android/gng.apk'),CHECK=join(ROOT,'out/android/check');
const ADB=join(process.env.ANDROID_HOME??join(homedir(),'Library/Android/sdk'),
  'platform-tools/adb');
const PKG='org.gng.offline';
const serial=process.argv[2]??process.env.AO_ADB_SERIAL??'emulator-5554';
const adb=(...a)=>execFileSync(ADB,['-s',serial,...a],{encoding:'utf8',timeout:60000});
const RIGHT=0xfe,RIGHT_JUMP=0xde,NEUTRAL=0xff;

mkdirSync(CHECK,{recursive:true,mode:0o700});
const report={schema:'gng.ao.stick-android-check.v1',serial,steps:[]};
const probes=[],bad=[];
let device;
try{
  adb('install','-r',APK);
  adb('shell','am','force-stop',PKG);
  adb('shell','am','start','-W','-n',PKG+'/.MainActivity');
  device=(await _android.devices()).find(d=>d.serial()===serial);
  assert.ok(device,'device');
  const page=await(await device.webView({pkg:PKG},{timeout:30000})).page();
  page.on('console',msg=>{
    const m=/^(AO_[A-Z_]+) (.*)$/s.exec(msg.text());if(!m)return;
    if(m[1]==='AO_INPUT')probes.push(JSON.parse(m[2]));
    if(['AO_ERROR','AO_HALT'].includes(m[1]))bad.push(msg.text());
  });
  await page.waitForTimeout(2000);
  await page.goto('https://appassets.androidplatform.net/assets/index.html?inputCheck&s='+
    Date.now(),{waitUntil:'domcontentloaded',timeout:30000});
  const latest=()=>probes.at(-1);
  const until=async(pred,what,timeout=30000)=>{
    const end=Date.now()+timeout;
    for(;;){
      assert.equal(bad.length,0,bad.join('\n'));
      const hit=probes.find(p=>p.frame>(until.after??0)&&pred(p));
      if(hit){until.after=hit.frame;return hit;}
      if(Date.now()>end)throw Error('STICK_TIMEOUT '+what+' '+JSON.stringify(latest()?.reads));
      await page.waitForTimeout(100);
    }
  };
  // CSS px -> screen px, calibrated with one real tap on the canvas.
  await page.evaluate(()=>{window.lastDown=null;addEventListener('pointerdown',
    e=>{window.lastDown={x:e.clientX,y:e.clientY};},{capture:true});});
  const dpr=await page.evaluate(()=>devicePixelRatio);
  const [w,h]=adb('shell','wm','size').match(/(\d+)x(\d+)/).slice(1).map(Number);
  const probe={x:Math.max(w,h)/2,y:Math.min(w,h)/2};
  adb('shell','input','tap',String(probe.x),String(probe.y));
  await page.waitForFunction(()=>window.lastDown,null,{timeout:5000});
  const down=await page.evaluate(()=>window.lastDown);
  const off={x:probe.x/dpr-down.x,y:probe.y/dpr-down.y};
  const screen=p=>[String(Math.round((p.x+off.x)*dpr)),String(Math.round((p.y+off.y)*dpr))];
  report.mapping={dpr,off};
  const center=async id=>{
    const b=await page.locator('#'+id).boundingBox();
    return {x:b.x+b.width/2,y:b.y+b.height/2};
  };
  const tap=async id=>adb('shell','input','tap',...screen(await center(id)));
  const motion=(kind,p)=>adb('shell','input','motionevent',kind,...screen(p));
  const shot=async name=>{
    await device.screenshot({path:join(CHECK,name)});report.steps.push({shot:name});
  };

  await page.waitForFunction(()=>!document.getElementById('coin').disabled,null,{timeout:60000});
  await tap('coin');
  await page.waitForFunction(()=>!document.getElementById('start').disabled,null,{timeout:30000});
  await tap('start');
  const started=await until(p=>p.gameState?.inGame,'in game');
  // The armour intro lasts ~15 s; Arthur answers the stick only after it.
  await until(p=>p.frame>=started.frame+900,'level playable',60000);
  const zone=await page.locator('#stick-zone').boundingBox();
  const radius=await page.evaluate(()=>document.getElementById('stick-base').offsetWidth/2);
  const start={x:zone.x+zone.width*.5,y:zone.y+zone.height*.6};
  report.stick={zone,radius};
  // Thumb down, run right: drag past the rim in steps, as a finger would.
  motion('DOWN',start);
  for(const dx of [10,25,40,radius+10])motion('MOVE',{x:start.x+dx,y:start.y});
  const run=await until(p=>p.reads[1]===RIGHT,'run right');
  report.steps.push({step:'run',frame:run.frame,p1:run.reads[1]});
  await page.waitForTimeout(800);await shot('stick-run.png');
  // Raise the thumb ~20 px: the base follows, the angle crosses ~23 degrees.
  const rim={x:start.x+radius+10,y:start.y};
  for(const dy of [7,14,21])motion('MOVE',{x:rim.x,y:rim.y-dy});
  const jump=await until(p=>p.reads[1]===RIGHT_JUMP,'run and jump');
  report.steps.push({step:'jump',frame:jump.frame,p1:jump.reads[1],thumbUpPx:21});
  await shot('stick-jump-1.png');
  await page.waitForTimeout(250);await shot('stick-jump-2.png');
  // Back down to running, then lift.
  for(const dy of [14,4,0])motion('MOVE',{x:rim.x+4,y:rim.y-dy+12});
  const back=await until(p=>p.reads[1]===RIGHT,'back to running');
  report.steps.push({step:'run again',frame:back.frame,p1:back.reads[1]});
  motion('UP',{x:rim.x+4,y:rim.y+12});
  const rest=await until(p=>p.reads[1]===NEUTRAL,'released');
  report.steps.push({step:'released',frame:rest.frame,p1:rest.reads[1]});
  report.jumpReads=jump.witness.activeSamples['p1.button2'];
  report.status='PASS';
}catch(e){report.status='STOP';report.error=String(e?.stack??e).slice(0,1200);}
finally{
  writeFileSync(join(CHECK,'stick-android-report.json'),JSON.stringify(report,null,1),
    {mode:0o600});
  await device?.close();
}
console.log('AO_STICK_ANDROID='+report.status+' '+JSON.stringify(report.steps.filter(s=>s.step))+
  (report.error?' '+report.error.split('\n')[0]:''));
process.exitCode=report.status==='PASS'?0:1;
