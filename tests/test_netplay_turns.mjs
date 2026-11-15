import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createTurnSession,createPortHistory,ramHash} from '../src/netplay_turns.mjs';
import {createPortRecorder} from '../src/v3_b3_live_tape.mjs';
import {createGngTurnRule} from '../games/gngb/netplay.mjs';

// A deterministic stand-in for the board: four port reads per frame at
// fixed cycles; RAM 0x02 is the mode (title, then a game) and 0x27 the turn.
function machine(){
  const ram=new Uint8Array(0x1e00);
  return {ram,frame(f,read){
    for(const [k,port] of [[10,0],[40,1],[70,1],[90,2]]){
      const v=read(port,f*100+k);
      ram[0x10+port]=(ram[0x10+port]*31+v)&255;ram[0x20]^=v;
    }
    ram[0x02]=f<5?1:2;ram[0x27]=Math.floor(f/40)%2;
  }};
}
const rule=()=>{const r=createGngTurnRule();return ram=>r(ram);};
const INPUT={host:(f,p)=>(f*13+p*7)%5===0?0xfe:0xff,guest:(f,p)=>(f*11+p*3)%7===0?0xfb:0xff};

// Ordered links with latency; a link that is down drops what is sent.
function network(latency){
  const queue={host:[],guest:[]},clock={t:0};let up=true;
  return {clock,
    send(from,m){
      if(!up)return;
      const to=from==='host'?'guest':'host',q=queue[to];
      const at=Math.max(q.at(-1)?.at??0,clock.t+latency(from));
      q.push({at,m:JSON.parse(JSON.stringify(m))});
    },
    deliver(peers){
      for(const to of ['host','guest'])
        while(queue[to].length&&queue[to][0].at<=clock.t)peers[to].s.receive(queue[to].shift().m);
    },
    set up(v){up=v;},
  };
}
function peer(role,net,{corruptAt=0}={}){
  const m=machine(),rec=createPortRecorder(),events=[];let f=0;
  const s=createTurnSession({role,ownerAfter:rule(),defaults:[255,255,255],hashEvery:20,
    send:msg=>net.send(role,msg),onEvent:e=>events.push(e)});
  return {s,m,events,get frame(){return f;},
    step(){
      if(!s.canRun(f+1))return false;
      f++;const owns=s.owns();
      m.frame(f,(port,cycle)=>{
        const v=owns?INPUT[role](f,port):s.read(port,cycle);
        rec.observe(0x3000+port,cycle,v);return v;
      });
      if(f===corruptAt)m.ram[0x30]^=1;
      s.frameEnd(f,m.ram,rec.drain());
      return true;
    }};
}
function reference(frames){
  const m=machine(),owner=rule();let who='host';
  for(let f=1;f<=frames;f++){m.frame(f,port=>INPUT[who](f,port));who=owner(m.ram);}
  return m.ram;
}
function play({frames=400,latency=()=>3,outage=null,corrupt=0}){
  const net=network(latency);
  const peers={host:peer('host',net),guest:peer('guest',net,{corruptAt:corrupt})};
  for(let t=0;t<20000&&(peers.host.frame<frames||peers.guest.frame<frames);t++){
    net.clock.t=t;
    if(outage&&t===outage[0])net.up=false;
    if(outage&&t===outage[1]){net.up=true;peers.host.s.resend();peers.guest.s.resend();}
    // The owner runs in real time; a follower may catch up a few frames.
    for(const p of Object.values(peers))
      for(let k=0;k<(p.s.owns()?1:3)&&p.frame<frames&&!p.s.ended;k++)if(!p.step())break;
    net.deliver(peers);
    if(peers.host.s.ended&&peers.guest.s.ended)break;
  }
  return peers;
}

test('both peers replay the owner\'s inputs and pass the turn at the same frames',()=>{
  const {host,guest}=play({latency:from=>from==='host'?4:2});
  assert.equal(host.frame,400);assert.equal(guest.frame,400);
  assert.deepEqual(host.m.ram,reference(400));
  assert.deepEqual(guest.m.ram,host.m.ram);
  const turns=p=>p.events.filter(e=>e.type==='owner').map(e=>e.owner+'@'+e.frame);
  assert.deepEqual(turns(host),turns(guest));
  assert.deepEqual(turns(host).slice(0,3),['guest@40','host@80','guest@120']);
  assert.equal(host.s.ended,null);assert.equal(guest.s.ended,null);
});
test('jitter and a dropped link: what was not acked is sent again',()=>{
  let r=7;const jitter=()=>(r=(r*1103515245+12345)&0x7fffffff)%9;
  const {host,guest}=play({latency:jitter,outage:[50,120]});
  assert.deepEqual(host.m.ram,reference(400));
  assert.deepEqual(guest.m.ram,host.m.ram);
  assert.equal(host.s.ended,null);assert.equal(guest.s.ended,null);
});
test('a RAM difference ends both sessions at the next hash',()=>{
  const {host,guest}=play({corrupt:50});
  for(const p of [host,guest])
    assert.deepEqual(p.s.ended&&{reason:p.s.ended.reason,frame:p.s.ended.frame},
      {reason:'desync',frame:60});
});
test('history reads forward and refuses changes back in time',()=>{
  const h=createPortHistory([255]);
  h.push([0,10,1]);h.push([0,10,2]);h.push([0,30,3]);
  assert.deepEqual([5,10,29,30,99].map(c=>h.read(0,c)),[255,2,2,3,3]);
  assert.throws(()=>h.push([0,20,4]),/NET_CHANGE_ORDER/);
  assert.throws(()=>h.push([1,40,4]),/NET_CHANGE_INVALID/);
  assert.equal(ramHash(new Uint8Array(0x1e00)),ramHash(new Uint8Array(0x1e00)));
});
test('GnG rule: the power-on test never hands the turn to the guest',()=>{
  const owner=createGngTurnRule(),ram=new Uint8Array(0x100);
  ram[0x02]=0xff;ram[0x27]=1;assert.equal(owner(ram),'host');
  ram[0x02]=1;assert.equal(owner(ram),'host');
  ram[0x02]=2;assert.equal(owner(ram),'guest');
  ram[0x27]=0;assert.equal(owner(ram),'host');
});
