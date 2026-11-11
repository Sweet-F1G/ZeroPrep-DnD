import {test} from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {mkdtemp,rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

test('initiative uses physical hero dice, rejects invalid or duplicate starts and never invents enemies',async()=>{
 const dir=await mkdtemp(path.join(os.tmpdir(),'skazitel-initiative-'));
 const child=spawn(process.execPath,['server.mjs'],{cwd:new URL('..',import.meta.url),env:{...process.env,PORT:'0',SKAZITEL_DATA:dir,SKAZITEL_KEYCHAIN_HELPER:'',SKAZITEL_TOKEN:'master-test'},stdio:['ignore','pipe','pipe']});
 try{
  const base=await new Promise((resolve,reject)=>{let out='',err='';const timeout=setTimeout(()=>reject(Error('Server timeout: '+err)),10000);child.stdout.on('data',b=>{out+=b;const m=out.match(/SKAZITEL_URL=(http:\/\/[^\n]+)/);if(m){clearTimeout(timeout);resolve(m[1]);}});child.stderr.on('data',b=>err+=b);child.once('exit',()=>{clearTimeout(timeout);reject(Error(err));});});
  const post=async(route,body)=>{const r=await fetch(base+'/api/'+route,{method:'POST',headers:{'x-app-token':'master-test','content-type':'application/json'},body:JSON.stringify(body),signal:AbortSignal.timeout(10000)});return {status:r.status,data:await r.json()};};
  const created=await post('create',{name:'Dice',characters:[{name:'Quick',abilityScores:{dexterity:16}},{name:'Slow',abilityScores:{dexterity:8}}]});assert.equal(created.status,200);
  const c=created.data.campaigns.find(x=>x.id===created.data.activeId),[quick,slow]=c.characters,id=c.id;
  for(const heroRolls of [{[quick.id]:10},{[quick.id]:10,[slow.id]:21},{[quick.id]:10,[slow.id]:5,stranger:2},{[quick.id]:'10',[slow.id]:5}]){
   assert.equal((await post('combat/start',{campaignId:id,heroRolls})).status,400);
  }
  const started=await post('combat/start',{campaignId:id,heroRolls:{[quick.id]:10,[slow.id]:20}});assert.equal(started.status,200);
  const order=started.data.initiative.combatants;assert.equal(order.length,2);assert.equal(order[0].id,slow.id);assert.equal(order[0].roll,20);assert.equal(order[0].initiative,19);assert.equal(order[1].initiative,13);assert.ok(order.every(x=>x.kind==='hero'));
  assert.equal((await post('combat/start',{campaignId:id})).status,400);
  assert.equal((await post('combat/end',{campaignId:id})).status,200);
  const auto=await post('combat/start',{campaignId:id,enemies:[{name:'Orc'}]});assert.equal(auto.status,200);assert.equal(auto.data.initiative.combatants.length,3);assert.equal(auto.data.initiative.combatants.filter(x=>x.kind==='enemy').length,1);assert.ok(auto.data.initiative.combatants.filter(x=>x.kind==='hero').every(x=>x.roll>=1&&x.roll<=20));
 }finally{if(child.exitCode===null){const exited=new Promise(r=>child.once('exit',r));child.kill();await exited;}await rm(dir,{recursive:true,force:true});}
});
