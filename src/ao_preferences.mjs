/** Local app preferences. Engine defaults retain historical checkpoint rules. */
import {difficultyOptions,gameOptions} from '../games/gngb/options.mjs';

export const PREFERENCES_KEY='gng-preferences';
export const INITIAL_OPTIONS=difficultyOptions('easiest',{lives:7});

export function readPreferences(storage){
  let raw=null,fire=null;
  try{
    storage??=globalThis.localStorage;
    let saved;
    try{saved=JSON.parse(storage.getItem(PREFERENCES_KEY));}catch{}
    if(saved?.version===1){raw=saved.options;fire=saved.autofire;}
    else{
      try{raw=JSON.parse(storage.getItem('gng-options'));}catch{}
      const legacy=storage.getItem('gng-autofire');
      if(legacy==='0'||legacy==='1')fire=legacy==='1';
    }
  }catch{}
  const options={...INITIAL_OPTIONS};
  for(const key of ['lives','difficulty','enemyPace','coop','character']){
    if(raw?.[key]===undefined)continue;
    try{gameOptions({...options,[key]:raw[key]});options[key]=raw[key];}catch{}
  }
  return {options:gameOptions(options),autofire:typeof fire==='boolean'?fire:true};
}

export function writePreferences(options,autofire,storage=globalThis.localStorage){
  const text=JSON.stringify({version:1,options:gameOptions(options),autofire});
  storage.setItem(PREFERENCES_KEY,text);
  if(storage.getItem(PREFERENCES_KEY)!==text)throw Error('OPTIONS_WRITE_FAILED');
}
