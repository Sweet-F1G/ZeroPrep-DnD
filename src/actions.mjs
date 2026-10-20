import {mapAction} from './maps.mjs';
import {progressionAction,recordHero,heroRecords} from './progression.mjs';import {dmAction} from './dm-state.mjs';
import {randomUUID} from 'node:crypto';import {useResource,rest,advanceTime,resource,sheet,integer} from './rules.mjs';import {remember,changeMemoryStatus,checkDeadlines,operationHash} from './memory.mjs';import {inventoryAction,rollLoot,claimLoot,validateInventory} from './inventory.mjs';
const types=['map.update','map.remove','item.update','feature.remove','spell.remove','resource.remove','training.grant','progression.award','progression.configure','progression.levelup','hero.record','hero.create','hero.delete','session.complete','feature.learn','spell.learn','dm.configure','world.update','scene.update','boundary.start','encounter.end','resource.configure','sheet.patch','memory.add','memory.status','resource.use','resource.add','rest','time.advance','item.add','item.consume','item.transfer','item.equip','item.store','item.buy','wallet.change','loot.roll','loot.claim'];
export function executeAction(c,action,sourceId){
 if(!action||!types.includes(action.type))throw Error('Неизвестное игровое действие');let text;
 if(action.type.startsWith('map.'))text=mapAction(c,action);
 else if(action.type==='hero.create'){
  const ch=action.character;if(!ch||typeof ch!=='object')throw Error('Некорректные данные персонажа');
  if(action.replaceParty)c.characters=[];
  if(c.characters.length>=12)throw Error('В партии уже максимум 12 героев');
  const name=String(ch.name||'Новый герой').trim().slice(0,80);
  const maxHp=integer(ch.maxHp??12,1,9999,'Максимум HP');
  const id=String(ch.id||randomUUID()).slice(0,100);
  const h={id,name,description:String(ch.description||'Искатель приключений').slice(0,500),maxHp,hp:integer(ch.hp??maxHp,0,maxHp,'HP'),ac:integer(ch.ac??12,0,50,'КД'),...sheet(ch),...heroRecords(ch)};
  c.characters.push(h);text=`Создан герой: ${h.name} (${h.className||'Искатель приключений'}, HP ${h.hp}/${h.maxHp}, КД ${h.ac})`;
  if(Array.isArray(ch.items)){
   for(const it of ch.items){
    if(it&&typeof it==='object'&&it.name){
     try{executeAction(c,{type:'item.add',item:{...it,ownerId:h.id,carrierId:h.id}},sourceId);}catch{}
    }
   }
  }
 }
 else if(action.type==='hero.delete'){
  const index=c.characters.findIndex(h=>h.id===action.characterId);if(index<0)throw Error('Герой не найден');
  const name=c.characters[index].name;c.characters.splice(index,1);text=`Герой ${name} удалён из партии`;
 }
 else if(action.type==='session.complete'){
  if(c.sessionZero)c.sessionZero.complete=true;text='Подготовка завершена. Приключение начинается!';
 }
 else if(['feature.remove','spell.remove','resource.remove'].includes(action.type)){const h=c.characters.find(h=>h.id===action.characterId);if(!h)throw Error('Герой не найден');const field=({ 'feature.remove':'features','spell.remove':'spells','resource.remove':'resources'})[action.type];if(!h[field]?.some(x=>x.id===action.recordId))throw Error('Запись не найдена');h[field]=h[field].filter(x=>x.id!==action.recordId);text=`${h.name}: запись удалена`;}
 else if(action.type.startsWith('progression.'))text=progressionAction(c,action,sourceId);
 else if(['hero.record','feature.learn','spell.learn','training.grant'].includes(action.type))text=recordHero(c,action,sourceId);
 else if(['dm.configure','world.update','scene.update','boundary.start','encounter.end'].includes(action.type))text=dmAction(c,action,sourceId);
 else if(action.type==='resource.configure'){const h=c.characters.find(h=>h.id===action.characterId),i=h?.resources.findIndex(r=>r.id===action.resourceId);if(i===undefined||i<0)throw Error('Ресурс не найден');const patch=action.patch||{};if(Object.keys(patch).some(k=>!['max','recovery','recoverAmount','resetOn','slotLevel','description'].includes(k)))throw Error('Некорректная настройка ресурса');h.resources[i]=resource({...h.resources[i],...patch});text=`${h.name}: ресурс настроен`;}
 else if(action.type==='sheet.patch'){
  const h=c.characters.find(h=>h.id===action.characterId);if(!h)throw Error('Герой не найден');const p=action.patch;if(!p||typeof p!=='object'||Array.isArray(p))throw Error('Нужна правка листа');
  const allowed=['level','className','bonusMode','bonuses','saves','abilityScores','training','saveTraining','maxHp','hp','ac','tempHp','conditions','concentration','notes','hitDice'];if(Object.keys(p).some(k=>!allowed.includes(k)))throw Error('Неизвестное поле листа');
  const next={...h,...p};if(Object.hasOwn(p,'level'))next.sheetVerified=true;for(const k of ['bonuses','saves','abilityScores','training','saveTraining','hitDice'])if(p[k])next[k]={...h[k],...p[k]};
  integer(next.maxHp,1,9999);integer(next.hp,0,next.maxHp);integer(next.ac,0,50);Object.assign(h,next,sheet(next));text=`${h.name}: лист обновлён`;
 }
 else if(action.type.startsWith('item.')||action.type==='wallet.change')text=inventoryAction(c,action);
 else if(action.type==='memory.add')text=remember(c,action.note||{},sourceId);
 else if(action.type==='memory.status')text=changeMemoryStatus(c,action,sourceId);
 else if(action.type==='resource.use')text=useResource(c,action);
 else if(action.type==='resource.add'){const h=c.characters.find(h=>h.id===action.characterId);if(!h)throw Error('Герой не найден');h.resources??=[];if(h.resources.length>=100)throw Error('Слишком много ресурсов');const r=resource(action.resource);if(h.resources.some(x=>x.id===r.id))throw Error('Ресурс уже существует');h.resources.push(r);text=`${h.name}: добавлен ресурс ${r.name}`;}
 else if(action.type==='rest')text=rest(c,action.kind,action.characterId);
 else if(action.type==='time.advance'){advanceTime(c,action.minutes);text=`Прошло ${action.minutes} игровых минут`;}
 else if(action.type==='loot.roll'){const l=rollLoot(c,{table:action.table,sourceId:action.sourceId||sourceId});text=`Найдена добыча: ${l.item?.name||'без предметов'}, ${l.copper} мм. Выдача ждёт подтверждения.`;}
 else if(action.type==='loot.claim')text=claimLoot(c,action.lootId);
 validateInventory(c);checkDeadlines(c);return text;
}
export const actionOrder={'hero.create':1,'hero.delete':2,'session.complete':3,'sheet.patch':4,'hero.record':4,'feature.learn':4,'spell.learn':4,'training.grant':4,'resource.add':4,'resource.configure':4,'item.add':5,'item.update':5,'item.equip':5,'item.transfer':5,'wallet.change':5};
export function applyActions(c,actions,sourceId){
 if(!Array.isArray(actions)||!actions.length||actions.length>25)throw Error('От одного до двадцати пяти действий за раз');
 const sorted=[...actions].sort((a,b)=>(actionOrder[a?.type]||10)-(actionOrder[b?.type]||10));
 const draft=structuredClone(c),messages=sorted.map(a=>executeAction(draft,a,sourceId));
 Object.assign(c,draft);return messages;
}
export function proposeActions(c,actions,sourceId){
 if(actions===undefined)return [];if(!Array.isArray(actions)||actions.length>25)throw Error('Некорректный список действий');
 const draft=structuredClone(c);return actions.map(a=>{
  const copy=structuredClone(a);if(typeof copy.type!=='string'||JSON.stringify(copy).length>6000)throw Error('Некорректное действие');
  // Validation is speculative; no proposed effect reaches the real campaign before approval.
  applyActions(draft,[copy],sourceId);
  return {id:randomUUID(),fingerprint:operationHash(copy),action:copy,sourceId,reason:String(a.reason||'Предложение мастера').slice(0,500)};
 });
}
export function approveAction(c,proposalId,accept){
 const p=c.actionProposals?.find(p=>p.id===proposalId);if(!p)throw Error('Предложение уже обработано');
 const text=accept?applyActions(c,[p.action],p.sourceId).join('\n'):'Действие отклонено';c.actionProposals=c.actionProposals.filter(p=>p.id!==proposalId);return text;
}
export function playerSpeech(c,text,characterId){
 let input=String(text).replace(/^(?:мастер|сказитель)[\s,:.!—-]+/iu,'').trim();const h=c.characters.find(h=>h.id===characterId);if(!h)return input;
 const names=[h.name];const first=h.name.split(/\s+/)[0];if(c.characters.filter(x=>x.name.split(/\s+/)[0].toLowerCase()===first.toLowerCase()).length===1)names.push(first);
 for(const name of names.sort((a,b)=>b.length-a.length)){const escaped=name.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');const pattern=new RegExp('^'+escaped+'[\\s,:.!—-]+','iu');if(pattern.test(input)){input=input.replace(pattern,'');break;}}
 return input;
}
// These commands use the exact player's words, with no interpretation by an LLM.
export function localCommand(c,text,characterId,sourceId){
 const input=playerSpeech(c,text,characterId),m=/^(запомни|запиши обещание|запиши задание)(?:\s*[:—,-]\s*|\s+)([\s\S]+)$/iu.exec(input);
 const level=/^(?:повышаю уровень|подтверждаю повышение)(?:[.,! ]|$)/iu.test(input);if(level){const h=c.characters.find(h=>h.id===characterId);if(!h?.progression?.pending)throw Error('У этого героя пока нет доступного повышения');const increases={};for(const [ru,k]of Object.entries({силу:'strength',ловкость:'dexterity',телосложение:'constitution',интеллект:'intelligence',мудрость:'wisdom',харизму:'charisma'})){const m=new RegExp(ru+'(?:\\s+на)?\\s+(1|2|один|одну|два|две)','iu').exec(input);if(m)increases[k]=/^(?:2|два|две)$/.test(m[1])?2:1;}return applyActions(c,[{type:'progression.levelup',characterId,pendingId:h.progression.pending.id,abilityIncreases:increases}],sourceId).join('\n');}
 if(m)return applyActions(c,[{type:'memory.add',note:{kind:/обещание/iu.test(m[1])?'promise':/задание/iu.test(m[1])?'quest':'fact',text:m[2],actorId:characterId}}],sourceId).join('\n');
 return null;
}
