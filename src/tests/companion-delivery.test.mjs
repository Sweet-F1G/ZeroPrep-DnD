import {test} from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {mkdtemp,rm,writeFile} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

test('companion commits silent replies, resolves physical rolls and keeps rejected turns atomic',async()=>{
 const dir=await mkdtemp(path.join(os.tmpdir(),'skazitel-companion-'));
 await writeFile(path.join(dir,'settings.json'),JSON.stringify({provider:'demo',ttsProvider:'off',autoSummary:'off'}));
 const child=spawn(process.execPath,['server.mjs'],{cwd:new URL('..',import.meta.url),env:{...process.env,PORT:'0',SKAZITEL_DATA:dir,SKAZITEL_KEYCHAIN_HELPER:'',SKAZITEL_TOKEN:'master-test',SKAZITEL_PLAYER_TOKEN:'player-test'},stdio:['ignore','pipe','pipe']});
 let stderr='';child.stderr.on('data',b=>stderr+=b);
 try {
  const base=await new Promise((resolve,reject)=>{
   const timer=setTimeout(()=>reject(Error('Server timeout '+stderr)),10000);
   let out='';child.stdout.on('data',b=>{out+=b;const m=out.match(/SKAZITEL_URL=(http:\/\/[^\n]+)/);if(m){clearTimeout(timer);resolve(m[1]);}});
   child.once('exit',()=>{clearTimeout(timer);reject(Error(stderr));});
  });
  const master=async(route,data)=>{const res=await fetch(base+'/api/'+route,{method:data?'POST':'GET',headers:{'x-app-token':'master-test','Content-Type':'application/json'},...(data?{body:JSON.stringify(data)}:{})});assert.equal(res.status,200);return res.json();};
  const send=async(payload,status=200)=>{const res=await fetch(base+'/api/player/turn',{method:'POST',headers:{'x-player-token':'player-test','Content-Type':'application/json'},body:JSON.stringify(payload)});const data=await res.json();assert.equal(res.status,status,JSON.stringify(data));return data;};
  let state=await master('create',{name:'Test only',edition:'2024',characters:[{name:'Первый',bonuses:{perception:2}},{name:'Второй'}]});
  const id=state.campaigns[0].id,hero=state.campaigns[0].characters[0].id,other=state.campaigns[0].characters[1].id;
  const input={campaignId:id,characterId:hero};
  await send({...input,text:'Начинаем'});
  let c=(await master('state')).campaigns[0];
  assert.equal(c.delivery,null);assert.ok(c.journal.find(j=>j.role==='assistant')?.text.length>20);
  await send({...input,text:'Осматриваю следы'});
  c=(await master('state')).campaigns[0];assert.ok(c.pending);
  const before=c.journal.length,rollId=c.pending.id;
  const mobile=await(await fetch(base+'/api/player/state?id='+id,{headers:{'x-player-token':'player-test'}})).json();
  assert.equal(mobile.campaign.pending.id,rollId);
  await send({...input,text:'Я хочу продолжить без кубика'},400);
  await send({...input,characterId:other,text:'На кубике 14'},400);
  await send({...input,raw:21,rollId},400);
  c=(await master('state')).campaigns[0];assert.equal(c.journal.length,before);assert.equal(c.pending.id,rollId);
  await send({...input,text:'На кубике четырнадцать',rollId});
  c=(await master('state')).campaigns[0];assert.equal(c.pending,null);assert.equal(c.rolls.at(-1).total,16);
  await send({...input,text:'Снова осматриваю следы'});
  c=(await master('state')).campaigns[0];assert.ok(c.pending);
  await send({...input,raw:12,rollId:c.pending.id});
  c=(await master('state')).campaigns[0];assert.equal(c.pending,null);
  await send({...input,campaignId:'missing-campaign',text:'Нельзя отправлять в чужую кампанию'},400);
  assert.equal((await master('state')).campaigns[0].journal.length,c.journal.length);
  // Voice delivery defers consequences; parallel phones share the master lock.
  await master('settings',{ttsProvider:'system'});
  const results=await Promise.all([1,2].map(n=>fetch(base+'/api/player/turn',{method:'POST',headers:{'x-player-token':'player-test','Content-Type':'application/json'},body:JSON.stringify({...input,text:'Осматриваю следы '+n})})));
  assert.deepEqual(results.map(r=>r.status).sort(),[200,409]);await Promise.all(results.map(r=>r.json()));
  c=(await master('state')).campaigns[0];assert.ok(c.delivery);assert.equal(c.pending,null);
  await master('delivery',{id,deliveryId:c.delivery.id,action:'finish'});
  c=(await master('state')).campaigns[0];assert.ok(c.pending);assert.equal(c.delivery,null);
 }finally{
  const exited=new Promise(resolve=>child.once('exit',resolve));child.kill();await exited;await rm(dir,{recursive:true,force:true});
 }
});
