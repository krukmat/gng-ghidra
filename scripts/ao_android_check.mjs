#!/usr/bin/env node
/** AO-3: Playwright reads AO_READY and AO_STATS from the debug WebView.
 * Usage: node scripts/ao_android_check.mjs [seconds=15] [adb serial]
 * Use 120 seconds for the phone GO/STOP measurement. All output is private.
 */
import {execFileSync} from 'node:child_process';
import {chmodSync,mkdirSync,readFileSync,writeFileSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {homedir} from 'node:os';
import {_android} from 'playwright-core';

const ROOT=resolve(fileURLToPath(import.meta.url),'../..');
const APK=join(ROOT,'out/android/gng.apk');
const CHECK=join(ROOT,'out/android/check');
const ADB=join(process.env.ANDROID_HOME??join(homedir(),'Library/Android/sdk'),
  'platform-tools/adb');
const PKG=process.env.AO_APP_ID??'org.gng.offline';
const ACTIVITY='org.rommigration.shell.MainActivity'; // base shell template
const audio=process.argv.includes('--audio'); // AO-6: tap Sound ON after boot
const args=process.argv.slice(2).filter(a=>a!=='--audio');
const seconds=Number(args[0]??15);
const selected=args[1]??process.env.AO_ADB_SERIAL;
if(!Number.isFinite(seconds)||seconds<5)throw Error('AO3_SECONDS_INVALID');
const adb=(serial,...args)=>execFileSync(ADB,['-s',serial,...args],
  {encoding:'utf8',timeout:120000,maxBuffer:16*1024*1024});
const matchLine=text=>{
  const m=/^(AO_[A-Z_]+) (.*)$/s.exec(text);
  if(!m)return null;
  try{return {tag:m[1],data:JSON.parse(m[2])};}catch{return null;}
};

async function main(){
  readFileSync(APK); // fail before touching the device when no private APK exists
  const available=execFileSync(ADB,['devices'],{encoding:'utf8'})
    .split('\n').slice(1).map(line=>/^([^\s]+)\s+device$/.exec(line)?.[1])
    .filter(Boolean);
  const serial=selected??(available.length===1?available[0]:null);
  if(!serial||!available.includes(serial))
    throw Error('AO3_DEVICE_SELECT '+available.join(','));
  const physical=!serial.startsWith('emulator-');
  const safe=serial.replace(/[^\w.-]/g,'_');
  mkdirSync(CHECK,{recursive:true,mode:0o700});
  const report={schema:'gng.ao3.android-check.v1',serial,seconds,
    deviceType:physical?'physical':'emulator',
    apk:'out/android/gng.apk'};
  let device=null;
  const lines=[];
  let wake=()=>{};
  const push=line=>{if(line){lines.push(line);wake();}};
  const until=async(pred,timeout,label)=>{
    const deadline=Date.now()+timeout;
    for(;;){
      const bad=lines.find(l=>l.tag==='AO_ERROR'||l.tag==='AO_HALT');
      if(bad)throw Error('AO3_'+bad.tag+' '+JSON.stringify(bad.data).slice(0,400));
      const hit=lines.find(pred);
      if(hit)return hit.data;
      const left=deadline-Date.now();
      if(left<=0)throw Error('AO3_TIMEOUT_'+label);
      await new Promise(ok=>{wake=ok;setTimeout(ok,Math.min(left,1000));});
    }
  };
  try{
    console.log('AO3_STEP=install serial='+serial);
    adb(serial,'install','-r',APK);
    adb(serial,'shell','am','force-stop',PKG);
    report.launchEpochMs=Number(adb(serial,'shell','date','+%s%3N').trim());
    report.launch=adb(serial,'shell','am','start','-W','-n',
      PKG+'/'+ACTIVITY).trim();
    console.log('AO3_STEP=attach');
    const devices=await _android.devices();
    device=devices.find(d=>d.serial()===serial);
    if(!device)throw Error('AO3_PLAYWRIGHT_DEVICE_MISSING');
    report.model=device.model();
    const webview=await device.webView({pkg:PKG},{timeout:30000});
    console.log('AO3_STEP=webview');
    const page=await webview.page();
    console.log('AO3_STEP=page url='+page.url());
    page.on('console',msg=>push(matchLine(msg.text())));
    page.on('pageerror',e=>push({tag:'AO_ERROR',data:{message:e.message}}));
    page.on('crash',()=>push({tag:'AO_ERROR',data:{message:'WebView crashed'}}));
    // Attach can occur after the first AO_READY. Navigate after listeners exist.
    await page.waitForTimeout(3000);
    await page.goto('https://appassets.androidplatform.net/assets/index.html?ao3='+
      Date.now(),{waitUntil:'domcontentloaded',timeout:30000});
    console.log('AO3_STEP=navigated');
    report.ready=await until(l=>l.tag==='AO_READY',60000,'READY');
    if(audio){
      report.audioReady=await until(l=>l.tag==='AO_AUDIO_READY',60000,'AUDIO_READY');
      await page.waitForFunction(()=>!document.getElementById('sound').disabled,
        null,{timeout:30000});
      await page.click('#sound');
      report.audioSession=await until(l=>l.tag==='AO_AUDIO_SESSION',30000,'AUDIO_SESSION');
    }
    await until(l=>l.tag==='AO_STATS'&&l.data.t>=seconds*1000,
      (seconds+60)*1000,'STATS');
    const stats=lines.filter(l=>l.tag==='AO_STATS').map(l=>l.data);
    const last=stats.at(-1),firstDraw=stats.findIndex(s=>s.drawn>0);
    const drawing=firstDraw<0?[]:stats.slice(firstDraw+1);
    const fps=drawing.map(s=>s.drawn*1000/s.windowMs);
    const sum=(list,key)=>list.reduce((v,s)=>v+s[key],0);
    report.measure={t:last.t,frames:last.frames,
      expected:+(last.t/16.768).toFixed(2),slips:last.slips,
      drawnFpsAvg:drawing.length?
        +(sum(drawing,'drawn')*1000/sum(drawing,'windowMs')).toFixed(2):0,
      drawnFpsMin:drawing.length?+Math.min(...fps).toFixed(2):0,
      drawingWindows:drawing.length,
      cpuHzMin:Math.min(...stats.slice(1).map(s=>s.windowFrames*1000/s.windowMs)),
      renderMsPerFrame:+(sum(drawing,'renderMs')/
        Math.max(1,sum(drawing,'rendered'))).toFixed(2)};
    report.playwright={url:page.url(),aoReady:1,aoStats:stats.length};
    if(audio){
      const a=lines.filter(l=>l.tag==='AO_AUDIO_STATS').map(l=>l.data);
      const w=a.map(x=>x.worklet).filter(Boolean);
      report.audio={label:await page.textContent('#sound'),stats:a.length,
        playing:w.filter(x=>x.state==='PLAYING').length,
        missing:Math.max(0,...w.map(x=>x.missing)),
        maxQueue:Math.max(0,...w.map(x=>x.queued)),
        outputNonzero:w.at(-1)?.outputNonzero??0,producer:a.at(-1)?.producer??null,
        avMs:a.map(x=>x.avMs).filter(Boolean).slice(-5),
        audioPacedFrames:sum(stats,'audioPaced'),
        stops:lines.filter(l=>l.tag==='AO_AUDIO_STOP').map(l=>l.data)};
    }
    try{
      report.screenshot=`out/android/check/ao3-${safe}-device.png`;
      await device.screenshot({path:join(CHECK,`ao3-${safe}-device.png`)});
      chmodSync(join(CHECK,`ao3-${safe}-device.png`),0o600);
    }catch(e){report.screenshotError=String(e);}
    report.status=last.frames<10?'BLOCKED_NO_FRAMES':
      physical&&seconds>=120&&
        (last.slips>0||last.frames<last.t/16.768-2)?'STOP_CPU':
      physical&&seconds>=120&&report.measure.drawnFpsMin<30?'STOP_RENDER':
      physical?'PASS':'PASS_EMULATOR';
  }catch(e){report.status='BLOCKED';report.error=String(e?.stack??e);}
  finally{
    try{
      const logcat=adb(serial,'logcat','-d','-v','epoch','-s',
        'WebShell:I','AndroidRuntime:E','*:S');
      writeFileSync(join(CHECK,`ao3-${safe}-logcat.txt`),logcat,{mode:0o600});
      const ready=[...logcat.matchAll(/^\s*(\d+\.\d+).*AO_READY /gm)];
      const r=ready.map(m=>Number(m[1])*1000)
        .find(v=>v>=report.launchEpochMs);
      if(r)report.coldStartupMs=Math.round(r-report.launchEpochMs);
    }catch(e){report.logcatError=String(e);}
    if(physical&&seconds>=120&&report.status==='PASS')
      report.status=report.coldStartupMs==null?'BLOCKED_STARTUP':
        report.coldStartupMs>=5000?'STOP_STARTUP':'PASS';
    writeFileSync(join(CHECK,`ao3-${safe}-report.json`),
      JSON.stringify(report,null,2)+'\n',{mode:0o600});
    await device?.close();
  }
  console.log('AO3='+report.status+' serial='+serial+
    ' ready_ms='+report.ready?.loadMs+' cold_ms='+report.coldStartupMs+
    ' frames='+report.measure?.frames+' fps='+report.measure?.drawnFpsAvg+
    ' report=out/android/check/ao3-'+safe+'-report.json');
  if(!['PASS','PASS_EMULATOR'].includes(report.status))process.exitCode=2;
}
main().catch(e=>{console.error('AO3=BLOCKED_'+e.message);process.exitCode=2;});
