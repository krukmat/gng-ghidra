import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createPracticeHandoffUI}
  from '../../bot/live/practice-handoff-ui.mjs';
test('handoff UI never resumes before operator-ready freeze',async()=>{
  let resumed=0,phase='AUTOPLAY';
  const ui=createPracticeHandoffUI({port:0,
    readStatus:()=>({phase}),
    onResume:async()=>{resumed++;phase='PLAYING';}});
  const url=await ui.start();
  try{
    const page=await (await fetch(url)).text();
    assert.match(page,/Reanudar y jugar/);
    const status=await (await fetch(url+'/status')).json();
    assert.equal(status.phase,'AUTOPLAY');
    const premature=await fetch(url+'/resume',{method:'POST'});
    assert.equal(premature.status,409);
    assert.equal(resumed,0);
    phase='FROZEN';
    const ready=await fetch(url+'/resume',{method:'POST',
      headers:{origin:url}});
    assert.equal(ready.status,200);
    assert.equal(resumed,1);
    const duplicate=await fetch(url+'/resume',{method:'POST'});
    assert.equal(duplicate.status,409);
    assert.equal(resumed,1);
  }finally{await ui.close();}
});
test('cross-origin resume blocked',async()=>{
  let calls=0;
  const ui=createPracticeHandoffUI({port:0,
    readStatus:()=>({phase:'FROZEN'}),
    onResume:async()=>{calls++;}});
  const url=await ui.start();
  try{
    const r=await fetch(url+'/resume',{method:'POST',
      headers:{origin:'http://evil.example'}});
    assert.equal(r.status,403);
    assert.equal(calls,0);
  }finally{await ui.close();}
});
