import {randomUUID,createHash} from 'node:crypto';
const kinds=['fact','promise','quest','npc','place','rumor'];
export function memoryRecord(input,sourceId){
 const kind=input.kind||'fact';if(!kinds.includes(kind))throw Error('Неизвестный тип записи памяти');
 const text=String(input.text||'').trim();if(!text||text.length>1500)throw Error('Запись памяти: от 1 до 1500 символов');
 const status=input.status||'active';if(!['active','fulfilled','broken','closed','overdue'].includes(status))throw Error('Неизвестный статус памяти');
 return {id:String(input.id||randomUUID()).slice(0,100),kind,title:String(input.title||text.slice(0,80)).slice(0,120),text,status,sourceId:String(sourceId||input.sourceId||''),actorId:String(input.actorId||'').slice(0,100),target:String(input.target||'').slice(0,120),deadlineMinutes:input.deadlineMinutes===null||input.deadlineMinutes===undefined?null:integerDeadline(input.deadlineMinutes),changes:(Array.isArray(input.changes)?input.changes:[]).slice(-100),createdAt:input.createdAt||new Date().toISOString(),updatedAt:new Date().toISOString()};
}
function integerDeadline(n){if(!Number.isInteger(n)||n<0||n>5256000)throw Error('Срок — целое число игровых минут');return n;}
export function remember(c,input,sourceId){
 c.memory??=[];const note=memoryRecord(input,sourceId);if(note.actorId&&!c.characters.some(h=>h.id===note.actorId))throw Error('Неизвестный автор обещания');
 if(c.memory.some(n=>n.id===note.id||n.text===note.text&&n.status===note.status))return 'Такая запись уже сохранена';
 if(c.memory.length>=1000)throw Error('В архиве памяти уже 1000 записей');if(c.memory.filter(n=>['promise','quest'].includes(n.kind)&&['active','overdue'].includes(n.status)).length>=30&&['promise','quest'].includes(note.kind))throw Error('Сначала закройте завершённые обязательства: активно уже 30');
 c.memory.push(note);return `Память: ${note.title}`;
}
export function changeMemoryStatus(c,{memoryId,status},sourceId){
 const n=c.memory?.find(n=>n.id===memoryId);if(!n)throw Error('Запись памяти не найдена');if(!['active','fulfilled','broken','closed'].includes(status))throw Error('Неизвестный статус памяти');
 const changes=[...(n.changes||[]),{from:n.status,to:status,sourceId,at:new Date().toISOString()}];Object.assign(n,{status,changes,updatedAt:new Date().toISOString()});return `${n.title}: ${status}`;
}
export function checkDeadlines(c){for(const n of c.memory||[])if(n.status==='active'&&n.deadlineMinutes!==null&&n.deadlineMinutes!==undefined&&n.deadlineMinutes<=(c.clockMinutes||0))n.status='overdue';}
const words=t=>[...new Set(String(t).toLowerCase().replace(/ё/g,'е').match(/[\p{L}\d]{3,}/gu)||[])].filter(w=>!['что','как','это','кто','меня','тебя','мастер','сказитель','герой','делает'].includes(w));
export function searchArchive(c,query,limit=8,{kinds}={}){
 const q=words(query);if(!q.length)return [];
 const docs=[...(c.memory||[]).map(n=>({id:n.id,kind:n.kind,text:`${n.title}: ${n.text}`,sourceId:n.sourceId,status:n.status,actorId:n.actorId,target:n.target,deadlineMinutes:n.deadlineMinutes})),...c.journal.map(e=>({id:e.id,kind:'event',text:e.text,at:e.at})),...(c.inventory||[]).map(i=>({id:i.id,kind:'item',text:JSON.stringify(i)})),...(c.dm?.world||[]).map(w=>({id:w.id,kind:'world',text:JSON.stringify(w),sourceId:w.sourceId})),...c.characters.flatMap(h=>[
 {id:h.id,kind:'hero',text:JSON.stringify({characterId:h.id,name:h.name,bio:h.bio,notes:h.notes,progression:h.progression})},
 ...['resources','features','spells'].flatMap(key=>(h[key]||[]).map(r=>({id:r.id,kind:key.slice(0,-1),text:JSON.stringify({characterId:h.id,characterName:h.name,...r})})))])];
 return docs.filter(d=>!kinds||kinds.includes(d.kind)).map((d,i)=>{const text=d.text.toLowerCase().replace(/ё/g,'е');return {...d,score:q.reduce((s,w)=>s+(text.includes(w)?1:0),0),order:i};}).filter(d=>d.score>0).sort((a,b)=>b.score-a.score||b.order-a.order).slice(0,Math.max(1,Math.min(30,limit))).map(({order,...d})=>d);
}
export function memoryContext(c,query){const mandatory=(c.memory||[]).filter(n=>['promise','quest'].includes(n.kind)&&['active','overdue'].includes(n.status));const recent=new Set(c.journal.slice(-12).map(e=>e.id));const related=searchArchive(c,query,20,{kinds:['event','fact','promise','quest','npc','place','rumor']}).filter(e=>!recent.has(e.id)&&!mandatory.some(n=>n.id===e.id)).slice(0,8);return {obligations:mandatory,related};}
export function sourcePassages(source,query,maxChars=14000){
 if(source.length<=maxChars)return source;
 const chunks=source.match(/[\s\S]{1,800}/g)||[],q=words(query);
 const ranked=chunks.map((text,i)=>({i,score:q.reduce((s,w)=>s+(text.toLowerCase().replace(/ё/g,'е').includes(w)?1:0),0)})).filter(x=>x.score>0).sort((a,b)=>b.score-a.score||a.i-b.i);
 // Select by relevance before restoring source order, or a late best match can be lost.
 const selected=new Set();let size=0;
 for(const i of [...ranked.slice(0,1).map(x=>x.i),0,...ranked.slice(1).map(x=>x.i)]){
  if(selected.has(i))continue;const length=chunks[i].length+40;
  if(selected.size&&size+length>maxChars)continue;
  selected.add(i);size+=length;
 }
 return [...selected].sort((a,b)=>a-b).map(i=>`[Материал ${i+1}/${chunks.length}] ${chunks[i]}`).join('\n').slice(0,maxChars);
}
export const operationHash=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex').slice(0,24);
