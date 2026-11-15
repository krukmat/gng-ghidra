#!/usr/bin/env node
/** Room relay for online two-player games (src/net_relay_client.mjs): a
 * WebSocket server (RFC 6455, no dependencies) that pairs two phones by a
 * four-letter code and forwards their messages. It knows nothing about the
 * game: messages are opaque JSON, at most MAX_MESSAGE bytes.
 *   {t:'host'}                -> {t:'room', code, token}
 *   {t:'join', code}          -> both {t:'paired', role, code, token}
 *   {t:'rejoin', code, token} -> both {t:'paired', role, code, again:true}
 *   {t:'msg', m}              -> peer {t:'msg', m}
 *   {t:'leave'}               -> peer {t:'peer-left'}; the room closes
 * A dropped socket may rejoin within REJOIN_MS ({t:'peer-gone'} meanwhile).
 * Usage: node scripts/netplay_relay.mjs [--port 8787] [--host 127.0.0.1]
 * Behind a TLS proxy for wss:// (the Android app only allows wss).
 */
import {createServer} from 'node:http';
import {createHash,randomBytes,randomInt} from 'node:crypto';
import {fileURLToPath} from 'node:url';

const GUID='258EAFA5-E914-47DA-95CA-C5AB0DC85B11';
const CODE_CHARS='ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
export const MAX_MESSAGE=65536;
const MAX_ROOMS=1000,REJOIN_MS=60000,PING_MS=20000;

function frame(opcode,payload){
  const n=payload.length,head=n<126?2:n<65536?4:10,out=Buffer.alloc(head+n);
  out[0]=0x80|opcode;
  if(n<126)out[1]=n;
  else if(n<65536){out[1]=126;out.writeUInt16BE(n,2);}
  else{out[1]=127;out.writeBigUInt64BE(BigInt(n),2);}
  payload.copy(out,head);
  return out;
}
// One client connection: masked frames in, unmasked text frames out.
function connection(socket,onText,onClose){
  let buf=Buffer.alloc(0),parts=[],closed=false,alive=true;
  const close=(code=1000)=>{
    if(closed)return;closed=true;
    const p=Buffer.alloc(2);p.writeUInt16BE(code);
    try{socket.end(frame(8,p));}catch{}
    onClose();
  };
  socket.on('data',chunk=>{
    buf=Buffer.concat([buf,chunk]);
    for(;;){
      if(buf.length<2)return;
      const fin=buf[0]&0x80,op=buf[0]&0x0f,masked=buf[1]&0x80;
      let n=buf[1]&0x7f,at=2;
      if(n===126){if(buf.length<4)return;n=buf.readUInt16BE(2);at=4;}
      else if(n===127){
        if(buf.length<10)return;
        const big=buf.readBigUInt64BE(2);
        if(big>BigInt(MAX_MESSAGE))return close(1009);
        n=Number(big);at=10;
      }
      if(!masked)return close(1002);
      if(n>MAX_MESSAGE)return close(1009);
      if(buf.length<at+4+n)return;
      const key=buf.subarray(at,at+4),data=Buffer.from(buf.subarray(at+4,at+4+n));
      for(let i=0;i<n;i++)data[i]^=key[i&3];
      buf=buf.subarray(at+4+n);
      alive=true;
      if(op===8)return close();
      if(op===9){socket.write(frame(10,data));continue;}
      if(op===10)continue;
      if(op===2||(op!==0&&op!==1))return close(1003);
      parts.push(data);
      if(parts.reduce((s,p)=>s+p.length,0)>MAX_MESSAGE)return close(1009);
      if(!fin)continue;
      const text=Buffer.concat(parts).toString('utf8');parts=[];
      onText(text);
    }
  });
  socket.on('close',()=>{if(!closed){closed=true;onClose();}});
  socket.on('error',()=>{});
  const ping=setInterval(()=>{
    if(!alive)return close(1001);
    alive=false;try{socket.write(frame(9,Buffer.alloc(0)));}catch{}
  },PING_MS);
  socket.on('close',()=>clearInterval(ping));
  return {send:text=>{if(!closed)socket.write(frame(1,Buffer.from(text)));},close};
}

export function createRelayServer({rejoinMs=REJOIN_MS}={}){
  const rooms=new Map();
  const code=()=>{
    for(;;){
      let c='';for(let i=0;i<4;i++)c+=CODE_CHARS[randomInt(CODE_CHARS.length)];
      if(!rooms.has(c))return c;
    }
  };
  const token=()=>randomBytes(16).toString('hex');
  const other=r=>r==='host'?'guest':'host';
  const drop=room=>{
    clearTimeout(room.timer);rooms.delete(room.code);
    for(const side of ['host','guest'])room[side]?.conn.close();
  };
  const server=createServer((req,res)=>{res.writeHead(426);res.end('WebSocket only\n');});
  server.on('upgrade',(req,socket)=>{
    const key=req.headers['sec-websocket-key'];
    if(req.headers.upgrade?.toLowerCase()!=='websocket'||!key||
       req.headers['sec-websocket-version']!=='13'){socket.destroy();return;}
    const accept=createHash('sha1').update(key+GUID).digest('base64');
    socket.write('HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\n'+
      'Connection: Upgrade\r\nSec-WebSocket-Accept: '+accept+'\r\n\r\n');
    socket.setNoDelay(true);
    let room=null,side=null;
    const send=m=>conn.send(JSON.stringify(m));
    const peer=()=>room?.[other(side)];
    const attach=(r,s)=>{
      room=r;side=s;r[s]={conn,send};
      if(r.left){clearTimeout(r.timer);r.left=null;}
    };
    const conn=connection(socket,text=>{
      let m;try{m=JSON.parse(text);}catch{return send({t:'error',code:'BAD_JSON'});}
      if(m?.t==='msg'){peer()?.send({t:'msg',m:m.m});return;}
      if(room&&m?.t==='leave'){
        peer()?.send({t:'peer-left'});const r=room;room=null;drop(r);return;
      }
      if(room)return send({t:'error',code:'ALREADY_IN_ROOM'});
      if(m?.t==='host'){
        if(rooms.size>=MAX_ROOMS)return send({t:'error',code:'RELAY_FULL'});
        const r={code:code(),tokens:{host:token(),guest:null},host:null,guest:null,
          left:null,timer:null};
        rooms.set(r.code,r);attach(r,'host');
        send({t:'room',code:r.code,token:r.tokens.host});
      }else if(m?.t==='join'){
        const r=rooms.get(String(m.code??'').toUpperCase());
        if(!r)return send({t:'error',code:'ROOM_NOT_FOUND'});
        if(r.tokens.guest)return send({t:'error',code:'ROOM_FULL'});
        r.tokens.guest=token();attach(r,'guest');
        for(const s of ['host','guest'])
          r[s]?.send({t:'paired',role:s,code:r.code,token:r.tokens[s]});
      }else if(m?.t==='rejoin'){
        const r=rooms.get(String(m.code??''));
        const s=r&&['host','guest'].find(x=>r.tokens[x]&&r.tokens[x]===m.token);
        if(!s)return send({t:'error',code:'REJOIN_REFUSED'});
        r[s]?.conn.close();attach(r,s);
        if(r[other(s)]){
          for(const x of ['host','guest'])r[x].send({t:'paired',role:x,code:r.code,again:true});
        }
      }else send({t:'error',code:'UNKNOWN'});
    },()=>{
      // Gone: the peer waits; the room lives until the rejoin deadline.
      if(!room||room[side]?.conn!==conn)return;
      const r=room;r[side]=null;room=null;
      r[other(side)]?.send({t:'peer-gone'});
      r.left=side;clearTimeout(r.timer);
      r.timer=setTimeout(()=>{
        r[other(side)]?.send({t:'room-closed'});drop(r);
      },rejoinMs);
    });
  });
  return {server,rooms};
}

if(process.argv[1]===fileURLToPath(import.meta.url)){
  const arg=(name,def)=>{const i=process.argv.indexOf(name);return i>0?process.argv[i+1]:def;};
  const {server}=createRelayServer();
  server.listen(Number(arg('--port',8787)),arg('--host','127.0.0.1'),()=>{
    const a=server.address();console.log('NETPLAY_RELAY listening '+a.address+':'+a.port);
  });
}
