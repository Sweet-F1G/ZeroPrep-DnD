import {test} from 'node:test';import assert from 'node:assert/strict';import {spawn} from 'node:child_process';import {mkdtemp,readFile,rm} from 'node:fs/promises';import os from 'node:os';import path from 'node:path';import http from 'node:http';
test('local app: campaigns, physical dice, rollback, persistence, export, secrets and access',async()=>{
 const dir=await mkdtemp(path.join(os.tmpdir(),'skazitel-test-'));let child;
 async function boot(){child=spawn(process.execPath,['server.mjs'],{cwd:new URL('..',import.meta.url),env:{...process.env,PORT:'0',SKAZITEL_DATA:dir,SKAZITEL_TOKEN:'test-session'},stdio:['ignore','pipe','pipe']});return await new Promise((resolve,reject)=>{let out='';const timeout=setTimeout(()=>reject(Error('Server timeout')),10000);child.stdout.on('data',b=>{out+=b;const m=out.match(/SKAZITEL_URL=(http:\/\/[^\n]+)/);if(m){clearTimeout(timeout);resolve(m[1]);}});child.once('error',reject);child.once('exit',code=>{if(code)reject(Error('Server exited '+code));});});}
 let base=await boot();
 async function api(route,data,expected=200){const r=await fetch(base+'/api/'+route,{method:data?'POST':'GET',headers:{'x-app-token':'test-session',...(data?{'Content-Type':'application/json'}:{})},...(data?{body:JSON.stringify(data)}:{})});const body=await r.json();assert.equal(r.status,expected,JSON.stringify(body));return body;}
 try{
  assert.equal((await fetch(base+'/api/state')).status,403);
  assert.equal((await fetch(base+'/api/state',{headers:{'x-app-token':'test-session',Origin:'https://evil.example'}})).status,403);
  await api('settings',{sttProvider:'groq',sttModel:'whisper-large-v3-turbo',voiceSendMode:'direct'});
  await api('transcribe',{audio:Buffer.from('RIFF-test').toString('base64'),mime:'audio/wav'},400);
  await api('settings',{voiceSendMode:'invalid'},400);assert.equal((await api('state')).config.voiceSendMode,'direct');
  await api('settings',{voiceSendMode:'review'});
  let s=await api('create',{seed:true}),id=s.activeId,c=s.campaigns[0],hero=c.characters[0].id;assert.equal(c.characters[1].bonuses.dexterity,-1);
  // A reaction pauses before consequences; the clock cannot be bypassed early.
  s=await api('turn',{id,characterId:hero,text:'Учебный гипноз'});const reactionId=s.campaigns[0].reaction.id;
  await api('turn',{id,characterId:hero,text:'Таймер истёк',passReaction:true,timedOut:true,reactionId},400);
  s=await api('reaction-clock',{id,reactionId,action:'start'});assert.ok(s.campaigns[0].reaction.deadlineAt);
  s=await api('reaction-clock',{id,reactionId,action:'pause'});assert.equal(s.campaigns[0].reaction.paused,true);
  await api('turn',{id,characterId:hero,text:'Таймер истёк',passReaction:true,timedOut:true,reactionId},400);
  s=await api('turn',{id,characterId:hero,text:'Я прикрываю медальон'});assert.equal(s.campaigns[0].reaction,null);
  s=await api('undo',{id});assert.ok(s.campaigns[0].reaction);
  s=await api('turn',{id,characterId:hero,text:'Никто не вмешивается',passReaction:true,reactionId});assert.equal(s.campaigns[0].pending.skill,'wisdom');
  await api('undo',{id});await api('undo',{id});
  if(s.localVoice?.installed){
   await api('settings',{ttsProvider:'silero',sileroSpeaker:'eugene'});
   const response=await fetch(base+'/api/speech',{method:'POST',headers:{'x-app-token':'test-session','Content-Type':'application/json'},body:JSON.stringify({text:'Сложность 12. Бросьте d20.'})});
   assert.equal(response.status,200);assert.equal(response.headers.get('content-type'),'audio/wav');const audio=Buffer.from(await response.arrayBuffer());assert.equal(audio.toString('ascii',0,4),'RIFF');assert.ok(audio.length>10000);
   await api('settings',{sileroSpeaker:'not-a-voice'},400);assert.equal((await api('state')).config.sileroSpeaker,'eugene');
   await api('settings',{ttsProvider:'system'});
  }
  s=await api('turn',{id,characterId:hero,text:'Начать'});assert.equal(s.campaigns[0].journal.length,2);
  s=await api('turn',{id,characterId:hero,text:'Осматриваю следы'});assert.equal(s.campaigns[0].pending.dc,12);
  await api('turn',{id,characterId:hero,text:'Обойти бросок'},400);
  await api('turn',{id,raw:21},400);
  s=await api('turn',{id,raw:9});assert.equal(s.campaigns[0].rolls[0].total,12);assert.equal(s.campaigns[0].rolls[0].success,true);
  s=await api('undo',{id});assert.ok(s.campaigns[0].pending);assert.equal(s.campaigns[0].rolls.length,0);
  const exported=await api('export?id='+id);s=await api('import',exported);assert.equal(s.campaigns.length,2);assert.notEqual(s.activeId,id);assert.notEqual(s.campaigns[1].pending.characterId,hero);
  let chars=s.campaigns[0].characters;chars[0].hp=8;s=await api('heroes',{id,characters:chars});assert.equal(s.campaigns[0].characters[0].hp,8);
  await api('settings',{keys:{openai:'not-a-real-key'}});assert.ok(!(await readFile(path.join(dir,'settings.json'),'utf8')).includes('not-a-real-key'));assert.ok(!(await api('state')).keys?.openai);assert.equal((await api('state')).keysPresent.openai,true);await api('settings',{keys:{openai:''}});assert.equal((await api('state')).keysPresent.openai,true);
  const stopped=new Promise(r=>child.once('exit',r));child.kill();await stopped;base=await boot();s=await api('state');assert.equal(s.campaigns.length,2);assert.equal(s.campaigns[0].characters[0].hp,8);assert.ok(!s.keysPresent.openai);
  // A real local mock checks the compatible API contract and a failed remote reply's atomicity.
  let valid=false;const mock=http.createServer(async(req,res)=>{let text='';for await(const b of req)text+=b;const body=JSON.parse(text);assert.equal(body.response_format.type,'json_object');res.setHeader('Content-Type','application/json');res.end(JSON.stringify({choices:[{message:{content:valid?JSON.stringify({narration:'Проверенный ответ mock-модели',changes:[],roll_request:null}):'{broken'}}]}));});await new Promise(r=>mock.listen(0,'127.0.0.1',r));
  try{
   await api('settings',{provider:'compatible',model:'mock-model',baseUrl:'http://127.0.0.1:'+mock.address().port});
   const before=(await api('state')).campaigns[0];await api('turn',{id,raw:11},400);const after=(await api('state')).campaigns[0];assert.deepEqual(after,before);
   valid=true;s=await api('turn',{id,raw:11});assert.equal(s.campaigns[0].journal.at(-1).text,'Проверенный ответ mock-модели');assert.equal(s.campaigns[0].rolls.at(-1).total,14);
  }finally{await new Promise(r=>mock.close(r));}
 }finally{if(child&&!child.killed){const stopped=new Promise(r=>child.once('exit',r));child.kill();await stopped;}await rm(dir,{recursive:true,force:true});}
});
