/** Turn-token netplay for games whose two players alternate on one set of
 * controls (GnG upright). Both peers run the same program from reset with
 * the same options; the host is P1, the guest P2.
 *
 * The peer whose player has the turn owns the inputs: its engine reads its
 * own controls and, after every frame, sends the port changes it read (the
 * port recorder's [port, cycle, value]) for that frame. The other engine
 * reads the same ports at the same cycles from that stream (`read`) and may
 * not run a frame the owner has not sent (`canRun`). The owner of the next
 * frame follows from the RAM at the end of the current one (`ownerAfter`,
 * from the game integration), so both peers pass the token at the same
 * frame. Every `hashEvery` frames both peers send a hash of work RAM; a
 * mismatch ends the session ('desync').
 *
 * Messages are plain JSON. Each carries the sender's sequence number `s` and
 * the highest sequence received in order `a`; what the peer has not acked is
 * kept and `resend()` sends it again after a reconnect. No DOM, no worker:
 * the engine worker and the Node tests drive it.
 */
// v2: the options may carry `coop`, which a v1 phone would drop and desync.
// v3: the host's options may name the character (games/gngb/options.mjs);
// an older guest would drop it and draw Arthur.
export const NET_PROTOCOL='gng.netplay.v3';
export const HASH_EVERY=60;
const ACK_EVERY=30; // a follower acks at least this often

/** FNV-1a of work RAM (the frame record's first 0x1e00 bytes). */
export function ramHash(record,bytes=0x1e00){
  let h=0x811c9dc5;
  for(let i=0;i<bytes;i++){h^=record[i];h=Math.imul(h,0x01000193);}
  return (h>>>0).toString(16).padStart(8,'0');
}

/** Port values through time, own and remote changes alike; reads only move
 * forward, as one deterministic run does. */
export function createPortHistory(defaults){
  const per=[...defaults].map(v=>({list:[[-1,v]],at:0}));
  return {
    push([port,cycle,value]){
      const p=per[port];
      if(!p||!Number.isSafeInteger(cycle)||cycle<0||!Number.isInteger(value)||
         value<0||value>255)throw Error('NET_CHANGE_INVALID');
      if(cycle<p.list.at(-1)[0])throw Error('NET_CHANGE_ORDER');
      p.list.push([cycle,value]);
    },
    read(port,cycle){
      const p=per[port];
      if(!p)throw Error('NET_PORT_INVALID');
      while(p.at+1<p.list.length&&p.list[p.at+1][0]<=cycle)p.at++;
      if(p.at>256){p.list.splice(0,p.at);p.at=0;}
      return p.list[p.at][1];
    },
  };
}

export function createTurnSession({role,ownerAfter,send,defaults,
  hashEvery=HASH_EVERY,hashOf=ramHash,onEvent=()=>{}}){
  if(role!=='host'&&role!=='guest')throw Error('NET_ROLE_INVALID');
  if(typeof ownerAfter!=='function'||typeof send!=='function')
    throw Error('NET_SESSION_INVALID');
  const history=createPortHistory(defaults);
  let owner='host',done=0,through=0,ended=null;
  let seq=0,received=0,ackedOut=0;
  const unacked=[],early=new Map(),hashes=new Map();
  const end=(reason,detail={})=>{
    if(ended)return;
    ended={reason,...detail};onEvent({type:'end',...ended});
  };
  const out=m=>{
    if(ended)return;
    m.s=++seq;m.a=received;ackedOut=received;unacked.push(m);send(m);
  };
  const ack=a=>{while(unacked.length&&unacked[0].s<=a)unacked.shift();};
  const compare=(frame,side,h)=>{
    const x=hashes.get(frame)??{};x[side]=h;
    if(x.mine!==undefined&&x.theirs!==undefined){
      hashes.delete(frame);
      if(x.mine!==x.theirs)end('desync',{frame,mine:x.mine,theirs:x.theirs});
    }else hashes.set(frame,x);
  };
  const apply=m=>{
    if(m.t==='in'){
      // Only the owner of those frames sends them, after the last confirmed.
      if(!Number.isSafeInteger(m.f)||m.f<=through||!Array.isArray(m.c))
        return end('protocol',{what:'in'});
      try{for(const c of m.c)history.push(c);}
      catch(e){return end('protocol',{what:e.message});}
      through=m.f;
    }else if(m.t==='hash')compare(m.f,'theirs',m.h);
    else if(m.t==='bye')end('peer-left');
  };
  return {
    get role(){return role;},
    get owner(){return owner;},
    get ended(){return ended;},
    /** This peer's controls drive the next frame. */
    owns:()=>owner===role,
    /** Frame `frame` (the next one) may run now. */
    canRun:frame=>!ended&&(owner===role||frame<=through),
    /** Port value of a remote-owned frame (port 0-based). */
    read:(port,cycle)=>history.read(port,cycle),
    /** After frame `frame` ran: `ram` its record, `changes` the reads the
     * port recorder kept during it. */
    frameEnd(frame,ram,changes){
      if(frame!==done+1)throw Error('NET_FRAME_ORDER');
      done=frame;
      if(owner===role){
        for(const c of changes)history.push(c);
        out({t:'in',f:frame,c:changes});
      } // else the reads came from the history: changes repeat it.
      if(frame%hashEvery===0){
        // Sent before comparing: the peer needs it to see a mismatch too.
        const h=hashOf(ram);out({t:'hash',f:frame,h});compare(frame,'mine',h);
      }
      const next=ownerAfter(ram);
      if(next!==owner){owner=next;onEvent({type:'owner',owner,frame});}
    },
    receive(m){
      if(ended||m===null||typeof m!=='object')return;
      if(Number.isSafeInteger(m.a))ack(m.a);
      if(m.t==='ack'||!Number.isSafeInteger(m.s)||m.s<=received)return;
      if(m.s>received+1){early.set(m.s,m);return;}
      apply(m);received=m.s;
      while(!ended&&early.has(received+1)){
        const n=early.get(received+1);early.delete(n.s);apply(n);received=n.s;
      }
      if(received-ackedOut>=ACK_EVERY){ackedOut=received;send({t:'ack',a:received});}
    },
    /** After a reconnect: what the peer has not acked, in order. */
    resend(){for(const m of unacked){m.a=received;send(m);}},
    leave(){if(!ended){send({t:'bye',s:seq+1,a:received});end('left');}},
    stats:()=>({role,owner,done,through,unacked:unacked.length,received,seq}),
  };
}
