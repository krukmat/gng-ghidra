/** Data-level project and lock contracts. No game or board imports. */
export const CONTRACT_VERSION='rom-migration.contracts.v1';
const fail=(code)=>{throw Error('MIGRATION_'+code);};
const obj=x=>x!==null&&typeof x==='object'&&!Array.isArray(x);
const name=x=>typeof x==='string'&&/^[a-z][a-z0-9_-]*$/.test(x);
const moduleRef=x=>typeof x==='string'&&/^(?:boards|games)\/[a-z][a-z0-9_/-]*\.mjs$/.test(x)&&!x.includes('//');
const hash=x=>typeof x==='string'&&/^[0-9a-f]{64}$/.test(x);
const revision=x=>typeof x==='string'&&/^[0-9a-f]{40}$/.test(x);

export function validateRecipe(r){
  if(!obj(r)||r.schema!=='rom-migration.project.v1'||!name(r.id)||
     !obj(r.cpu)||!name(r.cpu.main)||
     Object.values(r.cpu).some(x=>!name(x))||
     !obj(r.board)||!name(r.board.id)||
     !moduleRef(r.board.module)||!obj(r.game)||!name(r.game.id)||
     !moduleRef(r.game.module)||!obj(r.binary)||!name(r.binary.revision)||
     !['zip','flat'].includes(r.binary.kind)||!Array.isArray(r.binary.regions)||
     r.binary.regions.length===0||!Array.isArray(r.platforms)||
     r.platforms.length===0||r.platforms.some(x=>!['web','android'].includes(x))||
     !Array.isArray(r.devices)||r.devices.some(x=>!name(x))||
     !Array.isArray(r.scenarios)||r.scenarios.some(x=>!name(x))||
     !obj(r.requirements))
    fail('RECIPE_INVALID');
  const seen=new Set();
  for(const region of r.binary.regions){
    if(!obj(region)||!name(region.id)||seen.has(region.id)||
       !Number.isSafeInteger(region.bytes)||region.bytes<1||
       !hash(region.sha256)||
       (region.entry!==undefined&&(r.binary.kind!=='zip'||
         typeof region.entry!=='string'||!/^[\w./-]+$/.test(region.entry)||
         region.entry.split('/').some(s=>s===''||s==='.'||s==='..')))||
       (region.offset!==undefined&&(r.binary.kind!=='flat'||
         !Number.isSafeInteger(region.offset)||region.offset<0)))
      fail('REGION_INVALID');
    seen.add(region.id);
  }
  for(const [architecture,required] of Object.entries(r.requirements)){
    if(!name(architecture)||!Object.values(r.cpu).includes(architecture)||
       !obj(required)||
       (required.overlays!==undefined&&typeof required.overlays!=='boolean')||
       (required.dynamicCode!==undefined&&typeof required.dynamicCode!=='boolean')||
       (required.interrupts!==undefined&&(!Array.isArray(required.interrupts)||
         required.interrupts.some(x=>!name(x))))||
       (required.instructions!==undefined&&(!Array.isArray(required.instructions)||
         required.instructions.some(x=>!name(x)))))fail('REQUIREMENTS_INVALID');
  }
  return r;
}

export function validateLock(lock){
  if(!obj(lock)||lock.schema!=='rom-migration.lock.v1'||
     lock.contract!==CONTRACT_VERSION||!obj(lock.base)||
     !revision(lock.base.revision)||!obj(lock.base.components)||
     Object.keys(lock.base.components).length===0)fail('LOCK_INVALID');
  // Relative file paths; template files (Gradle, manifest, Kotlin) keep their
  // conventional names. No empty, '.' or '..' segment can leave the base.
  for(const [path,digest] of Object.entries(lock.base.components))
    if(!/^[a-z][A-Za-z0-9_./-]*\.(?:mjs|js|json|wasm|cpp|h|kt|kts|xml)$/.test(path)||
       path.split('/').some(s=>s===''||s==='.'||s==='..')||!hash(digest))
      fail('LOCK_COMPONENT_INVALID');
  return lock;
}

/** Fail before composition when a fixed base lacks required capabilities. */
export function assertCompatible(recipe,lock,provided){
  validateRecipe(recipe);validateLock(lock);
  if(!obj(provided)||provided.contract!==CONTRACT_VERSION||
     !obj(provided.cpu))fail('CAPABILITIES_MISSING');
  for(const architecture of Object.values(recipe.cpu)){
    const cpu=provided.cpu[architecture],required=recipe.requirements[architecture]??{};
    if(!obj(cpu)||!Array.isArray(cpu.instructions)||!Array.isArray(cpu.interrupts)||
       typeof cpu.overlays!=='boolean'||typeof cpu.dynamicCode!=='boolean'||
       cpu.stopOnUnsupported!==true)fail('CAPABILITIES_MISSING');
    if(required.overlays===true&&cpu.overlays!==true)fail('OVERLAYS_UNSUPPORTED');
    if(required.dynamicCode===true&&cpu.dynamicCode!==true)
      fail('DYNAMIC_CODE_UNSUPPORTED');
    for(const irq of required.interrupts??[])
      if(!cpu.interrupts.includes(irq))fail('INTERRUPT_UNSUPPORTED');
    for(const instruction of required.instructions??[])
      if(!cpu.instructions.includes(instruction))fail('INSTRUCTION_UNSUPPORTED');
  }
  return true;
}

export function validateFrame(frame){
  if(!obj(frame)||!Number.isSafeInteger(frame.session)||frame.session<0||
     !Number.isSafeInteger(frame.sequence)||frame.sequence<0||
     !Number.isSafeInteger(frame.cycle)||frame.cycle<0||
     !Number.isSafeInteger(frame.width)||frame.width<1||
     !Number.isSafeInteger(frame.height)||frame.height<1||
     !(frame.rgba instanceof Uint8Array)||
     frame.rgba.length!==frame.width*frame.height*4)fail('FRAME_INVALID');
  return frame;
}

export function validatePcm(packet){
  if(!obj(packet)||!Number.isSafeInteger(packet.session)||packet.session<0||
     !Number.isSafeInteger(packet.sampleStart)||packet.sampleStart<0||
     !Number.isSafeInteger(packet.sampleRate)||packet.sampleRate<1||
     !(packet.samples instanceof Int16Array))fail('PCM_INVALID');
  return packet;
}

/** Exact mapping identity, independent of any game's numeric bank boundaries. */
export function validateCodeIdentity(x){
  if(!obj(x)||!name(x.space)||!name(x.context)||
     !Number.isSafeInteger(x.overlayVersion)||x.overlayVersion<0||
     !Number.isSafeInteger(x.pc)||x.pc<0)fail('CODE_IDENTITY_INVALID');
  return x;
}

/** Integer-rational clock: numerator ticks of `to` per denominator ticks of `from`. */
export function validateClock(x){
  if(!obj(x)||!name(x.from)||!name(x.to)||
     !Number.isSafeInteger(x.numerator)||x.numerator<1||
     !Number.isSafeInteger(x.denominator)||x.denominator<1)
    fail('CLOCK_INVALID');
  return x;
}
