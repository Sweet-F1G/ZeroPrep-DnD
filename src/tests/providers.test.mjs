import {test} from 'node:test';
import assert from 'node:assert/strict';
import {providerError,generate,transcribe} from '../providers.mjs';
test('403 preserves upstream permission code and explanation',()=>{
 const message=providerError(403,JSON.stringify({error:{message:'Model blocked at project level',code:'model_permission_blocked_project'}}),'application/json');
 assert.match(message,/HTTP 403/);assert.match(message,/model_permission_blocked_project/);assert.match(message,/Model blocked at project level/);
});
test('Groq recognition uploads WAV in Russian with campaign names and the existing Groq key',async()=>{
 const original=globalThis.fetch;
 globalThis.fetch=async(url,options)=>{
  assert.equal(url,'https://api.groq.com/openai/v1/audio/transcriptions');
  assert.equal(options.headers.Authorization,'Bearer fake-groq-key');
  assert.equal(options.body.get('model'),'whisper-large-v3-turbo');assert.equal(options.body.get('language'),'ru');
  assert.equal(options.body.get('response_format'),'json');assert.match(options.body.get('prompt'),/Шарлей/);
  const file=options.body.get('file');assert.equal(file.type,'audio/wav');assert.equal(Buffer.from(await file.arrayBuffer()).toString(),'RIFF-test');
  return new Response(JSON.stringify({text:' Шарлей, я осматриваю дверь. '}),{headers:{'Content-Type':'application/json'}});
 };
 try{
  const text=await transcribe({provider:'compatible',baseUrl:'https://api.groq.com/openai/v1',sttProvider:'groq',sttModel:'whisper-large-v3-turbo'},{compatible:'fake-groq-key'},Buffer.from('RIFF-test'),'audio/wav',['Шарлей']);
  assert.equal(text,'Шарлей, я осматриваю дверь.');
 }finally{globalThis.fetch=original;}
});
test('Groq recognition never sends another provider key to Groq',async()=>{
 const original=globalThis.fetch;let calls=0;globalThis.fetch=async()=>{calls++;throw Error('Should not be called');};
 try{
  for(const baseUrl of ['https://openrouter.ai/api/v1','https://api.groq.com.evil.example/v1','not-a-url']){
   await assert.rejects(()=>transcribe({provider:'compatible',baseUrl,sttProvider:'groq',sttModel:'whisper-large-v3-turbo'},{compatible:'another-provider-key'},Buffer.from('RIFF'),'audio/wav'),/Groq/);
  }assert.equal(calls,0);
 }finally{globalThis.fetch=original;}
});
test('separate Groq speech key works with another text provider; invalid responses fail clearly',async()=>{
 const original=globalThis.fetch;
 globalThis.fetch=async(url,options)=>{assert.equal(options.headers.Authorization,'Bearer separate-groq-key');return new Response('{}',{headers:{'Content-Type':'application/json'}});};
 try{await assert.rejects(()=>transcribe({provider:'openai',baseUrl:'https://api.openai.com/v1',sttProvider:'groq',sttModel:'whisper-large-v3-turbo'},{groq:'separate-groq-key',openai:'different-key'},Buffer.from('RIFF'),'audio/wav'),/не вернул текст/);}finally{globalThis.fetch=original;}
});
test('upstream messages never echo credentials or arbitrary HTML',()=>{
 const secret='synthetic-secret-for-test';const message=providerError(401,JSON.stringify({error:{message:'Invalid key '+secret+' gsk_fakeexample'}}),'application/json',[secret]);
 assert.ok(!message.includes(secret));assert.ok(!message.includes('gsk_fakeexample'));
 assert.ok(!providerError(403,'<html><body>private diagnostic</body></html>','text/html').includes('private diagnostic'));
});
test('compatible provider surfaces JSON error with authorization redacted',async()=>{
 const original=globalThis.fetch;
 globalThis.fetch=async()=>new Response(JSON.stringify({error:{message:'Rejected synthetic-secret-for-test',code:'forbidden'}}),{status:403,headers:{'Content-Type':'application/json'}});
 try {await assert.rejects(()=>generate({provider:'compatible',baseUrl:'https://api.groq.com/openai/v1',model:'openai/gpt-oss-120b'},{compatible:'synthetic-secret-for-test'},{name:'Test',characters:[],journal:[]}),e=>e.message.includes('[forbidden]')&&!e.message.includes('synthetic-secret-for-test'));}finally{globalThis.fetch=original;}
});
