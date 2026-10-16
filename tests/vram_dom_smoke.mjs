#!/usr/bin/env node
/**
 * ROM-free DOM/Canvas event smoke for the exact emitted offline V1.2 page.
 *
 * Not a browser screenshot. Runs the real generated JS and its pixel
 * pipeline against a minimal deterministic Canvas test double. This catches
 * runtime errors after Node --check and ensures reset reproduces the initial
 * 256x240 framebuffer. Actual rendering requires user-local ROM/browser.
 */
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import vm from 'node:vm';

if(process.argv.length!==3)
  throw new Error('Usage: node tests/vram_dom_smoke.mjs <generated-fixture-vram-scene.html>');
const html=readFileSync(process.argv[2],'utf8');
const scripts=[...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(x=>x[1]);
assert.equal(scripts.length,1,'Expected exactly one self-contained inline script');
function genericNode(){
  const callbacks={};
  return {
    value:'',checked:false,textContent:'',
    callbacks,children:[],
    addEventListener(type,callback){callbacks[type]=callback;},
    appendChild(child){this.children.push(child);return child;},
    click(){if(callbacks.click)callbacks.click();},
  };
}
function mockCanvas(){
  const node=genericNode();
  node.width=256;node.height=240;
  node.getContext=()=>{
    if(!node.ctx)node.ctx={
      lastPixels:null,
      createImageData(w,h){
        assert.equal(w,256);assert.equal(h,240);
        return {width:w,height:h,data:new Uint8ClampedArray(w*h*4)};
      },
      putImageData(image,x,y){
        assert.equal(x,0);assert.equal(y,0);
        this.lastPixels=new Uint8ClampedArray(image.data);
      },
    };
    return node.ctx;
  };
  node.toDataURL=()=>{throw Error('Unexpected PNG download in smoke test');};
  return node;
}
const widgets=new Map();
for(const id of ['sx','sy','tile','color','spriteX','sprite',
  'fg','flip','before','after','saveBefore','saveAfter',
  'count','scrollInfo','diff','apply','reset','notice',
  'sxLabel','syLabel','tileLabel','colorLabel','spriteXLabel','spriteLabel']){
  widgets.set(id,id==='before'||id==='after'?mockCanvas():genericNode());
}
for(const [k,v] of Object.entries({
  sx:'72',sy:'32',tile:'0',color:'3',spriteX:'158',sprite:'0',
}))widgets.get(k).value=v;
const document={
  getElementById(id){
    assert.ok(widgets.has(id),'Unexpected missing DOM widget '+id);
    return widgets.get(id);
  },
  createElement(){return genericNode();},
};
const sandbox={
  document,atob:globalThis.atob,Uint8Array,Uint8ClampedArray,
  console,RangeError,Error,Number,Math,JSON,
};
vm.runInNewContext(scripts[0],sandbox,{timeout:30000,filename:'generated-v1.2-inline-script.js'});
const before=widgets.get('before').ctx?.lastPixels;
const after=widgets.get('after').ctx?.lastPixels;
assert.ok(before instanceof Uint8ClampedArray&&before.length===256*240*4,
  'Initial before canvas was not rendered');
assert.ok(after instanceof Uint8ClampedArray&&after.length===256*240*4,
  'Initial after canvas was not rendered');
const digest=buf=>createHash('sha256').update(buf).digest('hex');
assert.notEqual(digest(before),digest(after),
  'Initial MMIO scroll+tile+sprite edit must create visible pixel delta');
assert.match(widgets.get('count').textContent,/bytes alterados/);
assert.ok(widgets.get('diff').children.length>0,'No RAM/MMIO delta rows shown');

widgets.get('sx').value='160';
widgets.get('sy').value='48';
widgets.get('apply').click();
const modified=widgets.get('after').ctx.lastPixels;
assert.notEqual(digest(after),digest(modified),
  'Changing scroll must update framebuffer AFTER another explicit apply');

widgets.get('reset').click();
const reverted=widgets.get('after').ctx.lastPixels;
assert.equal(digest(before),digest(reverted),
  'Reset must render exactly the same framebuffer as BEFORE');
assert.match(widgets.get('count').textContent,/0 bytes/);
assert.match(widgets.get('notice').textContent,/0 cambios/);

console.log('GNG_V1_2_DOM_PIXEL_SMOKE=PASS canvases=2 '+
  'before_after=different scroll_changes=pixels reset=identical');
console.log('GNG_VISUAL_GAMEPLAY=UNPROVEN scene=synthetic_memory_fixture');
