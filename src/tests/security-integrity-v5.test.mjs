import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {spawn} from 'node:child_process';
import http from 'node:http';
import {createCampaignStore} from '../campaign-store.mjs';
import {makeCampaign} from '../engine.mjs';

test('stale instances cannot delete, and an empty database is not restored from a stale mirror',async()=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'skazitel-integrity-'));let a,b;
 try{
  const c=makeCampaign({name:'Protected',characters:[{name:'Hero'}]});
  a=await createCampaignStore(dir);await a.save([c]);b=await createCampaignStore(dir);
  c.characters[0].hp=4;await a.save([c]);
  await assert.rejects(b.delete(c.id),/другим окном/);assert.equal(a.load()[0].characters[0].hp,4);
  b.close();b=null;await a.delete(c.id);a.close();a=null;
  await fs.writeFile(path.join(dir,'campaigns.json'),JSON.stringify([c]));
  a=await createCampaignStore(dir);assert.deepEqual(a.load(),[]);
 }finally{a?.close();b?.close();await fs.rm(dir,{recursive:true,force:true});}
});

test('LAN admin access, fog, private whispers and concurrent mutations are protected',async(t)=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'skazitel-security-'));
 const c=makeCampaign({name:'Security',characters:[{name:'Hero'}]});const hero=c.characters[0].id;
 c.maps=[{id:'map',name:'Map',width:30,height:30,feetPerCell:5,fogOfWar:true,revealedCells:[],tokens:[{id:'hero',kind:'hero',label:'Hero',x:0,y:0},{id:'visible',kind:'enemy',label:'visible',x:1,y:1},{id:'secret',kind:'enemy',label:'SECRET FOE',x:20,y:20}]}];
 c.inventory=[{id:'potion',name:'healing potion',quantity:1,ownerId:'group',carrierId:'group'}];
 c.journal=[{id:'old-w',role:'user',text:'OLD SECRET',isWhisper:true,characterId:hero,characterName:'Hero'}, {id:'old-a',role:'assistant',text:'🤫 [Шёпотом для Hero]: OLD REPLY'}];
 const store=await createCampaignStore(dir);await store.save([c]);store.close();
 await fs.writeFile(path.join(dir,'settings.json'),JSON.stringify({provider:'demo',ttsProvider:'off',autoSummary:'off'}));
 const child=spawn(process.execPath,['server.mjs'],{cwd:new URL('..',import.meta.url),env:{...process.env,PORT:'0',SKAZITEL_DATA:dir,SKAZITEL_KEYCHAIN_HELPER:'',SKAZITEL_TOKEN:'admin-test',SKAZITEL_PLAYER_TOKEN:'player-test'},stdio:['ignore','pipe','pipe']});
 let mock,unblock;
 try{
  const base=await new Promise((resolve,reject)=>{let out='',err='';const timer=setTimeout(()=>reject(Error('Server timeout: '+err)),10000);child.stdout.on('data',chunk=>{out+=chunk;const m=out.match(/SKAZITEL_URL=(http:\/\/[^\n]+)/);if(m){clearTimeout(timer);resolve(m[1]);}});child.stderr.on('data',b=>err+=b);child.once('exit',()=>{clearTimeout(timer);reject(Error(err));});});
  const playerHeaders={'x-player-token':'player-test','content-type':'application/json'};
  const adminHeaders={'x-app-token':'admin-test','content-type':'application/json'};
  const post=(route,body,headers=playerHeaders)=>fetch(base+'/api/'+route,{method:'POST',headers,body:JSON.stringify(body)});
  const lanIp=Object.values(os.networkInterfaces()).flat().find(i=>i.family==='IPv4'&&!i.internal)?.address;
  if(lanIp){const lan=base.replace('127.0.0.1',lanIp);const remote=await fetch(lan+'/',{signal:AbortSignal.timeout(5000)});assert.equal(remote.status,403);assert.ok(!(await remote.text()).includes('admin-test'));assert.equal((await fetch(lan+'/api/state',{headers:adminHeaders,signal:AbortSignal.timeout(5000)})).status,403);}else t.diagnostic('No LAN interface available for the remote access check');
  for(const suffix of ['',`&heroId=${hero}`]){
   const response=await fetch(base+`/api/player/state?id=${c.id}${suffix}`,{headers:playerHeaders});const data=await response.json();const encoded=JSON.stringify(data);
   assert.ok(!encoded.includes('OLD SECRET'));assert.ok(!encoded.includes('OLD REPLY'));assert.ok(!encoded.includes('SECRET FOE'));assert.ok(encoded.includes('visible'));
  }
  assert.equal((await post('map/fog',{campaignId:c.id,mapId:'map',revealAll:true})).status,403);
  const whisper=await post('player/turn',{campaignId:c.id,characterId:hero,text:'NEW SECRET',isWhisper:true});assert.equal(whisper.status,200);const result=await whisper.json();assert.ok(result.narration);
  const state=JSON.stringify(await(await fetch(base+`/api/player/state?id=${c.id}&heroId=${hero}`,{headers:playerHeaders})).json());assert.ok(!state.includes('NEW SECRET'));assert.ok(!state.includes(result.narration));
  assert.equal((await post('undo',{id:c.id},adminHeaders)).status,200);
  const gate=new Promise(r=>unblock=r);let incoming;const entered=new Promise(r=>incoming=r);
  mock=http.createServer(async(req,res)=>{for await(const _ of req){}incoming();await gate;res.setHeader('content-type','application/json');res.end(JSON.stringify({choices:[{message:{content:JSON.stringify({narration:'Finished',changes:[],roll_request:null})}}]}));});await new Promise(r=>mock.listen(0,'127.0.0.1',r));
  const settings=await post('settings',{provider:'compatible',model:'test',baseUrl:`http://127.0.0.1:${mock.address().port}`},adminHeaders);assert.equal(settings.status,200);
  const pending=post('player/turn',{campaignId:c.id,characterId:hero,text:'Ожидаю ответ'});
  await Promise.race([entered,pending.then(async r=>{throw Error('Turn finished before reaching mock: '+r.status+' '+await r.text());}),new Promise((_,reject)=>{const timer=setTimeout(()=>reject(Error('Mock provider was not reached within 8 seconds')),8000);timer.unref();})]);
  const competing=await post('player/action',{campaignId:c.id,characterId:hero,action:'item',itemId:'potion'});assert.equal(competing.status,400);
  const deletion=await post('campaign/delete',{id:c.id},adminHeaders);assert.equal(deletion.status,400);
  unblock();assert.equal((await pending).status,200);
  const after=await(await fetch(base+'/api/state',{headers:adminHeaders})).json();assert.ok(after.campaigns.find(x=>x.id===c.id).inventory.some(i=>i.id==='potion'));
 }finally{unblock?.();if(mock)await new Promise(r=>mock.close(r));if(child.exitCode===null){const exited=new Promise(r=>child.once('exit',r));child.kill();await exited;}await fs.rm(dir,{recursive:true,force:true});}
});
