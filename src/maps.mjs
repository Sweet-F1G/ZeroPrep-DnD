import {integer} from './rules.mjs';
const text=(v,n)=>String(v||'').trim().slice(0,n);
export function gameMap(value,c){
 const id=text(value.id,100),name=text(value.name,120);if(!id||!name)throw Error('Карта требует постоянный id и название');
 const width=integer(value.width??12,2,40),height=integer(value.height??12,2,40);
 if(!Array.isArray(value.tokens||[])||(value.tokens||[]).length>100)throw Error('Не больше 100 маркеров на карте');
 const tokens=(value.tokens||[]).map(t=>{const characterId=t.characterId||null;if(characterId&&!c.characters.some(h=>h.id===characterId))throw Error('Герой маркера не найден');const id=text(t.id,100);if(!id)throw Error('Маркер требует id');return {id,label:text(t.label,80),characterId,x:integer(t.x,0,width-1),y:integer(t.y,0,height-1),kind:['hero','enemy','object'].includes(t.kind)?t.kind:'object'};});
 if(new Set(tokens.map(t=>t.id)).size!==tokens.length)throw Error('Повторяющиеся маркеры');
 return {id,name,width,height,feetPerCell:integer(value.feetPerCell??5,1,100000),description:text(value.description,3000),tokens};
}
export function mapAction(c,a){
 c.maps??=[];
 if(a.type==='map.remove'){if(!c.maps.some(m=>m.id===a.mapId))throw Error('Карта не найдена');c.maps=c.maps.filter(m=>m.id!==a.mapId);return 'Карта удалена';}
 const i=c.maps.findIndex(m=>m.id===a.map?.id),map=gameMap({...c.maps[i],...a.map},c);if(i<0){if(c.maps.length>=30)throw Error('Не больше 30 карт');c.maps.push(map);}else c.maps[i]=map;return `Карта: ${map.name} · маркеров ${map.tokens.length}`;
}
