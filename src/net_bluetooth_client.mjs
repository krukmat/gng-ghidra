/** The Android shell's Bluetooth line channel (base template BluetoothLine.kt,
 * window.ShellBluetooth) as events for the two-phone flow (app.mjs):
 *   waiting, connecting, paired {role}, message {message},
 *   peer-left {reason}, closed {reason}.
 * Lines are JSON. No rejoin: a dropped link ends the session. A phone that
 * leaves sends a goodbye line first, so the other one hears peer-left: on a
 * real radio the link's close alone reads as a lost link. While no client is
 * open, the shell's events go to the page's own handler (the one found in
 * __shellBluetooth when the client was created).
 */
// The link's own goodbye: the app's messages never use this type.
const BYE=JSON.stringify({type:'bye'});
/** How long a leaving phone keeps the link for its goodbye line to go out. */
export const BYE_MS=300;
let newest=0; // an older client's late close must not cut a newer link
export const bluetoothBridge=(scope=globalThis)=>scope.ShellBluetooth??null;

export function bluetoothStatus(bridge){
  try{return JSON.parse(bridge.status());}catch{return null;}
}
export function pairedDevices(bridge){
  try{
    const list=JSON.parse(bridge.pairedDevices());
    return Array.isArray(list)?list.filter(d=>typeof d?.address==='string')
      .map(d=>({name:String(d.name??'Android'),address:d.address})):[];
  }catch{return [];}
}
// Why the shell could not start or keep a link.
const reasonOf=(status,connected)=>status?.state==='permission-required'?'permission':
  status?.state==='unavailable'?'unavailable':status?.detail==='BLUETOOTH_OFF'?
  'bluetooth-off':connected?'lost':'bt-unreachable';

export function createBluetoothClient({onEvent,bridge=bluetoothBridge(),scope=globalThis}){
  if(typeof onEvent!=='function')throw Error('NET_BLUETOOTH_HANDLER_MISSING');
  if(!bridge)throw Error('NET_BLUETOOTH_UNAVAILABLE');
  const idle=scope.__shellBluetooth,id=++newest;
  let connected=false,closed=false;
  const emit=(type,data={})=>onEvent({type,...data});
  const finish=(type,data)=>{
    if(closed)return;
    closed=true;scope.__shellBluetooth=idle;emit(type,data);
  };
  scope.__shellBluetooth=e=>{
    if(closed||!e)return;
    if(e.type==='line'){
      let message;
      try{message=JSON.parse(e.line);}catch{bridge.disconnect();return finish('closed',{reason:'protocol'});}
      if(message?.type==='bye'){bridge.disconnect();return finish('peer-left',{reason:'peer-left'});}
      return emit('message',{message});
    }
    if(e.type!=='status')return;
    if(e.state==='waiting')emit('waiting');
    else if(e.state==='connecting')emit('connecting');
    else if(e.state==='connected'){
      if(!connected){connected=true;emit('paired',{role:e.role});}
    }else if(e.state==='disconnected')
      finish(connected?'peer-left':'closed',{reason:connected?'peer-left':'cancelled'});
    else finish('closed',{reason:reasonOf(e,connected)});
  };
  const started=ok=>{if(!ok)finish('closed',{reason:reasonOf(bluetoothStatus(bridge),false)});};
  return {
    host:()=>started(bridge.host()),
    join:address=>started(bridge.join(String(address))),
    // A refused line means the link is going: its status event follows.
    send(m){if(connected&&!closed)bridge.send(JSON.stringify(m));},
    leave(){
      if(closed)return;
      closed=true;scope.__shellBluetooth=idle;
      if(!connected){try{bridge.disconnect();}catch{}return;}
      try{bridge.send(BYE);}catch{}
      setTimeout(()=>{if(id===newest)try{bridge.disconnect();}catch{}},BYE_MS);
    },
  };
}
