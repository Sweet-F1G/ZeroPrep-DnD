import test from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {mkdtemp,rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

test('starter selection survives HTTP creation and keeps GM notes out of player state',async()=>{
 const dir=await mkdtemp(path.join(os.tmpdir(),'skazitel-starter-'));
 const child=spawn(process.execPath,['server.mjs'],{cwd:new URL('..',import.meta.url),env:{...process.env,PORT:'0',SKAZITEL_KEYCHAIN_HELPER:'',SKAZITEL_DATA:dir,SKAZITEL_TOKEN:'admin-test',SKAZITEL_PLAYER_TOKEN:'player-test'},stdio:['ignore','pipe','pipe']});
 try{
  const base=await new Promise((resolve,reject)=>{let out='';child.stdout.on('data',b=>{out+=b;const m=out.match(/SKAZITEL_URL=(http:\/\/[^\n]+)/);if(m)resolve(m[1]);});child.once('error',reject);child.once('exit',code=>reject(Error(`server exited: ${code}`)));});
  const post=async(route,body)=>{const r=await fetch(`${base}/api/${route}`,{method:'POST',headers:{'x-app-token':'admin-test','Content-Type':'application/json'},body:JSON.stringify(body)});const v=await r.json();assert.equal(r.status,200,JSON.stringify(v));return v;};
  await post('settings',{language:'ru'});
  const s=await post('create',{name:'Тест',scenario:'frontier',sessionZero:true});
  const campaign=s.campaigns.find(c=>c.id===s.activeId);assert.match(campaign.setting,/Пепельный брод/);assert.equal(campaign.source,undefined);const exported=await fetch(`${base}/api/export?id=${s.activeId}`,{headers:{'x-app-token':'admin-test'}});assert.equal(exported.status,200);assert.match((await exported.json()).campaign.source,/ЗАГОТОВКА МАСТЕРА/);assert.match(campaign.journal[0].text,/Пепельный брод/);
  const r=await fetch(`${base}/api/player/state?id=${s.activeId}`,{headers:{'x-player-token':'player-test'}});assert.equal(r.status,200);const player=await r.text();assert.ok(!player.includes('ЗАГОТОВКА МАСТЕРА'));assert.ok(!player.includes('сигнальной башне'));
 }finally{if(child.exitCode===null&&child.signalCode===null){const done=new Promise(resolve=>child.once('exit',resolve));child.kill();await done;}await rm(dir,{recursive:true,force:true});}
});
