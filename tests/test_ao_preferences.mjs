import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readPreferences,writePreferences,PREFERENCES_KEY} from '../src/ao_preferences.mjs';
const storage=(entries={})=>({getItem:key=>entries[key]??null,setItem:(key,value)=>{entries[key]=value;}});
test('fresh app uses screenshot settings while legacy engine defaults remain separate',()=>{
  assert.deepEqual(readPreferences(storage()),{
    options:{difficulty:'easy',enemyPace:50,lives:7},autofire:true});
});
test('legacy fields migrate independently and explicit disabled autofire survives',()=>{
  const old=storage({'gng-options':JSON.stringify({lives:5,difficulty:'hard',enemyPace:75,coop:true}),
    'gng-autofire':'0'});
  const preferences=readPreferences(old);
  writePreferences(preferences.options,preferences.autofire,old);
  assert.deepEqual(readPreferences(old),preferences);
  assert.equal(preferences.autofire,false);
  assert.equal(preferences.options.lives,5);
  assert.equal(preferences.options.coop,true);
});
test('invalid fields and inaccessible storage recover usable preferences',()=>{
  const saved=storage({[PREFERENCES_KEY]:JSON.stringify({version:1,options:{lives:4,difficulty:'bad'},autofire:false})});
  assert.equal(readPreferences(saved).options.lives,4);
  assert.equal(readPreferences(saved).options.difficulty,'easy');
  assert.equal(readPreferences({getItem(){throw Error('denied');}}).autofire,true);
  assert.throws(()=>writePreferences(readPreferences(saved).options,true,{setItem(){throw Error('quota');}}));
});

test('a damaged preference record can recover valid legacy choices',()=>{
  const old=storage({[PREFERENCES_KEY]:'broken','gng-options':'{"lives":5}',
    'gng-autofire':'0'});
  assert.equal(readPreferences(old).options.lives,5);
  assert.equal(readPreferences(old).autofire,false);
});
