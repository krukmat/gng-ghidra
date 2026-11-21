#!/usr/bin/env node
/** Check life counters and their visible icons after real Android deaths.
 * Build the isolated org.gng.persistence.check APK first. */
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {mkdirSync,readFileSync,writeFileSync} from 'node:fs';
import {homedir} from 'node:os';
import {join} from 'node:path';
import {_android} from 'playwright-core';
import {decodeCheckpoint} from '../src/checkpoint_format.mjs';
import {defendUntil} from './ao_check_controls.mjs';

const serial=process.env.AO_ADB_SERIAL??'emulator-5554';
const pkg='org.gng.persistence.check',dir='out/android/check/lives-display';
const adb=(...args)=>execFileSync(join(homedir(),'Library/Android/sdk/platform-tools/adb'),
  ['-s',serial,...args],{timeout:60000});
const logs=[],errors=[],report={serial,status:'RUNNING',states:[]};
let device,page;
const until=async(tag,mark=0,predicate=()=>true,timeout=45000)=>{
  const end=Date.now()+timeout;
  while(Date.now()<end){
    assert.deepEqual(errors,[]);
    const found=logs.slice(mark).find(l=>l.tag===tag&&predicate(l.data));
    if(found)return found.data;
    await page.waitForTimeout(50);
  }
  throw Error('LIVES_DISPLAY_TIMEOUT '+tag);
};
const slot=key=>page.evaluate(key=>new Promise((resolve,reject)=>{
  const open=indexedDB.open('gng-checkpoint',1);open.onerror=()=>reject(open.error);
  open.onsuccess=()=>{const db=open.result,tx=db.transaction('slot');
    const get=tx.objectStore('slot').get(key);
    tx.oncomplete=()=>{db.close();resolve(get.result);};};
}),key);
async function capture(label){
  await page.waitForFunction(()=>!document.getElementById('ck-save').disabled);
  const mark=logs.length;
  await page.locator('#ck-save').click();await until('AO_CK_SAVE',mark);
  const saved=await slot('quick');
  const checkpoint=decodeCheckpoint(saved.text,{programSha256:JSON.parse(saved.text).programSha256});
  const mem=checkpoint.cpu.mem;
  // Retain the complete foreground tilemap so the visible icons can be
  // corroborated independently of the observed RAM life counter.
  const state={label,frame:checkpoint.frame,lives:mem[0x60],
    foreground:[...mem.slice(0x2000,0x2800)]};
  state.icons=Array.from({length:7},(_,i)=>0x2380+i*2)
    .filter(at=>mem[at]===0x8a&&mem[at+1]===0x8b&&
      mem[at+32]===0x9a&&mem[at+33]===0x9b).length;
  writeFileSync(join(dir,label+'.json'),JSON.stringify(state,null,2)+'\n');
  const image=await page.evaluate(()=>document.getElementById('screen').toDataURL());
  writeFileSync(join(dir,label+'-screen.png'),Buffer.from(image.split(',')[1],'base64'));
  writeFileSync(join(dir,label+'-android.png'),adb('exec-out','screencap','-p'));
  report.states.push(state);
  console.log('LIVES_DISPLAY_CAPTURE '+label+' lives='+state.lives+' icons='+state.icons+' frame='+state.frame);
  assert.equal(state.icons,state.lives-1,'visible reserve-life icons match remaining lives');
  return state;
}
try{
  mkdirSync(dir,{recursive:true});
  const metadata=JSON.parse(readFileSync(
    'out/android/gradle-build/app/outputs/apk/debug/output-metadata.json','utf8'));
  assert.equal(metadata.applicationId,pkg,'build the isolated APK before testing');
  adb('install','-r','out/android/gradle-build/app/outputs/apk/debug/app-debug.apk');
  adb('shell','pm','clear',pkg);
  adb('shell','am','start','-W','-n',pkg+'/org.rommigration.shell.MainActivity');
  device=(await _android.devices()).find(d=>d.serial()===serial);
  assert.ok(device,'Android device available');
  page=await (await device.webView({pkg},{timeout:30000})).page();
  page.on('pageerror',e=>errors.push(String(e)));
  page.on('console',message=>{
    const match=/^(AO_\w+) (.*)$/s.exec(message.text());if(!match)return;
    logs.push({tag:match[1],data:JSON.parse(match[2])});
    if(['AO_ERROR','AO_HALT'].includes(match[1]))errors.push(message.text());
  });
  await page.goto('https://appassets.androidplatform.net/assets/index.html?inputCheck');
  await page.waitForFunction(()=>!document.getElementById('start').disabled);
  await page.locator('#options-open').click();
  await page.locator('label:has(input[name=lives][value="3"])').click();
  await page.locator('#options-apply').click();
  await page.waitForFunction(()=>!document.getElementById('start').disabled);
  let mark=logs.length;await page.locator('#start').click();
  const initial=await until('AO_CK_AUTO',mark);
  await defendUntil(page,()=>logs.slice(mark).some(l=>l.tag==='AO_INPUT'&&
    l.data.ram5===1&&l.data.gameState?.hurt===false&&l.data.frame>initial.frame+1200));
  mark=logs.length;
  await page.evaluate(()=>window.dispatchEvent(new Event('pagehide')));
  const automatic=await until('AO_CK_AUTO',mark,d=>d.frame>initial.frame);
  report.automaticFrame=automatic.frame;
  writeFileSync(join(dir,'automatic.json'),(await slot('auto')).text);
  await capture('before');
  for(let death=1;death<=2;death++){
    mark=logs.length;await page.keyboard.down('ArrowRight');
    await until('AO_LIFE_LOST',mark);await page.keyboard.up('ArrowRight');
    const loaded=await until('AO_CK_LOAD',mark,d=>d.recovery);
    assert.equal(loaded.frame,automatic.frame,'recover the same confirmed checkpoint');
    await until('AO_READY',mark);
    const boot=logs.findIndex((l,i)=>i>=mark&&l.tag==='AO_READY');
    const resumed=await until('AO_INPUT',boot,d=>d.gameState?.inGame&&d.frame>automatic.frame+30);
    assert.equal(resumed.gameState.lives[0],3-death);
    await capture('after-'+death);
  }
  mark=logs.length;await page.keyboard.down('ArrowRight');
  await until('AO_INPUT',mark,d=>d.gameState?.mode===1);
  await page.keyboard.up('ArrowRight');
  assert.equal(logs.slice(mark).some(l=>l.tag==='AO_CK_LOAD'&&l.data.recovery),false,
    'last life must end the game without recovery');
  writeFileSync(join(dir,'game-over-android.png'),adb('exec-out','screencap','-p'));
  report.status='PASS';
}catch(error){report.status='FAIL';report.error=String(error.stack??error);throw error;}
finally{
  writeFileSync(join(dir,'report.json'),JSON.stringify(report,null,2)+'\n');
  await device?.close();
}
console.log('LIVES_DISPLAY='+report.status);
