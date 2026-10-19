import {test} from 'node:test';
import assert from 'node:assert/strict';
import {makeCampaign,checkpoint,undo,acceptReply,resolveRoll,approveProposal,demoReply,updateReactionClock} from '../engine.mjs';
function campaign(){return makeCampaign({name:'Test',characters:[{name:'Hero',maxHp:20,bonuses:{perception:3}}]});}
function request(c,dc=15){acceptReply(c,{narration:'Проверка',roll_request:{characterId:c.characters[0].id,skill:'perception',dc,reason:'Следы'},changes:[]});}
test('ordinary check uses stored modifier and exact DC; undo restores pending roll',()=>{const c=campaign();request(c);checkpoint(c);const r=resolveRoll(c,12);assert.equal(r.total,15);assert.equal(r.success,true);assert.equal(c.pending,null);undo(c);assert.equal(c.pending.dc,15);assert.equal(c.rolls.length,0);});
test('raw 20 does not automatically succeed an impossible ordinary check',()=>{const c=campaign();request(c,30);assert.equal(resolveRoll(c,20).success,false);});
test('reject invalid raw dice without consuming pending check',()=>{const c=campaign();request(c);for(const n of [0,21,1.5,'14',NaN])assert.throws(()=>resolveRoll(c,n));assert.ok(c.pending);assert.equal(c.rolls.length,0);});
test('reject fabricated skill, character and difficulty',()=>{const c=campaign();for(const p of [{characterId:c.characters[0].id,skill:'fake',dc:12},{characterId:'fake',skill:'perception',dc:12},{characterId:c.characters[0].id,skill:'perception',dc:100}])assert.throws(()=>acceptReply(c,{narration:'test',roll_request:p}));});
test('HP cannot change until player accepts proposal; limits and undo work',()=>{const c=campaign(),id=c.characters[0].id;acceptReply(c,{narration:'Попадание',changes:[{characterId:id,hpDelta:-30,reason:'Урон'}]});assert.equal(c.characters[0].hp,20);const p=c.proposals[0];checkpoint(c);approveProposal(c,p.id,true);assert.equal(c.characters[0].hp,0);assert.throws(()=>approveProposal(c,p.id,true));undo(c);assert.equal(c.characters[0].hp,20);assert.equal(c.proposals.length,1);approveProposal(c,p.id,false);assert.equal(c.characters[0].hp,20);});

test('reaction waits before consequences and supports intervention, pass, and undo',()=>{
 const c=campaign();
 acceptReply(c,demoReply(c,{text:'гипноз'},null));
 assert.ok(c.reaction);assert.equal(c.pending,null);assert.equal(c.characters[0].hp,20);assert.deepEqual(c.proposals,[]);
 checkpoint(c);acceptReply(c,demoReply(c,{text:'Я закрываю медальон'},null));assert.equal(c.reaction,null);assert.equal(c.pending,null);
 undo(c);assert.ok(c.reaction);
 acceptReply(c,demoReply(c,{passReaction:true},null));assert.equal(c.reaction,null);assert.equal(c.pending.skill,'wisdom');
});
test('reaction cannot arrive together with premature damage or a roll; rejection is atomic',()=>{
 const c=campaign();acceptReply(c,demoReply(c,{text:'гипноз'},null));const before=structuredClone(c);
 for(const extra of [{changes:[{characterId:c.characters[0].id,hpDelta:-2}]},{roll_request:{characterId:c.characters[0].id,skill:'wisdom',dc:12}}]){
  assert.throws(()=>acceptReply(c,{narration:'Начало угрозы',reaction_request:{prompt:'Вмешаться?'},...extra}));assert.deepEqual(c,before);
 }
 assert.throws(()=>acceptReply(c,{narration:'test',reaction_request:{prompt:''}}));assert.deepEqual(c,before);
});
test('legacy undo checkpoints clear newer reaction state',()=>{
 const c=campaign();delete c.reaction;checkpoint(c);acceptReply(c,demoReply(c,{text:'гипноз'},null));undo(c);assert.equal(c.reaction,null);
});

test('dynamic reaction clock clamps urgency and preserves remaining time on pause/resume',()=>{
 const c=campaign();acceptReply(c,{narration:'Опасность',reaction_request:{prompt:'Кто вмешается?',timeoutSeconds:2}});
 assert.equal(c.reaction.timeoutSeconds,3);const reactionId=c.reaction.id;
 updateReactionClock(c,{reactionId,action:'start'},1000);assert.equal(c.reaction.deadlineAt,4000);
 updateReactionClock(c,{reactionId,action:'start'},2000);assert.equal(c.reaction.deadlineAt,4000);
 updateReactionClock(c,{reactionId,action:'pause'},2500);assert.equal(c.reaction.remainingMs,1500);assert.equal(c.reaction.deadlineAt,null);
 updateReactionClock(c,{reactionId,action:'start'},3000);assert.equal(c.reaction.deadlineAt,null);
 updateReactionClock(c,{reactionId,action:'resume'},5000);assert.equal(c.reaction.deadlineAt,6500);
 assert.throws(()=>updateReactionClock(c,{reactionId:'stale',action:'pause'}));
 acceptReply(c,{narration:'Совещание',reaction_request:{prompt:'Решение?',timeoutSeconds:120}});assert.equal(c.reaction.timeoutSeconds,30);
});
