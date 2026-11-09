import test from 'node:test';
import assert from 'node:assert/strict';
import {defaults} from '../providers.mjs';
import {buildSystem, VISION_SYSTEM, VISION_SYSTEM_EN} from '../prompts.mjs';
import {makeCampaign} from '../engine.mjs';
import {campaignContext} from '../context.mjs';

test('defaults includes local vision enabled by default', () => {
  assert.equal(defaults.vision, 'on');
});

test('buildSystem dynamically includes VISION_SYSTEM when vision is on', () => {
  const c = makeCampaign({name: 'Тест зрения'});
  c.vision = 'on';
  const sysPrompt = buildSystem(c, {vision: 'on'});
  assert.ok(sysPrompt.includes('ЗРИТЕЛЬНЫЙ КОНТАКТ С ИГРОКАМИ (ЛОКАЛЬНОЕ ЗРЕНИЕ МАСТЕРА)'));
  assert.ok(sysPrompt.includes('Apple Neural Engine'));
});

test('buildSystem completely excludes VISION_SYSTEM when vision is off', () => {
  const c = makeCampaign({name: 'Тест без зрения'});
  c.vision = 'off';
  const sysPrompt = buildSystem(c, {vision: 'off'});
  assert.ok(!sysPrompt.includes('ЗРИТЕЛЬНЫЙ КОНТАКТ С ИГРОКАМИ'));
  assert.ok(!sysPrompt.includes('Apple Neural Engine'));
});

test('buildSystem includes English vision prompt when language is en', () => {
  const c = makeCampaign({name: 'English test'});
  c.vision = 'on';
  c.language = 'en';
  const sysPrompt = buildSystem(c, {language: 'en', vision: 'on'});
  assert.ok(sysPrompt.includes('VISUAL EYE CONTACT WITH PLAYERS (LOCAL DM VISION)'));
});

test('campaignContext includes visionObservation when set', () => {
  const c = makeCampaign({name: 'Тест контекста'});
  c.visionObservation = 'В кадре 2 игрока. Один улыбается, второй смотрит на мастера.';
  const ctx = campaignContext(c);
  assert.equal(ctx.visionObservation, 'В кадре 2 игрока. Один улыбается, второй смотрит на мастера.');
});
