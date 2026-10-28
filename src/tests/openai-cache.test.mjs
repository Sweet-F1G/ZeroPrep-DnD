import {test} from 'node:test';import assert from 'node:assert/strict';
import {makeCampaign} from '../engine.mjs';import {cachedCampaignContext,openAIInput,stableJSON} from '../openai-context.mjs';
import {generate} from '../providers.mjs';import {normalizeUsage} from '../usage.mjs';import {estimateCost} from '../cost.mjs';
const config={provider:'openai',model:'gpt-6-luna',baseUrl:'https://api.openai.com/v1',reasoningEffort:'medium'};
function fixture(){const c=makeCampaign({name:'Тест',source:'Полный исходник. '.repeat(600),characters:[{name:'Лира'}]});const h=c.characters[0];h.notes='Подробности героя. '.repeat(100);h.features=[{id:'f',name:'Зоркость',description:'Полное описание. '.repeat(100)}];h.spells=[{id:'s',name:'Стрела',description:'Правило заклинания. '.repeat(100),prepared:true,level:1}];h.resources=[{id:'r',name:'Ячейки',max:3,current:2,recovery:'longRest',description:'Длинное правило. '.repeat(30),readyAt:null}];c.inventory=[{id:'i',name:'Ключ',description:'Свойства ключа. '.repeat(50),quantity:2,ownerId:h.id,charges:{current:1,max:3}}];c.journal=[{id:'e',role:'user',text:'Лира осматривает дверь'}];return c;}
test('full reference survives transport and stays byte-identical when HP, resources, preparation and ownership change',()=>{
 const c=fixture(),before=structuredClone(c),a=cachedCampaignContext(c);assert.deepEqual(c,before);
 assert.equal(a.reference.source,c.source);assert.equal(a.reference.characters[0].notes,c.characters[0].notes);assert.equal(a.reference.characters[0].spells[0].description,c.characters[0].spells[0].description);assert.equal(a.reference.characters[0].features[0].description,c.characters[0].features[0].description);
 assert.equal(a.reference.characters[0].resources[0].description,c.characters[0].resources[0].description);assert.equal(a.state.characters[0].resources[0].current,2);
 c.characters[0].hp=3;c.characters[0].resources[0].current=1;c.characters[0].resources[0].readyAt=60;c.characters[0].spells[0].prepared=false;c.inventory[0].quantity=1;c.inventory[0].ownerId='group';c.inventory[0].charges.current=0;c.journal.push({id:'e2',role:'user',text:'Передаю ключ'});
 const b=cachedCampaignContext(c);assert.equal(stableJSON(a.reference),stableJSON(b.reference));assert.equal(b.state.characters[0].hp,3);assert.equal(b.state.inventory[0].charges.current,0);assert.equal(b.state.characters[0].spells[0].prepared,false);
 const messages=openAIInput('JSON',b,{explicit:true});assert.equal(messages[0].role,'developer');assert.equal(messages[1].role,'user');assert.ok(messages[0].content[0].prompt_cache_breakpoint);assert.ok(messages[1].content[0].prompt_cache_breakpoint);assert.equal(messages[2].content[0].prompt_cache_breakpoint,undefined);
 assert.equal(stableJSON({b:0,a:false,c:null}),stableJSON({c:null,a:false,b:0}));
});
test('Luna uses Responses, explicit caching and reasoning; ignores reasoning output items and records write costs',async()=>{
 const c=fixture(),before=structuredClone(c),original=globalThis.fetch;let observed;
 globalThis.fetch=async(url,options)=>{assert.equal(url,'https://api.openai.com/v1/responses');assert.equal(options.headers.Authorization,'Bearer fake-openai');const body=JSON.parse(options.body);assert.equal(body.model,'gpt-6-luna');assert.equal(body.store,false);assert.equal(body.reasoning.effort,'medium');assert.equal(body.text.format.type,'json_object');assert.equal(body.prompt_cache_options.mode,'explicit');assert.equal(body.prompt_cache_options.ttl,'30m');assert.equal(body.messages,undefined);assert.equal(body.input.length,3);assert.equal(JSON.parse(body.input[1].content[0].text).reference.source,c.source);
 return Response.json({status:'completed',usage:{input_tokens:10000,output_tokens:1000,input_tokens_details:{cached_tokens:2000,cache_write_tokens:6000},output_tokens_details:{reasoning_tokens:500}},output:[{type:'reasoning',summary:[]},{type:'message',content:[{type:'output_text',text:JSON.stringify({narration:'У двери видны следы.',actions:[]})}]}]});};
 try{const reply=await generate(config,{openai:'fake-openai'},c,event=>{observed=event;});assert.ok(reply.narration);assert.deepEqual(c,before);const usage=normalizeUsage(observed.data);assert.equal(usage.cacheWrite,6000);assert.equal(usage.reasoning,500);assert.equal(usage.output,1000);assert.ok(Math.abs(estimateCost(observed,usage).usd-.00147)<1e-12);}finally{globalThis.fetch=original;}
});
test('recall appends changing evidence without rewriting the cacheable prefix',async()=>{
 const c=fixture(),original=globalThis.fetch,requests=[];
 globalThis.fetch=async(url,options)=>{const b=JSON.parse(options.body);requests.push(b);return Response.json({status:'completed',output:[{type:'message',content:[{type:'output_text',text:JSON.stringify(requests.length===1?{recall_query:'дверь'}:{narration:'Вы вспоминаете следы.'})}]}]});};
 try{await generate(config,{openai:'fake-openai-recall'},c);assert.equal(requests.length,2);assert.deepEqual(requests[0].input.slice(0,2),requests[1].input.slice(0,2));const last=JSON.parse(requests[1].input.at(-1).content[0].text);assert.ok(last.recall.sourceAlreadyInReference);assert.equal(last.recall.source,undefined);}finally{globalThis.fetch=original;}
});
test('incomplete responses and refusals stop cleanly without mutating campaign state',async()=>{
 const c=fixture(),before=structuredClone(c),original=globalThis.fetch;
 try{for(const response of [{status:'incomplete',output:[]},{status:'completed',output:[{type:'message',content:[{type:'refusal',refusal:'No'}]}]}]){globalThis.fetch=async()=>Response.json(response);await assert.rejects(()=>generate(config,{openai:'fake-openai-errors'},c),/не завершён|отказался/);assert.deepEqual(c,before);}}finally{globalThis.fetch=original;}
});
test('Smart Reasoning Boost: session zero boosts reasoningEffort to high, reverts to low once complete',async()=>{
 const c=fixture(),original=globalThis.fetch,efforts=[];
 globalThis.fetch=async(url,options)=>{
  const body=JSON.parse(options.body);
  efforts.push(body.reasoning.effort);
  return Response.json({status:'completed',output:[{type:'message',content:[{type:'output_text',text:JSON.stringify({narration:'Тестовый ответ',actions:[]})}]}]});
 };
 try{
  c.sessionZero={version:1,step:0,answers:{},draft:[],complete:false,editing:false};
  const cfg={...config,model:'gpt-6.1-terra',reasoningEffort:'low',sessionZeroBoost:'on'};
  await generate(cfg,{openai:'fake-openai'},c);
  assert.equal(efforts[0],'high');
  c.sessionZero.complete=true;
  await generate(cfg,{openai:'fake-openai'},c);
  assert.equal(efforts[1],'low');
  c.sessionZero.complete=false;
  await generate({...cfg,sessionZeroBoost:'off'},{openai:'fake-openai'},c);
  assert.equal(efforts[2],'low');
 }finally{globalThis.fetch=original;}
});
