import {AudioStreams} from './audio-stream.mjs';
import {gameMap} from './maps.mjs';
import {buildPortraitPrompt} from './public/portrait-prompt.mjs';
import {dmState,publicDM,worldRecord} from './dm-state.mjs';import {heroRecords} from './progression.mjs';
import http from 'node:http';
import https from 'node:https';
import {execSync} from 'node:child_process';
import os from 'node:os';
import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {randomUUID,randomBytes} from 'node:crypto';
import {queueIllustration,checkIllustration,imageFingerprint,saveOpenAIImage} from './illustrations.mjs';
import {createCampaignStore} from './campaign-store.mjs';
import {applyActions,approveAction,localCommand,proposeActions,playerSpeech} from './actions.mjs';
import {memoryRecord,searchArchive,operationHash,remember} from './memory.mjs';
import {validateInventory,inventoryItem} from './inventory.mjs';
import {integer,useResource,rest} from './rules.mjs';
import {makeCampaign,character,checkpoint,undo,resolveRoll,acceptReply,approveProposal,demoReply,updateReactionClock} from './engine.mjs';
import {defaults,generate,summarize,transcribe,speech,poolMetadata,usesGroqKey,createLiveSession,generateImage,speechChunks,generateTacticalMap} from './providers.mjs';
import {localVoiceStatus,sileroSpeech,sileroSpeakers,closeLocalVoice} from './local-voice.mjs';
import {edgeVoiceStatus,edgeSpeech,edgeVoices} from './edge-voice.mjs';
import {beginSessionZero,sessionZeroTurn,restoreSessionZero} from './session-zero.mjs';
import {credentialStore,mergeKeys,keyPool} from './credentials.mjs';
import {createUsageStore} from './usage.mjs';
import {summaryPlan,setSummary,summaryValid} from './context.mjs';
import {stageReply,advanceDelivery,interruptDelivery,publicDelivery,narrationParts,resolveOpenAiVoice,resolveEdgeVoice} from './delivery.mjs';
console.log('SKAZITEL_BOOT=imports-ready');
const root=path.dirname(fileURLToPath(import.meta.url));
let keyHelper=process.env.SKAZITEL_KEYCHAIN_HELPER;
if(keyHelper){const stable=path.resolve(root,'../KeyStore.app/Contents/MacOS/Skazitel');try{await fs.access(stable);keyHelper=stable;}catch{}}
const keyStore=credentialStore(keyHelper);let keyStorageError='',keysLoading=true;
const dataDir=process.env.SKAZITEL_DATA||path.join(root,'data');await fs.mkdir(dataDir,{recursive:true});
console.log('SKAZITEL_BOOT=data-ready');
const usageStore=await createUsageStore(dataDir);console.log('SKAZITEL_BOOT=usage-ready');let usageError='';
let lastTextRoute=null;
const observe=async event=>{if(event.kind==='narration'&&event.status>=200&&event.status<300)lastTextRoute={provider:event.provider,model:event.model,at:new Date().toISOString()};try{await usageStore.record(event);usageError='';}catch{usageError='Не удалось сохранить статистику расхода токенов.';}};
const token=process.env.SKAZITEL_TOKEN||randomBytes(32).toString('hex');
const playerToken=process.env.SKAZITEL_PLAYER_TOKEN||randomBytes(16).toString('hex');
function getLanIps(){const ips=[];try{const ifaces=os.networkInterfaces();for(const name of Object.keys(ifaces)){for(const iface of ifaces[name]||[]){if(iface.family==='IPv4'&&!iface.internal)ips.push(iface.address);}}}catch{}return ips;}
const sseClients=new Set();
function broadcast(eventName,data){const payload=`event: ${eventName}\ndata: ${JSON.stringify(data)}\n\n`;for(const client of sseClients){try{client.write(payload);}catch{sseClients.delete(client);}}}
function broadcastLanConnections(){broadcast('lan-clients',{count:sseClients.size});}
let config={...defaults},keys={},campaigns=[];const busy=new Set();
const keysReady=(async()=>{try{keys=await keyStore.load();}catch(e){keyStorageError=e.message;}finally{keysLoading=false;}})();
console.log('SKAZITEL_BOOT=keys-requested');
const voiceStatus=await localVoiceStatus(),edgeStatus=await edgeVoiceStatus();
try { config={...defaults,...JSON.parse(await fs.readFile(path.join(dataDir,'settings.json'),'utf8'))}; }catch(e){if(e.code!=='ENOENT')throw Error('Повреждён settings.json. Сохраните копию и восстановите файл.');}
if(config.ttsModel==='gpt-4o-mini-tts'||!config.ttsModel) config.ttsModel='tts-1';
console.log('SKAZITEL_BOOT=settings-ready');
const campaignStore=await createCampaignStore(dataDir);console.log('SKAZITEL_BOOT=database-ready');campaigns=campaignStore.load();
function normalizeCampaign(c){c.edition??='legacy';c.schemaVersion=5;c.dm=dmState(c.dm);c.clockMinutes??=0;c.memory??=[];c.inventory??=[];c.wallet??={group:0};c.loot??=[];c.actionProposals??=[];c.receipts??=[];c.images??=[];c.maps??=[];c.characters=c.characters.map(h=>({...character(h),id:h.id}));return c;}
for(const c of campaigns)normalizeCampaign(c);
let commitQueue=Promise.resolve();
async function commitCampaign(c){const task=commitQueue.then(async()=>{normalizeCampaign(c);const latest=campaigns.find(x=>x.id===c.id);if(latest?.images)c.images=latest.images;const next=campaigns.slice(),index=next.findIndex(x=>x.id===c.id);if(index>=0)next[index]=c;else next.push(c);await campaignStore.save(next);campaigns=next;broadcast('campaign',{campaignId:c.id});});commitQueue=task.catch(()=>{});return task;}
for(const c of campaigns)interruptDelivery(c);
for(const c of campaigns)if(c.reaction){const r=c.reaction;r.remainingMs=r.deadlineAt?Math.max(0,r.deadlineAt-Date.now()):(r.remainingMs??30000);r.deadlineAt=null;r.paused=true;}
let queue=Promise.resolve(),settingsLock=Promise.resolve();
async function save(name,data){const serialized=JSON.stringify(data,null,2);const task=queue.then(async()=>{const f=path.join(dataDir,name+'.json'),temp=f+'.'+randomUUID()+'.tmp';await fs.writeFile(temp,serialized,{mode:0o600});await fs.rename(temp,f);});queue=task.catch(()=>{});return task;}
const liveSessions=new Map();let liveStarting=false;
const summaryBusy=new Set();
const imageBusy=new Set(),imageChecks=new Map();
async function updateImage(campaignId,fn){const task=commitQueue.then(async()=>{const index=campaigns.findIndex(c=>c.id===campaignId);if(index<0)throw Error('Кампания не найдена');const c=structuredClone(campaigns[index]);fn(c);const next=campaigns.slice();next[index]=c;await campaignStore.save(next);campaigns=next;broadcast('campaign',{campaignId});});commitQueue=task.catch(()=>{});await task;}
function publicCampaign(c){const {undo,source,...rest}=c;return {...rest,dm:publicDM(c.dm),actionProposals:(c.actionProposals||[]).map(p=>p.action.type==='world.update'&&(p.action.entry?.visibility==='gm'||c.dm?.world?.some(w=>w.id===p.action.entry?.id&&w.visibility==='gm'))?{...p,reason:'Скрытая запись мира',action:{type:'world.update',entry:{visibility:'gm'}}}:p),journal:c.journal.slice(-120),journalTotal:c.journal.length,receipts:undefined,delivery:publicDelivery(c.delivery),summaryValid:summaryValid(c),sourceLength:source.length,canUndo:undo.length>0};}
function state(){return {config,storage:campaignStore.status(),lastTextRoute,usage:usageStore.report(),usageError,keyStorage:{persistent:keyStore.persistent,loading:keysLoading,error:keyStorageError},localVoice:voiceStatus,edgeVoice:edgeStatus,keyPools:poolMetadata(config,keys),keysPresent:Object.fromEntries(Object.entries(poolMetadata(config,keys)).map(([k,v])=>[k,v.length>0])),campaigns:campaigns.map(publicCampaign)};}
function json(res,obj,status=200){res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'});res.end(JSON.stringify(obj));}
async function body(req){let size=0,chunks=[];for await(const chunk of req){size+=chunk.length;if(size>20e6)throw Error('Запрос слишком большой (максимум 20 МБ)');chunks.push(chunk);}return JSON.parse(Buffer.concat(chunks).toString()||'{}');}
const audioStreams=new AudioStreams((text,signal)=>speechChunks({...config},{...keys},text,observe,signal));
const audioScope=(text='')=>config.ttsProvider==='edge'
 ?('edge|'+resolveEdgeVoice(config.edgeVoice||config.voice||'ru-RU-DmitryNeural',text))
 :(((config.ttsModel==='gpt-4o-mini-tts'||!config.ttsModel)?'tts-1':config.ttsModel)+'|'+resolveOpenAiVoice(config.voice,text));
let voiceLatencies=[];try{voiceLatencies=JSON.parse(await fs.readFile(path.join(dataDir,'voice-latency.json'),'utf8'));}catch{}
function getOrCreateTlsCert(targetDir){
 const certPath=path.join(targetDir,'cert.pem');
 const keyPath=path.join(targetDir,'key.pem');
 try{
  if(!fsSync.existsSync(certPath)||!fsSync.existsSync(keyPath)){
   execSync(`/usr/bin/openssl req -x509 -newkey rsa:2048 -keyout "${keyPath}" -out "${certPath}" -days 3650 -nodes -subj "/CN=Skazitel Local"`,{stdio:'ignore'});
  }
  return {key:fsSync.readFileSync(keyPath),cert:fsSync.readFileSync(certPath)};
 }catch(e){
  console.warn('TLS setup skipped:',e.message);
  return null;
 }
}
const tlsOptions=getOrCreateTlsCert(dataDir);
let server=null,httpsServer=null;
let costRequests=0;
const serverHandler=async(req,res)=>{
 let costSensitive=false;
 try {
  const httpPort=server?.address()?.port;
  const httpsPort=httpsServer?.address()?.port;
  const activePorts=[httpPort,httpsPort].filter(Boolean);
  const lanIps=['127.0.0.1','localhost',...getLanIps()];
  const validHosts=[];
  for(const p of activePorts){for(const ip of lanIps){validHosts.push(`${ip}:${p}`);}}
  if(!validHosts.includes(req.headers.host))return json(res,{error:'Недопустимый Host'},403);
  if(req.headers.origin&&!validHosts.some(h=>req.headers.origin===`http://${h}`||req.headers.origin===`https://${h}`))return json(res,{error:'Другой источник запрещён'},403);
  res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('Referrer-Policy','no-referrer');
  res.setHeader('Content-Security-Policy',"default-src 'self' 'unsafe-inline'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; media-src 'self' blob:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'");
  const isHttps=!!(req.socket.encrypted||req.connection?.encrypted);
  const proto=isHttps?'https':'http';
  const url=new URL(req.url,`${proto}://${req.headers.host}`);
  if(!url.pathname.startsWith('/api/')) {
   if(/^\/images\/[a-f0-9-]{36}\.(webp|png|jpg)$/.test(url.pathname)){try{const file=path.join(dataDir,'Images',path.basename(url.pathname)),data=await fs.readFile(file);res.writeHead(200,{'Content-Type':file.endsWith('.png')?'image/png':file.endsWith('.jpg')?'image/jpeg':'image/webp','Cache-Control':'private,max-age=86400'});return res.end(data);}catch{res.writeHead(404);return res.end();}}
   if(/^\/icons\/[a-z0-9-]+\.svg$/.test(url.pathname)||['/icons/manifest.json','/icons/LICENSE.txt'].includes(url.pathname)){const file=path.join(root,'public',url.pathname.slice(1));try{const data=await fs.readFile(file);res.writeHead(200,{'Content-Type':file.endsWith('.svg')?'image/svg+xml':file.endsWith('.json')?'application/json':'text/plain; charset=utf-8','Cache-Control':file.endsWith('.json')?'no-store':'public,max-age=86400'});return res.end(data);}catch{res.writeHead(404);return res.end();}}
   if(url.pathname.startsWith('/audio/')&&/^\/audio\/[a-z0-9_-]+\/[a-z0-9_.-]+\.(ogg|mp3|wav|m4a)$/.test(url.pathname)){
    const file=path.join(root,'public',url.pathname.slice(1));
    try{
     const stat=await fs.stat(file);
     const range=req.headers.range;
     const contentType=file.endsWith('.m4a')?'audio/mp4':file.endsWith('.ogg')?'audio/ogg':file.endsWith('.mp3')?'audio/mpeg':'audio/wav';
     if(range){
      const parts=range.replace(/bytes=/,'').split('-');
      let start=parts[0]?parseInt(parts[0],10):NaN;
      let end=parts[1]?parseInt(parts[1],10):NaN;
      if(isNaN(start)&&!isNaN(end)){start=Math.max(0,stat.size-end);end=stat.size-1;}
      else if(!isNaN(start)&&isNaN(end)){end=stat.size-1;}
      if(isNaN(start)||isNaN(end)||start<0||start>=stat.size||end>=stat.size||start>end){
       res.writeHead(416,{'Content-Range':`bytes */${stat.size}`});return res.end();
      }
      res.writeHead(206,{
       'Content-Range':`bytes ${start}-${end}/${stat.size}`,
       'Accept-Ranges':'bytes',
       'Content-Length':(end-start)+1,
       'Content-Type':contentType,
       'Cache-Control':'public,max-age=86400'
      });
      const stream=fsSync.createReadStream(file,{start,end});
      res.on('close',()=>stream.destroy());
      stream.on('error',()=>res.end());
      return stream.pipe(res);
     }else{
      res.writeHead(200,{
       'Content-Length':stat.size,
       'Content-Type':contentType,
       'Accept-Ranges':'bytes',
       'Cache-Control':'public,max-age=86400'
      });
      const stream=fsSync.createReadStream(file);
      res.on('close',()=>stream.destroy());
      stream.on('error',()=>res.end());
      return stream.pipe(res);
     }
    }catch{res.writeHead(404);return res.end();}
   }
    const assets={'/':'index.html','/app.js':'app.js','/ambient-sound.mjs':'ambient-sound.mjs','/sfx.mjs':'sfx.mjs','/style.css':'style.css','/voice-input.mjs':'voice-input.mjs','/speech-prefetch.mjs':'speech-prefetch.mjs','/live-voice.mjs':'live-voice.mjs','/rule-data.mjs':'rule-data.mjs','/attribution.txt':'attribution.txt','/player':'player.html','/player.html':'player.html','/player.js':'player.js','/player.css':'player.css','/qrcode.js':'qrcode.js'};const file=assets[url.pathname];if(!file){res.writeHead(404);return res.end();}
    let content=await fs.readFile(path.join(root,'public',file));if(file==='index.html')content=Buffer.from(content.toString().replace('__APP_TOKEN__',token));
    if(file==='player.html')content=Buffer.from(content.toString().replace(/__PLAYER_TOKEN__/g,playerToken).replace(/__APP_TOKEN__/g,playerToken));
    res.writeHead(200,{'Content-Type':file.endsWith('html')?'text/html; charset=utf-8':file.endsWith('js')||file.endsWith('mjs')?'text/javascript; charset=utf-8':file.endsWith('.txt')?'text/plain; charset=utf-8':'text/css; charset=utf-8','Cache-Control':'no-store'});return res.end(content);
   }
   if(req.method==='GET'&&/^\/api\/audio\/[a-f0-9]{48}$/.test(url.pathname)){if(await audioStreams.serve(url.pathname.split('/').at(-1),res))return;return json(res,{error:'Аудиофрагмент истёк или уже воспроизведён'},404);}
   if(req.method==='GET'&&url.pathname==='/api/lan-info'){
    const auth=req.headers['x-app-token']||req.headers['x-player-token']||url.searchParams.get('token');
    if(auth!==token&&auth!==playerToken)return json(res,{error:'Не авторизован'},403);
    const port=server.address().port;
    const httpsPort=httpsServer?.address()?.port||null;
    const ips=getLanIps(),primaryIp=ips[0]||'127.0.0.1';
    return json(res,{port,httpsPort,ips,primaryIp,playerToken,playerUrl:`http://${primaryIp}:${port}/player`,playerHttpsUrl:httpsPort?`https://${primaryIp}:${httpsPort}/player`:null,clientsCount:sseClients.size});
   }
   if(req.method==='GET'&&url.pathname==='/api/events'){
    const auth=req.headers['x-app-token']||req.headers['x-player-token']||url.searchParams.get('token');
    if(auth!==token&&auth!==playerToken)return json(res,{error:'Не авторизован'},403);
    res.writeHead(200,{'Content-Type':'text/event-stream; charset=utf-8','Cache-Control':'no-cache, no-transform','Connection':'keep-alive','Access-Control-Allow-Origin':'*'});
    res.write(': ping\n\n');
    sseClients.add(res);
    const cleanup=()=>{sseClients.delete(res);broadcastLanConnections();};
    req.on('close',cleanup);res.on('close',cleanup);
    broadcastLanConnections();
    return;
   }
   if(req.method==='GET'&&url.pathname==='/api/player/state'){
    const auth=req.headers['x-app-token']||req.headers['x-player-token']||url.searchParams.get('token');
    if(auth!==token&&auth!==playerToken)return json(res,{error:'Не авторизован'},403);
    const campaignId=url.searchParams.get('id');
    const heroId=url.searchParams.get('heroId');
    const c=(campaignId?campaigns.find(x=>x.id===campaignId):null)||(config.activeCampaignId?campaigns.find(x=>x.id===config.activeCampaignId):null)||campaigns[0];
    const httpsPort=httpsServer?.address()?.port||null;
    if(!c)return json(res,{campaign:null,campaigns:[],httpsPort});
    const journalSlice=(c.journal||[]).slice(-40).map(j=>{
     if(j.isWhisper&&auth===playerToken&&heroId&&j.characterId!==heroId){
      return {...j,text:`🤫 ${j.characterName||'Герой'} что-то шепчет Мастеру...`};
     }
     return j;
    });
    return json(res,{
     activeCampaignId:config.activeCampaignId||c.id,
     httpsPort,
     campaign:{
      id:c.id,name:c.name,setting:c.setting,characters:c.characters,inventory:c.inventory||[],wallet:c.wallet||{group:0},loot:c.loot||[],maps:c.maps||[],journal:journalSlice,initiative:c.initiative||null,encounter:c.encounter||null,images:(c.images||[]).filter(i=>i.status==='ready')
     },
     campaigns:campaigns.map(x=>({id:x.id,name:x.name,heroesCount:x.characters?.length||0}))
    });
   }
   if(req.method==='POST'&&url.pathname==='/api/player/roll'){
    const auth=req.headers['x-app-token']||req.headers['x-player-token'];
    if(auth!==token&&auth!==playerToken)return json(res,{error:'Не авторизован'},403);
    const b=await body(req);
    const c=campaigns.find(x=>x.id===b.campaignId)||campaigns[0];
    if(!c)throw Error('Кампания не найдена');
    const heroName=b.characterName||'Герой',title=b.title||'Бросок кубика',total=Number(b.total)||0;
    const d20=b.d20!==undefined&&b.d20!==''?b.d20:'';
    const modifier=Number(b.modifier)||0,modSign=modifier>=0?`+${modifier}`:`${modifier}`;
    const rollDetail=d20!==''?` (d20: ${d20}${modifier!==0?' '+modSign:''})`:'';
    const isCrit=d20===20,isFumble=d20===1;
    const critBadge=isCrit?' 💥 КРИТ!':isFumble?' 💀 ПРОВАЛ!':'';
    const entryText=`🎲 ${heroName} бросил ${title}: результат ${total}${rollDetail}${critBadge}`;
    c.journal.push({id:randomUUID(),role:'user',text:entryText,at:new Date().toISOString()});
    await commitCampaign(c);
    broadcast('roll',{campaignId:c.id,characterName:heroName,title,total,d20,modifier,isCrit,isFumble,text:entryText});
    return json(res,{ok:true,total,text:entryText});
   }
   if(req.method==='POST'&&url.pathname==='/api/player/action'){
    const auth=req.headers['x-app-token']||req.headers['x-player-token'];
    if(auth!==token&&auth!==playerToken)return json(res,{error:'Не авторизован'},403);
    const b=await body(req);
    const c=campaigns.find(x=>x.id===b.campaignId)||campaigns[0];
    if(!c)throw Error('Кампания не найдена');
    const hero=c.characters.find(h=>h.id===b.characterId);
    if(!hero)throw Error('Герой не найден');
    if(b.action==='hp'){
     throw Error('Здоровье контролируется исключительно Мастером игры');
    }
    if(b.action==='item'){
     const itemId=b.itemId;
     const item=(c.inventory||[]).find(it=>it.id===itemId);
     if(!item)throw Error('Предмет не найден');
     if(item.quantity>1){item.quantity-=1;}else{c.inventory=c.inventory.filter(it=>it.id!==itemId);}
     let healMsg='';
     if(/зелье\s+лечения|зелье\s+исцеления|healing\s+potion/iu.test(item.name)){
      const roll1=Math.floor(Math.random()*4)+1;
      const roll2=Math.floor(Math.random()*4)+1;
      const healAmt=roll1+roll2+2;
      const oldHp=hero.hp;
      hero.hp=Math.max(0,Math.min(hero.maxHp,hero.hp+healAmt));
      healMsg=` и восстановил ${healAmt} ОЗ (${oldHp} → ${hero.hp})`;
     }
     const logText=`🧪 ${hero.name} использовал «${item.name}»${healMsg}`;
     c.journal.push({id:randomUUID(),role:'user',text:logText,at:new Date().toISOString()});
     await commitCampaign(c);
     return json(res,{ok:true,character:hero,log:logText});
    }
    throw Error('Неизвестное действие');
   }
   if(req.method==='POST'&&url.pathname==='/api/player/resource'){
    const auth=req.headers['x-app-token']||req.headers['x-player-token'];
    if(auth!==token&&auth!==playerToken)return json(res,{error:'Не авторизован'},403);
    const b=await body(req);
    const c=campaigns.find(x=>x.id===b.campaignId)||campaigns[0];
    if(!c)throw Error('Кампания не найдена');
    const hero=c.characters.find(h=>h.id===b.characterId);
    if(!hero)throw Error('Герой не найден');
    const r=(hero.resources||[]).find(res=>res.id===b.resourceId);
    if(!r)throw Error('Ресурс не найден');
    const action=b.action||'use';
    if(action==='use'){
     if(r.current<=0)throw Error(`Ресурс «${r.name}» исчерпан`);
     r.current=Math.max(0,r.current-(b.amount||1));
    }else if(action==='recover'){
     r.current=Math.min(r.max,r.current+(b.amount||1));
    }else if(action==='set'){
     r.current=Math.max(0,Math.min(r.max,Number(b.amount)||0));
    }
    const logMsg=`✨ ${hero.name}: «${r.name}» (${r.current}/${r.max})`;
    c.journal.push({id:randomUUID(),role:'user',text:logMsg,at:new Date().toISOString()});
    await commitCampaign(c);
    broadcast('campaign',{campaignId:c.id});
    return json(res,{ok:true,resource:r,log:logMsg});
   }
   if(req.method==='POST'&&url.pathname==='/api/player/rest'){
    const auth=req.headers['x-app-token']||req.headers['x-player-token'];
    if(auth!==token&&auth!==playerToken)return json(res,{error:'Не авторизован'},403);
    const b=await body(req);
    const c=campaigns.find(x=>x.id===b.campaignId)||campaigns[0];
    if(!c)throw Error('Кампания не найдена');
    const kind=b.kind==='short'?'short':'long';
    const heroId=b.characterId||null;
    const hero=c.characters.find(h=>h.id===heroId);
    const msg=rest(c,kind,heroId);
    let healText='';
    if(kind==='short'&&hero&&b.spendHitDice&&hero.hitDice?.current>0){
     hero.hitDice.current-=1;
     const conMod=Math.floor(((hero.abilityScores?.constitution||10)-10)/2);
     const dieSides=hero.hitDice?.size||8;
     const roll=Math.floor(Math.random()*dieSides)+1;
     const heal=Math.max(1,roll+conMod);
     const old=hero.hp;
     hero.hp=Math.min(hero.maxHp,hero.hp+heal);
     healText=` ${hero.name} потратил d${dieSides} кость здоровья и восстановил ${heal} ОЗ (${old} → ${hero.hp}).`;
    }
    c.journal.push({id:randomUUID(),role:'system',text:`⛺ ${msg}${healText}`,at:new Date().toISOString()});
    await commitCampaign(c);
    broadcast('campaign',{campaignId:c.id});
    return json(res,{ok:true,message:`${msg}${healText}`});
   }
   if(req.method==='POST'&&url.pathname==='/api/combat/start'){
    const auth=req.headers['x-app-token']||req.headers['x-player-token'];
    if(auth!==token&&auth!==playerToken)return json(res,{error:'Не авторизован'},403);
    const b=await body(req);
    const c=campaigns.find(x=>x.id===b.campaignId)||campaigns[0];
    if(!c)throw Error('Кампания не найдена');
    const combatants=[];
    for(const h of c.characters){
     const dex=h.abilityScores?.dexterity||h.stats?.dex||10;
     const mod=Math.floor((dex-10)/2);
     const roll=Math.floor(Math.random()*20)+1;
     combatants.push({id:h.id,characterId:h.id,name:h.name,initiative:roll+mod,roll,mod,kind:'hero',hp:h.hp,maxHp:h.maxHp,avatar:h.avatar||''});
    }
    const map=c.maps?.[0];
    if(Array.isArray(b.enemies)&&b.enemies.length){
     for(const en of b.enemies){
      const roll=Math.floor(Math.random()*20)+1;
      combatants.push({id:en.id||randomUUID(),name:en.name||en.label||'Враг',initiative:roll+(en.mod||0),roll,mod:en.mod||0,kind:'enemy',hp:en.hp||15,maxHp:en.maxHp||15});
     }
    }else if(map?.tokens){
     const enemies=map.tokens.filter(t=>t.kind==='enemy');
     for(const en of enemies){
      const roll=Math.floor(Math.random()*20)+1;
      combatants.push({id:en.id,name:en.label||'Враг',initiative:roll,roll,mod:0,kind:'enemy',hp:15,maxHp:15});
     }
    }
    if(!combatants.some(x=>x.kind==='enemy')){
     const roll=Math.floor(Math.random()*20)+1;
     combatants.push({id:randomUUID(),name:'Противник',initiative:roll,roll,mod:0,kind:'enemy',hp:20,maxHp:20});
    }
    combatants.sort((a,b)=>b.initiative-a.initiative);
    c.initiative={active:true,round:1,turnIndex:0,combatants};
    c.encounter={active:true,id:randomUUID(),key:'combat-'+Date.now()};
    if(c.dm)c.dm.ambient='battle';
    const startMsg=`⚔️ Начало боя! Раунд 1. Очередь ходов: ${combatants.map(cb=>`${cb.name} (${cb.initiative})`).join(', ')}. Ход: ${combatants[0]?.name}.`;
    c.journal.push({id:randomUUID(),role:'system',text:startMsg,at:new Date().toISOString()});
    await commitCampaign(c);
    broadcast('combat-update',{campaignId:c.id,initiative:c.initiative});
    broadcast('campaign',{campaignId:c.id});
    return json(res,{ok:true,initiative:c.initiative,message:startMsg});
   }
   if(req.method==='POST'&&url.pathname==='/api/combat/next'){
    const auth=req.headers['x-app-token']||req.headers['x-player-token'];
    if(auth!==token&&auth!==playerToken)return json(res,{error:'Не авторизован'},403);
    const b=await body(req);
    const c=campaigns.find(x=>x.id===b.campaignId)||campaigns[0];
    if(!c)throw Error('Кампания не найдена');
    if(!c.initiative||!c.initiative.combatants?.length)throw Error('Бой не активен');
    let {round,turnIndex,combatants}=c.initiative;
    turnIndex++;
    if(turnIndex>=combatants.length){round++;turnIndex=0;}
    c.initiative.round=round;c.initiative.turnIndex=turnIndex;
    const current=combatants[turnIndex];
    const turnMsg=`⚔️ Раунд ${round} · Ход переходит к: ${current.name}!`;
    c.journal.push({id:randomUUID(),role:'system',text:turnMsg,at:new Date().toISOString()});
    await commitCampaign(c);
    broadcast('combat-update',{campaignId:c.id,initiative:c.initiative,current});
    broadcast('campaign',{campaignId:c.id});
    return json(res,{ok:true,initiative:c.initiative,current});
   }
   if(req.method==='POST'&&url.pathname==='/api/combat/end'){
    const auth=req.headers['x-app-token']||req.headers['x-player-token'];
    if(auth!==token&&auth!==playerToken)return json(res,{error:'Не авторизован'},403);
    const b=await body(req);
    const c=campaigns.find(x=>x.id===b.campaignId)||campaigns[0];
    if(!c)throw Error('Кампания не найдена');
    c.initiative=null;
    if(c.encounter)c.encounter.active=false;
    if(c.dm)c.dm.ambient='camp';
    const endMsg=`🕊️ Бой завершён! Опасность миновала.`;
    c.journal.push({id:randomUUID(),role:'system',text:endMsg,at:new Date().toISOString()});
    await commitCampaign(c);
    broadcast('combat-update',{campaignId:c.id,initiative:null});
    broadcast('campaign',{campaignId:c.id});
    return json(res,{ok:true,message:endMsg});
   }
   if(req.method==='POST'&&url.pathname==='/api/generate/random'){
    const auth=req.headers['x-app-token']||req.headers['x-player-token'];
    if(auth!==token&&auth!==playerToken)return json(res,{error:'Не авторизован'},403);
    const b=await body(req);
    const c=campaigns.find(x=>x.id===b.campaignId)||campaigns[0];
    if(!c)throw Error('Кампания не найдена');
    const type=b.type||'encounter';
    let result={};
    if(type==='encounter'){
     const loc=c.dm?.location||c.setting||'окрестности';
     const list=[
      {name:'Засада гоблинов-лучников',desc:`В зарослях у дороги (${loc}) натянуты тетивы! Трое гоблинов приготовились стрелять из укрытия.`,enemies:[{label:'Гоблин-лучник A',kind:'enemy'},{label:'Гоблин-лучник B',kind:'enemy'},{label:'Вожак банды',kind:'enemy'}]},
      {name:'Стая лютых волков',desc:`Ветер доносит глухой рык. Из тумана выходят волки с горящими голодными глазами, окружающие отряд.`,enemies:[{label:'Лютый вожак',kind:'enemy'},{label:'Серый волк A',kind:'enemy'},{label:'Серый волк B',kind:'enemy'}]},
      {name:'Заброшенный алтарь предков',desc:`Среди замшелых камней пульсирует забытая руна. Воздух дрожит от магического напряжения.`,enemies:[{label:'Каменный страж',kind:'enemy'}]},
      {name:'Караван торговца в беде',desc:`Телега купца застряла в глубокой колее со сломанной осью. Из темноты уже приближаются тени мародёров.`,enemies:[{label:'Головорез',kind:'enemy'},{label:'Разбойник',kind:'enemy'}]}
     ];
     result=list[Math.floor(Math.random()*list.length)];
    }else if(type==='loot'){
     const gp=Math.floor(Math.random()*35)+10;
     const sp=Math.floor(Math.random()*50)+15;
     const items=[
      {name:'Зелье лечения (2d4+2 ОЗ)',category:'potion',description:'Красная шипящая жидкость с ароматом корицы.'},
      {name:'Свиток доспеха мага',category:'scroll',description:'Пергамент с лазурными защитными рунами.'},
      {name:'Ограненный агат (50 зм)',category:'treasure',description:'Глубокий полупрозрачный самоцвет с полосчатым узором.'},
      {name:'Походная фляга гномьего эля',category:'food',description:'Крепкий бодрящий напиток, согревающий в долгом походе.'},
      {name:'Серебряный перстень с соколом',category:'treasure',description:'Тонкая работа мастера с печатью благородного дома.'}
     ];
     const item=items[Math.floor(Math.random()*items.length)];
     result={gp,sp,item,text:`Найдено: ${gp} зм, ${sp} см и «${item.name}»!`};
     if(b.applyToParty){
      c.wallet=c.wallet||{group:0};
      c.wallet.group=(c.wallet.group||0)+(gp*100)+(sp*10);
      c.inventory=c.inventory||[];
      c.inventory.push({id:randomUUID(),name:item.name,category:item.category,description:item.description,quantity:1,ownerId:'group',carrierId:'group',equipped:false});
      await commitCampaign(c);
      broadcast('campaign',{campaignId:c.id});
     }
    }else if(type==='npc'){
     const names=['Элрик Железнорук','Мириэль Теневая','Бромми Пузатый','Валтейн Седой','Каэлия Ветер','Дорн Молотобоец'];
     const roles=['Странствующий бард','Осторожный травник','Бывший наёмник','Беглый послушник','Тайный агент гильдии воров'];
     const traits=['Говорит тихим шёпотом, постоянно оглядываясь','Неприлично весел и сыплет старыми пословицами','Имеет глубокий шрам через бровь и мрачный взгляд','Ищет редкое снадобье для спасения родного дома'];
     const name=names[Math.floor(Math.random()*names.length)];
     const role=roles[Math.floor(Math.random()*roles.length)];
     const trait=traits[Math.floor(Math.random()*traits.length)];
     result={name,role,trait,text:`${name} (${role}). Характер: ${trait}.`};
     if(b.saveToWorld){
      c.dm=dmState(c.dm);
      c.dm.world.push(worldRecord({kind:'npc',name,description:`${role}. ${trait}`,attitude:'Нейтрален'},'dm-generator'));
      await commitCampaign(c);
      broadcast('campaign',{campaignId:c.id});
     }
    }
    return json(res,{ok:true,type,result});
   }
   if(req.method==='POST'&&url.pathname==='/api/map/fog'){
    const auth=req.headers['x-app-token']||req.headers['x-player-token'];
    if(auth!==token&&auth!==playerToken)return json(res,{error:'Не авторизован'},403);
    const b=await body(req);
    const c=campaigns.find(x=>x.id===b.campaignId)||campaigns[0];
    if(!c)throw Error('Кампания не найдена');
    const map=(c.maps||[]).find(m=>m.id===b.mapId)||c.maps?.[0];
    if(!map)throw Error('Карта не найдена');
    if(b.toggleFog!==undefined)map.fogOfWar=!!b.toggleFog;
    if(b.revealAll){
     map.revealedCells=[];
     for(let x=0;x<map.width;x++)for(let y=0;y<map.height;y++)map.revealedCells.push(`${x},${y}`);
    }else if(b.resetFog){
     map.revealedCells=[];
    }
    await commitCampaign(c);
    broadcast('campaign',{campaignId:c.id});
    return json(res,{ok:true,map});
   }
   if(req.method==='POST'&&(url.pathname==='/api/player/ptt'||url.pathname==='/api/player/turn'||url.pathname==='/api/player/transcribe')){
    const auth=req.headers['x-app-token']||req.headers['x-player-token'];
    if(auth!==token&&auth!==playerToken)return json(res,{error:'Не авторизован'},403);
    const b=await body(req);
    const c=campaigns.find(x=>x.id===b.campaignId)||campaigns[0];
    if(!c)throw Error('Кампания не найдена');
    let text=String(b.text||'').trim();
    if(b.audio){
     await keysReady;
     const audioBuf=Buffer.from(String(b.audio||''),'base64');
     if(!audioBuf.length)throw Error('Пустая запись с микрофона');
     let mime=String(b.mime||'audio/wav').toLowerCase().split(';')[0].trim();
     if(mime.includes('m4a')||mime.includes('aac')||mime.includes('mp4')||mime.includes('3gp')) mime='audio/mp4';
     else if(mime.includes('webm')) mime='audio/webm';
     else if(mime.includes('mpeg')||mime.includes('mp3')) mime='audio/mpeg';
     else if(mime.includes('ogg')) mime='audio/ogg';
     else if(mime.includes('wav')) mime='audio/wav';
     else if(mime.startsWith('audio/')||mime.startsWith('video/')) mime='audio/mp4';
     else throw Error('Неподдерживаемый аудиоформат: '+mime);
     const names=c.characters.map(x=>x.name);
     costSensitive=true;costRequests++;
     try{
      text=(await transcribe(config,keys,audioBuf,mime,names,observe)).trim();
     }finally{
      costRequests--;
     }
     if(!text)throw Error('Речь не распознана. Повторите запись ближе к микрофону.');
    }
    if(url.pathname==='/api/player/transcribe'){
     return json(res,{ok:true,text});
    }
    if(!text)throw Error('Опишите действие героя');
    const hero=c.characters.find(h=>h.id===b.characterId);
    if(!hero)throw Error('Персонаж не найден');
    interruptDelivery(c);
    if(c.proposals?.length)throw Error('Сначала подтвердите или отклоните изменения HP');
    if(c.pending)throw Error('Сначала завершите ожидаемый бросок d20 на вкладке «Кубики»');
    checkpoint(c);
    const isWhisper=b.isWhisper===true;
    const whisperPrefix=isWhisper?'🤫 [ШЁПОТ] ':'';
    const event={id:randomUUID(),role:'user',text:`${whisperPrefix}${hero.name}: ${text}`,isWhisper,characterId:hero.id,characterName:hero.name,at:new Date().toISOString()};
    c.journal.push(event);
    let localReply=localCommand(c,text,hero.id,event.id);
    if(!localReply&&/^(?:я\s+)?(?:обещаю|клянусь)(?:\s|$)/iu.test(playerSpeech(c,text,hero.id))){
     remember(c,{kind:'promise',text:playerSpeech(c,text,hero.id),actorId:hero.id},event.id);
    }
    if(config.provider!=='demo')await keysReady;
    const prepareFirst=t=>{const first=narrationParts(t)[0];if(first)audioStreams.prepare(first,audioScope(first));};
    const speechCallback=(config.ttsProvider==='openai'||config.ttsProvider==='edge')?prepareFirst:undefined;
    costSensitive=true;costRequests++;
    let reply;
    try{
     reply=localReply?{narration:localReply,changes:[]}:config.provider==='demo'?demoReply(c,b,null):await generate({...config},{...keys},c,observe,speechCallback,speechCallback);
     if(isWhisper&&reply?.narration){
      reply.narration=`🤫 [Шёпотом для ${hero.name}]: `+reply.narration;
     }
    }finally{
     costRequests--;
    }
    stageReply(c,reply);
    const latest=campaigns.find(x=>x.id===c.id);
    if(latest?.summary&&(!c.summary||latest.summary.count>c.summary.count)&&summaryValid({...c,summary:latest.summary}))c.summary=latest.summary;
    await commitCampaign(c);
    if(config.autoSummary==='on'&&config.provider!=='demo'&&!summaryBusy.has(c.id)){
     const plan=summaryPlan(c);
     if(plan){
      summaryBusy.add(c.id);
      const snapshotConfig={...config},snapshotKeys={...keys};
      (async()=>{try{const result=await summarize(snapshotConfig,snapshotKeys,plan,observe);await updateImage(c.id,lat=>{if((lat.summary?.count||0)<plan.count)setSummary(lat,result.summary,plan);});}catch{}finally{summaryBusy.delete(c.id);}})();
     }
    }
    return json(res,{ok:true,characterId:hero.id,characterName:hero.name,text,narration:reply.narration});
   }
   if(req.headers['x-app-token']!==token)return json(res,{error:'Нужна локальная сессия приложения'},403);
  if(req.method==='GET'&&url.pathname==='/api/state')return json(res,state());
  if(req.method==='GET'&&url.pathname==='/api/archive'){const c=campaigns.find(x=>x.id===url.searchParams.get('id'));if(!c)throw Error('Кампания не найдена');const query=(url.searchParams.get('q')||'').slice(0,300);return json(res,{results:query?searchArchive({...c,dm:publicDM(c.dm)},query,20):c.journal.slice(-100),indexed:campaignStore.search(c.id,query)});}
  if(req.method==='GET'&&url.pathname==='/api/voice-latency')return json(res,{recent:voiceLatencies});
  if(req.method==='GET'&&url.pathname==='/api/usage')return json(res,{...usageStore.report(),error:usageError});
  if(req.method==='GET'&&url.pathname==='/api/export') {const c=campaigns.find(x=>x.id===url.searchParams.get('id'));if(!c)throw Error('Кампания не найдена');return json(res,{format:'skazitel-v1',campaign:c});}
  if(url.pathname==='/api/openai/models'){
   await keysReady;
   let apiKey;
   if(req.method==='POST'){
    const b=await body(req);
    apiKey=b.apiKey?.trim();
   }
   if(!apiKey){
    const pool=keyPool(keys,'openai');
    apiKey=pool[0]?.key;
   }
   if(!apiKey)return json(res,{ok:false,error:'OpenAI API-ключ не найден в настройках',models:[]});
   try{
    const r=await fetch('https://api.openai.com/v1/models',{
     headers:{Authorization:'Bearer '+apiKey},
     signal:AbortSignal.timeout(8000)
    });
    if(!r.ok){
     const errData=await r.json().catch(()=>({}));
     return json(res,{ok:false,error:errData.error?.message||`Ошибка OpenAI (${r.status})`,models:[]});
    }
    const data=await r.json();
    const exclude=/(whisper|tts|transcribe|embedding|moderation|dall-e|babbage|davinci|realtime|audio|clip)/i;
    const prio=m=>{
     if(m.startsWith('gpt-6-luna'))return 1;
     if(m==='gpt-4o')return 2;
     if(m==='gpt-4o-mini')return 3;
     if(m.startsWith('o3'))return 4;
     if(m.startsWith('o1'))return 5;
     if(m.startsWith('gpt-5'))return 6;
     if(m.startsWith('gpt-4.1'))return 7;
     if(m.startsWith('gpt-4'))return 8;
     return 20;
    };
    const models=(data.data||[])
     .map(m=>m.id)
     .filter(id=>!exclude.test(id))
     .sort((a,b)=>{
      const pa=prio(a),pb=prio(b);
      if(pa!==pb)return pa-pb;
      return a.localeCompare(b);
     });
    return json(res,{ok:true,models});
   }catch(err){
    return json(res,{ok:false,error:err.message||'Не удалось связаться с OpenAI',models:[]});
   }
  }
  if(req.method!=='POST')return json(res,{error:'Метод не поддерживается'},405);
  if(['/api/turn','/api/summary','/api/speech','/api/transcribe','/api/image-request','/api/live-start','/api/latency-probe','/api/generate-map'].includes(url.pathname)){costSensitive=true;costRequests++;}
  const b=await body(req);
  if(url.pathname==='/api/voice-latency'){
   const row={at:new Date().toISOString()};for(const k of ['totalMs','sttMs','turnMs','speechMs'])if(Number.isFinite(b[k])&&b[k]>=0&&b[k]<=300000)row[k]=Math.round(b[k]);
   if(row.totalMs===undefined)throw Error('Нужен полный замер');voiceLatencies=[row,...voiceLatencies].slice(0,100);await save('voice-latency',voiceLatencies);return json(res,{ok:true});
  }
  if(url.pathname==='/api/latency-probe'){
   const original=campaigns.find(c=>c.id===b.id);if(!original||config.provider!=='openai')throw Error('Выберите кампанию с OpenAI');await keysReady;
   const c=structuredClone(original);c.journal.push({id:randomUUID(),role:'user',text:c.characters[0].name+': Я молча осматриваю видимую дорогу у башни. Опиши только то, что видно, в двух коротких предложениях. Никаких действий за героев.',at:new Date().toISOString()});
   const started=performance.now();let firstNarrationMs=null;const reply=await generate({...config},{...keys},c,event=>observe({...event,kind:'latency-probe'}),()=>{firstNarrationMs??=Math.round(performance.now()-started);});
   return json(res,{elapsedMs:Math.round(performance.now()-started),firstNarrationMs,characters:reply.narration?.length||0,committed:false});
  }
  if(url.pathname==='/api/speech-cancel'){const job=audioStreams.jobs.get(b.ticket);if(job)audioStreams.discard(job);return json(res,{ok:true});}
  if(url.pathname==='/api/speech-prepare'){
   if(config.ttsProvider!=='openai'&&config.ttsProvider!=='edge')throw Error('Потоковый голос доступен для OpenAI и Edge TTS');
   if(config.ttsProvider==='openai')await keysReady;
   const text=String(b.text||'');if(!text.trim()||text.length>4000)throw Error('Некорректный текст озвучки');
   return json(res,{url:'/api/audio/'+audioStreams.prepare(text,audioScope(text))});
  }
  if(url.pathname==='/api/cost-session'){if(b.action!=='new')throw Error('Неизвестное действие счётчика');if(busy.size||costRequests||liveSessions.size||liveStarting||[...audioStreams.jobs.values()].some(j=>!j.done)||summaryBusy.size)throw Error('Дождитесь завершения запросов перед началом новой сессии');await usageStore.newCostSession();return json(res,{...usageStore.report(),error:usageError});}
  if(url.pathname==='/api/settings'){
   const previousSettings=settingsLock;let releaseSettings;settingsLock=new Promise(resolve=>{releaseSettings=resolve;});await previousSettings;
   try{
   const next={...config};for(const k of Object.keys(defaults))if(typeof b[k]==='string')next[k]=b[k].slice(0,500);
   if(typeof b.activeCampaignId==='string'&&b.activeCampaignId!==config.activeCampaignId){next.activeCampaignId=b.activeCampaignId;broadcast('campaign-switch',{campaignId:b.activeCampaignId});}
   if(next.ttsProvider==='openai'&&(next.ttsModel==='gpt-4o-mini-tts'||!next.ttsModel))next.ttsModel='tts-1';
   if(!['default','fast'].includes(next.serviceTier))throw Error('Неизвестный режим скорости OpenAI');
   if(!['cascade','live'].includes(next.voicePipeline)||!['openai','horde'].includes(next.imageProvider)||!['low','medium','high'].includes(next.imageQuality))throw Error('Неизвестный режим голоса или изображений');
   if(next.summaryModel&&!['gpt-4.1-mini','gpt-5.4-mini'].includes(next.summaryModel))throw Error('Неизвестная модель сводок');
   if(!['low','medium','high','xhigh','max'].includes(next.reasoningEffort))throw Error('Неизвестный уровень рассуждений');
   if(!['free','paid'].includes(next.groqBilling))throw Error('Неизвестный тариф Groq');
   if(!['demo','openai','gemini','compatible'].includes(next.provider))throw Error('Неизвестный провайдер');
   if(!['system','openai','silero','edge','off'].includes(next.ttsProvider)||!['openai','gemini','groq'].includes(next.sttProvider))throw Error('Неизвестный голосовой провайдер');
   if(next.edgeVoice&&!edgeVoices.some(v=>v.id===next.edgeVoice))throw Error('Неизвестный голос Edge TTS');
   if(!['review','direct'].includes(next.voiceSendMode))throw Error('Неизвестный режим отправки голоса');
   if(!['ptt','continuous'].includes(next.listeningMode)||!['any','addressed'].includes(next.bargeInMode)||!['on','off'].includes(next.autoSummary))throw Error('Неизвестный режим прослушивания или сводки');
   if(!usesGroqKey(next)&&typeof b.reserveProvider!=='string')next.reserveProvider='off';
   if(!['off','openrouter'].includes(next.reserveProvider))throw Error('Неизвестный резерв');
   if(next.reserveProvider==='openrouter'&&!usesGroqKey(next))throw Error('Бесплатный резерв подключается к основному ведущему Groq.');
   if(!sileroSpeakers.includes(next.sileroSpeaker))throw Error('Неизвестный голос Silero');
   if(next.ttsProvider==='silero'&&!voiceStatus.installed)throw Error('Сначала установите локальную модель Silero.');
   await keysReady;
   const migrateGroq=usesGroqKey(config)&&(next.reserveProvider==='openrouter'||!usesGroqKey(next))&&!Object.hasOwn(keys,'groq')&&Object.hasOwn(keys,'compatible');
   const changesKeys=migrateGroq||b.clearKeys||Object.keys(b.keyPools||{}).length>0||Object.values(b.keys||{}).some(v=>typeof v==='string'&&v.trim());
   await keysReady;let nextKeys=keys;
   if(changesKeys){
    await keysReady;
    let stored=keyStorageError?await keyStore.load():keys;
    if(migrateGroq)stored={...stored,groq:'skazitel-pool-v1:'+JSON.stringify(keyPool(stored,'compatible')),compatible:'skazitel-pool-v1:[]'};
    nextKeys=mergeKeys(stored,b.keys,b.clearKeys,b.keyPools,usesGroqKey(next));
    await keyStore.save(nextKeys);keyStorageError='';
   }
   if(next.provider==='openai')next.baseUrl='https://api.openai.com/v1';
   await save('settings',next);config=next;keys=nextKeys;return json(res,state());
   }finally{releaseSettings();}
  }
  if(url.pathname==='/api/campaign/delete'){
   const id=b.id;if(!id)throw Error('ID кампании не указан');
   let newActiveId=config.activeCampaignId;
   const task=commitQueue.then(async()=>{
    const index=campaigns.findIndex(c=>c.id===id);
    if(index<0)throw Error('Кампания не найдена');
    campaigns.splice(index,1);
    await campaignStore.delete(id);
    if(config.activeCampaignId===id||!config.activeCampaignId||!campaigns.some(c=>c.id===config.activeCampaignId)){
     newActiveId=campaigns[0]?.id||'';
     config.activeCampaignId=newActiveId;
     await save('settings',config);
    }
    broadcast('campaign-deleted',{campaignId:id,activeCampaignId:newActiveId});
   });
   commitQueue=task.catch(()=>{});
   await task;
   return json(res,{ok:true,activeCampaignId:newActiveId,...state()});
  }
  if(url.pathname==='/api/create'){
   let c;
   if(b.seed){const source=await fs.readFile(path.join(root,'seed','theon-alvari.md'),'utf8');c=makeCampaign({name:'Теон и Альвари',setting:'D&D 2024 Cinematic. Закат у старой башни на северном тракте. Встреча с Э ещё НЕ началась. Неизвестные тайны из файла остаются неизвестными. КД Альвари 12 — временно по предложенному варианту со щитом, подтвердить с игроком.',source,characters:[{name:'Теон',description:'Полуэльф · Artificer 4 · Artillerist',maxHp:31,ac:15,bonuses:{strength:0,dexterity:2,constitution:2,intelligence:4,wisdom:1,charisma:-1,perception:3,investigation:6,arcana:6,stealth:2,athletics:0,persuasion:-1,survival:1,insight:1}},{name:'Альвари',description:'Полуэльф · Druid 4 · Circle of Stars',maxHp:31,ac:12,bonuses:{strength:1,dexterity:-1,constitution:2,intelligence:2,wisdom:4,charisma:0,perception:6,investigation:2,arcana:2,stealth:-1,athletics:1,persuasion:0,survival:6,insight:6}}]});}
   else c=makeCampaign({...b,characters:Array.isArray(b.characters)?b.characters:[]});
   if(b.dm)c.dm=dmState(b.dm);if(b.sessionZero===true)beginSessionZero(c,config.provider);
   config.activeCampaignId=c.id;
   await commitCampaign(c);return json(res,{...state(),activeId:c.id,activeCampaignId:c.id});
  }
  if(url.pathname==='/api/import'){
   const imported=b.campaign;if(b.format!=='skazitel-v1'||!imported)throw Error('Нужен JSON-экспорт Сказителя');
   const c=makeCampaign({name:imported.name,setting:imported.setting,source:imported.source,edition:imported.edition||'legacy',characters:[]});
   if((imported.characters||[]).length>12)throw Error('В партии больше 12 героев');
   const idMap=new Map();c.characters=(imported.characters||[]).map(x=>{const v=character(x);idMap.set(x.id,v.id);return v;});
   if(imported.profile)c.profile={rules:String(imported.profile.rules||'').slice(0,1000),style:String(imported.profile.style||'').slice(0,6000),boundaries:String(imported.profile.boundaries||'').slice(0,6000),heroes:String(imported.profile.heroes||'').slice(0,6000),dice:'Все броски физические'};
   if(imported.sessionZero)c.sessionZero=restoreSessionZero(imported.sessionZero);
   if(!c.characters.length&&(!c.sessionZero||c.sessionZero.complete))throw Error('В экспорте нет персонажей');
   const eventIdMap=new Map();
   if((imported.journal||[]).length>50000)throw Error('В импорте больше 50000 событий');
   c.journal=(imported.journal||[]).map(x=>{const id=randomUUID();eventIdMap.set(x.id,id);return {id,role:['user','assistant','system'].includes(x.role)?x.role:'system',text:String(x.text||'').slice(0,15000),at:String(x.at||new Date().toISOString()),automaticChanges:(x.automaticChanges||[]).slice(0,10).map(t=>String(t).slice(0,2000)),tacticalHints:(x.tacticalHints||[]).slice(0,2).map(h=>({...h,characterId:idMap.get(h.characterId)||'',text:String(h.text||'').slice(0,300)}))};});
   c.maps=(imported.maps||[]).slice(0,30).map(m=>gameMap({...m,tokens:(m.tokens||[]).map(t=>({...t,characterId:idMap.get(t.characterId)||null}))},c));
   c.rolls=(imported.rolls||[]).map(x=>({...x,characterId:idMap.get(x.characterId)}));
   if(imported.reaction&&!imported.pending){acceptReply(c,{narration:'Кампания восстановлена на паузе для реакции.',reaction_request:imported.reaction,changes:[]});}
   if(imported.pending){const p={...imported.pending,characterId:idMap.get(imported.pending.characterId)};acceptReply(c,{narration:'Кампания восстановлена из сохранения.',roll_request:p,changes:[]});}
   c.proposals=(imported.proposals||[]).slice(0,10).map(x=>({...x,id:randomUUID(),characterId:idMap.get(x.characterId),hpDelta:Number(x.hpDelta)})).filter(x=>x.characterId&&Number.isInteger(x.hpDelta)&&Math.abs(x.hpDelta)<=999);
   c.clockMinutes=integer(imported.clockMinutes??0,0,5256000,'Игровое время');
   if((imported.memory||[]).length>1000||(imported.inventory||[]).length>1000||(imported.loot||[]).length>10000)throw Error('Импорт превышает поддержанный размер памяти, инвентаря или добычи');
   c.memory=(imported.memory||[]).map(n=>memoryRecord({...n,changes:(n.changes||[]).map(change=>({...change,sourceId:eventIdMap.get(change.sourceId)||''})),actorId:idMap.get(n.actorId)||''},eventIdMap.get(n.sourceId)||''));
   if(new Set(c.memory.map(n=>n.id)).size!==c.memory.length)throw Error('Повторяющиеся ID записей памяти');
   c.inventory=(imported.inventory||[]).map(item=>inventoryItem(c,{...item,ownerId:!item.ownerId||item.ownerId==='group'?'group':idMap.get(item.ownerId)||'invalid-owner',carrierId:!item.carrierId?item.ownerId==='group'||!item.ownerId?'group':idMap.get(item.ownerId)||'invalid-owner':item.carrierId==='group'?'group':idMap.get(item.carrierId)||'invalid-owner'}));validateInventory(c);
   c.wallet={group:integer(imported.wallet?.group??0,0,100000000)};for(const [oldId,newId] of idMap)c.wallet[newId]=integer(imported.wallet?.[oldId]??0,0,100000000);
   c.loot=(imported.loot||[]).map(l=>({...l,sourceId:eventIdMap.get(l.sourceId)||'',copper:integer(l.copper,0,100000000),claimed:l.claimed===true}));
   function remapAction(value){if(Array.isArray(value))return value.map(remapAction);if(value&&typeof value==='object')return Object.fromEntries(Object.entries(value).map(([k,v])=>[k,k==='characterIds'&&Array.isArray(v)?v.map(id=>idMap.get(id)||''):['characterId','ownerId','carrierId','actorId'].includes(k)?v==='group'?'group':idMap.get(v)||'':['sourceId'].includes(k)?eventIdMap.get(v)||'':remapAction(v)]));return value;}
   c.dm=dmState(remapAction(imported.dm||{}));c.dm.world=c.dm.world.map(v=>worldRecord(v,eventIdMap.get(v.sourceId)||''));for(const h of c.characters){for(const record of [...h.features,...h.spells,...h.progression.awards,...h.progression.history])if(record.sourceId)record.sourceId=eventIdMap.get(record.sourceId)||'';}c.dm.changes=c.dm.changes.map(v=>({...v,sourceId:eventIdMap.get(v.sourceId)||''}));
   for(const old of (imported.actionProposals||[]).slice(0,30))c.actionProposals.push(...proposeActions(c,[remapAction(old.action)],eventIdMap.get(old.sourceId)||''));
   await commitCampaign(c);return json(res,{...state(),activeId:c.id});
  }
  if(url.pathname==='/api/transcribe'){await keysReady;const audio=Buffer.from(String(b.audio||''),'base64');if(!audio.length)throw Error('Пустая запись');if(!['audio/wav','audio/webm','audio/mp4'].includes(b.mime))throw Error('Неподдерживаемый аудиоформат');const names=campaigns.find(x=>x.id===b.campaignId)?.characters.map(x=>x.name)||[];return json(res,{text:await transcribe(config,keys,audio,b.mime,names,observe)});}
  if(url.pathname==='/api/speech'){
   if(config.ttsProvider==='silero'||b.preview==='silero'){
    const result=await sileroSpeech(String(b.text||''),b.preview==='silero'?b.speaker:config.sileroSpeaker);
    res.writeHead(200,{'Content-Type':'audio/wav','Cache-Control':'no-store','X-Synthesis-Ms':String(Math.round(result.synthesisSeconds*1000))});return res.end(result.audio);
   }
   if(config.ttsProvider==='edge'||b.preview==='edge'){
    let voice=b.preview==='edge'?(b.voice||config.edgeVoice||'ru-RU-DmitryNeural'):(config.edgeVoice||'ru-RU-DmitryNeural');
    if(!b.preview&&config.ttsProvider==='edge'){
     const textStr=String(b.text||'');
     if(/(?:^|\n)\s*(?:[«"]?[А-ЯЁ][а-яё]+(?:а|я|ия|эль|етта|ис|ин|ова|ева)\s*(?::|—|говорит|отвечает|шепчет|восклицает)|женщин|девушк|эльфийк|жриц|трактирщиц|ведьм|королев|старух|девочк)/iu.test(textStr)){
      voice='ru-RU-SvetlanaNeural';
     }
    }
    try{
     const audio=await edgeSpeech(String(b.text||''),voice);
     res.writeHead(200,{'Content-Type':'audio/mpeg','Cache-Control':'no-store'});return res.end(audio);
    }catch(edgeErr){
     if(voiceStatus.installed&&!b.preview){
      const result=await sileroSpeech(String(b.text||''),config.sileroSpeaker);
      res.writeHead(200,{'Content-Type':'audio/wav','Cache-Control':'no-store','X-Synthesis-Fallback':'silero'});return res.end(result.audio);
     }
     throw edgeErr;
    }
   }
   if(config.ttsProvider==='openai'||b.preview==='openai'){
    await keysReady;
    const ttsCfg={...config};
    if(b.preview==='openai'&&b.voice){ttsCfg.voice=b.voice;ttsCfg.forceVoice=true;}
    if(b.preview==='openai'&&b.ttsModel)ttsCfg.ttsModel=b.ttsModel;
    const audio=await speech(ttsCfg,keys,String(b.text||''),observe);
    res.writeHead(200,{'Content-Type':'audio/mpeg','Cache-Control':'no-store'});return res.end(audio);
   }
   throw Error('Выберите Edge, Silero или OpenAI для серверного озвучивания.');
  }
  if(url.pathname==='/api/live-start'){
   if(config.voicePipeline!=='live')throw Error('Выберите режим Live в настройках');
   if(liveSessions.size||liveStarting)throw Error('Live уже подключён. Сначала отключите микрофон');
   liveStarting=true;try{await keysReady;const session=await createLiveSession(config,keys,b.sdp);liveSessions.set(session.id,{model:config.liveModel,at:Date.now(),accounted:0});return json(res,session);}finally{liveStarting=false;}
  }
  if(url.pathname==='/api/live-meter'){
   const session=liveSessions.get(b.sessionId);if(!session)return json(res,{ok:true});
   const elapsed=Math.max(15,Number.isFinite(b.seconds)&&b.seconds>=0?b.seconds:(Date.now()-session.at)/1000),seconds=Math.max(0,elapsed-session.accounted);
   session.accounted=elapsed;if(b.closed===true)liveSessions.delete(b.sessionId);
   if(seconds)await observe({provider:'openai',model:session.model,kind:'live',status:200,audioSeconds:seconds,data:{}});
   if(b.closed===true){liveSessions.delete(b.sessionId);if(b.finalized===false)await observe({provider:'openai',model:session.model,kind:'live-finalization-unconfirmed',status:200,data:{}});}return json(res,{ok:true});
  }
  if(url.pathname==='/api/generate-map'){
   const c=campaigns.find(x=>x.id===b.id);if(!c)throw Error('Кампания не найдена');
   if(config.provider!=='demo')await keysReady;
   const map=await generateTacticalMap(config,keys,c,observe,b.focus||'',b.mode||'tactical');
   checkpoint(c);
   c.maps=[map,...(c.maps||[]).filter(m=>m.id!==map.id)].slice(0,30);
   await commitCampaign(c);
   return json(res,{ok:true,map,state:state()});
  }
  if(url.pathname==='/api/image-prompt'){const c=campaigns.find(c=>c.id===b.id);if(!c)throw Error('Кампания не найдена');return json(res,buildPortraitPrompt(c,b.characterId));}
  if(['/api/image-request','/api/image-check'].includes(url.pathname)){
   const campaign=campaigns.find(c=>c.id===b.id);if(!campaign)throw Error('Кампания не найдена');if(imageBusy.has(b.id))throw Error('Предыдущий запрос к очереди ещё выполняется');imageBusy.add(b.id);
   try{
    if(url.pathname==='/api/image-request'){
     if(config.imageProvider==='horde'&&b.publicConsent!==true)throw Error('Подтвердите публичность описания и результата для бесплатного анонимного AI Horde');
     const kind=b.kind||'scene',characterId=kind==='portrait'?b.characterId||'':'';if(kind==='portrait'&&!campaign.characters.some(h=>h.id===characterId))throw Error('Выберите героя');
     const prompt=String(b.prompt||'').trim();if(prompt.length<5||prompt.length>1500)throw Error('Описание: от 5 до 1500 символов');
     const fingerprint=imageFingerprint(prompt,kind,characterId);if((campaign.images||[]).length>=100)throw Error('В галерее уже 100 изображений');
     if((campaign.images||[]).some(i=>i.fingerprint===fingerprint&&(i.provider||'horde')===config.imageProvider&&(config.imageProvider!=='openai'||i.model===config.imageModel&&i.quality===config.imageQuality)&&['queued','ready'].includes(i.status)))return json(res,state());
     if((campaign.images||[]).filter(i=>i.status==='queued').length>=2)throw Error('Уже ожидаются два изображения');
     await keysReady;const job=config.imageProvider==='openai'?await saveOpenAIImage(await generateImage(config,keys,prompt,observe),{prompt,kind,characterId,model:config.imageModel,quality:config.imageQuality},path.join(dataDir,'Images')):await queueIllustration({prompt,kind,characterId});await updateImage(b.id,c=>{c.images??=[];if(c.images.length>=100)throw Error('В галерее уже 100 изображений');c.images.push(job);});
    }else{
     const job=campaign.images?.find(i=>i.id===b.imageId);if(!job)throw Error('Изображение не найдено');if(job.status!=='queued')return json(res,state());
     if((imageChecks.get(job.id)||0)>Date.now()-10000)return json(res,state());imageChecks.set(job.id,Date.now());const checked=await checkIllustration(job,path.join(dataDir,'Images'));
     await updateImage(b.id,c=>{const index=c.images.findIndex(i=>i.id===job.id);if(index>=0)c.images[index]=checked;});
    }
    return json(res,state());
   }finally{imageBusy.delete(b.id);}
  }
  const original=campaigns.find(x=>x.id===b.id);if(!original)throw Error('Кампания не найдена');
  const requestId=typeof b.requestId==='string'?b.requestId.slice(0,100):null;const fingerprint=operationHash({route:url.pathname,body:{...b,requestId:undefined}});
  const receipt=requestId?original.receipts?.find(r=>r.id===requestId):null;if(receipt){if(receipt.fingerprint!==fingerprint)throw Error('ID запроса уже использован для другого действия');return json(res,state());}
  if(busy.has(b.id))throw Error('Дождитесь завершения текущего действия');busy.add(b.id);
  try {
   const c=structuredClone(original);
   if(url.pathname==='/api/delivery'){
    if(b.action==='interrupt'){if(c.delivery?.id===b.deliveryId)interruptDelivery(c);}
    else if(b.action==='ack')advanceDelivery(c,b.deliveryId,b.index);
    else if(b.action==='finish'){while(c.delivery?.id===b.deliveryId)advanceDelivery(c,b.deliveryId,c.delivery.index);}
    else throw Error('Неизвестное действие озвучивания');
   }
   else if(url.pathname==='/api/summary'){
    if(c.delivery)throw Error('Сначала остановите или дослушайте мастера');
    if(b.action==='clear'){c.summary=null;}
    else if(b.action==='edit'){if(!summaryValid(c))throw Error('Сначала создайте сводку');setSummary(c,b.text,c.summary);}
    else {
     const plan=summaryPlan(c,true);if(!plan)throw Error('Для сводки нужны старые события: последние 12 записей остаются подробными.');
     await keysReady;
     const result=config.provider==='demo'?{summary:'Учебная сводка (без ИИ): '+[plan.previous,...plan.events.map(e=>e.text)].join(' ').slice(0,3900)}:await summarize(config,keys,plan,observe);
     setSummary(c,result.summary,plan);
    }
   }
   else if(url.pathname==='/api/reaction-clock'){
updateReactionClock(c,b);}
   else if(url.pathname==='/api/undo'){const receipts=c.receipts;undo(c);c.receipts=receipts;}
   else if(url.pathname==='/api/actions'){
    if(c.delivery||c.pending||c.reaction)throw Error('Сначала завершите реплику, бросок или угрозу');
    checkpoint(c);const source={id:randomUUID(),role:'user',text:'Игрок подтвердил операцию с листом, памятью или вещами.',at:new Date().toISOString()};c.journal.push(source);
    const messages=applyActions(c,b.actions,source.id);c.journal.push({id:randomUUID(),role:'system',text:messages.join('\n'),at:new Date().toISOString()});
   }
   else if(url.pathname==='/api/action-proposal'){
    if(c.delivery)throw Error('Сначала дослушайте или остановите мастера');checkpoint(c);const message=approveAction(c,b.proposalId,b.accept===true);c.journal.push({id:randomUUID(),role:'system',text:message,at:new Date().toISOString()});
   }
   else if(url.pathname==='/api/heroes'){
    if(c.delivery)throw Error('Остановите или дослушайте мастера перед правкой листа');
    if(!Array.isArray(b.characters)||b.characters.length!==c.characters.length)throw Error('Изменять количество героев нужно при создании кампании');
    const used=new Set();const edited=b.characters.map(x=>{if(!c.characters.some(y=>y.id===x.id)||used.has(x.id))throw Error('Некорректный ID героя');used.add(x.id);return {...character({...c.characters.find(h=>h.id===x.id),...x}),id:x.id};});checkpoint(c);c.characters=edited;c.journal.push({id:randomUUID(),role:'system',text:'Игроки обновили листы персонажей.',at:new Date().toISOString()});
   }
   else if(url.pathname==='/api/proposal'){checkpoint(c);approveProposal(c,b.proposalId,b.accept===true);}
   else if(url.pathname==='/api/turn'&&c.sessionZero&&!c.sessionZero.complete&&config.provider==='demo'){
    if(b.raw!==undefined||b.passReaction)throw Error('Сначала завершите нулевую сессию');
    checkpoint(c);sessionZeroTurn(c,b.text);
   }
   else if(url.pathname==='/api/turn'){
    interruptDelivery(c);
    if(!c.characters.length&&(!c.sessionZero||c.sessionZero.complete))throw Error('Добавьте хотя бы одного героя');if(c.proposals.length)throw Error('Сначала подтвердите или отклоните изменения HP');
    if(b.reactionId&&b.reactionId!==c.reaction?.id)throw Error('Эта пауза уже завершена');
    if(b.timedOut&&(!c.reaction||c.reaction.paused||!c.reaction.deadlineAt||Date.now()<c.reaction.deadlineAt))throw Error('Таймер реакции ещё не истёк');
    if(b.passReaction&&!c.reaction)throw Error('Сейчас нет паузы для реакции');
    if(b.rollId&&b.rollId!==c.pending?.id)throw Error('Этот запрос броска уже завершён');
    if(c.pending&&b.raw===undefined)throw Error('Сначала внесите ожидаемый бросок d20');
    checkpoint(c);let roll=null,localReply=null;
    if(b.raw!==undefined){roll=resolveRoll(c,b.raw);c.journal.push({id:randomUUID(),role:'system',text:'VERIFIED_ROLL '+JSON.stringify(roll),at:new Date().toISOString()});}
    else {const text=String(b.text||'').trim();if(!text)throw Error('Опишите действие');if(text.length>6000)throw Error('Слишком длинное действие');const hero=c.characters.find(x=>x.id===b.characterId);const speaker=hero?.name||(c.sessionZero&&!c.sessionZero.complete?'Игроки':null);if(!speaker)throw Error('Выберите действующего персонажа');const event={id:randomUUID(),role:'user',text:`${speaker}${b.interrupted?' (ПЕРЕБИВАЕТ МАСТЕРА)':''}: ${text}`,at:new Date().toISOString()};c.journal.push(event);
     if(hero){
      localReply=localCommand(c,text,hero.id,event.id);
      if(!localReply&&/^(?:я\s+)?(?:обещаю|клянусь)(?:\s|$)/iu.test(playerSpeech(c,text,hero.id)))remember(c,{kind:'promise',text:playerSpeech(c,text,hero.id),actorId:hero.id},event.id);
     }
    }
    if(config.provider!=='demo')await keysReady;
    const prepareFirst=text=>{const first=narrationParts(text)[0];if(first)audioStreams.prepare(first,audioScope(first));};
    const speechCallback=b.voiceDelivery&&(config.ttsProvider==='openai'||config.ttsProvider==='edge')?prepareFirst:undefined;
    const reply=localReply?{narration:localReply,changes:[]}:config.provider==='demo'?demoReply(c,b,roll):await generate({...config},{...keys},c,observe,speechCallback,speechCallback);if(b.voiceDelivery)stageReply(c,reply);else acceptReply(c,reply);
   } else return json(res,{error:'Неизвестный маршрут'},404);
   if(url.pathname==='/api/turn'){const latest=campaigns.find(x=>x.id===c.id);if(latest?.summary&&(!c.summary||latest.summary.count>c.summary.count)&&summaryValid({...c,summary:latest.summary}))c.summary=latest.summary;}
   if(requestId)c.receipts=[...(c.receipts||[]),{id:requestId,fingerprint}].slice(-100);await commitCampaign(c);
   if(url.pathname==='/api/turn'&&config.autoSummary==='on'&&config.provider!=='demo'&&!summaryBusy.has(c.id)){
    const plan=summaryPlan(c);if(plan){summaryBusy.add(c.id);const snapshotConfig={...config},snapshotKeys={...keys};
     (async()=>{try{const result=await summarize(snapshotConfig,snapshotKeys,plan,observe);await updateImage(c.id,latest=>{if((latest.summary?.count||0)<plan.count)setSummary(latest,result.summary,plan);});}catch{}finally{summaryBusy.delete(c.id);}})();
    }
   }
   return json(res,state());
  }finally{busy.delete(b.id);}
 } catch(e){json(res,{error:e.message||'Ошибка приложения'},400);}
 finally{if(costSensitive)costRequests--;}
};
server=http.createServer(serverHandler);
if(tlsOptions)httpsServer=https.createServer(tlsOptions,serverHandler);
const portEnv=Number(process.env.PORT||0);
server.listen(portEnv,'0.0.0.0',()=>{
 const port=server.address().port;
 console.log(`SKAZITEL_URL=http://127.0.0.1:${port}`);
 for(const ip of getLanIps())console.log(`SKAZITEL_LAN_URL=http://${ip}:${port}`);
 if(httpsServer){
  const desiredHttpsPort=portEnv===0?0:port+1;
  httpsServer.listen(desiredHttpsPort,'0.0.0.0',()=>{
   const httpsPort=httpsServer.address().port;
   console.log(`SKAZITEL_HTTPS_URL=https://127.0.0.1:${httpsPort}`);
   for(const ip of getLanIps())console.log(`SKAZITEL_LAN_HTTPS_URL=https://${ip}:${httpsPort}`);
  }).on('error',err=>{
   console.warn('HTTPS server failed to bind:',err.message);
  });
 }
});
process.once('SIGTERM',()=>{closeLocalVoice();campaignStore.close();server.close();try{httpsServer?.close();}catch{}process.exit(0);});
process.once('SIGINT',()=>{closeLocalVoice();campaignStore.close();server.close();try{httpsServer?.close();}catch{}process.exit(0);});
