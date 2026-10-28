/** AO-2 engine worker: the frozen AOT engine at real speed, without
 * SharedArrayBuffer. Each tick runs the frames that are due through the
 * resumable runtime (run(until)), then renders the newest fully known frame
 * and transfers its RGBA to the page. ?check=N runs N frames unpaced instead
 * and posts the SHA-256 of every rendered frame for the Node comparison.
 */
const CPU_HZ=1.5e6; // MC6809 E clock
const MAX_BEHIND=30; // frames; further behind re-anchors and counts a slip
const post=(msg,transfer=[])=>postMessage(msg,transfer);
const ports=new Uint8Array(5);

onmessage=({data})=>{
  // AO-4 sends the five input port bytes (SYSTEM, P1, P2, DSW1, DSW2).
  if(data?.type==='ports'&&data.ports?.length===5)ports.set(data.ports);
};

async function bytes(name){
  const res=await fetch(name);
  if(!res.ok)throw Error('AO_FETCH_'+res.status+' '+name);
  return new Uint8Array(await res.arrayBuffer());
}
async function start(){
  const t0=performance.now();
  const [{blocks},{createBoard,CYCLES_PER_FRAME},{renderGngbRgba},
    {rendererInputs},{rendererUnknownCount},{INPUT_DEFAULTS},
    {frozenCode,unpackGfx},{createPortReadWitness},{observeGameState}]=await Promise.all([
    import('./bundle/program.mjs'),import('./bundle/gngb_runtime.mjs'),
    import('./lib/gngb_frame_renderer.mjs'),import('./lib/gngb_render_inputs.mjs'),
    import('./lib/v2_b1_observable.mjs'),import('./lib/gngb_input_contract.mjs'),
    import('./lib/ao_web_assets.mjs'),import('./lib/v3_b2c_port_witness.mjs'),
    import('./lib/ao_game_state.mjs')]);
  const res=await fetch('bundle/manifest.json');
  if(!res.ok)throw Error('AO_FETCH_'+res.status+' manifest');
  const manifest=await res.json();
  if(!(blocks instanceof Map)||blocks.size!==manifest.blocks)
    throw Error('AO_BLOCK_COUNT_MISMATCH');
  const [codeBin,overlays,gfxBin]=await Promise.all(
    ['bundle/code.bin','bundle/overlays.bin','gfx.bin'].map(bytes));
  const code=frozenCode(manifest,codeBin,overlays),gfx=unpackGfx(gfxBin);
  ports.set(INPUT_DEFAULTS);
  const witness=createPortReadWitness();
  const readPorts=new Uint8Array(3).fill(255);
  const inputCheck=new URLSearchParams(location.search).has('inputCheck');
  let last=null,latest=null,stateKey=null,gameState=null;
  const cpu=createBoard(code,blocks,{frames:Number.MAX_SAFE_INTEGER,
    portRead:addr=>ports[addr-0x3000],
    onPortRead:read=>{witness.observe(read);readPorts[read.addr-0x3000]=read.value;},
    onFrame:frame=>{
      last=frame;
      // Same rule as the live wrapper: never draw a frame with unknown bytes.
      if(rendererUnknownCount(frame)===0)latest=frame;
      const state=observeGameState(frame);
      if(state){
        gameState=state;
        const key=JSON.stringify(state);
        if(key!==stateKey){
          stateKey=key;
          post({type:'game-state',...state});
        }
      }
      // Only the frame object is kept; the runtime never reads either log.
      cpu.state.records[frame.index-1]=null;
      cpu.state.events.length=0;
    }});
  const render=frame=>{
    const image=renderGngbRgba(rendererInputs(frame.record,
      {scroll:frame.scroll,latch:frame.latch},gfx));
    if(image.width!==256||image.height!==224||image.rgba.length!==256*224*4)
      throw Error('AO_RENDER_GEOMETRY');
    return image.rgba;
  };
  const step=until=>{
    const result=cpu.run(until);
    if(result?.status==='FRAMES_DONE')return true;
    post({type:'halt',status:result?.status??null,frame:cpu.state.records.length,
      cycle:cpu.state.C});
    return false;
  };
  post({type:'ready',loadMs:Math.round(performance.now()-t0),blocks:blocks.size});

  const check=Number(new URLSearchParams(location.search).get('check'));
  if(check>0){
    const hashes=[],c0=performance.now();
    for(let k=1;k<=check;k++){
      if(!step(k))return;
      if(latest!==last){hashes.push(null);continue;}
      const digest=await crypto.subtle.digest('SHA-256',render(latest));
      hashes.push([...new Uint8Array(digest)]
        .map(b=>b.toString(16).padStart(2,'0')).join(''));
    }
    post({type:'check',frames:check,ms:Math.round(performance.now()-c0),hashes});
    return;
  }

  const frameMs=CYCLES_PER_FRAME/CPU_HZ*1000;
  let anchor=performance.now(),done=0,shown=0,slips=0;
  let win={since:anchor,frames:0,rendered:0,cpuMs:0,renderMs:0,lateMs:0};
  const tick=()=>{
    const now=performance.now();
    win.lateMs=Math.max(win.lateMs,now-(anchor+(done+1)*frameMs));
    let due=Math.floor((now-anchor)/frameMs);
    if(due-done>MAX_BEHIND){anchor=now-done*frameMs;due=done+1;slips++;}
    const c0=performance.now();
    for(;done<due;done++){if(!step(done+1))return;win.frames++;}
    const c1=performance.now();
    win.cpuMs+=c1-c0;
    if(latest&&latest.index!==shown){
      // A fresh buffer per render: transferred, never copied.
      const rgba=render(latest);
      post({type:'frame',index:latest.index,rgba:rgba.buffer},[rgba.buffer]);
      shown=latest.index;win.rendered++;
      win.renderMs+=performance.now()-c1;
    }
    if(c1-win.since>=1000){
      post({type:'stats',t:Math.round(c1-anchor),frames:done,slips,
        windowMs:Math.round(c1-win.since),windowFrames:win.frames,
        rendered:win.rendered,cpuMs:+win.cpuMs.toFixed(2),
        renderMs:+win.renderMs.toFixed(2),lateMs:+win.lateMs.toFixed(2)});
      // Test-only observation of real CPU snapshots, never a state write.
      if(inputCheck)post({type:'input-probe',frame:done,
        witness:witness.snapshot(),ports:[...ports],reads:[...readPorts],
        ram2:last?.record[2],ram5:last?.record[5],ram23:last?.record[0x23],gameState});
      win={since:c1,frames:0,rendered:0,cpuMs:0,renderMs:0,lateMs:0};
    }
    setTimeout(guarded,Math.max(0,anchor+(done+1)*frameMs-performance.now()));
  };
  const guarded=()=>{try{tick();}catch(e){fail(e);}};
  guarded();
}
const fail=e=>post({type:'error',message:String(e?.message??e),
  code:e?.code??null,stack:String(e?.stack??'').slice(0,2000)});
start().catch(fail);
