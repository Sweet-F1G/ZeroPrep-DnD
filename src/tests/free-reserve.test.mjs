import {test} from 'node:test';import assert from 'node:assert/strict';
test('free provider reserve: prices, key isolation, cooldown, no paid fallback or invalid-request retry',async()=>{
 const {completeJSON,defaults,FREE_RESERVE_MODEL}=await import('../providers.mjs?free-reserve-test');
 const original=global.fetch;let price='1',groqStatus=429,received=[],events=[];
 global.fetch=async(url,options)=>{
  received.push({url:String(url),...options});
  if(String(url).endsWith('/models'))return Response.json({data:[{id:FREE_RESERVE_MODEL,supported_parameters:['response_format'],pricing:{prompt:price,completion:'0'}}]});
  if(String(url).includes('groq.com'))return Response.json({error:{message:'quota'}},{status:groqStatus});
  const b=JSON.parse(options.body);assert.equal(b.model,FREE_RESERVE_MODEL);assert.deepEqual(b.provider.max_price,{prompt:0,completion:0,request:0});assert.equal(options.headers.Authorization,'Bearer reserve-test');
  return Response.json({choices:[{message:{content:'{"narration":"Резерв отвечает"}'}}],usage:{prompt_tokens:42,completion_tokens:7}});
 };
 const config={...defaults,provider:'compatible',baseUrl:'https://api.groq.com/openai/v1',model:'test',reserveProvider:'openrouter'},keys={groq:'primary-test',compatible:'reserve-test'};
 try{
  await assert.rejects(completeJSON(config,keys,'JSON',{},e=>events.push(e)),/Платный запрос не отправлен/);assert.equal(received.filter(x=>x.url.endsWith('/chat/completions')).length,1);
  price='0';received=[];const result=await completeJSON(config,keys,'JSON',{},e=>events.push(e));assert.equal(result.narration,'Резерв отвечает');assert.equal(received.some(x=>x.url.includes('groq.com')),false);assert.equal(events.at(-1).model,FREE_RESERVE_MODEL);
  groqStatus=400;received=[];await assert.rejects(completeJSON({...config,model:'different'},keys,'JSON',{}),/400/);assert.equal(received.length,1);
  received=[];await assert.rejects(completeJSON({...config,reserveProvider:'off'},keys,'JSON',{}));assert.equal(received.length,0);
 }finally{global.fetch=original;}
});
