import {test} from 'node:test';
import assert from 'node:assert/strict';
import {makeCampaign,acceptReply} from '../engine.mjs';
import {stageReply,advanceDelivery,interruptDelivery} from '../delivery.mjs';
const campaign=()=>makeCampaign({name:'Test',characters:[{name:'Лира',maxHp:20}]});
const reply={narration:'Из тумана появляется башня. Над воротами горит холодный огонь.',illustration_suggestion:{kind:'scene',prompt:'A misty tower, cold fire above the gates, no text',reason:'Первый вид древней башни'}};
test('illustration suggestion is saved with its scene, without submitting an image job',()=>{const c=campaign();acceptReply(c,reply);assert.equal(c.journal[0].illustrationSuggestion.prompt,reply.illustration_suggestion.prompt);assert.equal(c.images?.length||0,0);assert.throws(()=>acceptReply(c,{...reply,illustration_suggestion:{kind:'portrait',characterId:'unknown',prompt:'A portrait'}}));assert.equal(c.journal.length,1);});
test('unheard image suggestions do not survive interruption; completed narration preserves them',()=>{const c=campaign();stageReply(c,reply);const d=c.delivery;advanceDelivery(c,d.id,0);assert.equal(c.journal[0].illustrationSuggestion,undefined);interruptDelivery(c);assert.equal(c.journal[0].illustrationSuggestion,undefined);stageReply(c,reply);while(c.delivery)advanceDelivery(c,c.delivery.id,c.delivery.index);assert.equal(c.journal.at(-1).illustrationSuggestion.reason,reply.illustration_suggestion.reason);});
