#!/usr/bin/env node
/** Real deaths restore the confirmed automatic copy, in Chromium or an
 * isolated Android WebView. Build assets (and the isolated APK) first. */
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {mkdirSync,readFileSync,writeFileSync} from 'node:fs';
import {homedir} from 'node:os';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {chromium,_android} from 'playwright-core';
import {createAssetServer} from './ao_serve.mjs';
import {canAutosave,observeGameState,RAM} from '../games/gngb/state.mjs';
import {optionDips,withGameOptions} from '../games/gngb/options.mjs';
import {decodeCheckpoint,encodeCheckpoint} from '../src/checkpoint_format.mjs';
import {liveTapeReader} from '../src/v3_b3_live_tape.mjs';
import {createBoard} from '../boards/gng/runtime.mjs';
import {gngCode} from '../boards/gng/bundle.mjs';
import {defendUntil} from './ao_check_controls.mjs';

const android=process.argv.includes('--android'),pkg='org.gng.persistence.check';
const report={status:'RUNNING',modes:[]},logs=[],errors=[];
const server=createAssetServer();
let browser,device,page;
const until=async(tag,mark=0,timeout=45000,predicate=()=>true)=>{
  const end=Date.now()+timeout;
  while(Date.now()<end){
    assert.deepEqual(errors,[]);
    const found=logs.slice(mark).find(l=>l.tag===tag&&predicate(l.data));
    if(found)return found.data;
    await page.waitForTimeout(50);
  }
  throw Error('LIFE_RECOVERY_TIMEOUT '+tag);
};
const ready=()=>page.waitForFunction(()=>!document.getElementById('start').disabled);
const slot=key=>page.evaluate(key=>new Promise((resolve,reject)=>{
  const open=indexedDB.open('gng-checkpoint',1);open.onerror=()=>reject(open.error);
  open.onsuccess=()=>{const db=open.result,tx=db.transaction('slot');
    const get=tx.objectStore('slot').get(key);
    tx.oncomplete=()=>{db.close();resolve(get.result??null);};};
}),key);
const newer=(key,offset=60000)=>page.evaluate(([key,offset])=>new Promise((resolve,reject)=>{
  const open=indexedDB.open('gng-checkpoint',1);open.onerror=()=>reject(open.error);
  open.onsuccess=()=>{const db=open.result,tx=db.transaction('slot','readwrite'),
    store=tx.objectStore('slot'),get=store.get(key);
    get.onsuccess=()=>store.put({...get.result,savedAt:new Date(Date.now()+offset).toISOString()},key);
    tx.oncomplete=()=>{db.close();resolve();};tx.onerror=()=>reject(tx.error);
  };
}),[key,offset]);
const decode=record=>{
  const json=JSON.parse(record.text);
  return decodeCheckpoint(record.text,{programSha256:json.programSha256});
};
async function checkArmorReplay(checkpoint){
  const bundle=join(import.meta.dirname,'../out/android/assets/bundle');
  const read=name=>readFileSync(join(bundle,name));
  const {blocks}=await import(pathToFileURL(join(bundle,'program.mjs')).href);
  const code=gngCode(JSON.parse(read('manifest.json')),read('code.bin'),read('overlays.bin'));
  let replayed;
  const board=createBoard(code,withGameOptions(blocks,checkpoint.options),{
    dips:optionDips(checkpoint.options),portRead:liveTapeReader(checkpoint.tape),
    onFrame:r=>{board.state.records[r.index-1]=null;board.state.events.length=0;},
    onAudioComplete:({frames})=>{
      if(frames===checkpoint.frame&&!replayed)replayed=board.exportState();
    }
  });
  assert.equal(board.run(checkpoint.frame).status,'FRAMES_DONE');
  assert.deepEqual(replayed,checkpoint.cpu,'armor recovery must replay from reset');
}
try{
  mkdirSync('out/android/check',{recursive:true});
  let url;
  if(android){
    const metadata=JSON.parse(readFileSync('out/android/gradle-build/app/outputs/apk/debug/output-metadata.json','utf8'));
    assert.equal(metadata.applicationId,pkg,'build the isolated package before the Android check');
    const adb=(...args)=>execFileSync(join(homedir(),'Library/Android/sdk/platform-tools/adb'),
      ['-s','emulator-5554',...args],{encoding:'utf8',timeout:60000});
    adb('install','-r','out/android/gradle-build/app/outputs/apk/debug/app-debug.apk');
    adb('shell','pm','clear',pkg);
    adb('shell','am','start','-W','-n',pkg+'/org.rommigration.shell.MainActivity');
    device=(await _android.devices()).find(d=>d.serial()==='emulator-5554');
    page=await (await device.webView({pkg},{timeout:30000})).page();
    url='https://appassets.androidplatform.net/assets/index.html?inputCheck';
  }else{
    await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
    browser=await chromium.launch({channel:'chromium',headless:true});
    page=await browser.newPage({viewport:{width:1100,height:700}});
    url='http://127.0.0.1:'+server.address().port+'/index.html?inputCheck';
  }
  page.setDefaultTimeout(30000);
  page.on('pageerror',e=>errors.push(String(e)));
  page.on('console',message=>{
    const match=/^(AO_\w+) (.*)$/s.exec(message.text());if(!match)return;
    try{logs.push({tag:match[1],data:JSON.parse(match[2])});}catch{}
    if(['AO_ERROR','AO_HALT','AO_AUDIO_STOP'].includes(match[1]))errors.push(message.text());
  });
  await page.goto(url);await ready();
  for(const mode of process.argv.includes('--armor-only')?[]:['single','by-turns','cooperative']){
    await page.locator('#options-open').click();
    await page.locator('label:has(input[name=lives][value="'+(mode==='single'?'7':'3')+'"])').click();
    await page.locator('label:has(input[name=coop][value="'+(mode==='cooperative'?'1':'0')+'"])').click();
    await page.locator('#options-apply').click();await ready();
    let mark=logs.length;
    await page.locator(mode==='single'?'#start':'#two-players').click();
    const first=await until('AO_CK_AUTO',mark);
    console.log('LIFE_RECOVERY_INITIAL '+mode+' '+first.frame);
    await page.locator('#ck-save').click();await until('AO_CK_SAVE',mark);
    const manual=await slot('quick');
    // At least one recovery must use a periodic checkpoint, beyond the
    // initial save, so rewinding to a fresh game cannot satisfy the check.
    if(mode==='single'){
      await defendUntil(page,()=>logs.slice(mark).some(l=>l.tag==='AO_CK_AUTO'&&l.data.frame>first.frame+1000));
    }
    const saved=await slot('auto'),checkpoint=decode(saved);
    const state=observeGameState({record:checkpoint.cpu.mem,known:checkpoint.cpu.km});
    assert.equal(canAutosave({record:checkpoint.cpu.mem,known:checkpoint.cpu.km}),true);
    mark=logs.length;
    await page.keyboard.down('ArrowRight');
    const lost=await until('AO_LIFE_LOST',mark);
    await page.keyboard.up('ArrowRight');
    const loaded=await until('AO_CK_LOAD',mark,30000,d=>d.recovery);
    assert.equal(loaded.automatic,true);assert.equal(lost.player,state.player);
    assert.equal(loaded.frame,saved.frame,'death uses the last confirmed automatic checkpoint');
    await until('AO_READY',mark);
    const restoredMark=logs.findIndex((l,i)=>i>=mark&&l.tag==='AO_READY');
    const resumed=await until('AO_INPUT',restoredMark,30000,d=>d.gameState&&d.frame>=saved.frame&&d.frame<saved.frame+240);
    assert.equal(resumed.gameState.player,state.player,'restore precedes a turn change');
    const remaining=[...state.lives];remaining[state.player-1]--;
    assert.deepEqual(resumed.gameState.lives,remaining,'recovery spends one life');
    assert.equal(resumed.gameState.hurt,false);
    const spent=decode(await slot('auto'));
    assert.equal(spent.frame,saved.frame,'recovery keeps the checkpoint position');
    assert.deepEqual(spent.options.recoveryLifeLosses,[[saved.frame,state.player,1]]);
    assert.equal((await slot('quick')).text,manual.text,'manual copy is independent');
    assert.equal(logs.slice(mark).some(l=>l.tag==='AO_MATCH'&&l.data.type==='turn'),false);
    await page.waitForFunction(()=>{
      const canvas=document.getElementById('screen');
      const pixels=canvas.getContext('2d').getImageData(0,0,canvas.width,canvas.height).data;
      let visible=0;
      for(let i=0;i<pixels.length;i+=4)if(pixels[i]||pixels[i+1]||pixels[i+2])visible++;
      return !document.getElementById('ck-save').disabled&&visible>5000;
    },null,{timeout:10000});
    const screenshot='out/android/check/life-recovery-'+mode+(android?'-android':'')+'.png';
    if(android)writeFileSync(screenshot,execFileSync(join(homedir(),'Library/Android/sdk/platform-tools/adb'),
      ['-s','emulator-5554','exec-out','screencap','-p'],{timeout:10000}));
    else await page.screenshot({path:screenshot});
    report.modes.push({mode,frame:saved.frame,player:state.player,lives:remaining});
    console.log('LIFE_RECOVERY_MODE_PASS '+mode);
    if(mode==='single'){
      // The same saved frame may be recovered again before the next periodic
      // capture; a page restart must retain both consumed lives.
      mark=logs.length;
      await page.keyboard.down('ArrowRight');
      await until('AO_LIFE_LOST',mark);await page.keyboard.up('ArrowRight');
      await until('AO_CK_LOAD',mark,30000,d=>d.recovery);
      await until('AO_READY',mark);
      const secondMark=logs.findIndex((l,i)=>i>=mark&&l.tag==='AO_READY');
      const second=await until('AO_INPUT',secondMark,30000,d=>d.gameState?.inGame);
      assert.equal(second.gameState.lives[0],remaining[0]-1,'second death spends another life');
      assert.deepEqual(decode(await slot('auto')).options.recoveryLifeLosses,
        [[saved.frame,state.player,2]],'repeated recovery charges the saved copy');
      await newer('auto');
      await page.reload();await ready();
      mark=logs.length;await page.locator('#ck-load').click();
      await until('AO_CK_LOAD',mark,30000,d=>d.automatic);
      await until('AO_READY',mark);
      const reopenedMark=logs.findIndex((l,i)=>i>=mark&&l.tag==='AO_READY');
      const reopened=await until('AO_INPUT',reopenedMark,30000,d=>d.gameState?.inGame);
      assert.equal(reopened.gameState.lives[0],remaining[0]-1,'life losses survive restart');
      // A damaged automatic record must fail once, retain both copies and
      // leave manual recovery usable, rather than entering a reload loop.
      await page.evaluate(()=>new Promise(resolve=>{
        const open=indexedDB.open('gng-checkpoint',1);open.onsuccess=()=>{
          const db=open.result,tx=db.transaction('slot','readwrite');
          tx.objectStore('slot').put({text:'invalid'},'auto');
          tx.oncomplete=()=>{db.close();resolve();};};
      }));
      mark=logs.length;await page.keyboard.down('ArrowRight');
      await until('AO_LIFE_LOST',mark);await page.keyboard.up('ArrowRight');
      await until('AO_CK_LOAD_FAILED',mark);
      await page.waitForTimeout(2000);
      assert.equal(logs.slice(mark).filter(l=>l.tag==='AO_CK_LOAD_FAILED').length,1);
      assert.equal((await slot('quick')).text,manual.text);
      await newer('quick');await page.reload();await ready();
      await page.waitForFunction(()=>document.getElementById('ck-load').title.includes('guardado manual'));
      mark=logs.length;await page.locator('#ck-load').click();
      await until('AO_CK_LOAD',mark);await until('AO_READY',mark);
      await page.waitForFunction(()=>!document.getElementById('ck-save').disabled);
      report.invalidAutomaticCopy='manual recovery remains usable';
    }
  }
  // Create a real automatic copy after an enemy has stripped the armor.
  await page.locator('#options-open').click();
  await page.locator('#options-apply').click();await ready();
  let mark=logs.length;
  await page.locator('#start').click();await until('AO_CK_AUTO',mark);
  await page.keyboard.down('ArrowRight');
  await until('AO_INPUT',mark,30000,d=>d.armored===false&&d.gameState?.hurt===false&&d.gameState?.inGame);
  await page.keyboard.up('ArrowRight');
  mark=logs.length;
  await page.evaluate(()=>window.dispatchEvent(new Event('pagehide')));
  await until('AO_CK_AUTO',mark);
  const saved=await slot('auto'),unarmored=decode(saved);
  assert.equal(unarmored.cpu.mem[RAM.armor],1);
  await page.locator('#ck-save').click();await until('AO_CK_SAVE',mark);
  const manual=await slot('quick');
  assert.equal(decode(manual).cpu.mem[RAM.armor],1);

  async function expectArmor(mark,recovery){
    const loaded=await until('AO_CK_LOAD',mark,30000,d=>d.automatic&&d.recovery===recovery);
    assert.equal(loaded.frame,saved.frame);
    await until('AO_READY',mark);
    const boot=logs.findIndex((l,i)=>i>=mark&&l.tag==='AO_READY');
    const input=await until('AO_INPUT',boot,30000,d=>d.frame>saved.frame&&d.gameState);
    assert.equal(input.armored,true,'the first playable state has armor');
    assert.equal(input.gameState.hurt,false);
    assert.equal(decode(await slot('auto')).frame,saved.frame,
      'the checkpoint position is preserved');
    return input;
  }
  mark=logs.length;
  await page.keyboard.down('ArrowRight');
  await until('AO_LIFE_LOST',mark);
  await page.keyboard.up('ArrowRight');
  await expectArmor(mark,true);
  await newer('quick',120000);await page.reload();await ready();
  await page.waitForFunction(()=>document.getElementById('ck-load').title.includes('guardado manual'));
  mark=logs.length;
  await page.locator('#ck-load').click();
  const manualLoad=await until('AO_CK_LOAD',mark,30000,d=>!d.automatic);
  assert.equal(manualLoad.frame,manual.frame);
  await until('AO_READY',mark);
  const manualBoot=logs.findIndex((l,i)=>i>=mark&&l.tag==='AO_READY');
  const exact=await until('AO_INPUT',manualBoot,30000,d=>d.frame>manual.frame&&d.gameState);
  assert.equal(exact.armored,true,'manual load restores armor');

  await newer('auto',180000);await page.reload();await ready();
  await page.waitForFunction(()=>document.getElementById('ck-load').title.includes('autoguardado'));
  mark=logs.length;
  await page.locator('#ck-load').click();
  const automaticRestored=await expectArmor(mark,false);
  // An older manual save made during a death must yield to the living
  // automatic copy, even when its timestamp makes it the newest slot.
  const dead=decode(manual);
  dead.cpu.mem[RAM.lives]=0;
  const deadText=encodeCheckpoint(dead);
  await page.evaluate(({text,frame})=>new Promise(resolve=>{
    const open=indexedDB.open('gng-checkpoint',1);open.onsuccess=()=>{
      const db=open.result,tx=db.transaction('slot','readwrite');
      tx.objectStore('slot').put({text,frame,
        savedAt:new Date(Date.now()+240000).toISOString()},'quick');
      tx.oncomplete=()=>{db.close();resolve();};};
  }),{text:deadText,frame:dead.frame});
  await page.reload();await ready();
  await page.waitForFunction(()=>document.getElementById('ck-load').title.includes('guardado manual'));
  mark=logs.length;
  await page.locator('#ck-load').click();
  await until('AO_CK_LOAD_FAILED',mark,30000,d=>d.code==='CK_SAVE_UNSAFE'&&!d.automatic);
  await expectArmor(mark,false);
  report.deadManualCopy='automatic recovery remains usable';
  mark=logs.length;
  await page.locator('#ck-save').click();await until('AO_CK_SAVE',mark);
  const withArmor=decode(await slot('quick'));
  assert.equal(withArmor.cpu.mem[RAM.armor],0);
  assert.deepEqual(withArmor.options.recoveryArmorFrames,[saved.frame]);
  mark=logs.length;
  await page.keyboard.down('ArrowRight');
  const hit=await until('AO_INPUT',mark,15000,d=>d.armored===false&&d.gameState?.inGame);
  await page.keyboard.up('ArrowRight');
  assert.deepEqual(hit.gameState.lives,automaticRestored.gameState.lives,
    'armor absorbs an enemy hit');
  assert.equal(logs.slice(mark).some(l=>l.tag==='AO_LIFE_LOST'),false);
  await checkArmorReplay(withArmor);
  report.armor={automaticFrame:saved.frame,replayFrame:withArmor.frame,hitAbsorbed:true};
  assert.deepEqual(errors,[]);report.status='PASS';
}finally{
  if(report.status!=='PASS')report.recent=logs.filter(l=>l.tag!=='AO_STATS').slice(-20);
  const name=process.argv.includes('--armor-only')?'armor-recovery':'life-recovery';
  writeFileSync('out/android/check/'+name+(android?'-android':'')+'.json',JSON.stringify(report,null,2)+'\n');
  await browser?.close();await device?.close();
  if(server.listening)await new Promise(resolve=>server.close(resolve));
}
console.log(JSON.stringify(report));
