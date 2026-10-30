import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {createSession} from '../boards/gng/index.mjs';
import {verifyInput,assertProgramMatches} from '../games/gngb/index.mjs';
import {gngbCodeImage} from '../games/gngb/code-image.mjs';

// ROM-free: the recipe entry point rejects foreign recipes, inexact regions
// and an AOT program that was not built from the given program regions.
const sizes={gg4:0x4000,gg3:0x8000,gg5:0x8000,gg2:0x8000};
const regions=Object.fromEntries(Object.entries(sizes).map(([id,n],k)=>
  [id,Uint8Array.from({length:n},(_,i)=>(i*31+k*7)&0xff)]));
const sha=b=>createHash('sha256').update(b).digest('hex');
const recipe={schema:'rom-migration.project.v1',id:'gngb',
  cpu:{main:'mc6809',sound:'z80'},
  board:{id:'gng',module:'boards/gng/index.mjs'},
  game:{id:'gngb',module:'games/gngb/index.mjs'},
  binary:{kind:'zip',revision:'gngb',regions:Object.entries(regions).map(([id,b])=>
    ({id,entry:id+'.bin',bytes:b.length,sha256:sha(b)}))},
  devices:['ym2203'],platforms:['web','android'],scenarios:['cold-start-120'],
  requirements:{mc6809:{overlays:true,interrupts:['irq']},
    z80:{dynamicCode:true,interrupts:['irq']}}};
const code=gngbCodeImage(name=>regions[name.replace('.bin','')]);
const program={code,blocks:new Map()},devices={ym2203:new Uint8Array(1)};

test('accepts exactly the recipe regions',async()=>{
  const input=await verifyInput(recipe,regions);
  assert.equal(input.revision,'gngb');
  assert.deepEqual(Object.keys(input.regions).sort(),['gg2','gg3','gg4','gg5']);
  const bad={...regions,gg2:regions.gg2.slice()};bad.gg2[5]^=1;
  await assert.rejects(verifyInput(recipe,bad),/GNGB_INPUT_REGION_MISMATCH gg2/);
  const {gg5,...missing}=regions;
  await assert.rejects(verifyInput(recipe,missing),/GNGB_INPUT_REGION_SET/);
  await assert.rejects(verifyInput(recipe,{...regions,extra:new Uint8Array(1)}),
    /GNGB_INPUT_REGION_SET/);
  await assert.rejects(verifyInput({...recipe,game:{...recipe.game,id:'other'}},regions),
    /GNGB_INPUT_RECIPE_MISMATCH/);
});

test('binds the AOT program to the program regions',()=>{
  assertProgramMatches(code,regions);
  const banks=code.banks.slice();banks[0x2000]^=1;
  assert.throws(()=>assertProgramMatches({...code,banks},regions),
    /GNGB_PROGRAM_REGION_MISMATCH/);
});

test('entry point fails before composition',async()=>{
  await assert.rejects(createSession({...recipe,board:{id:'other',
    module:'boards/other/index.mjs'}},regions,{program,devices}),/GNG_RECIPE_UNSUPPORTED/);
  await assert.rejects(createSession({...recipe,devices:[]},regions,{program,devices}),
    /GNG_RECIPE_UNSUPPORTED/);
  await assert.rejects(createSession({...recipe,schema:'x'},regions,{program,devices}),
    /MIGRATION_RECIPE_INVALID/);
  await assert.rejects(createSession(recipe,regions,{program}),/GNG_SESSION_CONFIG_INVALID/);
  const fixed=code.fixed.slice();fixed[0x8000]^=1;
  await assert.rejects(createSession(recipe,regions,{program:{...program,
    code:{...code,fixed}},devices}),/GNGB_PROGRAM_REGION_MISMATCH/);
});
