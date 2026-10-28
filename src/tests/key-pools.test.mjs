import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {mergeKeys,keyPool,credentialStore} from '../credentials.mjs';
import {completeJSON,transcribe,speech,poolMetadata} from '../providers.mjs';
const config={provider:'compatible',baseUrl:'https://api.groq.com/openai/v1',model:'pool-test-model',sttProvider:'groq',sttModel:'pool-test-whisper'};
const pool=(prefix,n=3)=>mergeKeys({}, {},false,{groq:Array.from({length:n},(_,i)=>({id:'new-'+i,key:prefix+i}))});
const ok=()=>new Response('{"choices":[{"message":{"content":"{}"}}],"usage":{"prompt_tokens":3,"completion_tokens":4,"total_tokens":7}}');
test('ten keys survive vault recreation, ordering, blank updates, migration and deletion',async()=>{
 const dir=await mkdtemp(path.join(tmpdir(),'skazitel-pool-test-'));
 try{
  const file=path.join(dir,'fixture-vault'),helper=path.join(dir,'helper');
  await writeFile(helper,`#!${process.execPath}\nconst fs=require('node:fs');const file=${JSON.stringify(file)};let input='';process.stdin.on('data',b=>input+=b);process.stdin.on('end',()=>{if(process.argv[3]==='save')fs.writeFileSync(file,input);else process.stdout.write(fs.existsSync(file)?fs.readFileSync(file):'{}');});`,{mode:0o700});
  const keys=pool('ten-fixture-',10);await credentialStore(helper).save(keys);const loaded=await credentialStore(helper).load();assert.deepEqual(loaded,keys);
  const entries=keyPool(loaded,'groq');assert.equal(entries.length,10);
  const reordered=[entries[2],entries[0],...entries.slice(3)].map(r=>({id:r.id,key:''}));
  const changed=mergeKeys(loaded,{},false,{groq:reordered});assert.deepEqual(keyPool(changed,'groq').map(r=>r.key),['ten-fixture-2','ten-fixture-0',...entries.slice(3).map(r=>r.key)]);
  const migrated=mergeKeys({compatible:'legacy-fixture'}, {},false,{groq:[{id:'legacy-compatible',key:''},{id:'new',key:'reserve-fixture'}]},true);assert.equal(keyPool(migrated,'groq')[0].key,'legacy-fixture');
  assert.equal(poolMetadata(config,mergeKeys(migrated,{},false,{groq:[]},true)).groq.length,0);
  assert.throws(()=>mergeKeys(keys,{},false,{groq:[{id:'unknown',key:''}]}),/Вставьте ключ/);
  assert.throws(()=>mergeKeys({}, {},false,{groq:[{id:'a',key:'same'},{id:'b',key:'same'}]}),/несколько раз/);
  assert.ok(!JSON.stringify(poolMetadata(config,keys)).includes('ten-fixture-'));
 }finally{await rm(dir,{recursive:true,force:true});}
});
test('429 → 403 → success follows reserve order, skips cooldown and records every attempt without secrets',async()=>{
 const original=globalThis.fetch,keys=pool('failover-fixture-'),calls=[],events=[];
 globalThis.fetch=async(url,options)=>{const auth=options.headers.Authorization;calls.push(auth);if(auth.endsWith('0'))return new Response(JSON.stringify({error:{message:'limit failover-fixture-0'}}),{status:429,headers:{'retry-after':'100'}});if(auth.endsWith('1'))return new Response('{}',{status:403});return ok();};
 try{
  await completeJSON(config,keys,'test',{},e=>events.push(e));assert.deepEqual(calls,['Bearer failover-fixture-0','Bearer failover-fixture-1','Bearer failover-fixture-2']);
  await completeJSON(config,keys,'test',{},e=>events.push(e));assert.equal(calls.length,4);assert.ok(calls[3].endsWith('2'));
  assert.deepEqual(events.map(e=>e.status),[429,403,200,200]);assert.ok(!JSON.stringify(events).includes('failover-fixture'));assert.deepEqual(poolMetadata(config,keys).groq.map(r=>r.status),[429,403,200]);
 }finally{globalThis.fetch=original;}
});
test('speech quota is independent from narration cooldown',async()=>{
 const original=globalThis.fetch,keys=pool('separate-fixture-'),seen=[];
 globalThis.fetch=async(url,options)=>{seen.push(options.headers.Authorization);if(url.endsWith('transcriptions'))return new Response('{"text":"Я открываю дверь"}');if(options.headers.Authorization.endsWith('0'))return new Response('{}',{status:429});return ok();};
 try{await completeJSON(config,keys,'test',{});await transcribe(config,keys,Buffer.from('RIFF'),'audio/wav');assert.ok(seen.at(-1).endsWith('0'));}finally{globalThis.fetch=original;}
});
test('network failover, no retries for malformed requests, all-failed redaction',async()=>{
 const original=globalThis.fetch;let calls=0;
 globalThis.fetch=async()=>{if(calls++===0)throw Error('private network detail');return ok();};
 try{await completeJSON(config,pool('network-fixture-'),'test',{});assert.equal(calls,2);
  calls=0;globalThis.fetch=async()=>{calls++;return new Response('{}',{status:400});};await assert.rejects(()=>completeJSON(config,pool('bad-request-fixture-'),'test',{}),/HTTP 400/);assert.equal(calls,1);
  globalThis.fetch=async(url,options)=>new Response(JSON.stringify({error:{message:options.headers.Authorization}}),{status:401});const failed=pool('secret-fixture-');
  await assert.rejects(()=>completeJSON(config,failed,'test',{}),e=>e.message.includes('Все доступные ключи (3)')&&!e.message.includes('secret-fixture-'));
  await assert.rejects(()=>completeJSON(config,failed,'test',{}),/временно недоступны/);
 }finally{globalThis.fetch=original;}
});
test('expired cooldown returns to primary; OpenAI, Gemini and compatible API support pools',async()=>{
 const original=globalThis.fetch,now=Date.now;let time=now(),calls=[];Date.now=()=>time;
 globalThis.fetch=async(url,options)=>{const auth=options.headers.Authorization||options.headers['x-goog-api-key'];calls.push(auth);if(auth==='Bearer expiry-fixture-0'&&calls.length===1)return new Response('{}',{status:429,headers:{'retry-after':'2'}});if(url.endsWith('/responses'))return Response.json({status:'completed',output:[{type:'message',content:[{type:'output_text',text:'{}'}]}]});return url.includes('googleapis')?new Response('{"candidates":[{"content":{"parts":[{"text":"{}"}]}}]}'):ok();};
 try{const keys=pool('expiry-fixture-');await completeJSON(config,keys,'test',{});time+=2100;await completeJSON(config,keys,'test',{});assert.equal(calls.at(-1),'Bearer expiry-fixture-0');
  for(const provider of ['openai','gemini','compatible']){const credentials=mergeKeys({}, {},false,{[provider]:[{id:'x',key:provider+'-fixture'}]});await completeJSON({...config,provider,baseUrl:'https://example.test/v1'},credentials,'test',{});assert.ok(calls.at(-1).endsWith(provider+'-fixture'));}
 }finally{globalThis.fetch=original;Date.now=now;}
});
test('ElevenLabs TTS pool switches to reserve key immediately when primary returns 429 or quota limit',async()=>{
 const original=globalThis.fetch;
 const keys=mergeKeys({},{},false,{elevenlabs:[
  {id:'k1',key:'eleven-failover-0'},
  {id:'k2',key:'eleven-failover-1'}
 ]});
 const calls=[];
 globalThis.fetch=async(url,options)=>{
  const auth=options.headers['xi-api-key'];
  calls.push(auth);
  if(auth==='eleven-failover-0')return new Response(JSON.stringify({detail:{status:'quota_exceeded',message:'Quota exceeded'}}),{status:429,headers:{'content-type':'application/json'}});
  return new Response(Buffer.from('ELEVEN_AUDIO_BYTES'),{status:200,headers:{'content-type':'audio/mpeg'}});
 };
 try{
  const ttsCfg={ttsProvider:'elevenlabs',elevenVoice:'JBFqnCBsd6RMkjVDRZzb',elevenModel:'eleven_flash_v2_5'};
  const audio=await speech(ttsCfg,keys,'Привет, искатели приключений!');
  assert.equal(audio.toString(),'ELEVEN_AUDIO_BYTES');
  assert.deepEqual(calls,['eleven-failover-0','eleven-failover-1']);
 }finally{
  globalThis.fetch=original;
 }
});
