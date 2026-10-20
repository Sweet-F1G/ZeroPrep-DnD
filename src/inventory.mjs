import {randomUUID,randomInt} from 'node:crypto';
import {integer} from './rules.mjs';
export const itemCategories={weapon:'Оружие',armor:'Доспехи',potion:'Зелья',food:'Припасы',tool:'Инструменты',treasure:'Ценности',container:'Контейнеры',quest:'Сюжетные вещи',other:'Прочее'};
export const heroExists=(c,id)=>id==='group'||(Array.isArray(c?.characters)&&c.characters.some(h=>h.id===id||h.name.toLowerCase()===String(id||'').toLowerCase()));

export function resolveHeroId(c,rawId){
 if(!rawId)return 'group';
 const str=String(rawId).trim().toLowerCase();
 if(!str||['group','party','all','общий','отряд','повозка','группа','инвентарь'].includes(str))return 'group';
 const list=Array.isArray(c?.characters)?c.characters:[];
 if(!list.length)return 'group';
 const byId=list.find(h=>h.id===rawId||h.id.toLowerCase()===str);
 if(byId)return byId.id;
 const byName=list.find(h=>h.name.toLowerCase()===str);
 if(byName)return byName.id;
 const bySub=list.find(h=>{const hn=h.name.toLowerCase();return hn.includes(str)||str.includes(hn);});
 if(bySub)return bySub.id;
 const byStem=list.find(h=>{
  const hw=h.name.toLowerCase().split(/\s+/).filter(w=>w.length>=3);
  const rw=str.split(/\s+/).filter(w=>w.length>=3);
  return hw.some(hword=>rw.some(rword=>hword.startsWith(rword.slice(0,4))||rword.startsWith(hword.slice(0,4))));
 });
 if(byStem)return byStem.id;
 const numMatch=str.match(/(?:hero|герой|персонаж|игрок)?\s*([1-9]\d*)/i);
 if(numMatch){
  const idx=parseInt(numMatch[1],10)-1;
  if(idx>=0&&idx<list.length)return list[idx].id;
 }
 if(list.length===1)return list[0].id;
 return 'group';
}

export function inventoryItem(c,input){
 const name=String(input.name||'').trim();if(!name||name.length>120)throw Error('Название вещи: от 1 до 120 символов');
 const ownerId=resolveHeroId(c,input.ownerId||input.characterId);
 const carrierId=resolveHeroId(c,input.carrierId||ownerId);
 const category=input.category||'other';if(!Object.hasOwn(itemCategories,category))throw Error('Неизвестная категория вещи');
 const weight=Number(input.weight??0);if(!Number.isFinite(weight)||weight<0||weight>100000)throw Error('Некорректный вес');
 return {id:String(input.id||randomUUID()).slice(0,100),name,category,quantity:integer(input.quantity??1,1,100000,'Количество вещей'),weight,valueCp:integer(input.valueCp??0,0,100000000,'Стоимость в медных монетах'),ownerId,carrierId,containerId:input.containerId||null,description:String(input.description||'').slice(0,1500),iconId:/^[a-z0-9-]{1,100}$/.test(input.iconId||'')?input.iconId:null,tags:(Array.isArray(input.tags)?input.tags:[]).slice(0,12).map(x=>String(x).slice(0,40)),equipped:input.equipped===true,attuned:input.attuned===true,charges:input.charges?{max:integer(input.charges.max,1,999),current:integer(input.charges.current,0,input.charges.max)}:null};
}
export function validateInventory(c){
 const items=c.inventory||[];if(items.length>1000||new Set(items.map(i=>i.id)).size!==items.length)throw Error('Некорректный список вещей');
 for(const item of items){const checked=inventoryItem(c,item);Object.assign(item,checked);if(item.containerId){const container=items.find(i=>i.id===item.containerId);if(!container||container.category!=='container')throw Error('Контейнер не найден');if(container.carrierId!==item.carrierId)throw Error('Вещь и контейнер должны иметь одного носителя');const seen=new Set([item.id]);let cursor=container;while(cursor){if(seen.has(cursor.id))throw Error('Контейнер нельзя вложить в самого себя');seen.add(cursor.id);cursor=items.find(i=>i.id===cursor.containerId);}}}
 for(const h of c.characters)if(items.filter(i=>i.carrierId===h.id&&i.attuned).length>3)throw Error('Не больше трёх настроенных вещей у героя');
}
export function inventoryAction(c,a){
 c.inventory??=[];c.wallet??={group:0};
 if(a.type==='item.add'){const item=inventoryItem(c,a.item||{});if(c.inventory.some(i=>i.id===item.id))throw Error('Вещь уже существует');c.inventory.push(item);validateInventory(c);return `Добавлено: ${item.name} ×${item.quantity}`;}
 const item=c.inventory.find(i=>i.id===a.itemId);
 if(a.type==='wallet.change'){const walletId=resolveHeroId(c,a.ownerId||a.characterId);const delta=integer(a.deltaCp,-100000000,100000000,'Монеты'),next=(c.wallet[walletId]||0)+delta;if(next<0||next>100000000)throw Error('Недостаточно денег или превышен размер кошелька');c.wallet[walletId]=next;return `Кошелёк: ${delta>0?'+':''}${delta} мм`;}
 if(!item)throw Error('Вещь не найдена в инвентаре');
 if(a.type==='item.update'){if(!a.patch||Object.keys(a.patch).some(k=>!['name','category','quantity','weight','valueCp','description','iconId','tags','equipped','attuned','charges'].includes(k)))throw Error('Некорректные поля вещи');Object.assign(item,inventoryItem(c,{...item,...a.patch,id:item.id}));validateInventory(c);return `Обновлено: ${item.name}`;}
 if(a.type==='item.consume'){const count=integer(a.quantity??1,1,item.quantity,'Расход вещей');if(c.inventory.some(i=>i.containerId===item.id))throw Error('Сначала освободите контейнер');item.quantity-=count;if(!item.quantity)c.inventory=c.inventory.filter(i=>i.id!==item.id);return `Использовано: ${item.name} ×${count}. Эффект вещи разрешается отдельно.`;}
 if(a.type==='item.transfer'){
  const ownerId=resolveHeroId(c,a.ownerId||a.characterId);
  const carrierId=resolveHeroId(c,a.carrierId||ownerId);
  const count=integer(a.quantity??item.quantity,1,item.quantity,'Количество передачи');if(c.inventory.some(i=>i.containerId===item.id))throw Error('Передача заполненного контейнера требует сначала перенести содержимое');
  let moved=item;if(count<item.quantity){item.quantity-=count;moved={...structuredClone(item),id:randomUUID(),quantity:count};c.inventory.push(moved);}
  moved.ownerId=ownerId;moved.carrierId=carrierId;moved.containerId=null;moved.equipped=false;moved.attuned=false;return `Передано: ${item.name} ×${count}`;
 }
 if(a.type==='item.equip'){if(item.carrierId==='group')throw Error('Укажите конкретного носителя');item.equipped=a.equipped===true;return `${item.name}: ${item.equipped?'экипировано':'снято'}. КД автоматически не меняется.`;}
 if(a.type==='item.store'){item.containerId=a.containerId||null;validateInventory(c);return `${item.name}: перемещено в контейнер`;}
 if(a.type==='item.buy'){
  const quantity=integer(a.quantity??1,1,100000),cost=integer(a.costCp,0,100000000),walletId=resolveHeroId(c,a.ownerId||item.ownerId);if((c.wallet[walletId]||0)<cost)throw Error('Недостаточно денег');integer(item.quantity+quantity,1,100000);c.wallet[walletId]=(c.wallet[walletId]||0)-cost;item.quantity+=quantity;return `Куплено: ${item.name} ×${quantity}, −${cost} мм`;
 }
 throw Error('Неизвестная операция с вещами');
}
export const lootTables={road:[{weight:40,item:null,cp:[0,10]},{weight:25,item:{name:'Дорожный паёк',category:'food'},cp:[1,20]},{weight:20,item:{name:'Свеча',category:'tool'},cp:[2,30]},{weight:10,item:{name:'Полудрагоценный камень',category:'treasure'},cp:[5,60]},{weight:5,item:{name:'Неизвестное зелье',category:'potion',description:'Свойства ещё не установлены; не считать лечебным автоматически.'},cp:[10,80]}],ruins:[{weight:40,item:null,cp:[0,20]},{weight:30,item:{name:'Старинная монета',category:'treasure'},cp:[10,100]},{weight:20,item:{name:'Обломок резной фигурки',category:'treasure'},cp:[5,50]},{weight:10,item:{name:'Запечатанный флакон',category:'potion',description:'Свойства неизвестны.'},cp:[20,120]}]};
export function rollLoot(c,{table='road',sourceId},rng=max=>randomInt(max)){
 if(!sourceId||!c.journal.some(e=>e.id===sourceId))throw Error('Для добычи нужен источник из журнала');c.loot??=[];
 const existing=c.loot.find(l=>l.sourceId===sourceId);if(existing)return existing;
 if(c.loot.length>=10000)throw Error('В архиве добычи уже 10000 источников');
 const rows=lootTables[table];if(!rows)throw Error('Неизвестная таблица добычи');let roll=integer(rng(rows.reduce((s,r)=>s+r.weight,0)),0,99),picked=rows[0];for(const r of rows){if(roll<r.weight){picked=r;break;}roll-=r.weight;}
 const cp=picked.cp[0]+integer(rng(picked.cp[1]-picked.cp[0]+1),0,picked.cp[1]-picked.cp[0]);
 const result={id:randomUUID(),sourceId,table,copper:cp,item:picked.item?{...picked.item,quantity:1}:null,claimed:false};c.loot.push(result);return result;
}
export function claimLoot(c,id){const result=c.loot?.find(l=>l.id===id);if(!result)throw Error('Добыча не найдена');if(result.claimed)return 'Эта добыча уже выдана';if(result.item)inventoryAction(c,{type:'item.add',item:result.item});inventoryAction(c,{type:'wallet.change',ownerId:'group',deltaCp:result.copper});result.claimed=true;return `Добыча: ${result.item?result.item.name:'без предметов'}, ${result.copper} мм`;
}
