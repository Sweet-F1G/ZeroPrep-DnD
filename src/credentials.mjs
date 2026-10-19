import {spawn} from 'node:child_process';
import {randomUUID} from 'node:crypto';
export const keyNames=['openai','gemini','compatible','groq'];
// String envelopes keep compatibility with the existing, separately signed Keychain helper.
const prefix='skazitel-pool-v1:';
export function keyPool(keys,name){
 const value=keys[name];if(!value)return [];
 if(!value.startsWith(prefix))return [{id:'legacy-'+name,key:value}];
 const rows=JSON.parse(value.slice(prefix.length));
 if(!Array.isArray(rows)||rows.some(r=>typeof r.id!=='string'||typeof r.key!=='string'||!r.key))throw Error('Повреждён список API-ключей.');
 return rows;
}
export function effectivePool(keys,name,sharedGroq=false){
 return name==='groq'&&!Object.hasOwn(keys,'groq')&&sharedGroq?keyPool(keys,'compatible'):keyPool(keys,name);
}
export function mergeKeys(current,patch={},clear=false,pools={},sharedGroq=false){
 const next=clear?{}:{...current};
 for(const name of keyNames)if(typeof patch[name]==='string'&&patch[name].trim()){
  if(patch[name].length>4096)throw Error('API-ключ слишком длинный');
  // Existing callers can replace the primary without discarding its reserves.
  const rows=keyPool(next,name);if(rows.length)rows[0]={...rows[0],key:patch[name].trim()};
  else rows.push({id:randomUUID(),key:patch[name].trim()});
  next[name]=rows.length===1?rows[0].key:prefix+JSON.stringify(rows);
 }
 for(const name of Object.keys(pools)){
  if(!keyNames.includes(name)||!Array.isArray(pools[name])||pools[name].length>100)throw Error('Некорректный список ключей (максимум 100 на сервис).');
  const old=effectivePool(next,name,sharedGroq),seen=new Set();
  const rows=pools[name].map(row=>{
   if(!row||typeof row!=='object'||typeof row.id!=='string'||row.id.length>100||seen.has(row.id))throw Error('Некорректная строка ключа.');
   seen.add(row.id);const existing=old.find(r=>r.id===row.id);
   const replacement=typeof row.key==='string'?row.key.trim():'';
   const secret=replacement||existing?.key;
   if(!secret||secret.length>4096)throw Error('Вставьте ключ в новую строку или удалите её.');
   return {id:existing?.id||randomUUID(),key:secret};
  });
  if(new Set(rows.map(r=>r.key)).size!==rows.length)throw Error('Один и тот же ключ добавлен несколько раз.');
  next[name]=prefix+JSON.stringify(rows);
 }
 if(Buffer.byteLength(JSON.stringify(next))>30000)throw Error('Список ключей слишком большой для защищённого хранилища.');
 return next;
}
export function credentialStore(helper=process.env.SKAZITEL_KEYCHAIN_HELPER){
 const persistent=!!helper;
 async function call(action,value){
  return new Promise((resolve,reject)=>{
   const child=spawn(helper,['--credentials',action],{stdio:['pipe','pipe','ignore']});let chunks=[],size=0,finished=false;
   const fail=()=>{if(finished)return;finished=true;clearTimeout(timer);reject(Error('Не удалось открыть Связку ключей macOS. Разрешите доступ «Сказителю» и повторите сохранение.'));};
   const timer=setTimeout(()=>{child.kill();fail();},60000);
   child.on('error',fail);child.stdin.on('error',()=>{});
   child.stdout.on('data',b=>{size+=b.length;if(size>32768){child.kill();fail();}else chunks.push(b);});
   child.on('close',code=>{if(finished)return;if(code!==0)return fail();finished=true;clearTimeout(timer);try{const data=action==='load'?JSON.parse(Buffer.concat(chunks).toString()):undefined;if(data){for(const name of Object.keys(data)){if(!keyNames.includes(name)||typeof data[name]!=='string')throw Error();keyPool(data,name);}}resolve(data);}catch{reject(Error('Не удалось прочитать сохранённые API-ключи.'));}});
   child.stdin.end(value===undefined?'':JSON.stringify(value));
  });
 }
 return {persistent,load:()=>persistent?call('load'):Promise.resolve({}),save:keys=>persistent?call(Object.keys(keys).length?'save':'clear',keys):Promise.resolve()};
}
