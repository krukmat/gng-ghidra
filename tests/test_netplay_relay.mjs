import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createRelayServer} from '../scripts/netplay_relay.mjs';
import {createRelayClient} from '../src/net_relay_client.mjs';

const listen=server=>new Promise(r=>server.listen(0,'127.0.0.1',()=>r(server.address().port)));
function client(url){
  const events=[],waiters=[];
  const c=createRelayClient(url,{retryMs:[50,50,50],onEvent:e=>{
    events.push(e);for(const w of waiters.splice(0))w();
  }});
  c.events=events;
  c.next=async(type,from=0)=>{
    for(;;){
      const hit=events.slice(from).find(e=>e.type===type);if(hit)return hit;
      await new Promise((r,k)=>{waiters.push(r);setTimeout(()=>k(Error('timeout '+type)),3000);});
    }
  };
  return c;
}
test('two clients pair by code, exchange messages and rejoin after a drop',async()=>{
  const {server,rooms}=createRelayServer({rejoinMs:2000});
  const url='ws://127.0.0.1:'+await listen(server);
  try{
    const a=client(url),b=client(url);
    a.host();
    const {code}=await a.next('room');
    assert.match(code,/^[A-Z2-9]{4}$/);
    b.join(code.toLowerCase());
    assert.equal((await a.next('paired')).role,'host');
    assert.equal((await b.next('paired')).role,'guest');
    a.send({n:1,s:'hola'});
    assert.deepEqual((await b.next('message')).message,{n:1,s:'hola'});
    // Drop the guest's socket under it: the host hears peer-gone, the guest
    // rejoins with its token and both are paired again.
    const mark=a.events.length,markB=b.events.length;
    const [conn]=[...rooms.get(code).guest?[rooms.get(code).guest.conn]:[]];
    conn.close(1001);
    await a.next('peer-gone',mark);
    const again=await b.next('paired',markB+1);
    assert.equal(again.again,true);
    b.send({n:2});
    assert.deepEqual((await a.next('message',mark)).message,{n:2});
    const c=client(url);c.join(code);
    assert.equal((await c.next('error')).code,'ROOM_FULL');
    c.leave();
    b.leave();
    assert.equal((await a.next('peer-left',mark)).reason,'peer-left');
    assert.equal(rooms.size,0);
    a.leave();
  }finally{server.close();server.closeAllConnections?.();}
});
test('an unknown room is refused; a bad URL closes at once',async()=>{
  const {server}=createRelayServer();
  const url='ws://127.0.0.1:'+await listen(server);
  try{
    const a=client(url);a.join('ZZZZ');
    assert.equal((await a.next('error')).code,'ROOM_NOT_FOUND');
    a.leave();
    const bad=client('ws://127.0.0.1:1');
    assert.equal((await bad.next('closed')).reason,'unreachable');
  }finally{server.close();server.closeAllConnections?.();}
});
