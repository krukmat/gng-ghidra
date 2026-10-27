import test from 'node:test';
import assert from 'node:assert/strict';
import {createTrace,parseTraceArgs} from '../src/h3_lab_trace.mjs';

// Minimal stand-in for a lab board state: a write at or past T snapshots
// the record first, as gngb_runtime does; $.w looks up $.wk dynamically.
function fakeState(){
  const mem=new Uint8Array(0x3000);
  const $={a:1,b:2,x:3,y:4,u:5,s:0x1ff0,dp:0,cc:0x50,C:0,T:100,
    PC:0x9c40,ipc:0x9c40,bank:1,records:[]};
  $.wk=(a,v,mask,prev)=>{if($.C+prev>=$.T){$.records.push({});$.T+=100;}mem[a]=v;};
  $.w=(a,v,prev)=>$.wk(a,v,255,prev);
  $.rd=a=>mem[a];
  $.rk=a=>{$.lk=255;return mem[a];};
  $.ramBytes=(a,n)=>({bytes:mem.slice(a,a+n),known:new Uint8Array(n).fill(255)});
  return {$,mem};
}

test('escritura vigilada: registro tras el snapshot, valor anterior y nuevo',()=>{
  const {$,mem}=fakeState(),fn=()=>{};
  const t=createTrace(new Map([[0x9c40,fn]]),{from:2,to:3,watch:0x510,len:2,detail:[3,3]});
  t.attach($);
  mem[0x510]=0x96;mem[0x511]=0xac;
  $.w(0x510,0x9c,0);
  assert.equal(t.outside,1);
  assert.equal(t.lines.length,0);
  $.C=99;$.w(0x511,0x64,2);
  assert.equal($.records.length,1);
  assert.deepEqual(t.writes.map(w=>[w.record,w.cycle,w.pc,w.old,w.new,w.before,w.after]),
    [[2,101,'9c40',0xac,0x64,0x9cac,0x9c64]]);
  assert.deepEqual(t.lines,['W 2 101 9c40 0511 ac>64']);
  assert.equal(t.table.get(0x9c40),fn);
  assert.match(t.lines.at(-1),/^B 2 99 9c40 a=01 b=02 x=0003 .* cc=50$/);
  assert.equal(t.table.get(0x1234),undefined);
});

test('lecturas solo en detalle; quiet no registra y no altera efectos',()=>{
  const {$,mem}=fakeState();
  const t=createTrace(new Map(),{from:1,to:3,watch:0x510,len:2,detail:[2,2]});
  t.attach($);
  mem[0x600]=7;
  assert.equal($.rd(0x600,3),7);
  assert.equal(t.lines.length,0);
  $.records.push({});$.T=200;$.C=150;
  assert.equal($.rd(0x600,3),7);
  assert.equal($.rk(0x1ff0,2),0);
  $.ipc=0x4a10;$.w(0x601,9,1);
  assert.deepEqual(t.lines,['R 2 153 9c40 0600=07','R 2 152 9c40 1ff0=00','W 2 151 b1:4a10 0601 00>09']);
  t.quiet=true;
  $.w(0x510,1,0);$.rd(0x600,3);
  assert.equal(t.lines.length,3);
  assert.equal(t.writes.length,0);
  assert.equal(t.outside,0);
  assert.equal(mem[0x510],1);
});

test('límites: ventana <=122, detalle <=4 dentro de la ventana, watch válido',()=>{
  assert.deepEqual(parseTraceArgs(['7240','7301','7290:7291']),
    {from:7240,to:7301,detail:[7290,7291],watch:0x510,len:2});
  assert.doesNotThrow(()=>parseTraceArgs(['7180','7301']));
  assert.throws(()=>parseTraceArgs(['7179','7301']),/WINDOW_INVALID/);
  assert.throws(()=>parseTraceArgs(['1','10']),/WINDOW_INVALID/);
  assert.throws(()=>parseTraceArgs(['7240','7301','7230:7231']),/DETAIL_INVALID/);
  assert.throws(()=>parseTraceArgs(['7240','7301','7290:7294']),/DETAIL_INVALID/);
  assert.throws(()=>parseTraceArgs(['7240','7301'],'0x1dff:2'),/WATCH_INVALID/);
});
