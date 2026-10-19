import {test} from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
test('HTTP settings preserve ten keys through restart; failover commits one turn and never exports keys',async()=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'skazitel-pools-server-'));let child,base;const calls=[];
 const mock=http.createServer(async(req,res)=>{calls.push(req.headers.authorization);for await(const b of req){}if(req.headers.authorization.endsWith('0')){res.writeHead(401);return res.end('{}');}if(req.headers.authorization.endsWith('1')){res.writeHead(429,{'retry-after':'60'});return res.end('{}');}res.end(JSON.stringify({choices:[{message:{content:JSON.stringify({narration:'Дверь открывается.',roll_request:null,changes:[],reaction_request:null})}}]}));});
 await new Promise(r=>mock.listen(0,'127.0.0.1',r));
 const helper=path.join(dir,'helper'),vault=path.join(dir,'fixture-vault');
 await fs.writeFile(helper,`#!${process.execPath}\nconst fs=require('node:fs');let input='';const file=${JSON.stringify(vault)};process.stdin.on('data',b=>input+=b);process.stdin.on('end',()=>{if(process.argv[3]==='save')fs.writeFileSync(file,input);else if(process.argv[3]==='clear')fs.writeFileSync(file,'{}');else process.stdout.write(fs.existsSync(file)?fs.readFileSync(file):'{}');});`,{mode:0o700});
 async function boot(){child=spawn(process.execPath,['server.mjs'],{cwd:new URL('..',import.meta.url),env:{...process.env,SKAZITEL_DATA:dir,SKAZITEL_TOKEN:'fixture',SKAZITEL_KEYCHAIN_HELPER:helper,PORT:'0'},stdio:['ignore','pipe','pipe']});base=await new Promise((resolve,reject)=>{let out='';child.stdout.on('data',b=>{out+=b;const m=out.match(/SKAZITEL_URL=(http:\/\/[^\n]+)/);if(m)resolve(m[1]);});child.once('exit',c=>reject(Error('exit '+c)));});}
 async function stop(){if(child&&!child.killed){const done=new Promise(r=>child.once('exit',r));child.kill();await done;}}
 async function api(route,body,status=200){const r=await fetch(base+'/api/'+route,{method:body?'POST':'GET',headers:{'Content-Type':'application/json','x-app-token':'fixture'},...(body?{body:JSON.stringify(body)}:{})});const d=await r.json();assert.equal(r.status,status,JSON.stringify(d));assert.ok(!JSON.stringify(d).includes('http-fixture-secret'));return d;}
 try{
  await boot();let s=await api('settings',{provider:'compatible',baseUrl:'http://127.0.0.1:'+mock.address().port,model:'fixture',keyPools:{groq:Array.from({length:10},(_,i)=>({id:'new-'+i,key:'http-fixture-secret-groq-'+i})),compatible:[0,1,2].map(i=>({id:'new-'+i,key:'http-fixture-secret-compatible-'+i}))}});
  assert.equal(s.keyStorage.persistent,true);assert.equal(s.keyPools.groq.length,10);const ids=s.keyPools.groq.map(r=>r.id);
  await stop();await boot();s=await api('settings',{autoSummary:'off'});assert.deepEqual(s.keyPools.groq.map(r=>r.id),ids);
  s=await api('settings',{keyPools:{groq:ids.toReversed().map(id=>({id,key:''}))}});assert.deepEqual(s.keyPools.groq.map(r=>r.id),ids.toReversed());
  s=await api('create',{name:'Fixture',characters:[{name:'Тест'}]});const id=s.activeId,characterId=s.campaigns[0].characters[0].id;
  s=await api('turn',{id,characterId,text:'Открыть дверь'});assert.equal(s.campaigns[0].journal.filter(e=>e.role==='assistant').length,1);assert.equal(calls.length,3);assert.ok(calls[2].endsWith('2'));
  await api('export?id='+id);assert.ok(!(await fs.readFile(path.join(dir,'settings.json'),'utf8')).includes('http-fixture-secret'));
  s=await api('settings',{keyPools:{groq:[]}});assert.equal(s.keyPools.groq.length,0);assert.equal(s.keyPools.compatible.length,3);
 }finally{await stop();await new Promise(r=>mock.close(r));await fs.rm(dir,{recursive:true,force:true});}
});
