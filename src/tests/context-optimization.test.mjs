import {test} from 'node:test';
import assert from 'node:assert/strict';
import {makeCampaign} from '../engine.mjs';
import {campaignContext} from '../context.mjs';
import {searchArchive,sourcePassages} from '../memory.mjs';
import {generate} from '../providers.mjs';
function fixture(){
 const c=makeCampaign({name:'Тест',characters:[{name:'Лира'}]}),h=c.characters[0];
 h.notes='Старая биография. '.repeat(200)+'Пароль Хрустальной башни: янтарь.';
 h.features=[{id:'f1',name:'Зоркость',description:'Замечает следы',sourceId:'event0'}];
 h.spells=[{id:'s1',name:'Ледяная стрела',description:'Оригинальное правило Ледяной стрелы. '.repeat(30),level:1,prepared:true,resourceId:'r1'}];
 h.resources=[{id:'r1',name:'Ячейки',current:0,max:2,recovery:'longRest',description:'Восстановление после отдыха'}];
 c.memory=[{id:'promise',kind:'promise',status:'active',text:'Вернуть ровно три монеты до заката',deadlineMinutes:50,sourceId:'event0',changes:[{from:'closed',to:'active'}]}];
 c.dm={autonomy:'automatic',hints:'contextual',world:[{id:'npc',kind:'npc',name:'Оррин',description:'Хранит янтарную печать',visibility:'gm',state:'active'}],changes:[{text:'audit'}]};
 c.journal=[{id:'old',role:'assistant',text:'Вы стоите у Хрустальной башни.'},{id:'now',role:'user',text:'Да, осмотрю дверь',at:'yesterday'}];return c;
}
test('transport preserves mechanics and obligations without duplicate hints or save mutations',()=>{
 const c=fixture(),before=structuredClone(c),context=campaignContext(c),h=context.characters[0];
 assert.deepEqual(c,before);assert.equal(h.hp,c.characters[0].hp);assert.deepEqual(h.resources,c.characters[0].resources);
 assert.equal(context.hints.characters,undefined);assert.equal(context.dm.changes,undefined);
 assert.equal(context.memory.obligations[0].text,c.memory[0].text);assert.equal(context.memory.obligations[0].deadlineMinutes,50);assert.equal(context.memory.obligations[0].changes,undefined);
 assert.equal(context.journal.at(-1).at,undefined);assert.equal(h.spells[0].resourceId,'r1');assert.equal(h.spells[0].prepared,true);assert.equal(h.spells[0].description,undefined);assert.equal(h.spells[0].descriptionIsExcerpt,true);assert.equal(h.notesIsExcerpt,true);assert.match(h.notes,/янтарь/);
});
test('recent scene resolves short answers; named spells and prepared combat spells include detail flags',()=>{
 const c=fixture();c.journal.unshift({id:'earlier',role:'assistant',text:'Применишь Ледяную стрелу?'});
 const h=campaignContext(c).characters[0];assert.ok(h.spells[0].description);assert.equal(h.spells[0].descriptionIsExcerpt,true);
 c.journal=c.journal.slice(1);c.encounter={active:true};assert.ok(campaignContext(c).characters[0].spells[0].description);
});
test('archive retrieves original notes, spells, features, resources and hidden world records',()=>{
 const c=fixture();for(const [query,kind]of [['янтарь','hero'],['Ледяная','spell'],['Зоркость','feature'],['Ячейки','resource'],['Оррин','world']]){
  const result=searchArchive(c,query,30).find(e=>e.kind===kind);assert.ok(result,query);
  if(kind==='spell')assert.equal(JSON.parse(result.text).description,c.characters[0].spells[0].description);
  if(kind==='world')assert.equal(JSON.parse(result.text).visibility,'gm');
 }
});
test('source excerpt retains strong late matches ahead of weak early matches',()=>{
 const source='Предисловие. '.repeat(100)+'Башня. '.repeat(1600)+'Хрустальный_ключ янтарная_печать: пароль здесь.';
 const excerpt=sourcePassages(source,'Хрустальный_ключ янтарная_печать башня',2400);assert.ok(excerpt.length<=2400);assert.match(excerpt,/пароль здесь/);
});
test('provider recall supplies original spell text and retains current state',async()=>{
 const c=fixture(),before=structuredClone(c),original=globalThis.fetch;let calls=0;
 globalThis.fetch=async(url,options)=>{
  const input=JSON.parse(JSON.parse(options.body).messages[1].content);calls++;
  if(calls===1)assert.equal(input.characters[0].spells[0].description,undefined);
  else {assert.equal(input.characters[0].hp,c.characters[0].hp);assert.ok(input.recall.events.some(e=>e.kind==='spell'&&JSON.parse(e.text).description===c.characters[0].spells[0].description));}
  return new Response(JSON.stringify({choices:[{message:{content:JSON.stringify(calls===1?{recall_query:'Ледяная стрела'}:{narration:'Нужно сверить бросок.',actions:[]})}}]}),{headers:{'Content-Type':'application/json'}});
 };
 try{const reply=await generate({provider:'compatible',baseUrl:'http://127.0.0.1:1',model:'test'},{},c);assert.equal(calls,2);assert.ok(reply.narration);assert.deepEqual(c,before);}finally{globalThis.fetch=original;}
});
