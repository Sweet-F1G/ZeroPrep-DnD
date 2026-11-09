import {test} from 'node:test';import assert from 'node:assert/strict';import {spawn} from 'node:child_process';import fs from 'node:fs/promises';import os from 'node:os';import path from 'node:path';import http from 'node:http';
test('usage records malformed replies; summary persists; staged narration does not commit unheard consequences',async()=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'skazitel-features-'));let child,base,malformed=false,requests=[];
 const mock=http.createServer(async(req,res)=>{let raw='';for await(const b of req)raw+=b;const body=JSON.parse(raw);requests.push(body);const context=JSON.parse(body.messages[1].content);const content=(body.messages[0].content.includes('краткую память')||body.messages[0].content.includes('concise memory summary'))?{summary:'Союзники встретили мага; дверь пока заперта.'}:{narration:'Дверь скрипит. Из темноты выступает маг. Он ждёт вашего решения.',reaction_request:{prompt:'Как поступить?',timeoutSeconds:3},roll_request:null,changes:[]};res.setHeader('Content-Type','application/json');res.setHeader('x-ratelimit-remaining-tokens','7000');res.end(JSON.stringify({usage:{prompt_tokens:100,completion_tokens:40,total_tokens:140,prompt_tokens_details:{cached_tokens:50}},choices:[{message:{content:malformed?'broken':JSON.stringify(content)}}]}));});
 await new Promise(r=>mock.listen(0,'127.0.0.1',r));
 async function boot(){child=spawn(process.execPath,['server.mjs'],{cwd:new URL('..',import.meta.url),env:{...process.env,SKAZITEL_KEYCHAIN_HELPER:'',SKAZITEL_DATA:dir,SKAZITEL_TOKEN:'fixture-session',PORT:'0'},stdio:['ignore','pipe','pipe']});base=await new Promise((resolve,reject)=>{let out='';const timer=setTimeout(()=>reject(Error('boot timeout')),10000);child.stdout.on('data',b=>{out+=b;const m=out.match(/SKAZITEL_URL=(http:\/\/[^\n]+)/);if(m){clearTimeout(timer);resolve(m[1]);}});child.once('exit',code=>{clearTimeout(timer);reject(Error('exit '+code));});});}
 async function stop(){if(child&&!child.killed){const done=new Promise(r=>child.once('exit',r));child.kill();await done;}}
 async function api(route,body,status=200){const r=await fetch(base+'/api/'+route,{method:body?'POST':'GET',headers:{'x-app-token':'fixture-session','Content-Type':'application/json'},...(body?{body:JSON.stringify(body)}:{})});const data=await r.json();assert.equal(r.status,status,JSON.stringify(data));return data;}
 try{
  await boot();await api('settings',{provider:'compatible',baseUrl:'http://127.0.0.1:'+mock.address().port,model:'fixture',autoSummary:'off'});
  let s=await api('create',{name:'Fixture',characters:[{name:'Теон'}]}),id=s.activeId,characterId=s.campaigns[0].characters[0].id;
  s=await api('turn',{id,characterId,text:'Начать',voiceDelivery:true});const delivery=s.campaigns[0].delivery;
  assert.equal(s.campaigns[0].reaction,null);assert.equal(s.campaigns[0].journal.at(-1).text,'');
  s=await api('delivery',{id,deliveryId:delivery.id,index:0,action:'ack'});assert.equal(s.campaigns[0].journal.at(-1).text,'Дверь скрипит.');
  s=await api('delivery',{id,deliveryId:delivery.id,action:'interrupt'});assert.equal(s.campaigns[0].reaction,null);assert.ok(!JSON.stringify(s.campaigns[0].journal).includes('темноты'));
  // Fill the old journal using unvoiced turns, then explicitly summarize it.
  for(let i=0;i<7;i++)await api('turn',{id,characterId,text:'Действие '+i});
  const before=(await api('state')).campaigns[0];s=await api('summary',{id,action:'create'});assert.ok(s.campaigns[0].summaryValid);assert.equal(s.campaigns[0].journal.length,before.journal.length);
  assert.ok(!('source' in JSON.parse(requests.at(-1).messages[1].content)));
  await api('turn',{id,characterId,text:'Дальше'});const sent=JSON.parse(requests.at(-1).messages[1].content);assert.equal(sent.summary,'Союзники встретили мага; дверь пока заперта.');assert.ok(sent.journal.length<before.journal.length);
  const prior=(await api('usage')).all.total;malformed=true;await api('turn',{id,characterId,text:'Ошибка'},400);assert.equal((await api('usage')).all.total,prior+140);
  const usage=await api('usage');assert.equal(usage.groups[0].limits['x-ratelimit-remaining-tokens'],'7000');assert.ok(!JSON.stringify(usage).includes('Союзники встретили'));
  const costId=usage.cost.id;assert.ok(usage.cost.unknown>0);await api('settings',{groqBilling:'paid'});
  const reset=await api('cost-session',{action:'new'});assert.notEqual(reset.cost.id,costId);assert.equal(reset.cost.requests,0);assert.equal(reset.all.total,usage.all.total);
  const page=await fetch(base);assert.match(await page.text(),/id="sessionCost"/);
  await stop();await boot();assert.equal((await api('state')).config.groqBilling,'paid');assert.equal((await api('usage')).cost.id,reset.cost.id);assert.equal((await api('usage')).all.total,usage.all.total);assert.equal((await api('usage')).session.requests,0);assert.ok((await api('state')).campaigns[0].summaryValid);
 }finally{await stop();await new Promise(r=>mock.close(r));await fs.rm(dir,{recursive:true,force:true});}
});
