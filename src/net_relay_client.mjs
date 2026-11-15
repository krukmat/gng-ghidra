/** Client of the room relay (scripts/netplay_relay.mjs) for browsers and
 * Node 22 (global WebSocket). Events go to onEvent({type, ...}):
 *   room {code}, paired {role, code, again}, message {message},
 *   reconnecting, peer-gone, peer-left {reason}, error {code}, closed {reason}.
 * After a dropped socket it rejoins the same room with its token, a few
 * times; messages sent while down are lost (the netplay session resends what
 * the peer did not ack once 'paired' comes back with again: true).
 */
export function createRelayClient(url,{onEvent,WebSocketImpl=globalThis.WebSocket,
  retryMs=[500,1000,2000,4000,8000,15000,30000]}={}){
  if(typeof onEvent!=='function')throw Error('NET_RELAY_HANDLER_MISSING');
  let ws=null,room=null,open=false,closed=false,retries=0;
  const pending=[];
  const emit=(type,data={})=>onEvent({type,...data});
  const raw=m=>ws.send(JSON.stringify(m));
  const queue=m=>{if(open)raw(m);else pending.push(m);};
  const finish=reason=>{if(!closed){closed=true;emit('closed',{reason});}};
  function handle(m){
    if(m?.t==='room'){room={code:m.code,token:m.token,role:'host'};emit('room',{code:m.code});}
    else if(m?.t==='paired'){
      room={code:m.code,token:m.token??room?.token,role:m.role};
      emit('paired',{role:m.role,code:m.code,again:!!m.again});
    }else if(m?.t==='msg')emit('message',{message:m.m});
    else if(m?.t==='peer-gone')emit('peer-gone');
    else if(m?.t==='peer-left'||m?.t==='room-closed')emit('peer-left',{reason:m.t});
    else if(m?.t==='error')emit('error',{code:m.code});
  }
  function connect(){
    try{ws=new WebSocketImpl(url);}catch{return finish('bad-url');}
    ws.onopen=()=>{
      open=true;retries=0;
      if(room?.token)raw({t:'rejoin',code:room.code,token:room.token});
      for(const m of pending.splice(0))raw(m);
    };
    ws.onmessage=e=>{let m;try{m=JSON.parse(e.data);}catch{return;}handle(m);};
    // Browsers follow an error with close; Node 22 may not on a refused link.
    let gone=false;
    ws.onerror=()=>{if(!open)ws.onclose();};
    ws.onclose=()=>{
      if(gone)return;gone=true;
      const was=open;open=false;
      if(closed)return;
      if(!room?.token)return finish(was?'lost':'unreachable');
      if(retries>=retryMs.length)return finish('lost');
      emit('reconnecting');
      setTimeout(()=>{if(!closed)connect();},retryMs[retries++]);
    };
  }
  connect();
  return {
    host:()=>queue({t:'host'}),
    join:code=>queue({t:'join',code:String(code).trim().toUpperCase()}),
    send:m=>{if(open)raw({t:'msg',m});},
    leave(){
      if(closed)return;closed=true;
      try{if(open)raw({t:'leave'});ws.close();}catch{}
    },
    get room(){return room;},
  };
}
