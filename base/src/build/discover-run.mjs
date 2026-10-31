/** Run-time discovery (build time only): compile the known seeds, run each
 * project scenario, and when the run stops on code with no block, record the
 * seed the project resolves for it and continue. The project's `run(blocks)`
 * owns the board: it returns `{done: true}` or `{seed}` (it may extend its
 * code view first, e.g. a RAM overlay copied from ROM). Generated code is
 * evaluated in-process here only; the shipped program is compiled again from
 * every recorded seed.
 */
const fail=code=>{throw Error('MIGRATION_DISCOVER_'+code);};

async function load(source){
  return (await import('data:text/javascript,'+encodeURIComponent(source))).blocks;
}

export async function discoverAtRuntime({view,seeds,compile,scenarios,limit=256}){
  if(typeof compile!=='function'||!Array.isArray(scenarios))fail('CONFIG');
  const blocks=new Map(),found=[],known=new Set(seeds.map(x=>view.identity(x)));
  const add=async list=>{
    if(!list.length)return;
    for(const [k,fn] of await load(compile(list).source))
      if(!blocks.has(k))blocks.set(k,fn);
  };
  await add(seeds);
  const runs=[];
  for(const {name,run} of scenarios){
    let misses=0;
    for(;;){
      const r=await run(blocks);
      if(r?.done){runs.push({name,misses,...(r.summary??{})});break;}
      if(!r?.seed)fail('UNRESOLVED_'+name+(r?.reason?'_'+r.reason:''));
      const k=view.identity(r.seed);
      if(known.has(k)&&blocks.has(k))fail('NO_PROGRESS_'+name);
      if(++misses>limit)fail('LIMIT_'+name);
      known.add(k);found.push(r.seed);
      await add([r.seed]);
    }
  }
  return {found,runs};
}
