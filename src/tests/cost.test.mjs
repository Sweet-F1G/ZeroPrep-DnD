import {test} from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs/promises';import os from 'node:os';import path from 'node:path';
import {estimateCost,wavSeconds,costTotals} from '../cost.mjs';import {createUsageStore} from '../usage.mjs';
const usage={input:1000000,output:100000,cached:200000,reasoning:50000};
test('cost uses provider-specific tariffs, cache subsets, reasoning once and long-context rates',()=>{
 assert.equal(estimateCost({provider:'openai',model:'gpt-6.1-sol',status:200},{input:100000,output:10000,cached:20000,reasoning:5000}).usd,.262);
 assert.equal(estimateCost({provider:'openai',model:'gpt-6.1-sol',status:200},usage).usd,4.74);
 assert.equal(estimateCost({provider:'api.groq.com',model:'openai/gpt-oss-120b',status:200,groqBilling:'free'},usage).usd,0);
 assert.ok(Math.abs(estimateCost({provider:'api.groq.com',model:'openai/gpt-oss-120b',status:200,groqBilling:'paid'},usage).usd-.195)<1e-10);
 assert.equal(estimateCost({provider:'openrouter.ai',model:'custom',status:200,data:{usage:{cost:.12}}},usage).usd,.12);
 assert.equal(estimateCost({provider:'unknown.example',model:'gpt-6.1-sol',status:200},usage).usd,null);
 assert.equal(estimateCost({provider:'openai',model:'unknown',status:200},usage).usd,null);
 assert.equal(estimateCost({provider:'openai',model:'gpt-4o-mini-tts',kind:'tts',status:200},{}).usd,null);
 assert.equal(estimateCost({provider:'openai',model:'gpt-6.1-sol',status:403},{}).usd,0);
});
test('speech cost uses audio duration, including Groq minimum duration, rather than text tokens',()=>{
 const audio=Buffer.alloc(44+32000);audio.write('RIFF');audio.writeUInt32LE(audio.length-8,4);audio.write('WAVEfmt ',8);audio.writeUInt32LE(16,16);audio.writeUInt32LE(32000,28);audio.write('data',36);audio.writeUInt32LE(32000,40);
 assert.equal(wavSeconds(audio),1);assert.equal(wavSeconds(Buffer.from('invalid')),null);
 assert.equal(estimateCost({provider:'openai',model:'gpt-4o-mini-transcribe',kind:'stt',status:200,audioSeconds:60},{}).usd,.003);
 assert.ok(Math.abs(estimateCost({provider:'groq',model:'whisper-large-v3-turbo',kind:'stt',status:200,audioSeconds:1,groqBilling:'paid'},{}).usd-10/3600*.04)<1e-12);
 const total=costTotals([{cost:{usd:0,basis:'free'}},{cost:{usd:.12,basis:'tokens'}},{cost:{usd:null,basis:'unknown'}}]);assert.equal(total.usd,.12);assert.equal(total.unknown,1);assert.equal(total.complete,false);
});
test('money session survives restart, rate changes preserve past charges, reset keeps usage history',async()=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'skazitel-cost-'));
 try{
  let store=await createUsageStore(dir);const id=store.report().cost.id;
  await store.record({provider:'api.groq.com',model:'openai/gpt-oss-120b',kind:'narration',status:200,groqBilling:'free',data:{usage:{prompt_tokens:1000000,completion_tokens:100000}}});
  await store.record({provider:'openai',model:'gpt-6.1-sol',kind:'narration',status:200,data:{usage:{prompt_tokens:100000,completion_tokens:10000}}});
  await store.record({provider:'openai',model:'gpt-4o-mini-tts',kind:'tts',status:200,data:{}});
  assert.equal(store.report().cost.usd,.3);assert.equal(store.report().cost.unknown,1);
  store=await createUsageStore(dir);assert.equal(store.report().session.requests,0);assert.equal(store.report().cost.id,id);assert.equal(store.report().cost.usd,.3);
  await store.newCostSession();assert.notEqual(store.report().cost.id,id);assert.equal(store.report().cost.usd,0);assert.equal(store.report().cost.unknown,0);assert.equal(store.report().all.requests,3);
  store=await createUsageStore(dir);assert.equal(store.report().cost.usd,0);assert.equal(store.report().all.requests,3);
 }finally{await fs.rm(dir,{recursive:true,force:true});}
});
