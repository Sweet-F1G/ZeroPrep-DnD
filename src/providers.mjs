import {readResponseStream} from './response-stream.mjs';
import {createHash} from 'node:crypto';
import {keyPool,effectivePool,keyNames} from './credentials.mjs';
import {buildSystem,fullControlSystem} from './prompts.mjs';
import {searchArchive,sourcePassages} from './memory.mjs';
import {campaignContext,SUMMARY_SYSTEM} from './context.mjs';
import {limitHeaders} from './usage.mjs';
import {wavSeconds} from './cost.mjs';
import {cachedCampaignContext,openAIInput,CACHE_CONTEXT_SYSTEM} from './openai-context.mjs';
import {gameMap} from './maps.mjs';
import {edgeSpeech,edgeSpeechChunks} from './edge-voice.mjs';
export const defaults={provider:'demo',model:'gpt-6-luna',baseUrl:'https://api.openai.com/v1',sttProvider:'openai',sttModel:'gpt-4o-mini-transcribe',ttsProvider:'system',ttsModel:'tts-1',voice:'alloy',edgeVoice:'ru-RU-DmitryNeural',sileroSpeaker:'eugene',voiceSendMode:'review',listeningMode:'ptt',bargeInMode:'any',autoSummary:'on',reserveProvider:'off',activeCampaignId:'',groqBilling:'free',reasoningEffort:'medium',voicePipeline:'cascade',liveModel:'gpt-live-1',imageProvider:'openai',imageModel:'gpt-image-2',imageQuality:'low',summaryModel:'',serviceTier:'default'};
export function providerError(status,body,contentType='',secrets=[]) {
 let message='',code='';
 try {const d=JSON.parse(body),e=d.error??d;message=typeof e==='string'?e:typeof e.message==='string'?e.message:'';code=typeof e.code==='string'?e.code:typeof e.type==='string'?e.type:'';}catch{if(!/<(?:!doctype|html|body|script)\b/i.test(body)&&!contentType.includes('text/html'))message=body;}
 const clean=s=>{for(const secret of secrets.filter(Boolean))s=s.split(secret).join('[ключ скрыт]');return s.replace(/\b(?:gsk_|sk-)[A-Za-z0-9_-]+/g,'[ключ скрыт]').replace(/[\u0000-\u001f\u007f]/g,' ').replace(/\s+/g,' ').trim().slice(0,700);};
 message=clean(message);code=clean(code).slice(0,100);
 const hint=status===401?'Провайдер отклонил авторизацию: проверьте действительность ключа.':status===403?'Провайдер запретил запрос. Возможны ограничения ключа, проекта, модели или сетевого доступа.':status===429?'Превышен лимит запросов или токенов.':status===413?'Размер одного запроса превышает лимит провайдера. Ожидание и ключ с тем же лимитом не уменьшат запрос.':'Проверьте модель и формат API.';
 return `API вернул HTTP ${status}${code?' ['+code+']':''}. ${message?'Ответ провайдера: '+message+' ':contentType.includes('text/html')?'Получена HTML-страница вместо JSON API; возможна блокировка на сетевом шлюзе. ':''}${hint}`;
}
const requestTimings=new WeakMap();
async function remote(url,options,onFailure) {
 const started=performance.now();
 let r;try {r=await fetch(url,{...options,signal:options.signal?AbortSignal.any([options.signal,AbortSignal.timeout(90000)]):AbortSignal.timeout(90000),redirect:'error'});} catch {await onFailure?.({status:0,headers:new Headers()},{});throw Object.assign(Error('Не удалось связаться с API: проверьте интернет и адрес провайдера. Тайм-аут — 90 секунд.'),{status:0});}
 requestTimings.set(r,{started,headersMs:performance.now()-started});
 if(!r.ok) {await onFailure?.(r,{});const headers=new Headers(options.headers);const secrets=[headers.get('Authorization')?.replace(/^Bearer\s+/i,''),headers.get('x-goog-api-key')];throw Object.assign(Error(providerError(r.status,await r.text(),r.headers.get('content-type')||'',secrets)),{status:r.status,retryAfter:r.headers.get('retry-after')});} return r;
}
function geminiText(d) { const parts=d.candidates?.[0]?.content?.parts||[];const text=parts.filter(x=>!x.thought).map(x=>x.text||'').join('');if(!text)throw Error('Gemini не вернул текст: проверьте доступность модели или ограничения ответа.');return text; }
function key(keys,k) {const rows=keyPool(keys,k);if(!rows.length)throw Error(`Добавьте API-ключ ${k==='gemini'?'Gemini':k==='openai'?'OpenAI':k==='groq'?'Groq':'модели'} в настройках.`);return rows[0].key;}
export function usesGroqKey(config){try{return config.provider==='compatible'&&new URL(config.baseUrl).hostname==='api.groq.com';}catch{return false;}}
const keyHealth=new Map();
const secretID=secret=>createHash('sha256').update(secret).digest('hex');
export function poolMetadata(config,keys){
 return Object.fromEntries(keyNames.map(name=>[name,(name==='compatible'&&usesGroqKey(config)&&!Object.hasOwn(keys,'groq')?[]:effectivePool(keys,name,usesGroqKey(config))).map(({id,key})=>{
  const states=[...keyHealth.entries()].filter(([k])=>k.startsWith(secretID(key)+':')).map(([,v])=>v).sort((a,b)=>b.at-a.at);
  const last=states[0];return {id,saved:true,status:last?.status??null,retryAt:last?.until||null,lastUsedAt:last?.okAt||null};
 })]));
}
async function pooledRemote(config,keys,name,url,options,log,{optional=false}={}){
 const rows=effectivePool(keys,name,usesGroqKey(config));
 if(!rows.length){if(optional)return remote(url,options,log);key({},name);}
 // Text and speech have different quotas; a speech limit must not disable narration.
 const scope=url+':'+(options.body instanceof FormData?options.body.get('model'):JSON.parse(options.body||'{}').model||'');
 let lastError,attempts=0;
 for(const row of rows){
  const id=secretID(row.key)+':'+scope,health=keyHealth.get(id);
  if(health?.until>Date.now())continue;
  attempts++;
  const headers={...options.headers};if(name==='gemini')headers['x-goog-api-key']=row.key;else headers.Authorization='Bearer '+row.key;
  try{const response=await remote(url,{...options,headers},log);keyHealth.set(id,{at:Date.now(),okAt:Date.now(),status:response.status,until:0});return response;}
  catch(error){
   if(![0,401,402,403,408,429].includes(error.status)&&!(error.status>=500&&error.status<=599))throw error;
   const retry=Number(error.retryAfter),date=Date.parse(error.retryAfter||'');
   const fallback=[401,403].includes(error.status)?300:error.status===429?60:15;
   const wait=error.retryAfter&&Number.isFinite(retry)?Math.max(1,retry):Number.isFinite(date)?Math.max(1,(date-Date.now())/1000):fallback;
   keyHealth.set(id,{at:Date.now(),status:error.status,until:Date.now()+wait*1000});lastError=error;
  }
 }
 if(lastError)throw Object.assign(Error(`Все доступные ключи (${attempts}) отказали. `+lastError.message),{status:lastError.status});
 const retryAt=Math.min(...rows.map(r=>keyHealth.get(secretID(r.key)+':'+scope)?.until||Date.now()));
 throw Object.assign(Error(`Ключи временно недоступны для этого запроса. Повторите примерно через ${Math.max(1,Math.ceil((retryAt-Date.now())/1000))} сек. или добавьте резервный ключ.`),{status:429});
}
function telemetry(config,kind,model,observe,extra={}){
 let provider=config.provider;
 if(kind==='stt')provider=config.sttProvider;
 if(kind==='tts')provider='openai';
 if(provider==='compatible'){try{provider=new URL(config.baseUrl).hostname;}catch{provider='compatible';}}
 if(config.provider==='openai'&&!['stt','tts'].includes(kind)){try{if(new URL(config.baseUrl).hostname!=='api.openai.com')provider=new URL(config.baseUrl).hostname;}catch{provider='unknown';}}
 return async(r,data)=>{const timing=requestTimings.get(r);return observe?.({provider,model,kind,status:r.status,limits:limitHeaders(r.headers),data,groqBilling:config.groqBilling||'free',...extra,...(provider==='openai'?{serviceTier:data.service_tier||config.serviceTier||'default'}:{}),...(timing?{elapsedMs:Math.round(performance.now()-timing.started),headersMs:Math.round(timing.headersMs)}:{})});};
}
async function readJSON(r,log){let d;try{d=await r.json();}catch{await log(r,{});throw Error('Провайдер вернул некорректный JSON');}await log(r,d);return d;}
async function primaryJSON(config,keys,system,input,observe,kind='narration',onNarration,onFirstSentence){
 const serialized=JSON.stringify(input);if(serialized.length>(config.provider==='openai'?2000000:180000))throw Error('Контекст слишком большой. Создайте сводку старых событий или уменьшите материалы кампании.');
 const log=telemetry(config,kind,config.model,observe);let text;
 if(config.provider==='openai'){
  const explicit=/^gpt-6(?:[.-]|$)/.test(config.model);
  const request={model:config.model,store:false,...(config.serviceTier==='fast'?{service_tier:'fast'}:{}),...(onNarration?{stream:true}:{}),input:openAIInput(system,input,{explicit}),text:{format:{type:'json_object'}},
   ...(explicit?{reasoning:{effort:config.reasoningEffort||'medium'},prompt_cache_options:{mode:'explicit',ttl:'30m'}}:{})};
  const r=await pooledRemote(config,keys,'openai','https://api.openai.com/v1/responses',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(request)},log);
  const data=onNarration?await readResponseStream(r,log,onNarration,onFirstSentence):await readJSON(r,log);
  if(data.status==='incomplete')throw Error('Ответ OpenAI не завершён. Изменения партии не применены. Повторите ход или проверьте ограничения ответа.');
  const parts=(data.output||[]).filter(item=>item.type==='message').flatMap(item=>item.content||[]);
  if(parts.some(part=>part.type==='refusal'))throw Error('OpenAI отказался отвечать на этот запрос. Изменения партии не применены.');
  text=parts.filter(part=>part.type==='output_text').map(part=>part.text).join('');
 }else if(config.provider==='gemini'){
  const r=await pooledRemote(config,keys,'gemini',`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(config.model)}:generateContent`,{method:'POST',headers:{'Content-Type':'application/json',},body:JSON.stringify({systemInstruction:{parts:[{text:system}]},contents:[{role:'user',parts:[{text:serialized}]}],generationConfig:{responseMimeType:'application/json'}})},log);
  text=geminiText(await readJSON(r,log));
 }else{
  const endpoint=new URL(config.baseUrl);if(endpoint.protocol!=='https:'&&!(endpoint.protocol==='http:'&&['localhost','127.0.0.1','[::1]'].includes(endpoint.hostname)))throw Error('Для внешнего API нужен HTTPS. HTTP разрешён только для локальной модели.');
  const name=config.provider==='openai'?'openai':usesGroqKey(config)?'groq':'compatible';
  const r=await pooledRemote(config,keys,name,config.baseUrl.replace(/\/$/,'')+'/chat/completions',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({model:config.model,messages:[{role:'system',content:system},{role:'user',content:serialized}],response_format:{type:'json_object'},...(config.freeReserve?{provider:{require_parameters:true,max_price:{prompt:0,completion:0,request:0}},max_tokens:4096}:{} )})},log,{optional:name==='compatible'});
  text=(await readJSON(r,log)).choices?.[0]?.message?.content;
 }
 try{return JSON.parse(text.replace(/^```(?:json)?\s*/,'').replace(/\s*```$/,''));}catch{throw Error('Модель не вернула JSON для игрового движка. Выберите модель с поддержкой JSON-ответов.');}
}
export const FREE_RESERVE_MODEL='google/gemma-4-31b-it:free';
// Fixed free variant + live zero-price verification + provider price ceiling. No paid model list.
let freeVerifiedUntil=0;
async function verifyFreeReserve(){
 if(Date.now()<freeVerifiedUntil)return;
 const r=await remote('https://openrouter.ai/api/v1/models',{headers:{}});
 const m=(await r.json()).data?.find(m=>m.id===FREE_RESERVE_MODEL);
 if(!m||!m.supported_parameters?.includes('response_format')||!m.pricing||!Object.hasOwn(m.pricing,'prompt')||!Object.hasOwn(m.pricing,'completion')||Object.values(m.pricing).some(v=>!Number.isFinite(Number(v))||Number(v)!==0))throw Error('Бесплатный резерв сейчас не подтверждён каталогом OpenRouter. Платный запрос не отправлен.');
 freeVerifiedUntil=Date.now()+600000;
}
export async function completeJSON(config,keys,system,input,observe,kind='narration',onNarration,onFirstSentence){
 try{return await primaryJSON(config,keys,system,input,observe,kind,onNarration,onFirstSentence);}
 catch(error){
  const retryable=[0,401,402,403,404,408,429].includes(error.status)||error.status>=500&&error.status<=599;
  if(!usesGroqKey(config)||config.reserveProvider!=='openrouter'||!retryable||!keyPool(keys,'compatible').length)throw error;
  try{
   await verifyFreeReserve();
   return await primaryJSON({...config,provider:'compatible',baseUrl:'https://openrouter.ai/api/v1',model:FREE_RESERVE_MODEL,freeReserve:true},keys,system,input,observe,kind);
  }catch(reserveError){throw Error('Groq недоступен; бесплатный резерв тоже не ответил. '+reserveError.message);}
 }
}
export async function generate(config,keys,c,observe,onNarration,onFirstSentence){
 const system=buildSystem(c)+'\n\n'+fullControlSystem+(config.provider==='openai'?'\n\n'+CACHE_CONTEXT_SYSTEM:''),context=config.provider==='openai'?cachedCampaignContext(c):campaignContext(c);let reply=await completeJSON(config,keys,system,context,observe,'narration',onNarration,onFirstSentence);
 if(typeof reply.recall_query==='string'&&reply.recall_query.trim()){
  const query=reply.recall_query.slice(0,300),recall={query,events:searchArchive(c,query,10),...(config.provider==='openai'?{sourceAlreadyInReference:true}:{source:sourcePassages(c.source,query,16000)})};
  reply=await completeJSON(config,keys,system,{...context,recall},observe,'recall');
  if(reply.recall_query)throw Error('Мастер не нашёл достаточно сведений в архиве. Уточните вопрос или добавьте факт в память.');
 }
 return reply;
}
export const summarize=(config,keys,plan,observe)=>completeJSON(config.summaryModel?{...config,provider:'openai',model:config.summaryModel}:config,keys,SUMMARY_SYSTEM,{previous:plan.previous,events:plan.events},observe,'summary');

export const MAP_GENERATOR_SYSTEM = `Ты тактический картограф настольной D&D 5e / 2024.
Твоя задача — составить подробную и реалистичную тактическую карту местности (сетку 2D) по описанию кампании, материалов и текущей сцены.
Ты должен мыслить как мастер боевых столкновений: предусмотреть интересные укрытия, высоту, ориентиры, дистанции и расставить участников.

Ответ СТРОГО JSON без markdown со следующей структурой:
{
  "id": "map-scene-1",
  "name": "Название карты (напр., 'Тракт у старой башни', 'Трапезная таверны «Клыкастый вепрь»')",
  "width": 14,
  "height": 14,
  "feetPerCell": 5,
  "description": "Тактическое описание местности: видимость, укрытия, двери, препятствия, высоты, свет",
  "tokens": [
    {"id": "hero-1", "label": "Теон", "characterId": "точный-id-из-списка", "kind": "hero", "x": 6, "y": 12},
    {"id": "enemy-1", "label": "Разбойник", "characterId": null, "kind": "enemy", "x": 6, "y": 3},
    {"id": "obj-1", "label": "Обломки стены (укрытие)", "characterId": null, "kind": "object", "x": 5, "y": 8}
  ]
}

ПРАВИЛА ПОСТРОЕНИЯ КАРТЫ:
1. Размеры width и height: от 10 до 22 клеток (стандартно 12–16). 1 клетка = 5 футов.
2. Координаты x от 0 до width-1, y от 0 до height-1. Не помещай маркеры в одну клетку.
3. ОБЯЗАТЕЛЬНО размести ВСЕХ героев из переданного списка characters с их точным characterId и kind="hero" в логичной стартовой позиции (группой у входа, дороги или лагеря).
4. Размести от 3 до 8 тактических объектов (укрытия, деревья, валуны, костёр, ящики, колонны, провалы, алтарь, повозка) с kind="object".
5. Если в сцене есть или подразумеваются враги, монстры или стража — размести 1–6 противников с kind="enemy" на дистанции 25–45 футов (5–9 клеток) от героев.
6. Если врагов нет (мирная сцена, привал, таверна) — размести мирных NPC или ключевые зоны интереса с kind="object".
7. Название и описание должны быть яркими и полезными для позиционирования и бросков.`;

export const WORLD_MAP_GENERATOR_SYSTEM = `Ты картограф мира и глобального региона настольной D&D 5e / 2024.
Твоя задача — составить обзорную карту региона / окружающих земель (сетку 2D от 14 до 22 клеток, масштаб 1 клетка = 3–5 миль / 1 лига, feetPerCell: 15000) по описанию кампании, сеттинга и сюжета.
Ты должен мыслить как мастер открытого мира: наметить ключевые тракты, поселения, опасные логова, древние руины, природные преграды и указать текущее местоположение отряда.

Ответ СТРОГО JSON без markdown:
{
  "id": "map-world",
  "name": "Карта региона: Название земель",
  "width": 18,
  "height": 16,
  "feetPerCell": 15000,
  "description": "Обзорная карта региона: ключевые тракты, поселения, дикие земли, подземелья и текущая стоянка отряда.",
  "tokens": [
    {"id": "party-pos", "label": "Стоянка отряда (Теон и Альвари)", "characterId": null, "kind": "hero", "x": 8, "y": 8},
    {"id": "loc-city", "label": "Город / Столица региона", "characterId": null, "kind": "object", "x": 4, "y": 4},
    {"id": "loc-inn", "label": "Трактир на распутье", "characterId": null, "kind": "object", "x": 8, "y": 7},
    {"id": "loc-tower", "label": "Старая башня (ориентир)", "characterId": null, "kind": "object", "x": 9, "y": 8},
    {"id": "loc-forest", "label": "Древний шепчущий лес", "characterId": null, "kind": "object", "x": 13, "y": 5},
    {"id": "loc-dungeon", "label": "Забытые катакомбы (руины)", "characterId": null, "kind": "enemy", "x": 14, "y": 12},
    {"id": "loc-pass", "label": "Горный перевал ветров", "characterId": null, "kind": "object", "x": 2, "y": 12}
  ]
}

ПРАВИЛА ПОСТРОЕНИЯ КАРТЫ РЕГИОНА:
1. Размеры width 16–20, height 14–18. feetPerCell: 15000 (1 лига / 3 мили).
2. Обязательно размести маркер отряда с kind="hero" в клетке текущего пребывания партии.
3. Размести 4–8 ключевых локаций: города, деревни, тракты, переправы, мосты, леса, горы (kind="object").
4. Размести 2–4 опасные точки / слухи о логовах чудовищ или разбойников (kind="enemy").
5. Название и описание должны быть яркими и полезными для путешествий и ориентирования.`;

export function proceduralMap(c, focus = '', mode = 'tactical') {
 const isWorld = mode === 'world';
 const width = isWorld ? 18 : 14, height = isWorld ? 16 : 14;
 const feetPerCell = isWorld ? 15000 : 5;
 const name = focus || (isWorld 
  ? `Карта региона: ${c.setting || c.name}` 
  : (c.dm?.location ? `Схема: ${c.dm.location}` : `Схема: ${c.name}`));
 const description = isWorld
  ? `Обзорная карта окрестных земель и трактов. 1 клетка = 1 лига (3 мили). Отмечены поселения, опасные зоны и текущее положение партии.`
  : (focus 
    ? `Тактическая схема для «${focus}». 1 клетка = 5 футов. Обозначены позиции героев, ориентиры и укрытия.`
    : `Местность: ${c.setting || 'Окружающая местность'}. 1 клетка = 5 футов. Отмечены позиции партии, укрытия и ключевые точки.`);
 
 const tokens = [];
 const heroes = c.characters || [];

 if (isWorld) {
  tokens.push({
   id: 'world-party',
   label: `Отряд (${heroes.map(h => h.name).join(', ') || 'Герои'})`,
   characterId: null,
   kind: 'hero',
   x: 8,
   y: 8
  });
  tokens.push(
   { id: 'loc-capital', label: 'Город / Торговый оплот', characterId: null, kind: 'object', x: 4, y: 4 },
   { id: 'loc-inn', label: 'Придорожный трактир', characterId: null, kind: 'object', x: 8, y: 7 },
   { id: 'loc-landmark', label: c.dm?.location || 'Старая башня у тракта', characterId: null, kind: 'object', x: 9, y: 8 },
   { id: 'loc-forest', label: 'Древняя пуща / чаща', characterId: null, kind: 'object', x: 13, y: 5 },
   { id: 'loc-pass', label: 'Горный кряж / перевал', characterId: null, kind: 'object', x: 3, y: 12 },
   { id: 'loc-danger', label: 'Забытые катакомбы (опасность)', characterId: null, kind: 'enemy', x: 14, y: 12 }
  );
 } else {
  const startY = height - 2;
  const startX = Math.floor(width / 2);
  heroes.forEach((h, idx) => {
   tokens.push({
    id: `hero-${h.id}`,
    label: h.name,
    characterId: h.id,
    kind: 'hero',
    x: Math.max(1, Math.min(width - 2, startX - Math.floor(heroes.length / 2) + idx)),
    y: startY
   });
  });

  const text = `${c.name} ${c.setting || ''} ${c.source || ''} ${focus}`.toLowerCase();
  if (text.includes('башн') || text.includes('руин') || text.includes('крепост')) {
   tokens.push(
    { id: 'obj-tower', label: 'Старая башня', characterId: null, kind: 'object', x: 7, y: 3 },
    { id: 'obj-wall-1', label: 'Обломки стены (укрытие)', characterId: null, kind: 'object', x: 4, y: 6 },
    { id: 'obj-wall-2', label: 'Каменная кладка', characterId: null, kind: 'object', x: 10, y: 7 },
    { id: 'obj-tree', label: 'Сухое дерево', characterId: null, kind: 'object', x: 2, y: 10 },
    { id: 'enemy-scout', label: 'Фигура у башни', characterId: null, kind: 'enemy', x: 7, y: 5 }
   );
  } else if (text.includes('таверн') || text.includes('трактир') || text.includes('зал')) {
   tokens.push(
    { id: 'obj-bar', label: 'Стойка трактирщика', characterId: null, kind: 'object', x: 7, y: 2 },
    { id: 'obj-table-1', label: 'Дубовый стол', characterId: null, kind: 'object', x: 4, y: 6 },
    { id: 'obj-table-2', label: 'Стол у очага', characterId: null, kind: 'object', x: 10, y: 6 },
    { id: 'obj-hearth', label: 'Камин', characterId: null, kind: 'object', x: 12, y: 2 },
    { id: 'obj-door', label: 'Входные двери', characterId: null, kind: 'object', x: 7, y: 13 }
   );
  } else if (text.includes('подземел') || text.includes('пещер') || text.includes('склеп') || text.includes('катакомб')) {
   tokens.push(
    { id: 'obj-altar', label: 'Древний алтарь', characterId: null, kind: 'object', x: 7, y: 3 },
    { id: 'obj-pillar-1', label: 'Колонна зала', characterId: null, kind: 'object', x: 4, y: 6 },
    { id: 'obj-pillar-2', label: 'Колонна зала', characterId: null, kind: 'object', x: 10, y: 6 },
    { id: 'obj-rubble', label: 'Завал камней (укрытие)', characterId: null, kind: 'object', x: 3, y: 9 },
    { id: 'enemy-1', label: 'Страж покоев', characterId: null, kind: 'enemy', x: 7, y: 5 }
   );
  } else {
   tokens.push(
    { id: 'obj-road', label: 'Тракт / тропа', characterId: null, kind: 'object', x: 7, y: 7 },
    { id: 'obj-rock', label: 'Валун (укрытие)', characterId: null, kind: 'object', x: 4, y: 7 },
    { id: 'obj-trees-1', label: 'Густой кустарник', characterId: null, kind: 'object', x: 11, y: 8 },
    { id: 'obj-camp', label: 'Кострище', characterId: null, kind: 'object', x: 7, y: 10 },
    { id: 'enemy-scout', label: 'Дозорный', characterId: null, kind: 'enemy', x: 7, y: 3 }
   );
  }
 }

 return gameMap({
  id: isWorld ? 'map-world' : ('map-' + Date.now()),
  name: name.slice(0, 120),
  width,
  height,
  feetPerCell,
  description: description.slice(0, 3000),
  tokens
 }, c);
}

export async function generateTacticalMap(config, keys, c, observe, focus = '', mode = 'tactical') {
 if (config.provider === 'demo') {
  return proceduralMap(c, focus, mode);
 }

 const isWorld = mode === 'world';
 const mapContext = {
  campaign: c.name,
  setting: c.setting,
  mode,
  focus: focus || (isWorld ? 'Карта региона / окрестных земель' : ''),
  sourceExcerpt: (c.source || '').slice(0, 4000),
  currentLocation: c.dm?.location || '',
  weather: c.dm?.weather || '',
  recentEvents: (c.journal || []).slice(-6).map(j => `${j.role}: ${j.text.slice(0, 250)}`),
  characters: (c.characters || []).map(h => ({ id: h.id, name: h.name, className: h.className, level: h.level }))
 };

 try {
  const systemPrompt = isWorld ? WORLD_MAP_GENERATOR_SYSTEM : MAP_GENERATOR_SYSTEM;
  const reply = await completeJSON(config, keys, systemPrompt, mapContext, observe, 'map-generate');
  const width = Math.max(8, Math.min(40, Number(reply?.width) || (isWorld ? 18 : 14)));
  const height = Math.max(8, Math.min(40, Number(reply?.height) || (isWorld ? 16 : 14)));
  const rawTokens = Array.isArray(reply?.tokens) ? reply.tokens : [];
  const tokens = [];
  const seenCoords = new Set();

  for (const t of rawTokens) {
   let charId = t.characterId || null;
   if (charId && !c.characters.some(h => h.id === charId)) {
    const matched = c.characters.find(h => h.name.toLowerCase() === String(t.label || '').toLowerCase());
    charId = matched ? matched.id : null;
   }
   const x = Math.max(0, Math.min(width - 1, Number(t.x) || 0));
   const y = Math.max(0, Math.min(height - 1, Number(t.y) || 0));
   const coord = `${x}:${y}`;
   if (seenCoords.has(coord)) continue;
   seenCoords.add(coord);
   tokens.push({
    id: String(t.id || `token-${tokens.length + 1}`).slice(0, 100),
    label: String(t.label || 'Объект').slice(0, 80),
    characterId: charId,
    kind: ['hero', 'enemy', 'object'].includes(t.kind) ? t.kind : (charId ? 'hero' : 'object'),
    x,
    y
   });
  }

  if (!isWorld) {
   (c.characters || []).forEach((h, idx) => {
    if (!tokens.some(t => t.characterId === h.id)) {
     let hx = Math.max(0, Math.min(width - 1, Math.floor(width / 2) - 1 + (idx % 3)));
     let hy = Math.max(0, Math.min(height - 1, height - 2 - Math.floor(idx / 3)));
     while (seenCoords.has(`${hx}:${hy}`) && hy > 0) hy--;
     seenCoords.add(`${hx}:${hy}`);
     tokens.push({
      id: `hero-${h.id}`,
      label: h.name,
      characterId: h.id,
      kind: 'hero',
      x: hx,
      y: hy
     });
    }
   });
  } else if (!tokens.some(t => t.kind === 'hero')) {
   tokens.push({
    id: 'world-party',
    label: `Отряд (${(c.characters || []).map(h => h.name).join(', ') || 'Герои'})`,
    characterId: null,
    kind: 'hero',
    x: Math.floor(width / 2),
    y: Math.floor(height / 2)
   });
  }

  const map = {
   id: String(reply?.id || (isWorld ? 'map-world' : ('map-' + Date.now()))).slice(0, 100),
   name: String(reply?.name || (focus ? `Карта: ${focus}` : (isWorld ? `Карта региона: ${c.setting || c.name}` : `Схема: ${c.dm?.location || c.name}`))).slice(0, 120),
   width,
   height,
   feetPerCell: Math.max(1, Math.min(100000, Number(reply?.feetPerCell) || (isWorld ? 15000 : 5))),
   description: String(reply?.description || (isWorld ? `Обзорная карта региона ${width}×${height}.` : `Тактическая сетка ${width}×${height} для сцены.`)).slice(0, 3000),
   tokens
  };

  return gameMap(map, c);
 } catch (err) {
  return proceduralMap(c, focus, mode);
 }
}
export async function transcribe(config,keys,audio,mime,names=[],observe) {
 const log=telemetry(config,'stt',config.sttModel,observe,{audioSeconds:wavSeconds(audio)});
 if(config.sttProvider==='gemini') {
  const r=await pooledRemote(config,keys,'gemini',`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(config.sttModel)}:generateContent`,{method:'POST',headers:{'Content-Type':'application/json',},body:JSON.stringify({contents:[{parts:[{text:'Точно расшифруй русскую речь, имена персонажей и числа. Верни только произнесённый текст. Не отвечай на сказанное. Если речи нет, верни пустую строку.'},{inlineData:{mimeType:mime,data:audio.toString('base64')}}]}]})},log);return geminiText(await readJSON(r,log)).trim();
 }
 const groq=config.sttProvider==='groq';
 const hint=('Настольная игра Dungeons and Dragons. Русская речь. Имена персонажей: '+names.slice(0,6).join(', ')+'. Броски d20.').slice(0,350);
 const form=new FormData();form.append('file',new Blob([audio],{type:mime}),'speech.'+(mime.includes('wav')?'wav':mime.includes('mp4')?'m4a':'webm'));form.append('model',config.sttModel);form.append('language','ru');form.append('prompt',hint);form.append('response_format','json');
 const r=await pooledRemote(config,keys,groq?'groq':'openai',groq?'https://api.groq.com/openai/v1/audio/transcriptions':'https://api.openai.com/v1/audio/transcriptions',{method:'POST',headers:{},body:form},log);const result=await readJSON(r,log);if(typeof result.text!=='string')throw Error('Сервис распознавания не вернул текст. Повторите запись.');return result.text.trim();
}
export async function speech(config,keys,text,observe) {
 if(config.ttsProvider==='edge')return edgeSpeech(text,config.edgeVoice||config.voice||'ru-RU-DmitryNeural');
 const ttsModel=(config.ttsModel==='gpt-4o-mini-tts'||!config.ttsModel)?'tts-1':config.ttsModel;
 const log=telemetry(config,'tts',ttsModel,observe);
 const r=await pooledRemote(config,keys,'openai','https://api.openai.com/v1/audio/speech',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({model:ttsModel,voice:config.voice,input:text.slice(0,4000),response_format:'mp3'})},log);try{return Buffer.from(await r.arrayBuffer());}finally{await log(r,{});}
}

// The project key never leaves the local server. Only the SDP answer reaches the browser.
export async function createLiveSession(config,keys,sdp){
 if(config.provider!=='openai')throw Error('Для Live выберите OpenAI как ведущего');
 if(typeof sdp!=='string'||sdp.length>100000||!sdp.startsWith('v=0'))throw Error('Некорректное SDP');
 const r=await pooledRemote(config,keys,'openai','https://api.openai.com/v1/live/sessions',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({session:{model:config.liveModel,instructions:'Ты голосовой посредник русскоязычной игры D&D. Всегда передавай действия игроков, броски и вопросы правил через client delegation мастеру Luna. Не решай исходы, не придумывай состояние мира, не меняй HP, предметы или способности самостоятельно. Озвучивай только полученный результат. При перебивке прекрати речь и выслушай игроков. Не произноси секреты мастера и технические данные.',delegation:{type:'client'}},transport:{type:'webrtc',sdp}})},undefined);
 const data=await r.json();if(!data.session?.id||typeof data.transport?.sdp!=='string')throw Error('Live не вернул SDP ответа');
 return {id:data.session.id,sdp:data.transport.sdp};
}
export async function generateImage(config,keys,prompt,observe){
 const log=telemetry({...config,provider:'openai'},'image',config.imageModel,observe);
 const r=await pooledRemote(config,keys,'openai','https://api.openai.com/v1/images/generations',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({model:config.imageModel,prompt,size:'1024x1024',quality:config.imageQuality,n:1,output_format:'png'})},log);
 const data=await readJSON(r,log);if(!data.data?.[0]?.b64_json)throw Error('OpenAI не вернул изображение');return data;
}

export async function* speechChunks(config,keys,text,observe,signal){
 if(config.ttsProvider==='edge'){
  yield* edgeSpeechChunks(text,config.edgeVoice||config.voice||'ru-RU-DmitryNeural',signal);
  return;
 }
 const ttsModel=(config.ttsModel==='gpt-4o-mini-tts'||!config.ttsModel)?'tts-1':config.ttsModel;
 const log=telemetry(config,'tts',ttsModel,observe);
 const r=await pooledRemote(config,keys,'openai','https://api.openai.com/v1/audio/speech',{method:'POST',signal,headers:{'Content-Type':'application/json'},body:JSON.stringify({model:ttsModel,voice:config.voice,input:text.slice(0,4000),response_format:'mp3'})},log);
 try{for await(const chunk of r.body)yield chunk;}finally{await log(r,{});}
}
