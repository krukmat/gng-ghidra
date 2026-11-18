#!/usr/bin/env node
/** Real browser persistence, lifecycle and failure checks, using private assets. */
import assert from 'node:assert/strict';
import {mkdirSync,writeFileSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {homedir} from 'node:os';
import {join} from 'node:path';
import {chromium,_android} from 'playwright-core';
import {createAssetServer} from './ao_serve.mjs';
const server=createAssetServer();
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const android=process.argv.includes('--android');
const browser=android?null:await chromium.launch({channel:'chromium',headless:true});
let device=null;
const url=android?'https://appassets.androidplatform.net/assets/index.html':
  'http://127.0.0.1:'+server.address().port+'/index.html';
const report={};
try{
  let page,adb;
  if(android){
    adb=(...args)=>execFileSync(join(homedir(),'Library/Android/sdk/platform-tools/adb'),
      ['-s','emulator-5554',...args],{encoding:'utf8'});
    adb('install','-r','out/android/gradle-build/app/outputs/apk/debug/app-debug.apk');
    adb('shell','pm','clear','org.gng.persistence.check');
    adb('shell','am','start','-W','-n','org.gng.persistence.check/org.rommigration.shell.MainActivity');
    await device?.close();
    device=(await _android.devices()).find(d=>d.serial()==='emulator-5554');
    page=await (await device.webView({pkg:'org.gng.persistence.check'})).page();
  }else page=await browser.newPage({viewport:{width:1100,height:700}});
  page.setDefaultTimeout(30000);
  page.setDefaultNavigationTimeout(30000);
  const errors=[],logs=[];
  page.on('pageerror',e=>errors.push(String(e)));
  page.on('console',m=>{try{const [tag,...rest]=m.text().split(' ');logs.push({tag,data:JSON.parse(rest.join(' '))});}catch{}});
  const ready=()=>page.waitForFunction(()=>!document.getElementById('start').disabled);
  const slot=key=>page.evaluate(key=>new Promise((resolve,reject)=>{
    const request=indexedDB.open('gng-checkpoint',1);
    request.onsuccess=()=>{const db=request.result,tx=db.transaction('slot');
      const get=tx.objectStore('slot').get(key);tx.oncomplete=()=>{db.close();resolve(get.result??null);};};
    request.onerror=()=>reject(request.error);
  }),key);
  const waitAuto=()=>page.waitForFunction(()=>!document.getElementById('ck-resume').hidden&&!document.getElementById('ck-resume').disabled);
  await page.goto(url);await ready();
  await page.locator('#options-open').click();
  for(const [name,value] of Object.entries({difficulty:'easiest',lives:'7',coop:'0',autofire:'1'}))
    assert.equal(await page.locator('input[name='+name+']:checked').inputValue(),value);
  await page.screenshot({path:'out/android/check/persistence-options.png'});
  await page.locator('#options-cancel').click();
  await page.waitForTimeout(1500);assert.equal(await slot('auto'),null,'title never autosaves');
  await page.locator('#start').click();await waitAuto();
  const first=await slot('auto');assert.ok(first?.text);
  await page.locator('#ck-save').click();
  await page.waitForFunction(()=>!document.getElementById('ck-load').disabled);
  const manual=await slot('quick');
  await page.waitForFunction(()=>document.getElementById('status').textContent.includes('autoguardado'),null,{timeout:40000});
  // Wait for a distinct periodic capture, independently of transient status text.
  const deadline=Date.now()+40000;
  let periodic;
  while(Date.now()<deadline){periodic=await slot('auto');if(periodic.frame>first.frame+1000)break;await page.waitForTimeout(500);}
  assert.ok(periodic.frame>first.frame+1000,'periodic progress');
  assert.equal((await slot('quick')).text,manual.text,'automatic save preserves manual copy');
  await page.reload();await ready();await waitAuto();
  await page.locator('#ck-resume').click();
  await page.waitForFunction(()=>document.getElementById('system-controls').hidden);
  await waitAuto();
  assert.ok(logs.some(l=>l.tag==='AO_CK_LOAD'&&l.data.frame===periodic.frame));
  // Failed writes preserve a confirmed record and release the save lock.
  await page.evaluate(()=>{
    window.originalTransaction=IDBDatabase.prototype.transaction;
    IDBDatabase.prototype.transaction=function(...args){
      if(args[1]==='readwrite')throw new DOMException('test quota','QuotaExceededError');
      return window.originalTransaction.apply(this,args);
    };
  });
  await page.locator('#ck-save').click();
  await page.waitForFunction(()=>document.getElementById('status').textContent.includes('no se pudo guardar'));
  assert.equal((await slot('quick')).text,manual.text);
  await page.evaluate(()=>{IDBDatabase.prototype.transaction=window.originalTransaction;});
  await page.locator('#ck-load').click();
  await page.waitForFunction(()=>document.getElementById('system-controls').hidden);
  // Invalid manual copy must leave a running game available.
  await page.evaluate(()=>new Promise(resolve=>{
    const open=indexedDB.open('gng-checkpoint',1);open.onsuccess=()=>{
      const db=open.result,tx=db.transaction('slot','readwrite');
      tx.objectStore('slot').put({text:'invalid'},'quick');tx.oncomplete=()=>{db.close();resolve();};
    };
  }));
  await page.locator('#ck-load').click();
  await page.waitForFunction(()=>document.getElementById('status').textContent.includes('no se pudo cargar'));
  assert.equal(await page.locator('#halt').isVisible(),false);
  await page.locator('#options-open').click();
  for(const [name,value] of Object.entries({difficulty:'hard',lives:'4',coop:'1',autofire:'0'}))
    await page.locator('label:has(input[name='+name+'][value="'+value+'"])').click();
  await page.locator('#options-apply').click();await ready();
  await page.reload();await ready();
  await page.locator('#options-open').click();
  for(const [name,value] of Object.entries({difficulty:'hard',lives:'4',coop:'1',autofire:'0'}))
    assert.equal(await page.locator('input[name='+name+']:checked').inputValue(),value);
  await page.locator('#options-cancel').click();
  if(!android){
    for(const coop of ['1','0']){
      await page.locator('#options-open').click();
      await page.locator('label:has(input[name=coop][value="'+coop+'"])').click();
      await page.locator('#options-apply').click();await ready();
      await page.locator('#two-players').click();
      const end=Date.now()+30000;
      let saved;
      while(Date.now()<end){
        saved=await slot('auto');
        const checkpoint=saved?.text&&JSON.parse(saved.text);
        if(checkpoint?.options?.coop===(coop==='1'?true:undefined)&&checkpoint.cpu?.mem?.$u8){
          const memory=Buffer.from(checkpoint.cpu.mem.$u8,'base64');
          if(memory[0x26]===1)break;
        }
        await page.waitForTimeout(200);
      }
      assert.ok(saved?.text);assert.ok(Date.now()<end,'two-player automatic save');
      await page.reload();await ready();await waitAuto();
      await page.locator('#ck-resume').click();
      await page.waitForFunction(()=>document.getElementById('turn').textContent==='Empieza el Jugador 1');
    }
    report.twoPlayerRestore=['cooperative','by-turns'];
  }
  if(android){
    const confirmed=await slot('auto');
    adb('shell','am','force-stop','org.gng.persistence.check');
    adb('install','-r','out/android/gradle-build/app/outputs/apk/debug/app-debug.apk');
    adb('shell','am','start','-W','-n','org.gng.persistence.check/org.rommigration.shell.MainActivity');
    await device?.close();
    device=(await _android.devices()).find(d=>d.serial()==='emulator-5554');
    page=await (await device.webView({pkg:'org.gng.persistence.check'})).page();
    await ready();await waitAuto();
    assert.equal((await slot('auto')).text,confirmed.text,'force-stop and APK update preserve progress');
    await page.locator('#ck-resume').click();
    await page.waitForFunction(()=>document.getElementById('system-controls').hidden);
    report.androidRestartAndUpdate=true;
  }
  assert.deepEqual(errors,[]);
  Object.assign(report,{status:'PASS',initialFrame:first.frame,periodicFrame:periodic.frame,manualFrame:manual.frame,
    failedWriteRecovered:true,invalidLoadPreservedGame:true});
}finally{
  mkdirSync('out/android/check',{recursive:true});
  writeFileSync(android?'out/android/check/persistence-android.json':'out/android/check/persistence.json',JSON.stringify(report,null,2));
  await browser?.close();await device?.close();await new Promise(resolve=>server.close(resolve));
}
console.log(report);
