#!/usr/bin/env node
/** Exercise the page's Bluetooth handshake and two live workers with an
 * ordered in-process line link. The legacy guest loads the base v2 protocol
 * module. No radio or second emulator is needed. */
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {mkdirSync,writeFileSync} from 'node:fs';
import {chromium} from 'playwright-core';
import {createAssetServer} from './ao_serve.mjs';

const OUT='out/android/check';
const oldProtocol=execFileSync('git',['show','7570b82:src/netplay_turns.mjs'],{encoding:'utf8'});
assert.match(oldProtocol,/NET_PROTOCOL='gng\.netplay\.v2'/);
const server=createAssetServer();
let browser;
const results=[];
const countOutfit=page=>page.evaluate(()=>{
  const c=document.getElementById('screen'),d=c.getContext('2d').getImageData(0,0,c.width,c.height).data;
  let n=0;for(let i=0;i<d.length;i+=4)
    if(d[i]===112&&d[i+1]===120&&d[i+2]===52)n++;
  return n;
});
const wait=async(page,label,test,timeout=90000)=>{
  const end=Date.now()+timeout;
  while(Date.now()<end){const found=await test();if(found)return found;
    await page.waitForTimeout(100);}
  throw Error('LANCELOT_ONLINE_TIMEOUT '+label);
};
async function pair({legacy=false}){
  const peers={},logs={host:[],guest:[]},errors=[],seen=[];
  let waiting=false,link=Promise.resolve();
  const event=(role,data)=>peers[role].evaluate(data=>window.__shellBluetooth?.(data),data);
  const deliver=(role,action,payload)=>{
    link=link.then(async()=>{
      if(action==='host'){
        waiting=true;await event(role,{type:'status',state:'waiting'});
      }else if(action==='join'){
        assert.ok(waiting,'host waits before guest joins');
        await event('host',{type:'status',state:'connected',role:'host'});
        await event('guest',{type:'status',state:'connected',role:'guest'});
      }else if(action==='send'){
        const target=role==='host'?'guest':'host';
        seen.push({from:role,message:JSON.parse(payload)});
        await event(target,{type:'line',line:payload});
      }
    });
    return link;
  };
  try{
    for(const role of ['host','guest']){
      const page=await browser.newPage({viewport:{width:1100,height:700}});
      peers[role]=page;
      await page.exposeBinding('__bridgeAction',(_,action,payload)=>deliver(role,action,payload));
      await page.addInitScript(()=>{
        window.ShellBluetooth={available:()=>true,
          status:()=>JSON.stringify({state:'ready'}),
          pairedDevices:()=>JSON.stringify([{name:'Host',address:'00:11:22:33:44:55'}]),
          host(){window.__bridgeAction('host');return true;},
          join(address){window.__bridgeAction('join',address);return true;},
          send(line){window.__bridgeAction('send',line);return true;},
          disconnect(){return true;}};
      });
      if(role==='guest'&&legacy)await page.route('**/lib/netplay_turns.mjs',route=>{
        seen.push({from:'legacy',module:route.request().url()});
        return route.fulfill({body:oldProtocol,contentType:'text/javascript'});
      });
      page.on('pageerror',e=>errors.push(role+': '+String(e)));
      page.on('console',m=>{
        const match=/^(AO_\w+) (.*)$/s.exec(m.text());if(!match)return;
        try{logs[role].push({tag:match[1],data:JSON.parse(match[2])});}catch{}
        if(['AO_ERROR','AO_HALT'].includes(match[1]))errors.push(role+': '+m.text());
      });
      await page.goto(`http://127.0.0.1:${server.address().port}/index.html?inputCheck`);
      await page.waitForFunction(()=>!document.getElementById('start').disabled);
    }
    const host=peers.host,guest=peers.guest;
    await host.locator('#options-open').click();
    await host.locator('label:has(input[name=character][value=lancelot])').click();
    await host.locator('#options-apply').click();
    await host.waitForFunction(()=>!document.getElementById('start').disabled);
    await host.locator('#online-open').click();
    await host.locator('#bt-host').click();
    await wait(host,'waiting',()=>logs.host.some(l=>l.tag==='AO_ONLINE'&&l.data.type==='waiting'));
    await guest.locator('#online-open').click();
    await guest.locator('#bt-join').click();
    if(legacy){
      await wait(guest,'legacy refused',()=>logs.guest.find(l=>l.tag==='AO_ONLINE_END')?.data);
      await link;
      assert.ok(seen.some(x=>x.from==='legacy'&&x.module.endsWith('/lib/netplay_turns.mjs')));
      assert.ok(seen.some(x=>x.message?.type==='hello'&&x.message.protocol==='gng.netplay.v3'));
      assert.ok(seen.some(x=>x.message?.type==='hello-refused'&&x.message.reason==='protocol'));
      assert.equal(logs.guest.some(l=>l.tag==='AO_ONLINE_PLAY'),false);
      assert.match(logs.guest.find(l=>l.tag==='AO_ONLINE_END').data.message,/versi[oó]n|datos inválidos/i);
      assert.deepEqual(errors,[]);
      return {case:'legacy guest',status:'PASS',refusal:'protocol',
        guestMessage:logs.guest.find(l=>l.tag==='AO_ONLINE_END').data.message};
    }
    const hostPlay=await wait(host,'host play',()=>logs.host.find(l=>l.tag==='AO_ONLINE_PLAY')?.data);
    const guestPlay=await wait(guest,'guest play',()=>logs.guest.find(l=>l.tag==='AO_ONLINE_PLAY')?.data);
    assert.equal(hostPlay.options.character,'lancelot');
    assert.equal(guestPlay.options.character,'lancelot');
    const guestInput=await wait(guest,'guest game',()=>logs.guest.find(l=>l.tag==='AO_INPUT'&&l.data.gameState?.inGame)?.data);
    const outfit=await wait(guest,'guest outfit',async()=>{
      const n=await countOutfit(guest);return n>40?n:false;
    });
    assert.deepEqual(errors,[]);
    const data=await guest.evaluate(()=>document.getElementById('screen').toDataURL('image/png'));
    writeFileSync(`${OUT}/lancelot-online-guest.png`,Buffer.from(data.split(',')[1],'base64'));
    return {case:'current guest',status:'PASS',guestFrame:guestInput.frame,
      guestOutfitPixels:outfit,hostCharacter:hostPlay.options.character,
      guestCharacter:guestPlay.options.character};
  }finally{await Promise.all(Object.values(peers).map(p=>p.close()));}
}
try{
  mkdirSync(OUT,{recursive:true});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  browser=await chromium.launch({channel:'chromium',headless:true});
  results.push(await pair({legacy:false}));
  results.push(await pair({legacy:true}));
  writeFileSync(`${OUT}/lancelot-online-check.json`,JSON.stringify({status:'PASS',results},null,2)+'\n');
  console.log('LANCELOT_ONLINE_CHECK=PASS '+JSON.stringify(results));
}finally{
  await browser?.close();
  if(server.listening)await new Promise(resolve=>server.close(resolve));
}
