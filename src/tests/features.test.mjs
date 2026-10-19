import {test} from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs/promises';import os from 'node:os';import path from 'node:path';
import {makeCampaign} from '../engine.mjs';import {normalizeUsage,createUsageStore} from '../usage.mjs';import {campaignContext,summaryPlan,setSummary,summaryValid} from '../context.mjs';import {stageReply,advanceDelivery,interruptDelivery,narrationParts} from '../delivery.mjs';import {VoiceGate,speakingCharacter,addressed} from '../public/voice-input.mjs';
const campaign=()=>makeCampaign({name:'Тест',characters:[{name:'Теон'},{name:'Альвари'}]});
test('usage counts cache/reasoning as subsets; unknown stays unknown; journal persists between runs',async()=>{
 assert.deepEqual(normalizeUsage({usage:{prompt_tokens:100,completion_tokens:40,total_tokens:140,prompt_tokens_details:{cached_tokens:80},completion_tokens_details:{reasoning_tokens:15}}}),{input:100,output:40,total:140,cached:80,reasoning:15});
 assert.equal(normalizeUsage({usageMetadata:{promptTokenCount:100,candidatesTokenCount:30,thoughtsTokenCount:10,totalTokenCount:140}}).output,40);
 assert.equal(normalizeUsage({}).total,null);
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'skazitel-usage-'));
 try{let store=await createUsageStore(dir);await store.record({provider:'fixture',model:'mock',kind:'summary',status:200,data:{usage:{prompt_tokens:20,completion_tokens:10,total_tokens:30}}});await store.record({provider:'fixture',model:'mock',kind:'stt',status:200,data:{}});
 assert.equal(store.report().session.total,30);assert.equal(store.report().session.unknown,1);store=await createUsageStore(dir);assert.equal(store.report().all.total,30);assert.equal(store.report().session.requests,0);assert.equal(store.report().recent.length,2);
 }finally{await fs.rm(dir,{recursive:true,force:true});}
});
test('summary removes only covered old events from model context; history and exact HP remain',()=>{
 const c=campaign();c.source='Секретный канон';c.journal=Array.from({length:20},(_,i)=>({id:String(i),role:'user',text:'Событие '+i}));
 const before=structuredClone(c.journal),plan=summaryPlan(c,true);assert.equal(plan.events.length,8);assert.ok(!('source' in plan));
 setSummary(c,'Старые события без выдумок',plan);assert.ok(summaryValid(c));const context=campaignContext(c);assert.equal(context.journal.length,12);assert.equal(context.characters[0].hp,20);assert.deepEqual(c.journal,before);assert.equal(context.source,'Секретный канон');
 c.journal[0].text='Другая ветка';assert.equal(summaryValid(c),false);assert.equal(campaignContext(c).journal.length,20);
});
test('spoken delivery commits only acknowledged segments and defers effects; interrupt discards unheard text',()=>{
 const c=campaign(),reply={narration:'Дверь открылась. На пороге появился маг. Он поднимает руку.',roll_request:{characterId:c.characters[0].id,skill:'wisdom',dc:12},changes:[]};
 stageReply(c,reply);const d=c.delivery;assert.equal(c.pending,null);assert.equal(c.journal.at(-1).text,'');
 assert.equal(advanceDelivery(c,d.id,1),false);advanceDelivery(c,d.id,0);assert.equal(c.journal.at(-1).text,'Дверь открылась.');assert.equal(c.pending,null);
 interruptDelivery(c);assert.equal(c.delivery,null);assert.equal(c.pending,null);assert.ok(!c.journal.at(-1).text.includes('поднимает'));
 stageReply(c,reply);const id=c.delivery.id;while(c.delivery)advanceDelivery(c,id,c.delivery.index);assert.equal(c.pending.dc,12);assert.equal(c.journal.at(-1).text,reply.narration);
 assert.equal(narrationParts('Урон 3.5 единицы. Что дальше?')[0],'Урон 3.5 единицы.');
});
test('local gate ignores silence and hum, emits one utterance, and resolves character ambiguity safely',()=>{
 let starts=0,ends=0;const gate=new VoiceGate({onStart(){starts++;},onEnd(parts,rate){ends++;assert.ok(parts.length>2);assert.equal(rate,48000);}});
 const quiet=new Float32Array(4096),speech=Float32Array.from({length:4096},(_,i)=>.1*Math.sin(i*2*Math.PI*180/48000)),hum=new Float32Array(4096).fill(.1);
 for(let i=0;i<10;i++)gate.feed(quiet,48000);for(let i=0;i<10;i++)gate.feed(hum,48000);assert.equal(starts,0);
 for(let i=0;i<5;i++)gate.feed(speech,48000);for(let i=0;i<10;i++)gate.feed(quiet,48000);assert.equal(starts,1);assert.equal(ends,1);
 const c=campaign();assert.equal(speakingCharacter('Мастер, Теон: я закрываю дверь',c.characters),c.characters[0].id);assert.equal(speakingCharacter('Я закрываю дверь',c.characters),null);assert.ok(addressed('Сказитель, подожди!'));assert.ok(!addressed('Подмастерье идёт'));
 c.characters.push({...c.characters[0],id:'duplicate',name:'Теон второй'});assert.equal(speakingCharacter('Теон, атакую',c.characters),null);
});
test('ambient microphone closes tracks when permission resolves after mode was switched off',async()=>{
 const {ContinuousMic}=await import('../public/voice-input.mjs');const descriptor=Object.getOwnPropertyDescriptor(globalThis,'navigator');let resolve,stops=0;
 Object.defineProperty(globalThis,'navigator',{configurable:true,value:{mediaDevices:{getUserMedia:()=>new Promise(r=>resolve=r)}}});
 try{const mic=new ContinuousMic({});const opening=mic.start(()=>false);mic.stop();resolve({getTracks:()=>[{stop(){stops++;}}]});await opening;assert.equal(stops,1);assert.equal(mic.active,false);}
 finally{if(descriptor)Object.defineProperty(globalThis,'navigator',descriptor);else delete globalThis.navigator;}
});
