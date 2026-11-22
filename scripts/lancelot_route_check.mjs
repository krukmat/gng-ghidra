#!/usr/bin/env node
/** Replay the complete Go-Explore route from reset and show representative
 * frames of both loops and endings on the web page and Android WebView.
 * Usage: node scripts/lancelot_route_check.mjs [tape.json]
 * The tape remains private; screenshots and the report go to out/android/check.
 */
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {mkdirSync,readFileSync,writeFileSync} from 'node:fs';
import {homedir} from 'node:os';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {chromium,_android} from 'playwright-core';
import {gngCode} from '../boards/gng/bundle.mjs';
import {createBoard} from '../boards/gng/runtime.mjs';
import {gameOptions,optionDips,withGameOptions} from '../games/gngb/options.mjs';
import {REC,rendererInputs} from '../src/gngb_render_inputs.mjs';
import {renderGngbRgba} from '../src/gngb_frame_renderer.mjs';
import {unpackGfx} from '../src/ao_web_assets.mjs';
import {lancelotOverrides,playerSprites} from '../src/lancelot_skin.mjs';
import {drawOrder} from '../src/sprite_memory.mjs';
import {rendererUnknownCount} from '../src/v2_b1_observable.mjs';
import {resolveB3LabTape} from '../src/v3_b3_external_tape.mjs';
import {createAssetServer} from './ao_serve.mjs';

const OUT='out/android/check';
const path=process.argv[2]??'../gng-ghidra/out/h3/loop2/l2-ending-96340.json';
const tape=resolveB3LabTape(path);
const manifest=JSON.parse(readFileSync('out/android/assets/bundle/manifest.json','utf8'));
const code=gngCode(manifest,readFileSync('out/android/assets/bundle/code.bin'),
  readFileSync('out/android/assets/bundle/overlays.bin'));
const {blocks}=await import(pathToFileURL(join(process.cwd(),
  'out/android/assets/bundle/program.mjs')).href);
const gfx=unpackGfx(new Uint8Array(readFileSync('out/android/assets/gfx.bin')));
const options=gameOptions({character:'lancelot'});
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const endings=new Map([
  [53700,'false-room'],[53800,'false-boss-cleared'],[54000,'false-scene'],
  [54091,'false-exit'],[54200,'false-interlude'],[54460,'second-loop'],
  [93816,'true-room'],[94521,'true-boss-cleared'],[94680,'true-scene-start'],
  [95000,'true-scene-middle'],[95400,'true-scene-late'],
  [95817,'true-scene-end'],[95818,'true-exit'],[96000,'true-interlude'],
  [96335,'post-ending']]);
const samples=[];
const phaseSeen=new Set();
let loop=1,previousPhase=null,falseExit=null,trueExit=null;
const board=createBoard(code,withGameOptions(blocks,options),{
  frames:tape.frames,dips:optionDips(options),portRead:tape.read,
  onFrame:r=>{
    const b=r.record,f=r.index,phase=b[0x72];
    if(previousPhase===6&&phase===0){
      if(loop===1)falseExit=f;else trueExit=f;
      loop++;
    }
    previousPhase=phase;
    const key=`${loop}-${phase}`;
    const isPhase=loop<=2&&f>1000&&b[2]===2&&phase<=6&&
      !phaseSeen.has(key)&&rendererUnknownCount(r)===0;
    const ending=endings.get(f);
    if(isPhase||ending){
      assert.equal(rendererUnknownCount(r),0,'drawable frame '+f);
      const inputs=rendererInputs(b,{scroll:r.scroll,latch:r.latch},gfx);
      const sprites=playerSprites(drawOrder(inputs.bufferedSprites));
      const arthur=renderGngbRgba(inputs).rgba;
      const lancelot=renderGngbRgba({...inputs,spriteColors:lancelotOverrides}).rgba;
      let changed=0,outfit=0,hair=0;
      for(let i=0;i<lancelot.length;i+=4){
        if(lancelot[i]!==arthur[i]||lancelot[i+1]!==arthur[i+1]||
           lancelot[i+2]!==arthur[i+2])changed++;
        if(lancelot[i]===112&&lancelot[i+1]===120&&lancelot[i+2]===52)outfit++;
        if(lancelot[i]===74&&lancelot[i+1]===46&&lancelot[i+2]===26)hair++;
      }
      if(ending||sprites.length&&changed>0){
        const name=ending??`loop${loop}-phase${phase}`;
        const foreground=Array.from({length:32},(_,row)=>
          String.fromCharCode(...b.subarray(REC.fg+row*32,REC.fg+(row+1)*32))
            .replace(/[^\x20-\x7e]/g,' ').trim()).filter(Boolean);
        samples.push({name,frame:f,loop,phase,mode:b[0x08],ending:b[0x7f],
          sequence:b[0xde],armor:b[0xac],playerSprites:sprites.length,
          changed,outfit,hair,sha256:hash(lancelot),foreground,
          sprites:ending?drawOrder(inputs.bufferedSprites).filter(s=>s.y+15>=16)
            .map(s=>({graphic:s.graphic,paletteGroup:s.paletteGroup,x:s.x,y:s.y})):undefined,
          record:[...b],scroll:r.scroll,latch:r.latch});
        if(isPhase)phaseSeen.add(key);
      }
    }
    board.state.records[f-1]=null;board.state.events.length=0;
  }});
assert.equal(board.run().status,'FRAMES_DONE');
assert.equal(falseExit,54091,'false ending exits into loop two');
assert.equal(trueExit,95818,'true ending exits after credits sequence');
for(let l=1;l<=2;l++)for(let p=0;p<=6;p++)
  assert.ok(phaseSeen.has(`${l}-${p}`),`missing loop ${l} phase ${p}`);
assert.equal(samples.filter(s=>endings.has(s.frame)).length,endings.size);
const scene=name=>samples.find(s=>s.name===name);
assert.ok(scene('false-boss-cleared').foreground.join(' ').includes('THIS ROOM IS AN ILLUSION'));
assert.ok(scene('true-scene-middle').foreground.join(' ').includes('CONGRATULATION'));
assert.ok(scene('true-scene-middle').foreground.join(' ').includes('THIS STORY IS HAPPY END'));
assert.ok(scene('true-scene-end').foreground.join(' ').includes('RETURN TO STARTING POINT'));
assert.ok(scene('false-boss-cleared').outfit>40,'Lancelot in the false ending');
assert.ok(scene('true-room').outfit>40,'Lancelot enters the true ending');
assert.ok(scene('true-boss-cleared').hair>=10,'Lancelot remains after losing armor');
console.log('LANCELOT_ROUTE_REPLAY '+JSON.stringify({tape:tape.sha256,frames:tape.frames,
  phases:phaseSeen.size,endings:endings.size,falseExit,trueExit}));

async function show(page,sample){
  return page.evaluate(async s=>{
    if(!window.__lancelotRoute){
      const base=new URL('./',location.href);
      const [{renderGngbRgba},{rendererInputs},{unpackGfx},{lancelotOverrides},gfxRes]=
        await Promise.all([
          import(new URL('lib/gngb_frame_renderer.mjs',base)),
          import(new URL('lib/gngb_render_inputs.mjs',base)),
          import(new URL('lib/ao_web_assets.mjs',base)),
          import(new URL('lib/lancelot_skin.mjs',base)),fetch(new URL('gfx.bin',base))]);
      if(!gfxRes.ok)throw Error('GFX_FETCH_'+gfxRes.status);
      window.__lancelotRoute={renderGngbRgba,rendererInputs,lancelotOverrides,
        gfx:unpackGfx(new Uint8Array(await gfxRes.arrayBuffer()))};
    }
    const {renderGngbRgba,rendererInputs,lancelotOverrides,gfx}=window.__lancelotRoute;
    const inputs=rendererInputs(new Uint8Array(s.record),
      {scroll:s.scroll,latch:s.latch},gfx);
    const {rgba}=renderGngbRgba({...inputs,spriteColors:lancelotOverrides});
    const canvas=document.getElementById('screen');
    canvas.getContext('2d').putImageData(new ImageData(rgba,256,224),0,0);
    const shown=canvas.getContext('2d').getImageData(0,0,256,224).data;
    const digest=new Uint8Array(await crypto.subtle.digest('SHA-256',shown));
    const sha256=[...digest].map(n=>n.toString(16).padStart(2,'0')).join('');
    let outfit=0,hair=0;
    for(let i=0;i<shown.length;i+=4){
      if(shown[i]===112&&shown[i+1]===120&&shown[i+2]===52)outfit++;
      if(shown[i]===74&&shown[i+1]===46&&shown[i+2]===26)hair++;
    }
    return {sha256,outfit,hair,png:canvas.toDataURL('image/png').split(',')[1]};
  },sample);
}

const server=createAssetServer();
let browser,device;
const results={status:'RUNNING',tape:path,tapeSha256:tape.sha256,
  programSha256:manifest.files['program.mjs'],frames:tape.frames,falseExit,trueExit,
  web:[],android:[]};
try{
  mkdirSync(OUT,{recursive:true});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  browser=await chromium.launch({channel:'chromium',headless:true});
  const web=await browser.newPage({viewport:{width:1100,height:700}});
  await web.goto(`http://127.0.0.1:${server.address().port}/index.html`);
  await web.locator('#options-open').click();
  await web.locator('label:has(input[name=character][value=lancelot])').click();
  await web.locator('#options-apply').click();
  assert.ok(await web.locator('input[name=character][value=lancelot]').isChecked());

  const pkg='org.gng.persistence.check';
  const metadata=JSON.parse(readFileSync('out/android/gradle-build/app/outputs/apk/debug/output-metadata.json','utf8'));
  assert.equal(metadata.applicationId,pkg,'build the isolated APK first');
  const adb=(...args)=>execFileSync(join(homedir(),'Library/Android/sdk/platform-tools/adb'),
    ['-s','emulator-5554',...args],{encoding:'utf8',timeout:60000});
  adb('install','-r','out/android/gradle-build/app/outputs/apk/debug/app-debug.apk');
  adb('shell','pm','clear',pkg);
  adb('shell','am','start','-W','-n',pkg+'/org.rommigration.shell.MainActivity');
  device=(await _android.devices()).find(d=>d.serial()==='emulator-5554');
  assert.ok(device,'emulator-5554 is connected');
  const android=await (await device.webView({pkg},{timeout:30000})).page();
  await android.goto('https://appassets.androidplatform.net/assets/index.html');
  await android.locator('#options-open').click();
  await android.locator('label:has(input[name=character][value=lancelot])').click();
  await android.locator('#options-apply').click();
  assert.ok(await android.locator('input[name=character][value=lancelot]').isChecked());

  for(const [platform,page] of [['web',web],['android',android]]){
    for(const sample of samples){
      const shown=await show(page,sample);
      assert.equal(shown.sha256,sample.sha256,`${platform} ${sample.name} pixels`);
      assert.equal(shown.outfit,sample.outfit,`${platform} ${sample.name} outfit`);
      assert.equal(shown.hair,sample.hair,`${platform} ${sample.name} hair`);
      writeFileSync(`${OUT}/lancelot-route-${platform}-${sample.name}.png`,
        Buffer.from(shown.png,'base64'));
      results[platform].push({name:sample.name,frame:sample.frame,loop:sample.loop,
        phase:sample.phase,mode:sample.mode,ending:sample.ending,
        sequence:sample.sequence,armor:sample.armor,
        playerSprites:sample.playerSprites,changed:sample.changed,
        outfit:shown.outfit,hair:shown.hair,sha256:shown.sha256,
        foreground:sample.foreground,sprites:sample.sprites});
    }
    console.log('LANCELOT_ROUTE_DISPLAY '+platform+' '+results[platform].length);
  }
  results.status='PASS';
  writeFileSync(`${OUT}/lancelot-route-check.json`,JSON.stringify(results,null,2)+'\n');
  console.log('LANCELOT_ROUTE_CHECK=PASS '+JSON.stringify({frames:tape.frames,
    web:results.web.length,android:results.android.length,falseExit,trueExit}));
}finally{
  await browser?.close();await device?.close();
  if(server.listening)await new Promise(resolve=>server.close(resolve));
}
