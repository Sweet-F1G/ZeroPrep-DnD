// USD, Standard processing, checked 2026-10-18. Unknown tariffs stay unknown.
// https://developers.openai.com/api/docs/models/gpt-6.1-sol
// https://developers.openai.com/api/docs/models/gpt-6-luna
// https://developers.openai.com/api/docs/pricing
export const pricingDate='2026-10-18';
const valid=n=>typeof n==='number'&&Number.isFinite(n)&&n>=0;
const openaiText={'gpt-6-astra':[10,50,1],'gpt-6.1-sol':[2,10,.1],'gpt-6-luna':[.1,.5,.01],'gpt-4o':[2.5,10,1.25],'gpt-4o-mini':[.15,.6,.075]};
export function estimateCost(event,usage){
 const provider=event.provider,model=event.model,data=event.data||{};
 const reported=data.usage?.cost;
 if(provider==='openai'&&event.kind==='live'&&model==='gpt-live-1'&&valid(event.audioSeconds))return {usd:event.audioSeconds/60*.05,basis:'live-duration-estimate',pricingDate};
 if(provider==='openai'&&event.kind==='image'&&model==='gpt-image-2'&&valid(usage.input)&&valid(usage.output)){const t=data.usage?.input_tokens_details?.text_tokens,i=data.usage?.input_tokens_details?.image_tokens;if(valid(t)&&valid(i))return {usd:(t*2.5+i*4+usage.output*15)/1e6,basis:'tokens',pricingDate};}
 if(provider==='openrouter.ai'&&valid(reported))return {usd:reported,basis:'provider',pricingDate};
 if(['groq','api.groq.com'].includes(provider)&&event.groqBilling==='free')return {usd:0,basis:'free',pricingDate};
 if(provider==='openrouter.ai'&&model==='google/gemma-4-31b-it:free')return {usd:0,basis:'free',pricingDate};
 if(event.status>=400&&!valid(usage.input)&&!valid(usage.output))return {usd:0,basis:'rejected',pricingDate};
 let rate=provider==='openai'?openaiText[model]:['groq','api.groq.com'].includes(provider)&&model==='openai/gpt-oss-120b'?[.15,.6,.075]:null;
 if(rate&&valid(usage.input)&&valid(usage.output)){
  const long=provider==='openai'&&usage.input>272000,cached=Math.min(usage.input,usage.cached||0),writes=provider==='openai'?Math.min(usage.input-cached,usage.cacheWrite||0):0;
  const tier=data.service_tier||event.serviceTier||'default';if(provider==='openai'&&!['default','auto','fast','priority'].includes(tier))return {usd:null,basis:'unknown',pricingDate};
  const [input,output,cache]=rate.map(v=>v*(provider==='openai'&&['fast','priority'].includes(tier)?2:1));return {usd:((usage.input-cached-writes)*input*(long?2:1)+writes*input*1.25*(long?2:1)+cached*cache*(long?2:1)+usage.output*output*(long?1.5:1))/1e6,basis:'tokens',pricingDate};
 }
 const seconds=event.audioSeconds??data.usage?.seconds;
 const minuteRate=provider==='openai'?({'gpt-4o-mini-transcribe':.003,'gpt-4o-transcribe':.006,'gpt-transcribe':.0045})[model]:['groq','api.groq.com'].includes(provider)&&model==='whisper-large-v3-turbo'?.04/60:null;
 if(event.kind==='stt'&&valid(seconds)&&valid(minuteRate))return {usd:(provider==='groq'||provider==='api.groq.com'?Math.max(10,seconds):seconds)/60*minuteRate,basis:'audio-duration',pricingDate};
 if(provider==='openai'&&event.kind==='tts'&&model==='gpt-4o-mini-tts'&&valid(usage.input)&&valid(usage.output))return {usd:(usage.input*.6+usage.output*12)/1e6,basis:'tokens',pricingDate};
 return {usd:null,basis:'unknown',pricingDate};
}
export function wavSeconds(audio){
 if(audio.length<12||audio.toString('ascii',0,4)!=='RIFF'||audio.toString('ascii',8,12)!=='WAVE')return null;
 let rate=null,size=null;
 for(let i=12;i+8<=audio.length;){const n=audio.readUInt32LE(i+4),type=audio.toString('ascii',i,i+4);if(i+8+n>audio.length)return null;if(type==='fmt '&&n>=16)rate=audio.readUInt32LE(i+16);if(type==='data')size=n;i+=8+n+(n%2);}
 return rate>0&&size!==null?size/rate:null;
}
export function costTotals(records){
 let usd=0,unknown=0,estimated=0,free=0;
 for(const r of records){const c=r.cost;if(!c||!valid(c.usd))unknown++;else{usd+=c.usd;if(!['provider','free','rejected'].includes(c.basis))estimated++;if(c.basis==='free')free++;}}
 return {usd,unknown,estimated,free,requests:records.length,complete:unknown===0};
}
