import {test} from 'node:test';import assert from 'node:assert/strict';
import {SpeechPrefetch} from '../public/speech-prefetch.mjs';import {LiveVoice} from '../public/live-voice.mjs';
import {createLiveSession,generateImage,defaults,summarize} from '../providers.mjs';import {estimateCost} from '../cost.mjs';import {normalizeUsage} from '../usage.mjs';
import {makeCampaign,acceptReply,checkpoint,undo} from '../engine.mjs';import {applyActions} from '../actions.mjs';import {cachedCampaignContext} from '../openai-context.mjs';
test('prefetch starts once, transfers ownership and aborts only unheard work',async()=>{
 const calls=[],queue=new SpeechPrefetch(async(text,signal)=>{calls.push({text,signal});return text;});
 queue.warm('a','first');queue.warm('a','first');await Promise.resolve();assert.equal(calls.length,1);
 const taken=queue.take('a');queue.clear();assert.equal(calls[0].signal.aborted,false);assert.equal((await taken.promise).value,'first');
 queue.warm('b','second');await Promise.resolve();queue.clear();assert.equal(calls[1].signal.aborted,true);
 queue.warm('c','third');await Promise.resolve();assert.equal(queue.take('wrong'),null);assert.equal(calls[2].signal.aborted,true);
});
test('live delegates once, preserves ids, limits commentary and ignores non-client events',async()=>{
 let calls=0;const sent=[],live=new LiveVoice({delegate:async text=>{calls++;assert.equal(text,'Лира идёт вперёд');return 'Ответ. '.repeat(200);},onError:e=>{throw e;},status:()=>{}});
 live.active=true;live.epoch=1;live.seen=new Set();live.chain=Promise.resolve();live.transcript='';live.channel={readyState:'open',send:s=>sent.push(JSON.parse(s))};
 live.event({type:'session.input_transcript.delta',delta:'Лира идёт вперёд'});
 const event={type:'session.delegation.created',delegation:{id:'one',target:'client'}};live.event(event);live.event(event);await live.chain;
 assert.equal(calls,1);assert.ok(sent.length>1);assert.ok(sent.every(s=>s.delegation_id==='one'&&s.content.length<=500));assert.equal(sent.map(s=>s.content).join(''),'Ответ. '.repeat(200));
 live.event({type:'session.delegation.created',delegation:{id:'two',target:'responses'}});assert.equal(calls,1);
});
test('OpenAI live SDP and images keep keys server-side and record usage/timings',async()=>{
 const original=globalThis.fetch;let event;
 globalThis.fetch=async(url,options)=>{assert.equal(options.headers.Authorization,'Bearer fixture-secret');const b=JSON.parse(options.body);
 if(url.endsWith('/live/sessions')){assert.equal(b.session.delegation.type,'client');assert.equal(b.session.model,'gpt-live-1');assert.equal(b.transport.sdp,'v=0\noffer');return Response.json({session:{id:'session-test'},transport:{sdp:'v=0\nanswer'}});}
 assert.equal(url,'https://api.openai.com/v1/images/generations');assert.equal(b.model,'gpt-image-2');assert.equal(b.quality,'low');assert.equal(b.n,1);return Response.json({data:[{b64_json:'fixture'}],usage:{input_tokens:20,output_tokens:400,input_tokens_details:{text_tokens:20,image_tokens:0}}});};
 try{const config={...defaults,provider:'openai'},session=await createLiveSession(config,{openai:'fixture-secret'},'v=0\noffer');assert.deepEqual(session,{id:'session-test',sdp:'v=0\nanswer'});assert.ok(!JSON.stringify(session).includes('secret'));
 await generateImage(config,{openai:'fixture-secret'},'Forest',e=>{event=e;});assert.equal(event.kind,'image');assert.ok(event.elapsedMs>=0);assert.ok(Math.abs(estimateCost(event,normalizeUsage(event.data)).usd-.00605)<1e-10);
 assert.equal(estimateCost({provider:'openai',kind:'live',model:'gpt-live-1',audioSeconds:240*60},{}).usd,12);
 }finally{globalThis.fetch=original;}
});
test('full game control is atomic, visible, undoable; settings cannot self-escalate',()=>{
 const c=makeCampaign({name:'Test',characters:[{name:'Лира'}]}),h=c.characters[0];c.dm={autonomy:'full'};checkpoint(c);
 acceptReply(c,{narration:'Лира становится ловчее.',actions:[{type:'sheet.patch',characterId:h.id,patch:{abilityScores:{dexterity:16}},commit:'resolved',reason:'Награда за тренировку'},{type:'map.update',map:{id:'hall',name:'Зал',tokens:[{id:'hero',characterId:h.id,label:'Лира',x:1,y:2}]},commit:'resolved',reason:'Герои изучили зал'}]});
 assert.equal(c.characters[0].abilityScores.dexterity,16);assert.equal(c.maps[0].tokens.length,1);assert.equal(c.journal.at(-1).automaticChanges.length,2);assert.equal(cachedCampaignContext(c).state.maps[0].name,'Зал');
 const before=structuredClone(c);assert.throws(()=>applyActions(c,[{type:'map.update',map:{id:'hall',name:'Зал',tokens:[{id:'bad',x:100,y:0}]}}],'test'));assert.deepEqual(c,before);
 acceptReply(c,{narration:'Настройки предложены.',actions:[{type:'dm.configure',autonomy:'assisted',commit:'resolved',reason:'Просьба'}]});assert.equal(c.dm.autonomy,'full');assert.equal(c.actionProposals.length,1);
 undo(c);assert.deepEqual(c.maps,[]);
});
test('Live graceful close keeps transport until final event and retains final usage',async()=>{
 const calls=[],live=new LiveVoice({api:async(route,data)=>calls.push({route,data}),status:()=>{},onError:e=>{throw e;}});let closed=false;
 live.active=true;live.sessionId='s';live.pc={close(){closed=true;}};live.channel={readyState:'open',send(raw){assert.equal(JSON.parse(raw).type,'session.close');}};
 const stopping=live.stop();assert.equal(closed,false);live.event({type:'session.closed',usage:{seconds:21}});await stopping;assert.equal(closed,true);assert.equal(calls[0].data.seconds,21);assert.equal(calls[0].data.finalized,true);
});
