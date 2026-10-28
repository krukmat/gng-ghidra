import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createTouchControls,PULSE_MS,PULSE_GAP_MS} from '../src/ao_touch_controls.mjs';

test('independent fingers, a single direction and sliding preserve held actions',()=>{
  let ports;
  const c=createTouchControls(p=>{ports=p;});c.setEnabled(true);
  assert.equal(c.hold(1,'p1.right'),true);
  assert.equal(c.hold(2,'p1.up'),false);
  c.hold(3,'p1.button1');c.hold(4,'p1.button2');
  assert.equal(ports[1],0xce);
  c.hold(1,'p1.left');assert.equal(ports[1],0xcd);
  c.release(3);assert.equal(ports[1],0xdd);
  c.release(4);c.release(1);assert.deepEqual(ports,[255,255,255,223,251]);
});
test('two fingers on one button release only after the last finger',()=>{
  let ports;const c=createTouchControls(p=>{ports=p;});c.setEnabled(true);
  c.hold(1,'p1.button1');c.hold(2,'p1.button1');c.release(1);
  assert.equal(ports[1],0xef);c.release(2);assert.equal(ports[1],255);
});
test('Coin pulses have a released gap and cancellation drops queued credits',t=>{
  t.mock.timers.enable({apis:['setTimeout']});
  let ports;const c=createTouchControls(p=>{ports=p;});c.setEnabled(true);
  c.pulse('coin1');c.pulse('coin1');assert.equal(ports[0],0xbf);
  t.mock.timers.tick(PULSE_MS);assert.equal(ports[0],255);
  t.mock.timers.tick(PULSE_GAP_MS);assert.equal(ports[0],0xbf);
  c.pulse('coin1');c.releaseAll();
  t.mock.timers.tick(2000);assert.equal(ports[0],255);
});
test('loading or a halt disables inputs and releases pending pulses',t=>{
  t.mock.timers.enable({apis:['setTimeout']});
  let ports;const c=createTouchControls(p=>{ports=p;});
  assert.equal(c.pulse('coin1'),false);assert.equal(c.hold(1,'p1.right'),false);
  c.setEnabled(true);c.pulse('start1');c.hold(1,'p1.right');
  c.setEnabled(false);t.mock.timers.tick(1000);
  assert.deepEqual(ports,[255,255,255,223,251]);
});
test('Continue pulses Start and Disparo together without releasing another finger',t=>{
  t.mock.timers.enable({apis:['setTimeout']});
  let ports;const c=createTouchControls(p=>{ports=p;});c.setEnabled(true);
  c.hold(1,'p1.button1');c.pulse('continue1');c.pulse('continue1');
  assert.equal(ports[0],0xfe);assert.equal(ports[1],0xef);
  t.mock.timers.tick(PULSE_MS);
  assert.equal(ports[0],255);assert.equal(ports[1],0xef);
  c.release(1);assert.equal(ports[1],255);
  t.mock.timers.tick(PULSE_GAP_MS);
  assert.equal(ports[0],0xfe);assert.equal(ports[1],0xef);
  c.releaseAll();t.mock.timers.tick(2000);
  assert.deepEqual(ports,[255,255,255,223,251]);
});
