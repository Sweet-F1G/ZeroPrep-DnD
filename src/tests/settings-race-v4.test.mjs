import {test} from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs/promises';import os from 'node:os';import path from 'node:path';import {spawn} from 'node:child_process';
test('background campaign selection cannot overwrite new keys or model settings during a slow vault save',async()=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'skazitel-settings-race-')),helper=path.join(dir,'helper'),marker=path.join(dir,'saving');let child;
 await fs.writeFile(helper,`#!${process.execPath}\nconst fs=require('node:fs');let input='';process.stdin.on('data',b=>input+=b);process.stdin.on('end',()=>{if(process.argv[3]==='load')return process.stdout.write('{}');fs.writeFileSync(${JSON.stringify(marker)},'1');setTimeout(()=>{},150);});`,{mode:0o700});
 child=spawn(process.execPath,['server.mjs'],{cwd:new URL('..',import.meta.url),env:{...process.env,PORT:'0',SKAZITEL_DATA:dir,SKAZITEL_KEYCHAIN_HELPER:helper,SKAZITEL_TOKEN:'fixture'},stdio:['ignore','pipe','inherit']});
 try{const base=await new Promise(resolve=>{let text='';child.stdout.on('data',b=>{text+=b;const m=text.match(/SKAZITEL_URL=(http:\/\/[^\n]+)/);if(m)resolve(m[1]);});});
 const settings=async data=>{const r=await fetch(base+'/api/settings',{method:'POST',headers:{'Content-Type':'application/json','x-app-token':'fixture'},body:JSON.stringify(data)});assert.equal(r.status,200);return r.json();};
 const first=settings({model:'new-model',keys:{groq:'fixture-key'}});for(let n=0;n<100;n++){try{await fs.access(marker);break;}catch{await new Promise(r=>setTimeout(r,5));}}
 const second=settings({activeCampaignId:'chosen'});await first;const state=await second;assert.equal(state.config.model,'new-model');assert.equal(state.config.activeCampaignId,'chosen');assert.equal(state.keysPresent.groq,true);assert.equal(state.keyPools.groq.length,1);
 }finally{const stopped=new Promise(r=>child.once('exit',r));child.kill();await stopped;await fs.rm(dir,{recursive:true,force:true});}
});
