import {randomUUID} from 'node:crypto';
import {abilities,skills,skillAbilities,editions} from './public/rule-data.mjs';
export {abilities,skills,skillAbilities,editions} from './public/rule-data.mjs';
export function integer(n,min,max,label='Число'){if(!Number.isInteger(n)||n<min||n>max)throw Error(`${label}: нужно целое число от ${min} до ${max}`);return n;}
export const modifier=score=>Math.floor((score-10)/2);
export const proficiency=level=>2+Math.floor((integer(level,1,20,'Уровень')-1)/4);
export function resource(r={}){
 const max=integer(r.max??1,1,999,'Максимум ресурса'),name=String(r.name||'').trim().slice(0,100);if(!name)throw Error('Назовите ресурс');
 const recovery=r.recovery||'manual';if(!['shortRest','longRest','turn','manual','gameTime','recharge'].includes(recovery))throw Error('Неизвестное восстановление ресурса');
 if(r.resetOn!==undefined&&r.resetOn!==null&&!['scene','battle','session','adventure'].includes(r.resetOn))throw Error('Неизвестное событие восстановления');
 return {resetOn:r.resetOn||null,slotLevel:r.slotLevel===undefined||r.slotLevel===null?null:integer(r.slotLevel,1,9,'Круг ячеек'),id:String(r.id||randomUUID()).slice(0,100),name,max,current:integer(r.current??max,0,max,'Осталось ресурса'),recovery,recoverAmount:integer(r.recoverAmount??max,1,max,'Количество восстановления'),minutes:integer(r.minutes??60,0,525600,'Время восстановления'),readyAt:Number.isInteger(r.readyAt)&&r.readyAt>=0?r.readyAt:null,description:String(r.description||'').slice(0,1000)};
}
export function sheet(c={}){
 const explicitLevel=/(?:^|[\s·.,;])(?:artificer|barbarian|bard|cleric|druid|fighter|monk|paladin|ranger|rogue|sorcerer|warlock|wizard|изобретатель|варвар|бард|жрец|друид|воин|монах|паладин|следопыт|плут|чародей|колдун|волшебник)\s+(20|1[0-9]|[1-9])(?=$|[\s·.,;])/iu.exec(c.description||'');
 const level=integer(c.level??(explicitLevel?Number(explicitLevel[1]):1),1,20,'Уровень'),pb=proficiency(level),bonusMode=c.bonusMode==='calculated'?'calculated':'manual';
 const abilityScores=Object.fromEntries(Object.keys(abilities).map(k=>[k,integer(c.abilityScores?.[k]??10,1,30,'Характеристика')]));
 const training=Object.fromEntries(Object.keys(skillAbilities).map(k=>[k,integer(c.training?.[k]??0,0,2,'Владение')]));
 const saveTraining=Object.fromEntries(Object.keys(abilities).map(k=>[k,integer(c.saveTraining?.[k]??0,0,1,'Владение спасброском')]));
 const bonuses=Object.fromEntries(Object.keys(skills).map(k=>[k,bonusMode==='calculated'?modifier(abilityScores[skillAbilities[k]||k])+(training[k]||0)*pb:integer(c.bonuses?.[k]??0,-20,50,'Бонус')]));
 const saves=Object.fromEntries(Object.keys(abilities).map(k=>[k,bonusMode==='calculated'?modifier(abilityScores[k])+saveTraining[k]*pb:integer(c.saves?.[k]??bonuses[k],-20,50,'Спасбросок')]));
 if(Array.isArray(c.resources)&&c.resources.length>100)throw Error('В листе максимум 100 ресурсов');
 if(c.hitDice?.size!==undefined&&![4,6,8,10,12].includes(c.hitDice.size))throw Error('Кость здоровья: d4, d6, d8, d10 или d12');
 const resources=(Array.isArray(c.resources)?c.resources:[]).slice(0,100).map(resource);if(new Set(resources.map(r=>r.id)).size!==resources.length)throw Error('Повторяющиеся ID ресурсов');
 return {sheetVerified:typeof c.sheetVerified==='boolean'?c.sheetVerified:Number.isInteger(c.level),level,className:String(c.className||'').slice(0,100),bonusMode,abilityScores,training,saveTraining,bonuses,saves,proficiency:pb,resources,tempHp:integer(c.tempHp??0,0,9999,'Временные HP'),conditions:(Array.isArray(c.conditions)?c.conditions:[]).slice(0,20).map(x=>String(x).slice(0,100)),concentration:String(c.concentration||'').slice(0,200),deathSaves:{successes:integer(c.deathSaves?.successes??0,0,3),failures:integer(c.deathSaves?.failures??0,0,3)},hitDice:{size:integer(c.hitDice?.size??8,4,12,'Кость здоровья'),max:integer(c.hitDice?.max??level,1,20),current:integer(c.hitDice?.current??c.hitDice?.max??level,0,c.hitDice?.max??level)},notes:String(c.notes||'').slice(0,3000)};
}
export function requestRoll(c,r){
 const h=c.characters.find(h=>h.id===r.characterId);if(!h)throw Error('Модель запросила неизвестного персонажа');
 const kind=r.kind||'check';if(!['check','save','death'].includes(kind))throw Error('Этот тип броска ещё не поддерживается');
 const skill=kind==='death'?'constitution':r.skill;
 if(!Object.hasOwn(kind==='save'?abilities:skills,skill))throw Error('Неизвестный навык или спасбросок');
 if(kind==='death'&&(h.hp!==0||(h.deathSaves?.failures??0)>=3||(h.deathSaves?.successes??0)>=3))throw Error('Герой сейчас не делает спасбросок от смерти');
 const mode=r.mode||'normal';if(!['normal','advantage','disadvantage'].includes(mode))throw Error('Неизвестный режим броска');
 return {id:randomUUID(),characterId:h.id,kind,mode,skill,dc:kind==='death'?10:integer(r.dc,1,40,'Сложность'),reason:String(r.reason||'Проверка').slice(0,500),stakes:String(r.stakes||'Последствия определяются ситуацией').slice(0,700)};
}
export function rollResult(c,raw){
 const p=c.pending;if(!p)throw Error('Сейчас мастер не ожидает бросок');const h=c.characters.find(h=>h.id===p.characterId);if(!h)throw Error('Персонаж не найден');
 const mode=p.mode||'normal',values=Array.isArray(raw)?raw:[raw];if(values.length!==(mode==='normal'?1:2))throw Error(mode==='normal'?'Нужно одно число d20':'Нужны два физических d20 — оба числа');values.forEach(n=>integer(n,1,20,'Результат d20'));
 const chosen=mode==='advantage'?Math.max(...values):mode==='disadvantage'?Math.min(...values):values[0];
 const kind=p.kind||'check',bonus=kind==='death'?0:kind==='save'?(h.saves?.[p.skill]??h.bonuses[p.skill]??0):h.bonuses[p.skill]??0,total=chosen+bonus;
 const event={id:randomUUID(),requestId:p.id,characterId:h.id,character:h.name,kind,skill:p.skill,mode,dice:values,raw:chosen,bonus,total,dc:p.dc,success:total>=p.dc,reason:p.reason,at:new Date().toISOString()};
 if(kind==='death'){
  if(h.hp!==0)throw Error('Спасбросок от смерти уже не требуется');const d=h.deathSaves??{successes:0,failures:0};
  if(chosen===20){h.hp=1;h.deathSaves={successes:0,failures:0};event.outcome='regained-consciousness';}
  else {h.deathSaves={successes:Math.min(3,d.successes+(event.success?1:0)),failures:Math.min(3,d.failures+(chosen===1?2:event.success?0:1))};event.outcome=h.deathSaves.failures>=3?'dead':h.deathSaves.successes>=3?'stable':'dying';}
 }
 c.rolls.push(event);c.pending=null;return event;
}
export function useResource(c,{characterId,resourceId,amount=1}){
 const h=c.characters.find(h=>h.id===characterId),r=h?.resources?.find(r=>r.id===resourceId);if(!r)throw Error('Способность/ресурс не найдены в листе');integer(amount,1,999,'Расход');if(r.current<amount)throw Error(`Недостаточно ресурса «${r.name}»: ${r.current}/${r.max}`);
 r.current-=amount;if(r.recovery==='gameTime'&&r.readyAt===null)r.readyAt=(c.clockMinutes||0)+r.minutes;
 return `${h.name}: ${r.name} −${amount}, осталось ${r.current}/${r.max}`;
}
export function advanceTime(c,minutes){integer(minutes,1,525600,'Минуты');c.clockMinutes=(c.clockMinutes||0)+minutes;for(const h of c.characters)for(const r of h.resources||[])if(r.recovery==='gameTime'&&r.minutes>0&&r.readyAt!==null&&r.readyAt<=c.clockMinutes){const cycles=1+Math.floor((c.clockMinutes-r.readyAt)/r.minutes);r.current=Math.min(r.max,r.current+cycles*r.recoverAmount);r.readyAt=r.current<r.max?r.readyAt+cycles*r.minutes:null;}}
export function rest(c,kind,characterId){
 if(!['short','long'].includes(kind))throw Error('Неизвестный отдых');if(c.pending||c.reaction||c.encounter?.active)throw Error('Нельзя отдыхать, пока не разрешён бросок, угроза или бой');
 const heroes=characterId?c.characters.filter(h=>h.id===characterId):c.characters;if(!heroes.length)throw Error('Не найден герой');
 for(const h of heroes){if(h.hp<=0)throw Error('Сначала стабилизируйте и вылечите героя');if(kind==='long'&&h.lastLongRestStart!==undefined&&(c.clockMinutes||0)-h.lastLongRestStart<1440)throw Error('Между началами долгого отдыха должно пройти не меньше 24 игровых часов');}
 const start=c.clockMinutes||0;advanceTime(c,kind==='long'?480:60);
 for(const h of heroes){for(const r of h.resources||[]){if(r.recovery==='shortRest'||kind==='long'&&r.recovery==='longRest')r.current=Math.min(r.max,r.current+(kind==='long'?r.max:r.recoverAmount));}
  if(kind==='long'){h.hp=h.maxHp;h.tempHp=0;h.lastLongRestStart=start;if(h.hitDice)h.hitDice.current=Math.min(h.hitDice.max,h.hitDice.current+(c.edition==='2024'?h.hitDice.max:Math.max(1,Math.floor(h.hitDice.max/2))));}
 }
 return `${kind==='long'?'Долгий':'Короткий'} отдых завершён: ${heroes.map(h=>h.name).join(', ')}. Прошло ${kind==='long'?8:1} игровых часов. Восстановлены только подходящие ресурсы; короткий отдых сам по себе HP не лечит.`;
}
