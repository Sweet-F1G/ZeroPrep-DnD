import {test} from 'node:test';import assert from 'node:assert/strict';import {makeCampaign,checkpoint,undo} from '../engine.mjs';import {applyActions} from '../actions.mjs';import {remember,searchArchive,checkDeadlines} from '../memory.mjs';import {campaignContext,summaryPlan,setSummary} from '../context.mjs';import {rollLoot,claimLoot} from '../inventory.mjs';import {stageReply,interruptDelivery,advanceDelivery} from '../delivery.mjs';
const campaign=()=>makeCampaign({name:'Тест',characters:[{name:'Лира'},{name:'Бор'}]});
test('promise retains exact words and source through compaction, recall, deadlines and undo',()=>{
 const c=campaign();c.journal=Array.from({length:30},(_,i)=>({id:'e'+i,role:'user',text:'Событие '+i}));
 remember(c,{kind:'promise',text:'Принести кольцо до заката третьего дня',deadlineMinutes:50},'e0');const plan=summaryPlan(c,true);setSummary(c,'Сводка',plan);
 assert.match(campaignContext(c).memory.obligations[0].text,/третьего дня/);assert.equal(searchArchive(c,'кольцо')[0].sourceId,'e0');checkpoint(c);c.clockMinutes=51;checkDeadlines(c);assert.equal(c.memory[0].status,'overdue');undo(c);assert.equal(c.memory[0].status,'active');
});
test('items, wallets, partial transfers and containers cannot duplicate or create money',()=>{
 const c=campaign(),[a,b]=c.characters;
 applyActions(c,[{type:'item.add',item:{id:'p',name:'Зелье',category:'potion',quantity:3,ownerId:a.id}},{type:'wallet.change',ownerId:'group',deltaCp:200}],'e');
 applyActions(c,[{type:'item.transfer',itemId:'p',ownerId:b.id,quantity:1}],'e');assert.equal(c.inventory.reduce((s,i)=>s+i.quantity,0),3);assert.equal(c.inventory.find(i=>i.ownerId===b.id).quantity,1);
 const before=structuredClone(c);assert.throws(()=>applyActions(c,[{type:'wallet.change',ownerId:'group',deltaCp:-100},{type:'item.consume',itemId:'p',quantity:9}],'e'));assert.deepEqual(c,before);
 applyActions(c,[{type:'item.add',item:{id:'box',name:'Сундук',category:'container'}}],'e');assert.throws(()=>applyActions(c,[{type:'item.store',itemId:'box',containerId:'box'}],'e'));
});
test('unheard proposals never reach memory or inventory; loot grants only once per source',()=>{
 const c=campaign(),reply={narration:'Купец предлагает сделку. Подтвердите её, если согласны.',actions:[{type:'memory.add',note:{kind:'promise',text:'Вернуть кольцо'}}]};
 stageReply(c,reply);interruptDelivery(c);assert.equal(c.memory.length,0);assert.equal(c.actionProposals.length,0);
 stageReply(c,reply);const id=c.delivery.id;while(c.delivery)advanceDelivery(c,id,c.delivery.index);assert.equal(c.memory.length,0);assert.equal(c.actionProposals.length,1);assert.ok(c.journal.some(e=>e.id===c.actionProposals[0].sourceId));
 const sourceId=c.journal.at(-1).id,l=rollLoot(c,{sourceId},max=>0);assert.equal(rollLoot(c,{sourceId}).id,l.id);claimLoot(c,l.id);const money=c.wallet.group;claimLoot(c,l.id);assert.equal(c.wallet.group,money);
});
test('bounded context can retrieve omitted canon and inventory without changing the archive',()=>{
 const c=campaign();c.source='Материалы мира. '.repeat(900)+'Хрустальная_башня хранит рубиновый ключ. '+ 'Эпилог. '.repeat(400);c.inventory=Array.from({length:80},(_,i)=>({id:'item'+i,name:i===0?'Уникальный рубиновый ключ':'Монета '+i,quantity:1,ownerId:'group'}));c.journal.push({id:'ask',role:'user',text:'Расскажи про Хрустальная_башня и рубиновый ключ'});
 const before=c.source,context=campaignContext(c);assert.equal(context.sourceIsExcerpt,true);assert.ok(context.source.includes('рубиновый ключ'));assert.equal(context.inventory.length,50);assert.ok(context.inventory.some(i=>i.id==='item0'));assert.equal(c.source,before);assert.ok(searchArchive(c,'рубиновый').some(r=>r.kind==='item'));
});
