#!/usr/bin/env node
/** Private video of a cooperative two-player game over the netplay link
 * (src/netplay_turns.mjs, the session the app runs over Bluetooth): two
 * boards on the shipped program bundle, host (P1's phone) and guest (P2's
 * phone), each with its own scripted controls, joined by a simulated link
 * with jitter as in scripts/gng_netplay_check.mjs. No radio is involved.
 * Both screens are recorded side by side at each tick of real time, each
 * under a strip that names the phone, says whether it plays (green) or
 * watches (grey) and shows that player's score. PASS = both players score,
 * the turn passes at the same frames on both phones and both boards end in
 * the same state. Writes out/gng-coop/video/bluetooth-coop.{mp4,json}.
 * Needs the ROM-derived bundle (AO_BUNDLE, default out/rp4/build/bundle),
 * roms/gng.zip and ffmpeg.
 * Usage: node scripts/gng_coop_netplay_video.mjs
 */
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {closeSync,mkdirSync,openSync,readFileSync,rmSync,writeFileSync,writeSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {gngCode} from '../boards/gng/bundle.mjs';
import {createBoard} from '../boards/gng/runtime.mjs';
import {defineInputSchedule,readScheduledPort,INPUT_DEFAULTS}
  from '../src/gngb_input_contract.mjs';
import {createPortRecorder} from '../src/v3_b3_live_tape.mjs';
import {createTurnSession} from '../src/netplay_turns.mjs';
import {createGngTurnRule} from '../games/gngb/netplay.mjs';
import {observeGameState} from '../games/gngb/state.mjs';
import {createMatchTracker} from '../src/ao_match.mjs';
import {gameOptions,optionDips,withGameOptions} from '../games/gngb/options.mjs';
import {rendererUnknownCount} from '../src/v2_b1_observable.mjs';
import {renderGngbRgba} from '../src/gngb_frame_renderer.mjs';
import {rendererInputs} from '../src/gngb_render_inputs.mjs';
import {gngbGraphics} from './r35_t5_render_check.mjs';

const ROOT=resolve(fileURLToPath(import.meta.url),'../..');
const BUNDLE=resolve(ROOT,process.env.AO_BUNDLE??'out/rp4/build/bundle');
const OUT=join(ROOT,'out/gng-coop/video');
const F=25152,FPS=`1500000/${F}`,LIMIT=30000,FROM=540,TAIL=240;
const SW=256,SH=224,GAP=8,STRIP=24,W=SW*2+GAP,H=STRIP+SH;
const OPTIONS=gameOptions({coop:true,continues:false});
const press=(f,control,n)=>[{cycle:f*F,control,pressed:true},
  {cycle:(f+n)*F,control,pressed:false}];
const manifest=JSON.parse(readFileSync(join(BUNDLE,'manifest.json'),'utf8'));
const code=gngCode(manifest,readFileSync(join(BUNDLE,'code.bin')),
  readFileSync(join(BUNDLE,'overlays.bin')));
const {blocks:plain}=await import(pathToFileURL(join(BUNDLE,'program.mjs')).href);
const blocks=withGameOptions(plain,OPTIONS);
const gfx=gngbGraphics(name=>execFileSync('unzip',['-p',join(ROOT,'roms/gng.zip'),name],
  {maxBuffer:1<<20,stdio:['ignore','pipe','ignore']}));

const GLYPHS={A:'01110100011000111111100011000110001',D:'11110100011000110001100011000111110',
  E:'11111100001000011110100001000011111',F:'11111100001000011110100001000010000',
  G:'01110100011000010111100011000101111',I:'01110001000010000100001000010001110',
  J:'00111000100001000010000101001001100',L:'10000100001000010000100001000011111',
  M:'10001110111010110101100011000110001',N:'10001110011010110011100011000110001',
  O:'01110100011000110001100011000101110',P:'11110100011000111110100001000010000',
  R:'11110100011000111110101001001010001',S:'01111100001000001110000010000111110',
  T:'11111001000010000100001000010000100',U:'10001100011000110001100011000101110',
  0:'01110100011001110101110011000101110',1:'00100011000010000100001000010001110',
  2:'01110100010000100010001000100011111',3:'11110000010000101110000010000111110',
  4:'00010001100101010010111110001000010',5:'11111100001111000001000011000101110',
  6:'00110010001000011110100011000101110',7:'11111000010001000100010000100001000',
  8:'01110100011000101110100011000101110',9:'01110100011000101111000010001001100',
  '-':'00000000000000011111000000000000000'};
function text(buf,x,y,s){
  for(const ch of s){
    const g=GLYPHS[ch];
    if(g)for(let i=0;i<35;i++)if(g[i]==='1'){
      const o=((y+(i/5|0))*W+x+i%5)*4;buf[o]=buf[o+1]=buf[o+2]=255;
    }
    x+=6;
  }
}
function strip(buf,x0,phone,plays,score){
  const [r,g,b]=plays?[0,130,60]:[70,70,70];
  for(let y=0;y<STRIP;y++)for(let x=x0;x<x0+SW;x++){
    const o=(y*W+x)*4;buf[o]=r;buf[o+1]=g;buf[o+2]=b;buf[o+3]=255;
  }
  const state=plays?'JUEGA':'MIRA';
  text(buf,x0+4,3,`TELEFONO ${phone} - JUGADOR ${phone}`);
  text(buf,x0+SW-4-state.length*6,3,state);
  text(buf,x0+4,14,'PUNTOS '+String(score).padStart(6,'0'));
}

// The host inserts two coins and presses Start 2; then each player walks
// right and fires on its own rhythm (the guest also jumps).
function schedule(role){
  const e=role==='host'?[...press(560,'coin1',12),...press(600,'coin1',12),
    ...press(680,'start2',12)]:[];
  for(let f=1240;f<LIMIT;f+=role==='host'?80:64)e.push(...press(f,'p1.right',role==='host'?36:30));
  for(let f=1300;f<LIMIT;f+=role==='host'?12:10)e.push(...press(f,'p1.button1',4));
  if(role==='guest')for(let f=1500;f<LIMIT;f+=230)e.push(...press(f,'p1.button2',6));
  return defineInputSchedule(e.sort((a,b)=>a.cycle-b.cycle));
}
// Ordered link with seeded jitter.
function network(){
  let r=11;const queue={host:[],guest:[]},clock={t:0};
  const jitter=()=>2+((r=(r*1103515245+12345)&0x7fffffff)%7);
  return {clock,
    send(from,m){
      const q=queue[from==='host'?'guest':'host'];
      q.push({at:Math.max(q.at(-1)?.at??0,clock.t+jitter()),m:JSON.parse(JSON.stringify(m))});
    },
    deliver(peers){
      for(const to of ['host','guest'])
        while(queue[to].length&&queue[to][0].at<=clock.t)peers[to].session.receive(queue[to].shift().m);
    }};
}
function peer(role,net){
  const input=schedule(role),events=[],recorder=createPortRecorder();
  const session=createTurnSession({role,ownerAfter:createGngTurnRule(),
    defaults:INPUT_DEFAULTS.slice(0,3),send:m=>net.send(role,m),onEvent:e=>events.push(e)});
  let last=null,frame=0,shown=0;
  const board=createBoard(code,blocks,{frames:Number.MAX_SAFE_INTEGER,dips:optionDips(OPTIONS),
    portRead:(a,c)=>session.owns()?readScheduledPort(input,a,c):session.read(a-0x3000,c),
    onPortRead:x=>recorder.observe(x.addr,x.cycle,x.value),
    onFrame:x=>{last=x;board.state.records[x.index-1]=null;board.state.events.length=0;}});
  const screen=Buffer.alloc(SW*SH*4);
  return {session,events,board,screen,get frame(){return frame;},get last(){return last;},
    step(){
      if(!session.canRun(frame+1))return false;
      assert.equal(board.run(frame+1).status,'FRAMES_DONE');
      frame++;
      session.frameEnd(frame,last.record,recorder.drain());
      return true;
    },
    render(){
      if(shown===frame)return;
      shown=frame;
      if(rendererUnknownCount(last)===0)screen.set(renderGngbRgba(rendererInputs(last.record,
        {scroll:last.scroll,latch:last.latch},gfx)).rgba);
      else screen.fill(0);
    }};
}

mkdirSync(OUT,{recursive:true,mode:0o700});
const mp4=join(OUT,'bluetooth-coop.mp4'),raw=join(OUT,'bluetooth-coop.rgba');
const fd=openSync(raw,'w',0o600),canvas=Buffer.alloc(W*H*4);
for(let i=3;i<canvas.length;i+=4)canvas[i]=255;
const net=network(),peers={host:peer('host',net),guest:peer('guest',net)};
const match=createMatchTracker(),log=[];
let end=LIMIT,key=null,started=false,scores=[0,0],videoFrames=0,maxLead=0;
const seconds=()=>+(videoFrames*F/1500000).toFixed(1);
try{
  for(let t=0;peers.host.frame<end||peers.guest.frame<end;t++){
    assert.ok(t<LIMIT*4,'the session keeps moving');
    net.clock.t=t;
    for(const p of Object.values(peers))
      for(let k=0;k<(p.session.owns()?1:4)&&p.frame<end;k++){
        if(!p.step())break;
        if(p!==peers.host)continue;
        const s=observeGameState(p.last),k2=JSON.stringify(s);
        if(!s||k2===key)continue;
        key=k2;
        for(const e of match.update(s)){
          log.push({frame:p.frame,at:seconds(),...e});
          if(e.type==='start')started=true;
          if(e.type==='result')end=Math.min(end,p.frame+TAIL);
        }
        // Before the match the score bytes hold the RAM test's patterns.
        if(started&&s.players===2&&s.mode>=2)s.scores.forEach((v,i)=>{
          if(v>scores[i])log.push({frame:p.frame,at:seconds(),type:'score',player:i+1,score:v});
          scores[i]=v;
        });
      }
    net.deliver(peers);
    for(const p of Object.values(peers))assert.equal(p.session.ended,null,JSON.stringify(p.session.ended));
    maxLead=Math.max(maxLead,Math.abs(peers.host.frame-peers.guest.frame));
    if(peers.host.frame<FROM)continue;
    [peers.host,peers.guest].forEach((p,i)=>{
      p.render();
      const x0=i*(SW+GAP);
      for(let y=0;y<SH;y++)p.screen.copy(canvas,((STRIP+y)*W+x0)*4,y*SW*4,(y+1)*SW*4);
      strip(canvas,x0,i+1,p.session.owns(),scores[i]);
    });
    writeSync(fd,canvas);videoFrames++;
  }
  closeSync(fd);
  const {host,guest}=peers;
  const turns=p=>p.events.filter(e=>e.type==='owner').map(e=>e.owner+'@'+e.frame);
  assert.deepEqual(turns(guest),turns(host),'turns at the same frames on both phones');
  assert.ok(turns(host).length>=2,'the turn passes');
  assert.deepStrictEqual(guest.board.exportState(),host.board.exportState(),'guest equals host');
  const result=log.find(e=>e.type==='result');
  assert.ok(result,'the game ended at the title');
  assert.ok(result.scores[0]>0&&result.scores[1]>0,'both players scored');
  execFileSync('ffmpeg',['-nostdin','-hide_banner','-loglevel','error','-y',
    '-f','rawvideo','-pixel_format','rgba','-video_size',`${W}x${H}`,'-framerate',FPS,
    '-i',raw,'-vf','scale=iw*2:ih*2:flags=neighbor','-an','-c:v','libx264',
    '-preset','medium','-crf','18','-pix_fmt','yuv420p','-movflags','+faststart',mp4]);
  const report={schema:'gng.coop-netplay-video.v1',bundle:manifest.files['program.mjs'],
    options:OPTIONS,frames:host.frame,turns:turns(host),result,maxLead,video:mp4,
    seconds:seconds(),events:log};
  writeFileSync(join(OUT,'bluetooth-coop.json'),JSON.stringify(report,null,2)+'\n',{mode:0o600});
  console.log(JSON.stringify({...report,events:log.filter(e=>e.type!=='score').concat(
    [1,2].map(n=>log.find(e=>e.type==='score'&&e.player===n)))}));
  console.log('GNG_COOP_NETPLAY_VIDEO PASS');
}finally{rmSync(raw,{force:true});}
