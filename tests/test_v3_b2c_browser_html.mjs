import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {resolve,dirname} from 'node:path';

const source=readFileSync(resolve(dirname(fileURLToPath(import.meta.url)),
  '../scripts/v3_b2c_live.mjs'),'utf8');
const fixture=source.match(/const html=(`[\s\S]*?`);\r?\n/);
test('browser JS compiles AFTER the Node HTML template is evaluated',()=>{
  assert.ok(fixture,'server HTML template must exist');
  // Trusted source in a test-only parser, NOT in GnG runtime.
  const html=new Function('return '+fixture[1])();
  const script=html.match(/<script>([\s\S]*?)<\/script>/);
  assert.ok(script,'browser script must exist');
  assert.doesNotThrow(()=>new Function(script[1]));
});
test('served HTML has canvas, CPU witness and controls',()=>{
  const html=new Function('return '+fixture[1])();
  for(const id of ['screen','status','cpu-input','video-health','restart'])
    assert.ok(html.includes('id="'+id+'"'));
  const script=html.match(/<script>([\s\S]*?)<\/script>/)[1];
  for(const endpoint of ['/pixels','/state','/reset','/input'])
    assert.ok(script.includes(endpoint));
  assert.ok(script.includes('ctx.putImageData'));
  assert.ok(script.includes('renderSession===sessionId'));
});
test('frame endpoint carries consistent ID without 409 race',()=>{
  assert.match(source,/'X-GnG-Frame':String\(displayedServerFrame\)/);
  assert.match(source,/'X-GnG-Session':String\(generation\)/);
  assert.doesNotMatch(source,/FRAME_ADVANCED/);
});

test('live HTML exposes real operator Coin and Start hardware buttons',()=>{
  const html=new Function('return '+fixture[1])();
  assert.match(html,/id="coin"/);
  assert.match(html,/id="start"/);
  const js=html.match(/<script>([\s\S]*?)<\/script>/)[1];
  assert.match(js,/pulse\('coin1'\)/);
  assert.match(js,/pulse\('start1'\)/);
  assert.match(source,/CPU_HALTED_RESTART/);
});

test('the operator controls pause only at real VBlank and resume CPU',()=>{
  const html=new Function('return '+fixture[1])();
  assert.match(html,/id="continue"/);
  assert.match(html,/id="interaction-window"/);
  const script=html.match(/<script>([\s\S]*?)<\/script>/)[1];
  assert.match(script,/fetch\('\/continue'/);
  assert.match(source,/createVisibleFrameGate/);
  assert.match(source,/gate\.shouldAdvance/);
  // A real hardware coin press always invokes resumeOperator(); if that
  // release has nothing to free yet (worker still booting after /reset),
  // the intent is remembered as earlyCoinPending instead of discarded.
  assert.match(source,
    /data\.control==='coin1'&&data\.pressed&&!resumeOperator\(\)/);
  assert.match(source,/earlyCoinPending=true/);
  assert.match(source,
    /const coinHeld=heldControls\(\)\.includes\('coin1'\)\|\|earlyCoinPending;/);
  assert.match(source,/gate\.shouldAdvance\(\{index:m\.index,known:m\.known,coinHeld\}\)/);
});
test('button pulses stay inside the hold the GnG ROM credits',()=>{
  // Measured on the live engine: a 400 ms (24-frame) Coin hold leaves
  // CREDIT 0, while 100 ms and 200 ms holds give CREDIT 2 and Start
  // begins the game. Keep button pulses inside that credited window.
  const html=new Function('return '+fixture[1])();
  const js=html.match(/<script>([\s\S]*?)<\/script>/)[1];
  const hold=Number(js.match(/PULSE_MS=(\d+)/)?.[1]);
  assert.ok(hold>=100&&hold<=200,'pulse hold '+hold+' ms outside credited window');
  assert.match(js,/PULSE_GAP_MS=\d+/);
});
test('an early coin credit cannot survive into the next reset session',()=>{
  // earlyCoinPending must be cleared at the top of launch(), alongside
  // releaseAll(), so a stale credit from an abandoned session never
  // auto-releases a session the operator never put money into.
  assert.match(source,/releaseAll\(\);\s*earlyCoinPending=false;/);
});
