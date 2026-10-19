import {test} from 'node:test';import assert from 'node:assert/strict';import http from 'node:http';
import {readResponseStream} from '../response-stream.mjs';import {AudioStreams} from '../audio-stream.mjs';import {estimateCost} from '../cost.mjs';import {completeJSON,defaults} from '../providers.mjs';
const event=data=>'data: '+JSON.stringify(data)+'\n\n';
test('SSE starts preparation before completion, handles escaped Russian text and split packets',async()=>{
 let release,early,logged=0;const wait=new Promise(r=>release=r),full={status:'completed',output:[{type:'message',content:[{type:'output_text',text:'{"narration":"Привет"}'}]}]};
 const stream=new ReadableStream({async start(controller){const bytes=new TextEncoder().encode(event({type:'response.output_text.delta',delta:'{"narration":"Дверь \\"скрипит\\". Входите!","actions":['}));for(let i=0;i<bytes.length;i+=3)controller.enqueue(bytes.slice(i,i+3));await wait;controller.enqueue(new TextEncoder().encode(event({type:'response.completed',response:full})));controller.close();}});
 const promise=readResponseStream(new Response(stream,{headers:{'Content-Type':'text/event-stream'}}),()=>logged++,text=>{early=text;release();});
 assert.deepEqual(await promise,full);assert.equal(early,'Дверь "скрипит". Входите!');assert.equal(logged,1);
});
test('failed or truncated SSE never produces a completed response',async()=>{
 const body=event({type:'response.output_text.delta',delta:'{"narration":"Откройте дверь."'});let logs=0;
 await assert.rejects(readResponseStream(new Response(body,{headers:{'Content-Type':'text/event-stream'}}),()=>logs++,()=>{}),/закрыл поток/);assert.equal(logs,1);
});
test('audio tickets stream first bytes before synthesis ends and cannot be replayed',async()=>{
 let release;const wait=new Promise(r=>release=r);let calls=0;
 const streams=new AudioStreams(async function*(text){calls++;yield Buffer.from('first');await wait;yield Buffer.from('last');});
 const id=streams.prepare('hello','voice');assert.equal(streams.prepare('hello','voice'),id);
 const server=http.createServer(async(req,res)=>{if(!await streams.serve(req.url.slice(1),res)){res.statusCode=404;res.end();}});await new Promise(r=>server.listen(0,'127.0.0.1',r));
 try{const r=await fetch('http://127.0.0.1:'+server.address().port+'/'+id),reader=r.body.getReader();assert.equal(new TextDecoder().decode((await reader.read()).value),'first');release();assert.equal(new TextDecoder().decode((await reader.read()).value),'last');assert.equal((await reader.read()).done,true);assert.equal(calls,1);assert.equal((await fetch('http://127.0.0.1:'+server.address().port+'/'+id)).status,404);}finally{release();await new Promise(r=>server.close(r));}
});
test('Fast request retains reasoning and full input; returned default tier avoids premium',async()=>{
 const original=fetch;globalThis.fetch=async(url,options)=>{const body=JSON.parse(options.body);assert.equal(body.service_tier,'fast');assert.equal(body.reasoning.effort,'medium');assert.equal(body.stream,true);return Response.json({service_tier:'default',status:'completed',output:[{type:'message',content:[{type:'output_text',text:'{"narration":"Ответ"}'}]}]});};
 try{await completeJSON({...defaults,provider:'openai',serviceTier:'fast'},{openai:'latency-test-fake'},'JSON',{everything:'kept'},()=>{},'narration',()=>{});}finally{globalThis.fetch=original;}
 const usage={input:1000,output:1000,cached:0};const normal=estimateCost({provider:'openai',model:'gpt-6-luna',data:{}},usage).usd;
 assert.equal(estimateCost({provider:'openai',model:'gpt-6-luna',serviceTier:'fast',data:{}},usage).usd,normal*2);
 assert.equal(estimateCost({provider:'openai',model:'gpt-6-luna',serviceTier:'fast',data:{service_tier:'default'}},usage).usd,normal);
});
