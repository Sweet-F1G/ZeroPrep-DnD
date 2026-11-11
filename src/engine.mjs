import { randomUUID } from 'node:crypto';
import {skills,integer,sheet,requestRoll,rollResult,editions} from './rules.mjs';
import {proposeActions,applyActions} from './actions.mjs';
import {heroRecords} from './progression.mjs';
import {dmState,availableHints,spellAvailable} from './dm-state.mjs';
export {skills,integer} from './rules.mjs';
export {baseSystem as SYSTEM} from './prompts.mjs';
export function character(c={}) {
 const name=String(c.name||'Новый герой').trim().slice(0,80); if(!name) throw Error('Укажите имя героя');
 const maxHp=integer(c.maxHp??20,1,9999,'Максимум HP');
 const avatar=typeof c.avatar==='string'?c.avatar.slice(0,250000):'';
 return {id:randomUUID(),name,avatar,description:String(c.description||'Искатель приключений').slice(0,500),maxHp,hp:integer(c.hp??maxHp,0,maxHp,'HP'),ac:integer(c.ac??12,0,50,'КД'),...sheet(c),...heroRecords(c)};
}
export function makeCampaign({name,setting,source='',characters=[],edition='legacy',persona='realist_dreamer',personaDetails=''}) {
 if(!Array.isArray(characters)||characters.length>12)throw Error('В партии должно быть не больше 12 героев');
 edition=String(edition);if(!Object.hasOwn(editions,edition))throw Error('Неизвестная редакция правил');
 if(!String(name||'').trim()) throw Error('Укажите название кампании');
 return {id:randomUUID(),schemaVersion:5,dm:dmState(),edition,persona:String(persona||'realist_dreamer').slice(0,50),personaDetails:String(personaDetails||'').slice(0,1000),visionObservation:'',clockMinutes:0,maps:[],memory:[],inventory:[],wallet:{group:0},loot:[],actionProposals:[],receipts:[],name:String(name).slice(0,100),setting:String(setting||'Фэнтези, исследование и приключения').slice(0,10000),source:String(source).slice(0,120000),characters:characters.map(character),journal:[],rolls:[],pending:null,reaction:null,delivery:null,summary:null,proposals:[],undo:[],createdAt:new Date().toISOString()};
}
export function checkpoint(c) { const {undo,...rest}=c; c.undo.push(structuredClone(rest)); c.undo=c.undo.slice(-20); }
export function undo(c) { if(!c.undo.length) throw Error('Нет действия для отмены'); const previous=c.undo.pop(), history=c.undo; Object.assign(c,{reaction:null,delivery:null,summary:null,profile:null,sessionZero:null,maps:[],memory:[],inventory:[],wallet:{group:0},loot:[],actionProposals:[],dm:dmState(),encounter:null,clockMinutes:0},previous,{undo:history}); }
export const resolveRoll=rollResult;
export function acceptReply(c,reply) {
 if(!reply||typeof reply.narration!=='string'||!reply.narration.trim()||reply.narration.length>12000) throw Error('Модель вернула некорректный ответ. Попробуйте ещё раз.');
 let pending=null;
 if(reply.roll_request) {
  pending=requestRoll(c,reply.roll_request);
 }
 const proposals=(Array.isArray(reply.changes)?reply.changes:[]).slice(0,10).map(p=>{
  if(!c.characters.some(x=>x.id===p.characterId)) throw Error('Неизвестный персонаж в изменениях');
  return {id:randomUUID(),characterId:p.characterId,hpDelta:integer(p.hpDelta,-999,999,'Изменение HP'),reason:String(p.reason||'Изменение HP').slice(0,500)};
 });
 let reaction=null;
 if(reply.reaction_request){
  const r=reply.reaction_request;
  if(typeof r.prompt!=='string'||!r.prompt.trim()||r.prompt.length>700)throw Error('Модель вернула некорректную паузу для реакции');
  if(pending||proposals.length)throw Error('Во время паузы нельзя заранее назначать бросок или последствия. Сначала дайте игрокам вмешаться.');
  const seconds=Number.isFinite(Number(r.timeoutSeconds))?Math.max(3,Math.min(30,Math.round(Number(r.timeoutSeconds)))):30;
  reaction={id:randomUUID(),prompt:r.prompt.trim(),stakes:String(r.stakes||'Опасность ещё не разрешена. Выберите, как вмешаться.').slice(0,700),timeoutSeconds:seconds,remainingMs:seconds*1000,deadlineAt:null,paused:false};
 }
 const entry={id:randomUUID(),role:'assistant',text:reply.narration,at:new Date().toISOString()};
 if(reply.illustration_suggestion){const i=reply.illustration_suggestion;if(typeof i.prompt!=='string'||i.prompt.trim().length<5||i.prompt.length>1500)throw Error('Некорректное описание иллюстрации');const kind=i.kind==='portrait'?'portrait':'scene';if(kind==='portrait'&&!c.characters.some(h=>h.id===i.characterId))throw Error('Неизвестный герой для портрета');entry.illustrationSuggestion={kind,characterId:kind==='portrait'?i.characterId:'',prompt:i.prompt.trim(),reason:String(i.reason||'Этот момент можно проиллюстрировать').slice(0,180)};}
 const draft=structuredClone(c);draft.journal.push(entry);
 const operations=reply.actions||[],automaticTypes=['sheet.patch','hero.record','hero.create','hero.delete','session.complete','feature.learn','feature.remove','spell.learn','spell.remove','training.grant','resource.add','resource.configure','resource.remove','item.add','item.consume','item.transfer','item.equip','item.update','item.store','item.buy','wallet.change','rest','time.advance','memory.add','memory.status','world.update','scene.update','resource.use','boundary.start','encounter.end','progression.award','map.update','map.remove'];
 if(!Array.isArray(operations)||operations.length>25)throw Error('Некорректный список операций');
 for(const a of operations){
  if(a&&typeof a==='object'){
   if(!a.reason||typeof a.reason!=='string'||!a.reason.trim())a.reason='Действие Мастера';
   if(['hero.create','hero.delete','session.complete'].includes(a.type)||(c.sessionZero&&!c.sessionZero.complete)){
    if(a.commit!=='proposed')a.commit='resolved';
   }
  }
 }
 const actionPriority={'hero.create':1,'hero.delete':2,'session.complete':3,'sheet.patch':4,'hero.record':4,'feature.learn':4,'spell.learn':4,'training.grant':4,'resource.add':4,'resource.configure':4,'item.add':5,'item.update':5,'item.equip':5,'item.transfer':5,'wallet.change':5};
 const automatic=operations.filter(a=>((c.dm?.autonomy==='full'&&a.type!=='dm.configure')||((c.dm?.autonomy||'automatic')==='automatic'&&automaticTypes.includes(a.type)))&&a.commit==='resolved'&&typeof a.reason==='string'&&a.reason.trim()).sort((a,b)=>(actionPriority[a.type]||10)-(actionPriority[b.type]||10));
 if(reaction&&automatic.length)throw Error('До вмешательства нельзя применять последствия');
 const messages=automatic.length?applyActions(draft,automatic,entry.id):[];
 const actionProposals=proposeActions(draft,operations.filter(a=>!automatic.includes(a)),entry.id);
 if(messages.length){entry.automaticChanges=messages.map((text,i)=>automatic[i].type==='world.update'&&(automatic[i].entry?.visibility==='gm'||draft.dm?.world?.some(w=>w.id===automatic[i].entry?.id&&w.visibility==='gm'))?'Скрытая запись мира обновлена':text);draft.dm=dmState(draft.dm);for(let i=0;i<messages.length;i++)draft.dm.changes.push({id:randomUUID(),sourceId:entry.id,text:messages[i],visibility:(automatic[i].entry?.visibility==='gm'||draft.dm?.world?.some(w=>w.id===automatic[i].entry?.id&&w.visibility==='gm'))?'gm':'party',at:entry.at});draft.dm.changes=draft.dm.changes.slice(-100);}

 if(reaction&&actionProposals.length)throw Error('Сначала вмешательство игроков, затем последствия');
 const nextActions=[...(c.actionProposals||[]),...actionProposals].filter((x,i,all)=>all.findIndex(y=>y.fingerprint===x.fingerprint)===i);
 if(nextActions.length>30)throw Error('Слишком много неподтверждённых действий: обработайте старые');
 Object.assign(c,draft);c.pending=pending;c.reaction=reaction;c.proposals=proposals;c.actionProposals=nextActions;
 if(c.characters?.length&&c.sessionZero&&!c.sessionZero.complete&&operations.some(a=>['session.complete','scene.update','map.update'].includes(a?.type))){c.sessionZero.complete=true;}
 const hintState=availableHints(c);if(hintState.enabled&&Array.isArray(reply.tactical_hints)){const recent=c.journal.slice(-4).flatMap(e=>e.tacticalHints||[]).map(h=>h.text);entry.tacticalHints=reply.tactical_hints.slice(0,2).flatMap(v=>{if(!v||typeof v!=='object')return [];const h=c.characters.find(h=>h.id===v.characterId),text=String(v.text||'').slice(0,300);if(!h||!text||recent.includes(text))return [];if(v.resourceId&&!h.resources.some(r=>r.id===v.resourceId&&r.current>0))return [];if(v.featureId&&!h.features.some(f=>f.id===v.featureId))return [];if(v.spellId&&!h.spells.some(s=>s.id===v.spellId&&s.prepared&&spellAvailable(h,s,c)))return [];if(!v.resourceId&&!v.featureId&&!v.spellId&&v.kind!=='rule')return [];return [{characterId:h.id,text,...(v.resourceId?{resourceId:v.resourceId}:{}),...(v.featureId?{featureId:v.featureId}:{}),...(v.spellId?{spellId:v.spellId}:{})}];});}
 c.journal[c.journal.length-1]=entry;
}
export function approveProposal(c,id,accept) {
 const p=c.proposals.find(x=>x.id===id); if(!p) throw Error('Предложение уже обработано');
 if(accept) { const hero=c.characters.find(x=>x.id===p.characterId);let delta=p.hpDelta;if(delta<0){const absorbed=Math.min(hero.tempHp||0,-delta);hero.tempHp=(hero.tempHp||0)-absorbed;delta+=absorbed;}hero.hp=Math.max(0,Math.min(hero.maxHp,hero.hp+delta));if(hero.hp>0)hero.deathSaves={successes:0,failures:0};else hero.concentration=''; }
 c.journal.push({id:randomUUID(),role:'system',text:`${accept?'Подтверждено':'Отклонено'}: ${p.reason}; HP ${p.hpDelta>0?'+':''}${p.hpDelta}`,at:new Date().toISOString()});
 c.proposals=c.proposals.filter(x=>x.id!==id);
}
export function demoReply(c,input,roll) {
 if(roll) return {narration:roll.success?`Проверка успешна: ${roll.total} против сложности ${roll.dc}. Вы замечаете безопасный проход вдоль стены и свежие следы у двери. Можно изучить их или пройти дальше. Что вы делаете?`:`Проверка не удалась: ${roll.total} против сложности ${roll.dc}. Камень выскальзывает из-под ноги, и шум выдаёт ваше присутствие. Из-за двери доносится вопрос: «Кто там?» Как вы ответите?`,roll_request:null,changes:[]};
 if(input.passReaction&&c.reaction)return {narration:'Вы решили не вмешиваться. Магический узор становится ярче. Чтобы сопротивляться влиянию, нужна проверка Мудрости, сложность 12. Бросьте d20.',roll_request:{characterId:c.characters[0].id,skill:'wisdom',dc:12,reason:'Сопротивляться гипнотическому влиянию',stakes:'При провале герой ненадолго теряет контроль; последствия обсудим после броска.'},changes:[]};
 if(c.reaction)return {narration:'Вы успеваете вмешаться до завершения гипноза. Чародей отвлекается, и магический узор гаснет. Герой сохраняет контроль. Это учебная развязка; в обычной игре мастер оценит ваше действие и при необходимости запросит бросок.',roll_request:null,changes:[]};
 if(/пауза|гипноз|гипнотиз/i.test(input.text||''))return {narration:'Учебная сцена: незнакомец поднимает медальон, и взгляд героя начинает цепляться за мерцающий узор. Заклинание ещё не завершено. Кто вмешается?',reaction_request:{prompt:'Кто и как поможет герою до завершения гипноза?',timeoutSeconds:15,stakes:'Если никто не вмешается, герой будет сопротивляться влиянию проверкой Мудрости.'},roll_request:null,changes:[]};
 if(!c.journal.some(x=>x.role==='assistant')) return {narration:'Это учебная сцена без ИИ: ответы здесь заготовлены для проверки приложения. Впереди — запертая дверь, рядом видны следы на влажной земле. Попробуйте осмотреть следы: мастер попросит физический бросок. Для свободной игры подключите модель в настройках.',roll_request:null,changes:[]};
 const hero=c.characters.find(x=>x.id===input.characterId)||c.characters[0];
 return {narration:`${hero.name}, вы осматриваете следы у двери. Сделайте проверку Восприятия, сложность 12. При провале вы привлечёте внимание обитателя здания. Бросьте настоящий d20 и внесите число с грани в карточку проверки.`,roll_request:{characterId:hero.id,skill:'perception',dc:12,reason:'Осмотреть следы у двери',stakes:'При провале шум привлечёт внимание обитателя здания.'},changes:[]};
}

export function updateReactionClock(c,{reactionId,action},now=Date.now()){
 const r=c.reaction;if(!r||r.id!==reactionId)throw Error('Эта пауза уже завершена');
 if(action==='pause'){
  if(r.deadlineAt!==null)r.remainingMs=Math.max(0,r.deadlineAt-now);
  r.deadlineAt=null;r.paused=true;
 }else if(action==='start'){
  if(!r.paused&&r.deadlineAt===null)r.deadlineAt=now+r.remainingMs;
 }else if(action==='resume'){
  if(r.remainingMs<=0)throw Error('Время закончилось. Вмешайтесь или продолжите сцену.');
  if(r.paused){r.paused=false;r.deadlineAt=now+r.remainingMs;}
 }else throw Error('Неизвестное действие таймера');
}
