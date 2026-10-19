import {randomUUID,createHash} from 'node:crypto';import fs from 'node:fs/promises';import path from 'node:path';
const endpoint='https://aihorde.net/api/v2/generate',anonymousKey='0000000000';
const headers={'Content-Type':'application/json',apikey:anonymousKey,'Client-Agent':'Skazitel:0.4.0:local-app'};
async function request(url,options={}){let response;try{response=await fetch(url,{...options,headers:{...headers,...options.headers},signal:AbortSignal.timeout(20000),redirect:'error'});}catch{throw Error('Бесплатная очередь изображений сейчас недоступна. Игра может продолжаться.');}if(!response.ok)throw Error(`AI Horde: HTTP ${response.status}. Бесплатная очередь недоступна; платный резерв не используется.`);return response.json();}
export const imageFingerprint=(prompt,kind,characterId)=>createHash('sha256').update(JSON.stringify({prompt:prompt.trim(),kind,characterId})).digest('hex');
export async function queueIllustration({prompt,kind='scene',characterId=''}){
 prompt=String(prompt||'').trim();if(prompt.length<5||prompt.length>1500)throw Error('Описание изображения: от 5 до 1500 символов');if(!['portrait','scene'].includes(kind))throw Error('Неизвестный тип изображения');
 const data=await request(endpoint+'/async',{method:'POST',body:JSON.stringify({prompt,params:{width:512,height:512,steps:20,n:1},r2:false,shared:true,nsfw:false,censor_nsfw:true,trusted_workers:true,validated_backends:true,slow_workers:true,allow_downgrade:true})});
 if(!/^[a-f0-9-]{36}$/i.test(data.id||''))throw Error('AI Horde не подтвердил очередь');
 return {id:randomUUID(),remoteId:data.id,kind,characterId,prompt,fingerprint:imageFingerprint(prompt,kind,characterId),status:'queued',public:true,costUsd:0,createdAt:new Date().toISOString()};
}
export async function checkIllustration(job,directory){
 if(job.status!=='queued')return job;if(!/^[a-f0-9-]{36}$/i.test(job.remoteId||''))throw Error('Некорректный номер очереди');
 const status=await request(endpoint+'/check/'+job.remoteId);if(status.faulted)return {...job,status:'failed',message:'Бесплатный обработчик завершился с ошибкой. Можно попробовать новое описание.'};
 if(!status.done)return {...job,queuePosition:Number.isFinite(status.queue_position)?Math.max(0,status.queue_position):null,waitSeconds:Number.isFinite(status.wait_time)?Math.max(0,status.wait_time):null,possible:status.is_possible!==false};
 const data=await request(endpoint+'/status/'+job.remoteId),generation=data.generations?.[0];if(!generation)return {...job,status:'failed',message:'Обработчик не вернул изображение'};
 if(generation.censored||['censored','csam'].includes(generation.state))return {...job,status:'censored',message:'Изображение скрыто фильтром сервиса'};
 const encoded=generation.img;if(typeof encoded!=='string'||encoded.length>12000000||!/^[a-zA-Z0-9+/=\s]+$/.test(encoded))throw Error('Ожидалось изображение, а не внешняя ссылка');
 const bytes=Buffer.from(encoded,'base64');let ext;if(bytes.toString('ascii',0,4)==='RIFF'&&bytes.toString('ascii',8,12)==='WEBP')ext='webp';else if(bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])))ext='png';else if(bytes[0]===255&&bytes[1]===216&&bytes[2]===255)ext='jpg';else throw Error('Сервис вернул неподдерживаемый формат изображения');
 if(!bytes.length||bytes.length>8000000)throw Error('Изображение слишком большое');await fs.mkdir(directory,{recursive:true,mode:0o700});const file=job.id+'.'+ext,temp=path.join(directory,file+'.tmp');await fs.writeFile(temp,bytes,{mode:0o600});await fs.rename(temp,path.join(directory,file));
 return {...job,status:'ready',file,model:String(generation.model||'').slice(0,150),completedAt:new Date().toISOString()};
}

export async function saveOpenAIImage(data,{prompt,kind,characterId,model,quality},directory){
 const encoded=data.data?.[0]?.b64_json;if(typeof encoded!=='string'||encoded.length>24000000||!/^[a-zA-Z0-9+/=\s]+$/.test(encoded))throw Error('Некорректное изображение OpenAI');
 const bytes=Buffer.from(encoded,'base64');if(!bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])))throw Error('Ожидался PNG');
 const id=randomUUID(),file=id+'.png';await fs.mkdir(directory,{recursive:true,mode:0o700});const temp=path.join(directory,file+'.tmp');await fs.writeFile(temp,bytes,{mode:0o600});await fs.rename(temp,path.join(directory,file));
 return {id,file,kind,characterId,prompt,model,quality,provider:'openai',public:false,status:'ready',fingerprint:imageFingerprint(prompt,kind,characterId),createdAt:new Date().toISOString(),completedAt:new Date().toISOString()};
}
