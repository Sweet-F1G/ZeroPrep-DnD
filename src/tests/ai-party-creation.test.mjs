import {test} from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {mkdtemp,rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {makeCampaign,acceptReply} from '../engine.mjs';
import {executeAction} from '../actions.mjs';

test('hero.create, hero.delete and session.complete manage party dynamically', ()=>{
 const c=makeCampaign({name:'Деревня Дрочево',edition:'2024'});
 c.sessionZero={version:1,step:0,answers:{},draft:[],complete:false,editing:false};
 assert.equal(c.characters.length,0);

 // 1. AI creates first hero
 const t1=executeAction(c,{
  type:'hero.create',
  character:{
   name:'Вакула Кузнец',
   className:'Воин',
   species:'Человек',
   level:1,
   maxHp:14,
   hp:14,
   ac:15,
   abilityScores:{strength:16,dexterity:12,constitution:14,intelligence:10,wisdom:12,charisma:8}
  },
  commit:'resolved',
  reason:'Создание персонажа'
 },'test');
 assert.match(t1,/Вакула Кузнец/);
 assert.equal(c.characters.length,1);
 assert.equal(c.characters[0].hp,14);
 assert.equal(c.characters[0].ac,15);
 assert.equal(c.characters[0].abilityScores.strength,16);

 // 2. AI creates second hero
 const t2=executeAction(c,{
  type:'hero.create',
  character:{
   name:'Дед Тихон',
   className:'Друид',
   species:'Человек',
   level:1,
   maxHp:10,
   hp:10,
   ac:12
  },
  commit:'resolved',
  reason:'Создание персонажа'
 },'test');
 assert.match(t2,/Дед Тихон/);
 assert.equal(c.characters.length,2);

 // 3. AI completes session zero
 const t3=executeAction(c,{
  type:'session.complete',
  commit:'resolved',
  reason:'Старт приключения'
 },'test');
 assert.equal(c.sessionZero.complete,true);

 // 4. AI deletes hero if replaced
 const heroId=c.characters[1].id;
 const t4=executeAction(c,{
  type:'hero.delete',
  characterId:heroId,
  commit:'resolved',
  reason:'Удаление'
 },'test');
 assert.match(t4,/Дед Тихон удалён/);
 assert.equal(c.characters.length,1);
 assert.equal(c.characters[0].name,'Вакула Кузнец');

 // 5. Automatic execution via acceptReply
 acceptReply(c,{
  narration:'Кузнец выковывает подкову, когда на пороге появляется дед с козой.',
  actions:[
   {
    type:'hero.create',
    character:{name:'Дед Тихон',className:'Друид',maxHp:10,ac:12},
    commit:'resolved',
    reason:'Возвращение деда'
   },
   {
    type:'item.add',
    item:{name:'Тяжёлый кузнечный молот',category:'weapon',ownerId:'Вакула Кузнец'},
    commit:'resolved',
    reason:'Стартовое снаряжение'
   }
  ]
 });
 assert.equal(c.characters.length,2);
 assert.ok(c.inventory.some(i=>i.name==='Тяжёлый кузнечный молот'&&i.ownerId===c.characters[0].id));

 // 6. Test inverted action order (item.add before hero.create) with fuzzy ownerId and safe fallback
 const freshCampaign=makeCampaign({name:'Борьба за деревню'});
 freshCampaign.characters=[];
 freshCampaign.sessionZero={complete:false,step:0};
 acceptReply(freshCampaign,{
  narration:'Мастер создаёт героев и выдаёт им стартовые пожитки.',
  actions:[
   {
    type:'item.add',
    item:{name:'Серп друида',category:'weapon',ownerId:'Тихон'},
    commit:'resolved',
    reason:'Стартовое оружие'
   },
   {
    type:'item.add',
    item:{name:'Мешок картошки',category:'food',ownerId:'Неизвестный путник'},
    commit:'resolved',
    reason:'Общие припасы'
   },
   {
    type:'hero.create',
    character:{name:'Дед Тихон',className:'Друид',maxHp:14,ac:11},
    commit:'resolved',
    reason:'Генерация друида'
   },
   {
    type:'hero.create',
    character:{name:'Вакула Кузнец',className:'Воин',maxHp:16,ac:14},
    commit:'resolved',
    reason:'Генерация воина'
   },
   {
    type:'scene.update',
    scene:{name:'Деревенская площадь',description:'Солнце заливает пыльную дорогу'},
    commit:'resolved',
    reason:'Первая сцена'
   }
  ]
 });
 assert.equal(freshCampaign.characters.length,2);
 assert.equal(freshCampaign.sessionZero.complete,true);
 const sickle=freshCampaign.inventory.find(i=>i.name==='Серп друида');
 assert.ok(sickle);
 assert.equal(sickle.ownerId,freshCampaign.characters[0].id);
 const potatoes=freshCampaign.inventory.find(i=>i.name==='Мешок картошки');
 assert.ok(potatoes);
 assert.equal(potatoes.ownerId,'group');
});

test('HTTP API: campaign deletion and session zero AI flow', async ()=>{
 const dir=await mkdtemp(path.join(os.tmpdir(),'skazitel-del-'));let child,base;
 async function boot(){
  child=spawn(process.execPath,['server.mjs'],{
   cwd:new URL('..',import.meta.url),
   env:{...process.env,PORT:'0',SKAZITEL_KEYCHAIN_HELPER:'',SKAZITEL_DATA:dir,SKAZITEL_TOKEN:'test'},
   stdio:['ignore','pipe','inherit']
  });
  base=await new Promise((resolve,reject)=>{
   let out='';child.stdout.on('data',b=>{out+=b;const m=out.match(/SKAZITEL_URL=(http:\/\/[^\n]+)/);if(m)resolve(m[1]);});child.once('error',reject);
  });
 }
 async function api(route,data){
  const r=await fetch(base+'/api/'+route,{
   method:data?'POST':'GET',
   headers:{'x-app-token':'test','Content-Type':'application/json'},
   ...(data?{body:JSON.stringify(data)}:{})
  });
  const res=await r.json();
  assert.equal(r.status,200,JSON.stringify(res));
  return res;
 }
 async function stop(){
  const stopped=new Promise(r=>child.once('exit',r));child.kill();await stopped;
 }

 try{
  await boot();
  // Create two campaigns
  const c1=await api('create',{name:'Первая партия',sessionZero:true});
  const c2=await api('create',{name:'Вторая партия',sessionZero:true});
  assert.equal(c2.campaigns.length,2);
  assert.equal(c2.activeId,c2.campaigns[1].id);

  // Delete the second campaign via /api/campaign/delete
  const delRes=await api('campaign/delete',{id:c2.activeId});
  assert.equal(delRes.ok,true);
  assert.equal(delRes.campaigns.length,1);
  assert.equal(delRes.campaigns[0].name,'Первая партия');
  assert.equal(delRes.activeCampaignId,delRes.campaigns[0].id);

  // Delete the remaining campaign
  const delLast=await api('campaign/delete',{id:delRes.campaigns[0].id});
  assert.equal(delLast.ok,true);
  assert.equal(delLast.campaigns.length,0);
  assert.equal(delLast.activeCampaignId,'');
 }finally{
  if(child&&!child.killed)await stop();
  await rm(dir,{recursive:true,force:true});
 }
});
