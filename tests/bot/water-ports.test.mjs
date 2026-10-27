import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createWaterPortAdapter} from '../../bot/control/water-ports.mjs';

test('P1 action transitions emit no unrelated controls',()=>{
  const a=createWaterPortAdapter();
  assert.deepEqual(a.step({session:'a',phase:'APPROACH',action:'right'}).commands,
    [{control:'p1.right',pressed:true}]);
  assert.deepEqual(a.step({session:'a',phase:'APPROACH',action:'right'}).commands,[]);
  assert.deepEqual(a.step({session:'a',phase:'TAKEOFF',action:'right_jump'}).commands,
    [{control:'p1.button2',pressed:true}]);
  assert.deepEqual(a.step({session:'a',phase:'AIRBORNE',action:'right'}).commands,
    [{control:'p1.button2',pressed:false}]);
  assert.deepEqual(a.step({session:'a',phase:'WAIT',action:'neutral'}).commands,
    [{control:'p1.right',pressed:false}]);
});

test('STOP releases held inputs and latches until explicit reset',()=>{
  const a=createWaterPortAdapter();
  a.step({session:'a',phase:'TAKEOFF',action:'right_jump'});
  assert.deepEqual(a.step({session:'a',phase:'STOP',action:'neutral'}).commands,
    [{control:'p1.right',pressed:false},{control:'p1.button2',pressed:false}]);
  assert.equal(a.step({session:'a',phase:'APPROACH',action:'right'}).status,
    'RESET_REQUIRED');
  a.reset();
  assert.equal(a.step({session:'a',phase:'APPROACH',action:'right'}).commands[0].pressed,true);
});

test('session transition releases controls and never re-presses automatically',()=>{
  const a=createWaterPortAdapter();a.step({session:'a',phase:'APPROACH',action:'right'});
  assert.deepEqual(a.step({session:'b',phase:'APPROACH',action:'right'}).commands,
    [{control:'p1.right',pressed:false}]);
  assert.equal(a.step({session:'b',phase:'APPROACH',action:'right'}).status,
    'RESET_REQUIRED');
});

test('explicit reset returns any pending release commands',()=>{
  const a=createWaterPortAdapter();
  a.step({session:'a',phase:'TAKEOFF',action:'right_jump'});
  assert.deepEqual(a.reset(),[
    {control:'p1.right',pressed:false},{control:'p1.button2',pressed:false},
  ]);
});

test('rejects unexpected action; outside scope releases input to parent',()=>{
  const a=createWaterPortAdapter();
  assert.throws(()=>a.step({session:'a',phase:'APPROACH',action:'coin1'}),/PORT_ACTION/);
  a.step({session:'a',phase:'APPROACH',action:'right'});
  assert.equal(a.step({session:'a',phase:'OUTSIDE_ZONE',action:'neutral'}).commands[0].pressed,false);
});
