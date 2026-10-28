#!/usr/bin/env node
/** AO-2 browser check on the Mac. Serves out/android/assets on 127.0.0.1 and
 * drives Playwright's headless Chromium (no window, no focus, no keyboard):
 *  1. ?check=N: the SHA-256 of every rendered frame must equal the Node
 *     renderer run on the original audio bundle and src/ (not the assets);
 *  2. paced run for S seconds: the CPU keeps the real 59.64 Hz rhythm with
 *     no slip and the page draws >= 30 fps once frames are drawable.
 * Usage: node scripts/ao_browser_check.mjs [seconds=120] [frames=600]
 * The screenshot and report stay private in out/android/check/.
 */
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {createReadStream,mkdirSync,statSync,writeFileSync} from 'node:fs';
import {createServer} from 'node:http';
import {extname,join,resolve,sep} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {chromium} from 'playwright-core';
import {ASSETS,buildAssets} from './ao_build_assets.mjs';
import {gngbGraphics} from './r35_t5_render_check.mjs';
import {selectB3Bundle} from '../src/v3_b3_bundle.mjs';
import {prepareAudioBundle} from '../src/gngb_audio_bundle_overlay.mjs';
import {loadFrozen} from '../src/v2_b1_frozen.mjs';
import {CYCLES_PER_FRAME} from '../src/gngb_runtime.mjs';
import {renderGngbRgba} from '../src/gngb_frame_renderer.mjs';
import {rendererInputs} from '../src/gngb_render_inputs.mjs';
import {rendererUnknownCount} from '../src/v2_b1_observable.mjs';
import {INPUT_DEFAULTS} from '../src/gngb_input_contract.mjs';

const ROOT=resolve(fileURLToPath(import.meta.url),'../..');
const CHECK_DIR=join(ROOT,'out/android/check');
const FRAME_MS=CYCLES_PER_FRAME/1.5e6*1000;
const MIN_FPS=30;
const MIME={'.html':'text/html; charset=utf-8','.mjs':'text/javascript; charset=utf-8',
  '.json':'application/json','.bin':'application/octet-stream'};

/** Frame hashes from the original audio bundle and src/, as the worker draws. */
async function nodeReference(n){
  const selected=selectB3Bundle(ROOT);
  if(!selected)throw Error('AO2_B3_BUNDLE_MISSING');
  const audio=await prepareAudioBundle(ROOT,selected.dir);
  const {code}=loadFrozen(audio.dir);
  const {blocks}=await import(pathToFileURL(join(audio.dir,'program.mjs')).href);
  const {createBoard}=await import(pathToFileURL(join(audio.dir,'gngb_runtime.mjs')).href);
  const zip=join(ROOT,'roms/gng.zip');
  const gfx=gngbGraphics(name=>execFileSync('unzip',['-p',zip,name],
    {maxBuffer:1<<20,stdio:['ignore','pipe','ignore']}));
  const hashes=[];
  const cpu=createBoard(code,blocks,{frames:n,portRead:a=>INPUT_DEFAULTS[a-0x3000],
    onFrame:f=>{
      hashes.push(rendererUnknownCount(f)!==0?null:createHash('sha256').update(
        renderGngbRgba(rendererInputs(f.record,{scroll:f.scroll,latch:f.latch},gfx))
          .rgba).digest('hex'));
      cpu.state.records[f.index-1]=null;
    }});
  const result=cpu.run();
  if(result?.status!=='FRAMES_DONE'||hashes.length!==n)
    throw Error('AO2_NODE_REFERENCE_'+result?.status);
  return hashes;
}
function serve(root){
  const server=createServer((req,res)=>{
    let file=null;
    try{
      file=resolve(root,'.'+decodeURIComponent(new URL(req.url,'http://h').pathname));
      if(!file.startsWith(root+sep)||!statSync(file).isFile()||!MIME[extname(file)])
        file=null;
    }catch{file=null;}
    if(!file){res.writeHead(404).end();return;}
    res.writeHead(200,{'content-type':MIME[extname(file)],'cache-control':'no-store'});
    createReadStream(file).pipe(res);
  });
  return new Promise(ok=>server.listen(0,'127.0.0.1',()=>ok(server)));
}
/** AO_* JSON lines the page logs; AO_ERROR and AO_HALT end any wait. */
function pageLog(page){
  const lines=[];
  let wake=null;
  const push=line=>{lines.push(line);wake?.();};
  page.on('console',msg=>{
    const m=/^(AO_[A-Z]+) (.*)$/s.exec(msg.text());
    if(m)push({tag:m[1],data:JSON.parse(m[2])});
  });
  page.on('pageerror',e=>push({tag:'AO_ERROR',data:{message:e.message}}));
  page.on('crash',()=>push({tag:'AO_ERROR',data:{message:'page crashed'}}));
  return {lines,async until(pred,ms,what){
    const deadline=Date.now()+ms;
    for(;;){
      const bad=lines.find(l=>l.tag==='AO_ERROR'||l.tag==='AO_HALT');
      if(bad)throw Error('AO2_PAGE_'+bad.tag+' '+JSON.stringify(bad.data).slice(0,400));
      const hit=lines.find(pred);
      if(hit)return hit;
      const left=deadline-Date.now();
      if(left<=0)throw Error('AO2_TIMEOUT_'+what);
      await new Promise(ok=>{wake=ok;setTimeout(ok,Math.min(left,1000));});
    }
  }};
}
function summarize(stats,loadMs){
  // The first window includes the warm-up after the 27 MB program import.
  // Nothing is drawable before frame 311 (~5.2 s, first sprite DMA), so the
  // fps figures count only the windows after the first one that drew.
  const last=stats.at(-1),steady=stats.slice(1);
  const first=stats.findIndex(s=>s.drawn>0),drawing=first<0?[]:stats.slice(first+1);
  const sum=(list,key)=>list.reduce((n,s)=>n+s[key],0);
  const hz=steady.map(s=>s.windowFrames*1000/s.windowMs);
  const fps=drawing.map(s=>s.drawn*1000/s.windowMs);
  const round=v=>+v.toFixed(2);
  return {loadMs,t:last.t,frames:last.frames,expected:round(last.t/FRAME_MS),
    slips:last.slips,windows:stats.length,drawingWindows:drawing.length,
    firstDrawnByMs:first<0?null:stats[first].t,
    cpuHzMin:round(Math.min(...hz)),cpuHzMax:round(Math.max(...hz)),
    drawnFpsAvg:drawing.length?round(sum(drawing,'drawn')*1000/sum(drawing,'windowMs')):0,
    drawnFpsMin:drawing.length?round(Math.min(...fps)):0,
    cpuMsPerFrame:round(sum(steady,'cpuMs')/sum(steady,'windowFrames')),
    renderMsPerFrame:round(sum(drawing,'renderMs')/Math.max(1,sum(drawing,'rendered'))),
    lateMsMax:round(Math.max(...steady.map(s=>s.lateMs)))};
}
async function main(){
  const seconds=Number(process.argv[2]??120),frames=Number(process.argv[3]??600);
  if(!(seconds>=5)||!Number.isInteger(frames)||frames<1)throw Error('AO2_ARGS');
  const index=await buildAssets();
  const reference=await nodeReference(frames);
  const server=await serve(ASSETS);
  const base='http://127.0.0.1:'+server.address().port;
  const report={schema:'gng.ao2.browser-check.v2',generation:index.generation,
    frames,seconds};
  let browser=null;
  try{
    // The 'chromium' channel is Playwright's full Chromium in new headless mode.
    browser=await chromium.launch({channel:'chromium',headless:true});
    report.browser=browser.version();
    const page=await browser.newPage({viewport:{width:512,height:448}});
    const log=pageLog(page);

    await page.goto(base+'/index.html?check='+frames);
    const ready=(await log.until(l=>l.tag==='AO_READY',60000,'READY')).data;
    const check=(await log.until(l=>l.tag==='AO_CHECK',300000,'CHECK')).data;
    const bad=check.hashes.map((h,i)=>h===reference[i]?0:i+1).filter(Boolean);
    report.check={loadMs:ready.loadMs,ms:check.ms,
      rendered:check.hashes.filter(Boolean).length,
      referenceRendered:reference.filter(Boolean).length,
      firstRenderedFrame:reference.findIndex(Boolean)+1||null,
      mismatch:bad.length+Math.abs(check.hashes.length-reference.length),
      firstMismatchFrame:bad[0]??null};

    log.lines.length=0;
    await page.goto(base+'/index.html');
    const paced=(await log.until(l=>l.tag==='AO_READY',60000,'READY')).data;
    await log.until(l=>l.tag==='AO_STATS'&&l.data.t>=seconds*1000,
      (seconds+60)*1000,'PACED');
    report.paced=summarize(log.lines.filter(l=>l.tag==='AO_STATS').map(l=>l.data),
      paced.loadMs);
    mkdirSync(CHECK_DIR,{recursive:true,mode:0o700});
    writeFileSync(join(CHECK_DIR,'ao2-paced.png'),await page.screenshot(),{mode:0o600});
  }finally{
    await browser?.close();
    server.close();
  }
  const c=report.check,p=report.paced;
  const rhythm=p.slips===0&&Math.abs(p.frames-p.expected)<=2;
  // A zero mismatch also means both sides rendered the same frames.
  report.status=c.referenceRendered===0?'BLOCKED_NO_RENDERED_FRAMES':
    c.mismatch!==0?'BLOCKED_PIXEL_MISMATCH':!rhythm?'BLOCKED_RHYTHM':
    p.drawnFpsAvg<MIN_FPS?'BLOCKED_FPS':'PASS';
  mkdirSync(CHECK_DIR,{recursive:true,mode:0o700});
  writeFileSync(join(CHECK_DIR,'ao2-report.json'),JSON.stringify(report,null,2)+'\n',
    {mode:0o600});
  console.log(`AO2_BROWSER=chromium ${report.browser}`);
  console.log(`AO2_CHECK_FRAMES=${frames} rendered=${c.rendered}/${c.referenceRendered} `+
    `first=${c.firstRenderedFrame??'NONE'} mismatch=${c.mismatch} `+
    `first_mismatch=${c.firstMismatchFrame??'NONE'} ms=${c.ms}`);
  console.log(`AO2_LOAD_MS=${c.loadMs}/${p.loadMs}`);
  console.log(`AO2_PACED_FRAMES=${p.frames} expected=${p.expected} slips=${p.slips} `+
    `cpu_hz=${p.cpuHzMin}..${p.cpuHzMax} late_ms_max=${p.lateMsMax}`);
  console.log(`AO2_PACED_DRAWN_FPS=${p.drawnFpsAvg} min=${p.drawnFpsMin} `+
    `windows=${p.drawingWindows} first_drawn_by_ms=${p.firstDrawnByMs??'NONE'}`);
  console.log(`AO2_PACED_MS_PER_FRAME=cpu ${p.cpuMsPerFrame} render ${p.renderMsPerFrame}`);
  console.log(`AO2=${report.status} report=out/android/check/ao2-report.json`);
  if(report.status!=='PASS')process.exitCode=2;
}
main().catch(e=>{console.error('AO2=BLOCKED_'+e.message);process.exitCode=2;});
