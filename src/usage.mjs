import fs from 'node:fs/promises';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {estimateCost,costTotals,pricingDate} from './cost.mjs';
const num=v=>Number.isFinite(v)&&v>=0?v:null;
export function normalizeUsage(data={}){
 const g=data.usageMetadata,u=data.usage;
 if(g){const input=num(g.promptTokenCount),reasoning=num(g.thoughtsTokenCount),visible=num(g.candidatesTokenCount);return {input,output:visible===null?null:visible+(reasoning??0),cached:num(g.cachedContentTokenCount),reasoning,total:num(g.totalTokenCount)??(input!==null&&visible!==null?input+visible+(reasoning??0):null)};}
 const input=num(u?.prompt_tokens??u?.input_tokens),output=num(u?.completion_tokens??u?.output_tokens);
 return {input,output,...((u?.prompt_tokens_details?.cache_write_tokens??u?.input_tokens_details?.cache_write_tokens)!==undefined?{cacheWrite:num(u?.prompt_tokens_details?.cache_write_tokens??u?.input_tokens_details?.cache_write_tokens)}:{}),cached:num(u?.prompt_tokens_details?.cached_tokens??u?.input_tokens_details?.cached_tokens),reasoning:num(u?.completion_tokens_details?.reasoning_tokens??u?.output_tokens_details?.reasoning_tokens),total:num(u?.total_tokens)??(input!==null&&output!==null?input+output:null)};
}
export function limitHeaders(headers){const result={};for(const k of ['x-ratelimit-limit-requests','x-ratelimit-remaining-requests','x-ratelimit-reset-requests','x-ratelimit-limit-tokens','x-ratelimit-remaining-tokens','x-ratelimit-reset-tokens','retry-after']){const v=headers.get(k);if(v!==null)result[k]=v.slice(0,100);}return result;}
export async function createUsageStore(dir){
 const file=path.join(dir,'usage.json'),session=randomUUID();let records=[];try{records=JSON.parse(await fs.readFile(file,'utf8'));if(!Array.isArray(records))throw Error('format');}catch(e){if(e.code!=='ENOENT')throw Error('Повреждена статистика usage.json. Сохраните копию файла.');}
 const sessionFile=path.join(dir,'cost-session.json');let costSession;
 try{costSession=JSON.parse(await fs.readFile(sessionFile,'utf8'));if(!costSession?.id||!Number.isFinite(Date.parse(costSession.startedAt)))throw Error('format');}catch(e){if(e.code!=='ENOENT')throw Error('Повреждён cost-session.json. Сохраните копию файла.');costSession={id:randomUUID(),startedAt:new Date().toISOString()};await fs.writeFile(sessionFile,JSON.stringify(costSession),{mode:0o600});}
 let queue=Promise.resolve();
 const sum=list=>{const t={requests:list.length,input:0,output:0,cached:0,cacheWrite:0,reasoning:0,total:0,unknown:0};for(const r of list){if(r.total===null)t.unknown++;for(const k of ['input','output','cached','cacheWrite','reasoning','total'])t[k]+=r[k]??0;}for(const k of ['input','output','cached','cacheWrite','reasoning','total'])if(list.length&&!list.some(r=>r[k]!==null&&r[k]!==undefined))t[k]=null;return t;};
 return {
  async record(event){const task=queue.then(async()=>{const r={id:randomUUID(),session,at:new Date().toISOString(),provider:event.provider,model:event.model,kind:event.kind,status:event.status,...(event.serviceTier?{serviceTier:event.serviceTier}:{}),...(Number.isFinite(event.elapsedMs)?{elapsedMs:Math.max(0,event.elapsedMs)}:{}),...(Number.isFinite(event.headersMs)?{headersMs:Math.max(0,event.headersMs)}:{}),...normalizeUsage(event.data),costSessionId:costSession.id,cost:estimateCost(event,normalizeUsage(event.data)),limits:event.limits||{}};const all=[...records,r],cutoff=all.length-10000,next=all.filter((row,i)=>i>=cutoff||row.costSessionId===costSession.id),temp=file+'.tmp';await fs.writeFile(temp,JSON.stringify(next),{mode:0o600});await fs.rename(temp,file);records=next;});queue=task.catch(()=>{});return task;},
  async newCostSession(){const task=queue.then(async()=>{const next={id:randomUUID(),startedAt:new Date().toISOString()},temp=sessionFile+'.tmp';await fs.writeFile(temp,JSON.stringify(next),{mode:0o600});await fs.rename(temp,sessionFile);costSession=next;});queue=task.catch(()=>{});await task;},
  report(){const today=new Date().toISOString().slice(0,10),groups=new Map();for(const r of records){const key=r.provider+' / '+r.model;const g=groups.get(key)||[];g.push(r);groups.set(key,g);}return {cost:{...costTotals(records.filter(r=>r.costSessionId===costSession.id)),id:costSession.id,startedAt:costSession.startedAt,pricingDate,retention:Math.max(10000,records.length)},session:sum(records.filter(r=>r.session===session)),today:sum(records.filter(r=>r.at.startsWith(today))),todayUTC:today,all:sum(records),groups:[...groups].map(([name,list])=>({name,...sum(list),limits:list.filter(r=>Object.keys(r.limits).length).at(-1)?.limits||{},limitsAt:list.filter(r=>Object.keys(r.limits).length).at(-1)?.at})),recent:records.slice(-50).reverse(),retention:Math.max(10000,records.length)};}
 };
}
