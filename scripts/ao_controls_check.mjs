#!/usr/bin/env node
/** Private AO-4 check. Build assets first; Chromium stays headless.
 * Real touch events -> worker messages -> real MC6809 reads.
 * Five cold boots must accept Coin then Start; Start without Coin must fail.
 * Add --gameover to wait for a real loss and verify Coin + Continue.
 */
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {readFileSync,writeFileSync,mkdirSync,statSync} from 'node:fs';
import {resolve,join,extname,sep} from 'node:path';
import {fileURLToPath} from 'node:url';
import {chromium} from 'playwright-core';

const ROOT=resolve(fileURLToPath(import.meta.url),'../..');
const ASSETS=join(ROOT,'out/android/assets'),CHECK=join(ROOT,'out/android/check');
const trials=Number(process.argv[2]??5);
const checkGameOver=process.argv.includes('--gameover');
if(!Number.isInteger(trials)||trials<1||trials>5)throw Error('AO4_TRIALS_INVALID');
const MIME={'.html':'text/html','.mjs':'text/javascript','.json':'application/json',
  '.bin':'application/octet-stream','.wasm':'application/wasm'};
const server=createServer((req,res)=>{
  try{
    const path=resolve(ASSETS,'.'+new URL(req.url,'http://local').pathname);
    if(!path.startsWith(ASSETS+sep)||!MIME[extname(path)]||!statSync(path).isFile())
      throw Error('NOT_FOUND');
    res.writeHead(200,{'Content-Type':MIME[extname(path)],'Cache-Control':'no-store'});
    res.end(readFileSync(path));
  }catch{res.writeHead(404);res.end();}
});
const report={schema:'gng.ao4.controls-check.v1',trials:[]};
let browser,page;
try{
  mkdirSync(CHECK,{recursive:true,mode:0o700});
  await new Promise(ok=>server.listen(0,'127.0.0.1',ok));
  browser=await chromium.launch({channel:'chromium',headless:true});
  page=await browser.newPage({viewport:{width:900,height:400},hasTouch:true});
  const cdp=await page.context().newCDPSession(page);
  const probes=[],bad=[];
  page.on('console',msg=>{
    const m=/^(AO_\w+) (.*)$/s.exec(msg.text());if(!m)return;
    if(m[1]==='AO_INPUT')probes.push(JSON.parse(m[2]));
    if(['AO_ERROR','AO_HALT','AO_AUDIO_STOP'].includes(m[1]))bad.push(msg.text());
  });
  page.on('pageerror',e=>bad.push(String(e)));
  const until=async(predicate,timeout=20000)=>{
    const end=Date.now()+timeout;
    while(Date.now()<end){
      assert.equal(bad.length,0,bad.join('\n'));
      const hit=probes.find(predicate);if(hit)return hit;
      await page.waitForTimeout(25);
    }
    throw Error('AO4_PROBE_TIMEOUT '+JSON.stringify(probes.at(-1)));
  };
  const point=async(id,key)=>{
    const box=await page.locator('#'+key).boundingBox();assert.ok(box,key);
    return {id,x:box.x+box.width/2,y:box.y+box.height/2};
  };
  const touch=async(type,points=[])=>cdp.send('Input.dispatchTouchEvent',
    {type,touchPoints:points});
  // Thumbstick: a finger lands in the zone, then drags 45 px one way.
  const DRAG={up:[0,-45],down:[0,45],left:[-45,0],right:[45,0],
    'up-right':[32,-32],'up-left':[-32,-32]};
  const stick=async(id,dir)=>{
    const z=await page.locator('#stick-zone').boundingBox();assert.ok(z,'stick zone');
    const c={x:z.x+z.width*.55,y:z.y+z.height*.6};
    return [{id,...c},{id,x:c.x+DRAG[dir][0],y:c.y+DRAG[dir][1]}];
  };
  const hold=async(dir,...others)=>{
    const [down,moved]=await stick(1,dir);
    await touch('touchStart',[down,...others]);
    await touch('touchMove',[moved,...others]);
    return moved;
  };
  for(let trial=1;trial<=trials;trial++){
    probes.length=0;
    if(trial===1)await page.goto('http://127.0.0.1:'+server.address().port+
      '/index.html?inputCheck=1');
    else await page.locator('#restart').tap();
    await page.waitForFunction(()=>!document.getElementById('coin').disabled);
    assert.equal(await page.locator('#system-controls').isVisible(),true);
    assert.equal(await page.locator('#sound').textContent(),'Sonido OFF');
    let baseline=await until(p=>p.frame>=320);
    assert.equal(baseline.ram2,0);assert.equal(baseline.ram23,0);
    if(trial===1){
      assert.equal(await page.locator('#start').isDisabled(),true);
      const negative=await until(p=>p.frame>baseline.frame+90);
      assert.equal(negative.ram2,0,'Start without Coin must not start a game');
      assert.equal(negative.witness.activeSamples.start1,0);
      report.startWithoutCoin='PREVENTED';baseline=negative;
      await page.screenshot({path:join(CHECK,'ao4-menu.png')});
    }
    await page.locator('#coin').tap();
    const coin=await until(p=>p.frame>baseline.frame&&p.ram23===1);
    const coinReads=coin.witness.activeSamples.coin1;
    assert.ok(coinReads>0&&coinReads<=12,'Coin active reads='+coinReads);
    await page.waitForFunction(()=>!document.getElementById('start').disabled);
    await page.locator('#start').tap();
    const started=await until(p=>p.frame>coin.frame&&p.ram2>=2&&p.ram23===0);
    assert.ok(started.witness.activeSamples.start1>0);
    assert.equal(await page.locator('#system-controls').isVisible(),false);
    assert.equal(await page.locator('#coin').isDisabled(),true);
    assert.equal(await page.locator('#start').isDisabled(),true);
    report.coinStartDuringGame='HIDDEN_AND_DISABLED';
    assert.equal(await page.locator('#sound').isVisible(),true);
    report.soundControl='PREPARED_DISABLED';
    report.trials.push({trial,coinReads,coinCounter:coin.ram23,
      startedFrame:started.frame,gameMode:started.ram2});
    console.log('AO4_TRIAL='+trial+' PASS coinReads='+coinReads);
    if(trial!==1)continue;

    const before=started.witness.activeSamples;
    for(const id of ['up','down','left','right','attack','jump']){
      if(DRAG[id])await hold(id);else await touch('touchStart',[await point(1,id)]);
      await page.waitForTimeout(200);await touch('touchEnd');
    }
    const keys=['p1.up','p1.down','p1.left','p1.right','p1.button1','p1.button2'];
    const all=await until(p=>keys.every(k=>p.witness.activeSamples[k]>before[k]));
    report.controls=Object.fromEntries(keys.map(k=>[k,all.witness.activeSamples[k]-before[k]]));
    const actions=[await point(2,'attack'),await point(3,'jump')];
    const right=await hold('right',...actions);
    const multi=await until(p=>p.frame>all.frame&&p.reads[1]===0xce);
    // The same thumb slides from right to up without lifting.
    await touch('touchMove',[{...right,x:right.x-35,y:right.y-90},...actions]);
    const slid=await until(p=>p.frame>multi.frame&&p.reads[1]===0xc7);
    await touch('touchEnd');
    const neutral0=await until(p=>p.frame>slid.frame&&p.reads[1]===255);
    // Upper diagonals run and jump that way: Right/Left plus Jump.
    await hold('up-right');
    const jumpRight=await until(p=>p.frame>neutral0.frame&&p.reads[1]===0xde);
    await touch('touchEnd');
    await hold('up-left');
    const jumpLeft=await until(p=>p.frame>jumpRight.frame&&p.reads[1]===0xdd);
    await touch('touchEnd');
    const neutral=await until(p=>p.frame>jumpLeft.frame&&p.reads[1]===255);
    await hold('up',await point(2,'attack'));
    await page.waitForTimeout(150);await touch('touchCancel');
    const cancelled=await until(p=>p.frame>neutral.frame&&p.reads[1]===255);
    await hold('left');
    const pressed=await until(p=>p.frame>cancelled.frame&&p.reads[1]===0xfd);
    await page.evaluate(()=>window.dispatchEvent(new Event('blur')));
    await until(p=>p.frame>pressed.frame&&p.reads[1]===255);await touch('touchEnd');
    report.multitouch='PASS';report.stickSlide='PASS';report.stickJump='PASS';report.cancelAndBlur='PASS';
    // Let the start sequence finish so the preview shows the level itself.
    const preview=await until(p=>p.frame>=started.frame+900,20000);
    report.previewFrame=preview.frame;
    await page.screenshot({path:join(CHECK,'ao4-controls.png')});
    await page.setViewportSize({width:640,height:360});
    // Wait for the compositor to present the resized layout before capturing.
    await page.waitForTimeout(250);
    report.layout=await page.locator('button,canvas').evaluateAll(elements=>
      elements.map(el=>{const b=el.getBoundingClientRect();return {id:el.id,
        fits:b.left>=0&&b.top>=0&&b.right<=innerWidth&&b.bottom<=innerHeight};}));
    assert.ok(report.layout.every(b=>b.fits),'buttons or canvas outside viewport');
    const geometry=await page.evaluate(()=>{
      const box=id=>document.getElementById(id).getBoundingClientRect();
      const left=box('button-stack'),right=box('stick-base');
      return {actionsLeft:left.right<innerWidth/2,
        actionsBottom:left.bottom>innerHeight*.85,
        directionsRight:right.left>innerWidth/2,
        actionsPanel:getComputedStyle(document.getElementById('button-stack')).backgroundColor,
        actionButton:getComputedStyle(document.getElementById('attack')).backgroundColor};
    });
    assert.ok(geometry.actionsLeft&&geometry.actionsBottom&&geometry.directionsRight);
    assert.equal(geometry.actionsPanel,'rgba(0, 0, 0, 0)');
    assert.match(geometry.actionButton,/^rgba\(/,'action buttons must be translucent');
    report.geometry=geometry;
    await page.screenshot({path:join(CHECK,'ao4-controls-compact.png')});
    await page.setViewportSize({width:900,height:400});
    if(checkGameOver){
      const ended=await until(p=>p.frame>preview.frame&&p.gameState.gameOver,90000);
      assert.equal(await page.locator('#system-controls').isVisible(),true);
      assert.equal(await page.locator('#coin').isDisabled(),false);
      assert.equal(await page.locator('#start').isDisabled(),true);
      await page.screenshot({path:join(CHECK,'ao4-game-over.png')});
      await page.locator('#coin').tap();
      const credited=await until(p=>p.frame>ended.frame&&p.gameState.credits===1);
      await page.waitForFunction(()=>!document.getElementById('start').disabled);
      assert.equal(await page.locator('#start').textContent(),'Continuar');
      await page.screenshot({path:join(CHECK,'ao4-continue.png')});
      await page.locator('#start').tap();
      const resumed=await until(p=>p.frame>credited.frame&&p.ram2===2&&p.ram5===1&&
        p.gameState.credits===0&&p.gameState.inGame);
      const delta=key=>resumed.witness.activeSamples[key]-ended.witness.activeSamples[key];
      assert.ok(delta('coin1')>0&&delta('coin1')<=12);
      assert.ok(delta('start1')>0&&delta('p1.button1')>0);
      assert.equal(await page.locator('#system-controls').isVisible(),false);
      report.gameOver={status:'PASS',endedFrame:ended.frame,
        resumedFrame:resumed.frame,coinReads:delta('coin1'),
        startReads:delta('start1'),attackReads:delta('p1.button1'),
        mainMode:resumed.ram2,phase:resumed.ram5,credits:resumed.gameState.credits};
      console.log('AO4_GAMEOVER=PASS resumed_frame='+resumed.frame);
    }
  }
  await page.locator('#restart').tap();
  await page.waitForFunction(()=>!document.getElementById('system-controls').hidden&&
    document.getElementById('coin').disabled);
  report.restartReturnsToMenu='PASS';
  report.status='PASS';
}catch(e){
  report.status='BLOCKED';report.error=String(e.stack??e);
  try{await page?.screenshot({path:join(CHECK,'ao4-failed.png')});}catch{}
  process.exitCode=2;
}finally{
  await browser?.close();server.close();
  writeFileSync(join(CHECK,'ao4-report.json'),JSON.stringify(report,null,2)+'\n',
    {mode:0o600});
}
console.log('AO4='+report.status+' trials='+report.trials.length+
  ' report=out/android/check/ao4-report.json');
if(report.error)console.error(report.error);
