#!/usr/bin/env node
/** Private check of the cooperative two-player option in the app. Build the
 * assets first (scripts/ao_build_assets.mjs); Chromium stays headless.
 * The options dialog offers Dos jugadores: Por turnos / Cooperativo; choosing
 * Cooperativo restarts the engine with `coop`, stores it and shows it in the
 * hint. A two-player game then runs with Right held until both players are
 * out of lives: the turns are announced and the result names the team's total.
 * Usage: node scripts/ao_coop_check.mjs   (writes out/android/check/coop.json
 * and coop-result.png; about two minutes)
 */
import assert from 'node:assert/strict';
import {writeFileSync,mkdirSync} from 'node:fs';
import {resolve,join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createAssetServer} from './ao_serve.mjs';
import {chromium} from 'playwright-core';

const ROOT=resolve(fileURLToPath(import.meta.url),'../..');
const ASSETS=join(ROOT,'out/android/assets'),CHECK=join(ROOT,'out/android/check');
const server=createAssetServer(ASSETS);
const report={schema:'gng.ao.coop-check.v1'};
let browser;
try{
  mkdirSync(CHECK,{recursive:true,mode:0o700});
  await new Promise(ok=>server.listen(0,'127.0.0.1',ok));
  browser=await chromium.launch({channel:'chromium',headless:true});
  const page=await browser.newPage({viewport:{width:900,height:400}});
  const logs=[],bad=[];
  page.on('console',msg=>{
    const m=/^(AO_\w+) (.*)$/s.exec(msg.text());if(!m)return;
    if(['AO_ERROR','AO_HALT'].includes(m[1]))bad.push(msg.text());
    try{logs.push({tag:m[1],data:JSON.parse(m[2])});}catch{}
  });
  page.on('pageerror',e=>bad.push(String(e)));
  const until=async(predicate,timeout,what)=>{
    const end=Date.now()+timeout;
    while(Date.now()<end){
      assert.equal(bad.length,0,bad.join('\n'));
      const hit=logs.find(predicate);if(hit)return hit;
      await page.waitForTimeout(50);
    }
    throw Error('AO_COOP_TIMEOUT '+what);
  };
  const ready=()=>page.waitForFunction(()=>!document.getElementById('start').disabled);
  await page.goto('http://127.0.0.1:'+server.address().port+'/index.html');
  await ready();

  // The options dialog: by turns unless chosen, then cooperative.
  await page.locator('#options-open').click();
  assert.equal(await page.locator('input[name=coop]:checked').inputValue(),'0');
  assert.deepEqual(await page.locator('#options-form .opt:has(input[name=coop]) span').allTextContents(),
    ['Dos jugadores','Por turnos','Cooperativo']);
  await page.locator('label:has(input[name=coop][value="1"])').click();
  await page.locator('label:has(input[name=lives][value="3"])').click();
  logs.length=0;
  await page.locator('#options-apply').click();
  const boot=await until(l=>l.tag==='AO_READY',30000,'ready');
  assert.equal(boot.data.options.coop,true,'the engine runs the cooperative game');
  assert.equal(boot.data.options.continues,false);
  await ready();
  assert.equal(JSON.parse(await page.evaluate(()=>localStorage.getItem('gng-preferences'))).options.coop,true);
  assert.match(await page.locator('#hint').textContent(),/cooperativo/);
  await page.locator('#options-open').click();
  assert.equal(await page.locator('input[name=coop]:checked').inputValue(),'1');
  assert.match(await page.locator('#options-current').textContent(),/cooperativo/);
  await page.locator('#options-cancel').click();
  report.options=boot.data.options;

  // A whole two-player game walking right.
  await page.locator('#two-players').click();
  await until(l=>l.tag==='AO_MATCH'&&l.data.type==='start',60000,'match start');
  assert.equal(await page.locator('#turn').textContent(),'Empieza el Jugador 1');
  await page.keyboard.down('ArrowRight');
  const result=(await until(l=>l.tag==='AO_MATCH'&&l.data.type==='result',300000,'result')).data;
  await page.keyboard.up('ArrowRight');
  const turns=logs.filter(l=>l.tag==='AO_MATCH'&&l.data.type==='turn').map(l=>l.data.player);
  assert.ok(turns.length>=3,'turns pass');
  turns.forEach((p,i)=>assert.equal(p,i%2===0?2:1,'turn '+i));
  assert.equal(await page.locator('#result').isVisible(),true);
  assert.equal(await page.locator('#result-title').textContent(),'Fin de la partida cooperativa');
  const total=(result.scores[0]+result.scores[1]).toLocaleString('es');
  assert.equal(await page.locator('#result-winner').textContent(),'Equipo: '+total+' puntos');
  await page.screenshot({path:join(CHECK,'coop-result.png')});
  Object.assign(report,{turns,result});
  await page.waitForFunction(()=>document.getElementById('ck-resume').hidden);
  assert.equal(bad.length,0,bad.join('\n'));
  writeFileSync(join(CHECK,'coop.json'),JSON.stringify(report,null,2)+'\n',{mode:0o600});
  console.log(JSON.stringify(report));
  console.log('AO_COOP_CHECK PASS');
}finally{
  await browser?.close();
  server.close();
}
