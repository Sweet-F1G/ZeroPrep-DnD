import {test} from 'node:test';
import assert from 'node:assert/strict';
import {continuousTurnPlan} from '../public/voice-input.mjs';
test('continuous mode sends named or selected hero without review; dice, HP and ambiguous names remain explicit',()=>{
 const c={characters:[{id:'a',name:'Первый герой'},{id:'b',name:'Второй герой'}],proposals:[],pending:null};
 assert.deepEqual(continuousTurnPlan('Второй, я открываю дверь',c,'a'),{action:'send',characterId:'b'});
 assert.deepEqual(continuousTurnPlan('Я открываю дверь',c,'a'),{action:'send',characterId:'a'});
 assert.equal(continuousTurnPlan('Я открываю дверь',c,null).action,'choose');
 assert.deepEqual(continuousTurnPlan('Я иду',{...c,characters:[c.characters[0]]},null),{action:'send',characterId:'a'});
 assert.equal(continuousTurnPlan('Четырнадцать',{...c,pending:{}},'a').action,'dice');
 assert.equal(continuousTurnPlan('Я иду',{...c,proposals:[{}]},'a').action,'blocked');
 assert.equal(continuousTurnPlan('Первый, я иду',{...c,characters:[c.characters[0],{id:'c',name:'Первый другой'}]},'a').action,'choose');
});
