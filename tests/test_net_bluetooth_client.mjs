import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createBluetoothClient,pairedDevices,bluetoothStatus}
  from '../src/net_bluetooth_client.mjs';

// The shell's bridge as BluetoothLine.kt exposes it; events go out by hand.
function shell({start=true,status={state:'disconnected'}}={}){
  const scope={},sent=[],calls=[];
  scope.ShellBluetooth={
    status:()=>JSON.stringify({type:'status',role:'none',detail:'',available:true,...status}),
    pairedDevices:()=>JSON.stringify([{name:'Tablet',address:'AA:BB:CC:DD:EE:01'},
      {name:null,address:'AA:BB:CC:DD:EE:02'},{address:5},null]),
    host:()=>{calls.push('host');return start;},
    join:a=>{calls.push('join '+a);return start;},
    send:line=>{sent.push(line);return true;},
    disconnect:()=>calls.push('disconnect'),
  };
  const idle=()=>{};scope.__shellBluetooth=idle;
  const fire=e=>scope.__shellBluetooth(e);
  return {scope,sent,calls,idle,fire,bridge:scope.ShellBluetooth};
}
const open=s=>{
  const events=[];
  const c=createBluetoothClient({bridge:s.bridge,scope:s.scope,onEvent:e=>events.push(e)});
  return {c,events,types:()=>events.map(e=>e.type)};
};

test('host: waits, pairs, exchanges JSON lines and hears the peer leave',()=>{
  const s=shell(),{c,events,types}=open(s);
  c.host();
  s.fire({type:'status',role:'host',state:'waiting'});
  c.send({type:'early'}); // not connected yet: nothing goes out
  s.fire({type:'status',role:'host',state:'connected'});
  s.fire({type:'status',role:'host',state:'connected'}); // a repeat pairs once
  c.send({type:'hello',n:1});
  s.fire({type:'line',line:'{"type":"hello-ok"}'});
  s.fire({type:'status',role:'none',state:'disconnected'});
  s.fire({type:'line',line:'{"late":true}'}); // after the end: ignored
  assert.deepEqual(types(),['waiting','paired','message','peer-left']);
  assert.deepEqual(events[1],{type:'paired',role:'host'});
  assert.deepEqual(events[2].message,{type:'hello-ok'});
  assert.deepEqual(s.sent,['{"type":"hello","n":1}']);
  assert.deepEqual(s.calls,['host']);
  assert.equal(s.scope.__shellBluetooth,s.idle,'the page handler is back');
});

test('guest: a refused start, a bad line and a lost link end with a reason',()=>{
  let s=shell({start:false,status:{state:'permission-required'}}),o=open(s);
  o.c.join('AA:BB:CC:DD:EE:01');
  assert.deepEqual(o.events,[{type:'closed',reason:'permission'}]);
  assert.deepEqual(s.calls,['join AA:BB:CC:DD:EE:01']);

  s=shell({start:false,status:{state:'error',detail:'BLUETOOTH_OFF'}});o=open(s);
  o.c.host();
  assert.deepEqual(o.events,[{type:'closed',reason:'bluetooth-off'}]);

  s=shell();o=open(s);o.c.join('AA:BB:CC:DD:EE:01');
  s.fire({type:'status',role:'guest',state:'connecting'});
  s.fire({type:'status',role:'none',state:'error',detail:'LINK_LOST'});
  assert.deepEqual(o.events.map(e=>e.reason??e.type),['connecting','bt-unreachable']);

  s=shell();o=open(s);o.c.join('AA:BB:CC:DD:EE:01');
  s.fire({type:'status',role:'guest',state:'connected'});
  s.fire({type:'line',line:'not json'});
  assert.deepEqual(o.events.at(-1),{type:'closed',reason:'protocol'});
  assert.deepEqual(s.calls,['join AA:BB:CC:DD:EE:01','disconnect']);

  s=shell();o=open(s);o.c.join('AA:BB:CC:DD:EE:01');
  s.fire({type:'status',role:'guest',state:'connected'});
  s.fire({type:'status',role:'none',state:'error',detail:'LINK_LOST'});
  assert.deepEqual(o.events.at(-1),{type:'closed',reason:'lost'});
});

test('leave disconnects once and stays quiet; devices and status are checked',()=>{
  const s=shell(),{c,events}=open(s);
  c.host();c.leave();c.leave();
  s.fire({type:'status',role:'none',state:'disconnected'});
  assert.deepEqual(events,[]);
  assert.deepEqual(s.calls,['host','disconnect']);
  assert.equal(s.scope.__shellBluetooth,s.idle);
  assert.deepEqual(pairedDevices(s.bridge),[{name:'Tablet',address:'AA:BB:CC:DD:EE:01'},
    {name:'Android',address:'AA:BB:CC:DD:EE:02'}]);
  assert.deepEqual(pairedDevices({pairedDevices:()=>'oops'}),[]);
  assert.equal(bluetoothStatus(s.bridge).state,'disconnected');
  assert.equal(bluetoothStatus({status:()=>{throw Error('gone');}}),null);
  assert.throws(()=>createBluetoothClient({onEvent:()=>{},bridge:null}),/NET_BLUETOOTH_UNAVAILABLE/);
});

// The Android template: secure RFCOMM to paired devices, connect permission
// only (no network), the bridge registered under the name the page looks for.
test('Android template: Bluetooth permissions and bridge',()=>{
  const base='base/templates/android/app/src/main/';
  const manifest=readFileSync(new URL('../'+base+'AndroidManifest.xml',import.meta.url),'utf8');
  const line=readFileSync(new URL('../'+base+'java/org/rommigration/shell/BluetoothLine.kt',
    import.meta.url),'utf8');
  const activity=readFileSync(new URL('../'+base+'java/org/rommigration/shell/MainActivity.kt',
    import.meta.url),'utf8');
  assert.match(manifest,/android\.permission\.BLUETOOTH_CONNECT"/);
  assert.match(manifest,/android\.permission\.BLUETOOTH" android:maxSdkVersion="30"/);
  assert.match(manifest,/android\.hardware\.bluetooth" android:required="false"/);
  assert.match(manifest,/android:usesCleartextTraffic="false"/);
  for(const absent of ['INTERNET','BLUETOOTH_SCAN','BLUETOOTH_ADVERTISE','LOCATION'])
    assert.doesNotMatch(manifest,new RegExp(absent));
  assert.match(line,/listenUsingRfcommWithServiceRecord/);
  assert.match(line,/createRfcommSocketToServiceRecord/);
  assert.doesNotMatch(line,/Insecure|startDiscovery/);
  assert.match(activity,/addJavascriptInterface\(bluetooth, "ShellBluetooth"\)/);
  assert.match(activity,/bluetooth\.shutdown\(\)/);
});
