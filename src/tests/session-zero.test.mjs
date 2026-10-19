import {test} from 'node:test';import assert from 'node:assert/strict';
import {makeCampaign,checkpoint,undo} from '../engine.mjs';import {beginSessionZero,sessionZeroTurn,restoreSessionZero} from '../session-zero.mjs';import {campaignContext} from '../context.mjs';
import {spokenRoll,spokenApproval} from '../public/voice-input.mjs';
test('spoken session zero: resume, explicit confirmation, corrections, exact stats and undo',()=>{
 const c=makeCampaign({name:'Тест'});beginSessionZero(c);
 for(const t of ['Северный тракт','Мрачное фэнтези, строгие правила','Без пыток','Лира и Бор','Лира, HP 17, КД 14; Бор, HP 25, КД 16'])sessionZeroTurn(c,t);
 assert.equal(c.sessionZero.step,5);assert.equal(c.characters.length,0);assert.equal(c.profile,undefined);
 assert.equal(c.sessionZero.draft[0].hp,17);assert.equal(c.sessionZero.draft[1].ac,16);
 c.sessionZero=restoreSessionZero(JSON.parse(JSON.stringify(c.sessionZero)));
 sessionZeroTurn(c,'да');assert.equal(c.sessionZero.complete,false);
 sessionZeroTurn(c,'изменить стиль');sessionZeroTurn(c,'Лёгкое фэнтези, строгое применение правил');assert.equal(c.sessionZero.step,5);
 checkpoint(c);sessionZeroTurn(c,'Мастер, подтверждаю договорённости.');assert.equal(c.characters.length,2);assert.match(campaignContext(c).profile.boundaries,/Без пыток/);
 undo(c);assert.equal(c.sessionZero.complete,false);assert.equal(c.characters.length,0);assert.equal(c.profile,null);
});
test('session zero does not infer HP from a story and accepts punctuation in names',()=>{
 const c=makeCampaign({name:'Тест'});beginSessionZero(c);
 for(const t of ['Мир','Стиль','Границы','Лира (старшая)','Лира (старшая), HP 18, КД 15'])sessionZeroTurn(c,t);
 assert.equal(c.sessionZero.draft[0].hp,18);
 sessionZeroTurn(c,'изменить листы');sessionZeroTurn(c,'Ей двадцать лет, жила в двенадцати городах');assert.equal(c.sessionZero.draft[0].hp,18);
});
test('missing stats cannot be borrowed from the next hero',()=>{const c=makeCampaign({name:'Тест'});beginSessionZero(c);for(const t of ['Мир','Стиль','Границы','Лира и Бор','Лира бард, Бор HP 25 КД 16'])sessionZeroTurn(c,t);assert.equal(c.sessionZero.draft[0].hp,20);assert.equal(c.sessionZero.draft[1].hp,25);});
test('spoken dice and HP commands reject ambiguous sentences and unrelated yes',()=>{
 for(const t of ['14','на кубике четырнадцать','Мастер, выпало 14.'])assert.equal(spokenRoll(t),14);
 for(const t of ['выпало 14 плюс 2','я атакую 14 врагов','21','ноль','четырнадцать или пятнадцать'])assert.equal(spokenRoll(t),null);
 assert.equal(spokenApproval('Подтверждаю изменения.'),true);assert.equal(spokenApproval('Отклоняю урон'),false);assert.equal(spokenApproval('да'),null);
});
