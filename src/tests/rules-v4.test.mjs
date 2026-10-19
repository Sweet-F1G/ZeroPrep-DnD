import {test} from 'node:test';import assert from 'node:assert/strict';
import {makeCampaign,acceptReply,resolveRoll,checkpoint,undo} from '../engine.mjs';import {sheet,useResource,rest} from '../rules.mjs';import {applyActions} from '../actions.mjs';
test('18 skills and six saves use proficiency, expertise and manual overrides independently',()=>{
 const h=sheet({level:5,bonusMode:'calculated',abilityScores:{wisdom:16,dexterity:14},training:{perception:2,stealth:1},saveTraining:{wisdom:1}});
 assert.equal(h.bonuses.perception,9);assert.equal(h.bonuses.stealth,5);assert.equal(h.saves.wisdom,6);assert.equal(Object.keys(h.bonuses).length,24);
 const legacy=sheet({bonuses:{wisdom:3,perception:7},saves:{wisdom:5}});assert.equal(legacy.bonuses.perception,7);assert.equal(legacy.saves.wisdom,5);
});
test('advantage, saves and death use physical dice; 20 is not an automatic saving throw success',()=>{
 const c=makeCampaign({name:'Тест',edition:'2024',characters:[{name:'Лира',saves:{wisdom:5},bonuses:{wisdom:1}}]}),id=c.characters[0].id;
 acceptReply(c,{narration:'Спасбросок',roll_request:{characterId:id,kind:'save',skill:'wisdom',mode:'advantage',dc:20}});
 assert.throws(()=>resolveRoll(c,15));assert.ok(c.pending);assert.equal(resolveRoll(c,[2,15]).total,20);
 acceptReply(c,{narration:'Проверка',roll_request:{characterId:id,kind:'save',skill:'wisdom',dc:35}});assert.equal(resolveRoll(c,20).success,false);
 c.characters[0].hp=0;acceptReply(c,{narration:'От смерти',roll_request:{characterId:id,kind:'death'}});resolveRoll(c,1);assert.equal(c.characters[0].deathSaves.failures,2);
 acceptReply(c,{narration:'От смерти',roll_request:{characterId:id,kind:'death'}});checkpoint(c);assert.equal(resolveRoll(c,20).outcome,'regained-consciousness');assert.equal(c.characters[0].hp,1);undo(c);assert.equal(c.characters[0].hp,0);assert.ok(c.pending);
});
test('resources cannot be overspent; rest and edition-specific hit dice recovery are exact and atomic',()=>{
 for(const edition of ['2014','2024']){const c=makeCampaign({name:'Тест',edition,characters:[{name:'Лира',level:5,hp:4,maxHp:20,hitDice:{size:8,max:5,current:0},resources:[{id:'a',name:'Способность',max:3,current:0,recovery:'shortRest',recoverAmount:1},{id:'b',name:'Ячейки',max:2,current:0,recovery:'longRest'},{id:'m',name:'Ручное',max:2,current:0,recovery:'manual'}]}]}),h=c.characters[0];
 assert.throws(()=>useResource(c,{characterId:h.id,resourceId:'a'}));rest(c,'short');assert.equal(h.resources[0].current,1);assert.equal(h.hp,4);assert.equal(h.resources[1].current,0);
 rest(c,'long');assert.equal(h.hp,20);assert.equal(h.hitDice.current,edition==='2024'?5:2);assert.equal(h.resources[2].current,0);assert.throws(()=>rest(c,'long'));
 const before=structuredClone(c);assert.throws(()=>applyActions(c,[{type:'resource.use',characterId:h.id,resourceId:'a',amount:3},{type:'resource.use',characterId:h.id,resourceId:'b',amount:3}],c.journal.at(-1)?.id));assert.deepEqual(c,before);
 }
});
test('spoken advantage dice require exactly two unambiguous faces',async()=>{const {spokenRoll}=await import('../public/voice-input.mjs');assert.deepEqual(spokenRoll('На кубиках двенадцать и восемь','advantage'),[12,8]);assert.equal(spokenRoll('12 и 8'),null);assert.equal(spokenRoll('12 и 8 и 3','advantage'),null);});
test('voice HP approval selects the named hero and rejects ambiguous confirmations',async()=>{const {spokenHpPlan}=await import('../public/voice-input.mjs');const c={characters:[{id:'a',name:'Лира'},{id:'b',name:'Бор'}],proposals:[{id:'p1',characterId:'a'},{id:'p2',characterId:'b'}]};assert.equal(spokenHpPlan('подтверждаю изменения',c),null);assert.deepEqual(spokenHpPlan('Мастер, Бор, подтверждаю изменения',c),{proposalId:'p2',characterId:'b',accept:true});c.proposals.push({id:'p3',characterId:'b'});assert.equal(spokenHpPlan('Бор, подтверждаю изменения',c),null);});
