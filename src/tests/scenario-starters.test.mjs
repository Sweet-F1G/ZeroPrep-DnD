import test from 'node:test';
import assert from 'node:assert/strict';
import {makeCampaign} from '../engine.mjs';
import {applyScenario} from '../scenarios.mjs';
import {scenarioOptions} from '../public/scenario-options.mjs';
import {campaignContext} from '../context.mjs';
import {cachedCampaignContext} from '../openai-context.mjs';
import {beginSessionZero,sessionZeroTurn} from '../session-zero.mjs';
import {buildSystem} from '../prompts.mjs';

test('original starters deliver the public premise and GM notes to both model contexts',()=>{
 assert.equal(scenarioOptions.length,4);
 for(const item of scenarioOptions)for(const language of ['ru','en']){
  const c=makeCampaign({name:'Test',source:'User notes'});applyScenario(c,item.id,language);
  assert.ok(c.setting.length>50);assert.match(c.source,/User notes/);
  assert.ok(c.source.length<2400,'starter is available in full to non-OpenAI providers');
  assert.equal(campaignContext(c).source,c.source);
  assert.equal(cachedCampaignContext(c).reference.source,c.source);
  assert.ok(!JSON.stringify(item).includes(c.source),'player-safe option does not contain GM notes');
 }
 assert.throws(()=>applyScenario(makeCampaign({name:'Test'}),'unknown'));
});

test('a chosen demo premise is visible and can be accepted during session zero',()=>{
 const c=makeCampaign({name:'Test'});applyScenario(c,'frontier','ru');const premise=c.setting;
 beginSessionZero(c,'demo');assert.match(c.journal[0].text,/Пепельный брод/);
 sessionZeroTurn(c,'оставить');assert.equal(c.sessionZero.answers.world,premise);
});

test('both GM prompts give agency and group boundaries priority',()=>{
 assert.match(buildSystem({edition:'2024'},{language:'ru'}),/Договорённости и границы игроков важнее/);
 assert.match(buildSystem({edition:'2024'},{language:'en'}),/Player boundaries and agreements outrank/);
});
