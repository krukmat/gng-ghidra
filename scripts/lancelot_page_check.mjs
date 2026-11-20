#!/usr/bin/env node
/** Lancelot on the real page: headless Chromium (Playwright), no Chrome
 * window, no MAME. One page session:
 *  1. Opciones -> Lancelot: he starts in the archer outfit; Guardar keeps
 *     the character in the save; walking into the first zombie he loses it
 *     and keeps his dark brown hair.
 *  2. Opciones -> Arthur: Arthur in his armor, no Lancelot colors.
 *  3. Cargar the Lancelot save while Arthur is chosen: Lancelot comes back.
 * Build assets first (node scripts/ao_build_assets.mjs).
 * Canvas captures and report: out/android/check/lancelot-*.png|json
 */
import assert from 'node:assert/strict';
import {mkdirSync,writeFileSync} from 'node:fs';
import {chromium} from 'playwright-core';
import {createAssetServer} from './ao_serve.mjs';

const OUT='out/android/check';
// Colors from src/lancelot_skin.mjs and the stage-1 sprite palette group 0.
// Armor and skin colors also occur in the scenery; outfit and hair do not.
const COLORS={outfit:[112,120,52],hair:[74,46,26],armor:[136,136,170]};
const server=createAssetServer();
let browser,page;
const logs=[],errors=[],report={status:'RUNNING'};
// The canvas itself, not a page screenshot: a mid-game page.screenshot()
// stalled the headless game in 3 of 4 runs.
const snap=async name=>writeFileSync(`${OUT}/lancelot-${name}.png`,Buffer.from((await page.evaluate(()=>
  document.getElementById('screen').toDataURL('image/png'))).split(',')[1],'base64'));
const count=()=>page.evaluate(colors=>{
  const c=document.getElementById('screen'),d=c.getContext('2d').getImageData(0,0,c.width,c.height).data;
  const n=Object.fromEntries(Object.keys(colors).map(k=>[k,0]));
  for(let i=0;i<d.length;i+=4)for(const [k,[r,g,b]] of Object.entries(colors))
    if(d[i]===r&&d[i+1]===g&&d[i+2]===b)n[k]++;
  return n;
},COLORS);
const until=async(label,test,timeout=90000)=>{
  const end=Date.now()+timeout;
  while(Date.now()<end){assert.deepEqual(errors,[]);const v=await test();if(v)return v;
    await page.waitForTimeout(100);}
  await snap('timeout');
  throw Error('LANCELOT_PAGE_TIMEOUT '+label+' '+JSON.stringify({colors:await count(),
    tail:logs.slice(-8).map(l=>l.tag+' '+JSON.stringify(l.data).slice(0,160))}));
};
const lastProbe=()=>logs.findLast(l=>l.tag==='AO_INPUT')?.data;
const ready=()=>page.waitForFunction(()=>!document.getElementById('start').disabled);
const slot=key=>page.evaluate(key=>new Promise((resolve,reject)=>{
  const open=indexedDB.open('gng-checkpoint',1);open.onerror=()=>reject(open.error);
  open.onsuccess=()=>{const db=open.result,tx=db.transaction('slot');
    const get=tx.objectStore('slot').get(key);
    tx.oncomplete=()=>{db.close();resolve(get.result??null);};};
}),key);
// Cargar takes the newest copy: make the manual one newer than the autosave.
const newer=key=>page.evaluate(key=>new Promise((resolve,reject)=>{
  const open=indexedDB.open('gng-checkpoint',1);open.onerror=()=>reject(open.error);
  open.onsuccess=()=>{const db=open.result,tx=db.transaction('slot','readwrite'),
    store=tx.objectStore('slot'),get=store.get(key);
    get.onsuccess=()=>store.put({...get.result,savedAt:new Date(Date.now()+60000).toISOString()},key);
    tx.oncomplete=()=>{db.close();resolve();};tx.onerror=()=>reject(tx.error);};
}),key);
async function choose(character){
  await page.locator('#options-open').click();
  await page.locator(`label:has(input[name=character][value=${character}])`).click();
  const mark=logs.length;
  await page.locator('#options-apply').click();
  const options=await until('options '+character,()=>logs.slice(mark).find(l=>l.tag==='AO_OPTIONS')?.data);
  await ready();
  return options;
}
// From Start to the first armored probe of play (the intro shows him bare).
async function armoredPlay(name){
  const mark=logs.length;
  await page.locator('#start').click();
  const readyData=await until('ready '+name,()=>logs.slice(mark).find(l=>l.tag==='AO_READY')?.data);
  const colors=await until('armored '+name,async()=>{
    if(lastProbe()?.armored!==true)return false;
    const n=await count();return n.outfit+n.armor>40&&n;});
  await snap(name+'-armored');
  return {options:readyData.options,frame:lastProbe().frame,colors};
}
try{
  mkdirSync(OUT,{recursive:true});
  await new Promise(r=>server.listen(0,'127.0.0.1',r));
  browser=await chromium.launch({channel:'chromium',headless:true});
  page=await browser.newPage({viewport:{width:1100,height:700}});
  page.setDefaultTimeout(30000);
  page.on('pageerror',e=>errors.push(String(e)));
  page.on('console',m=>{const x=/^(AO_\w+) (.*)$/s.exec(m.text());if(!x)return;
    try{logs.push({tag:x[1],data:JSON.parse(x[2])});}catch{}
    if(['AO_ERROR','AO_HALT'].includes(x[1]))errors.push(m.text());});
  await page.goto(`http://127.0.0.1:${server.address().port}/index.html?inputCheck`);
  await ready();

  // 1. Lancelot.
  assert.equal((await choose('lancelot')).character,'lancelot');
  const lancelot=await armoredPlay('lancelot');
  assert.equal(lancelot.options.character,'lancelot','the engine plays the chosen character');
  assert.ok(lancelot.colors.outfit>40,'Lancelot starts in the archer outfit');
  assert.equal(lancelot.colors.armor,0,'no armor pixels on Lancelot');
  // The intro refuses saves (CK_SAVE_UNSAFE): retry until play accepts one.
  let mark=logs.length,tries=0;
  await until('save',async()=>{
    const done=logs.slice(mark).find(l=>l.tag==='AO_CK_SAVE');
    if(done)return done;
    if(tries===0||logs.slice(mark).some(l=>l.tag==='AO_CK_SAVE_FAILED')){
      mark=logs.length;tries++;await page.locator('#ck-save').click();}
    await page.waitForTimeout(400);
    return false;});
  report.saveTries=tries;
  const saved=JSON.parse((await slot('quick')).text);
  assert.equal(saved.options.character,'lancelot','the save keeps the character');
  // A real hit. Probes come once a second, so the hurt frame itself may be
  // skipped: the first unarmored probe after the armored one, before any
  // reload (a death reloads the autosave and replays the bare intro).
  mark=logs.length;
  const reloaded=()=>logs.slice(mark).some(l=>l.tag==='AO_CK_LOAD');
  await page.keyboard.down('ArrowRight');
  const hit=await until('hit',()=>{
    assert.equal(reloaded(),false,'armor must be lost before any reload');
    return logs.slice(mark).find(l=>l.tag==='AO_INPUT'&&l.data.armored===false&&
      l.data.frame>lancelot.frame)?.data;});
  await page.keyboard.up('ArrowRight');
  const bare=await until('bare',async()=>{
    assert.equal(reloaded(),false,'sampled before any reload');
    if(lastProbe()?.armored!==false)return false;
    const n=await count();return n.hair>=10&&n;},60000);
  await snap('lancelot-unarmored');
  lancelot.unarmored={hitFrame:hit.frame,frame:lastProbe().frame,colors:bare};

  // 2. Arthur.
  assert.equal((await choose('arthur')).character,undefined);
  const arthur=await armoredPlay('arthur');
  assert.equal(arthur.options.character,undefined);
  assert.ok(arthur.colors.armor>40,'Arthur keeps his armor');
  assert.equal(arthur.colors.outfit+arthur.colors.hair,0,'no Lancelot colors on Arthur');

  // 3. Loading the Lancelot save brings Lancelot back.
  // Cargar compares the copies' dates as read at page load.
  await newer('quick');await page.reload();await ready();
  assert.equal(await page.evaluate(()=>{document.getElementById('options-open').click();
    const v=document.getElementById('options-form').elements.character.value;
    document.getElementById('options-cancel').click();return v;}),'arthur',
    'the chosen character is remembered across page loads');
  mark=logs.length;
  await page.locator('#ck-load').click();
  const loaded=await until('load',()=>logs.slice(mark).find(l=>l.tag==='AO_CK_LOAD')?.data);
  const loadReady=await until('load ready',()=>logs.slice(mark).find(l=>l.tag==='AO_READY')?.data);
  assert.equal(loadReady.options.character,'lancelot','a loaded save plays its own character');
  const back=await until('loaded colors',async()=>{
    const n=await count();return n.outfit>40&&n;});
  // No armor-color check here: the stage scenery uses it too.
  await snap('loaded');
  Object.assign(report,{status:'PASS',lancelot,arthur,
    loaded:{frame:loaded.frame,savedFrame:saved.frame,colors:back}});
  writeFileSync(`${OUT}/lancelot-page-check.json`,JSON.stringify(report,null,1));
  console.log('LANCELOT_PAGE_CHECK=PASS '+JSON.stringify(report));
}finally{await browser?.close();server.close();}
