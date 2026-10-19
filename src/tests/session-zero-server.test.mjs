import {test} from 'node:test';import assert from 'node:assert/strict';import {spawn} from 'node:child_process';import {mkdtemp,rm} from 'node:fs/promises';import os from 'node:os';import path from 'node:path';
test('session zero HTTP: empty roster, persistence, export/import draft, approval and first scene',async()=>{
 const dir=await mkdtemp(path.join(os.tmpdir(),'skazitel-zero-'));let child,base;
 async function boot(){child=spawn(process.execPath,['server.mjs'],{cwd:new URL('..',import.meta.url),env:{...process.env,PORT:'0',SKAZITEL_KEYCHAIN_HELPER:'',SKAZITEL_DATA:dir,SKAZITEL_TOKEN:'test'},stdio:['ignore','pipe','inherit']});base=await new Promise((resolve,reject)=>{let out='';child.stdout.on('data',b=>{out+=b;const m=out.match(/SKAZITEL_URL=(http:\/\/[^\n]+)/);if(m)resolve(m[1]);});child.once('error',reject);});}
 async function api(route,data){const r=await fetch(base+'/api/'+route,{method:data?'POST':'GET',headers:{'x-app-token':'test','Content-Type':'application/json'},...(data?{body:JSON.stringify(data)}:{})});const result=await r.json();assert.equal(r.status,200,JSON.stringify(result));return result;}
 async function stop(){const stopped=new Promise(r=>child.once('exit',r));child.kill();await stopped;}
 try{await boot();let migration=await api('settings',{provider:'compatible',model:'test',baseUrl:'https://api.groq.com/openai/v1',keys:{compatible:'legacy-groq-fixture'}});
 assert.equal(migration.keyPools.compatible.length,0);assert.equal(migration.keyPools.groq.length,1);
 migration=await api('settings',{reserveProvider:'openrouter',keyPools:{groq:migration.keyPools.groq.map(r=>({id:r.id,key:''})),compatible:[{id:'new-reserve',key:'openrouter-fixture'}]}});
 assert.equal(migration.keyPools.compatible.length,1);assert.equal(migration.keyPools.groq.length,1);
 const changed=await api('settings',{provider:'demo',clearKeys:true});assert.equal(changed.config.reserveProvider,'off');
 let s=await api('create',{name:'Разговор',sessionZero:true});const id=s.activeId;assert.equal(s.campaigns[0].sessionZero.step,0);
 await api('turn',{id,text:'Башня на севере'});await stop();await boot();s=await api('state');assert.equal(s.campaigns[0].sessionZero.step,1);
 const exported=await api('export?id='+id);s=await api('import',exported);assert.equal(s.campaigns.at(-1).sessionZero.step,1);
 for(const text of ['Лёгкий стиль','Без пыток','Лира и Бор','Лира, HP 17, КД 14; Бор, HP 25, КД 16','подтверждаю договорённости'])s=await api('turn',{id,text});
 assert.equal(s.campaigns[0].characters[0].hp,17);assert.equal(s.campaigns[0].profile.boundaries,'Без пыток');
 s=await api('turn',{id,characterId:s.campaigns[0].characters[0].id,text:'Начни приключение'});assert.ok(s.campaigns[0].journal.at(-1).text);assert.equal(s.campaigns[0].sessionZero.complete,true);
 }finally{if(child&&!child.killed)await stop();await rm(dir,{recursive:true,force:true});}
});
