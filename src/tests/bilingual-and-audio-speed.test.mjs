import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {cleanNarrationForTTS, expandDiceAndTermsForTTS, resolveOpenAiVoice} from '../delivery.mjs';
import {buildSystem, coreSystemEn, ttsVoiceSystemEn, characterCreationSystemEn} from '../prompts.mjs';
import {defaults} from '../providers.mjs';

test('expandDiceAndTermsForTTS expands dice formulas and game abbreviations in Russian', () => {
  assert.equal(expandDiceAndTermsForTTS('Бросьте 1d20+3 для проверки.'), 'Бросьте 1 дэ 20 плюс 3 для проверки.');
  assert.equal(expandDiceAndTermsForTTS('У гоблина осталось 14 HP и КД 15.'), 'У гоблина осталось 14 очков здоровья и класс доспеха 15.');
  assert.equal(expandDiceAndTermsForTTS('Сложность испытания Сл 16.'), 'Сложность испытания сложность 16.');
  assert.equal(expandDiceAndTermsForTTS('Награда составляет 50 зм и 10 см.'), 'Награда составляет 50 золотых и 10 серебряных.');
});

test('expandDiceAndTermsForTTS expands dice formulas and game abbreviations in English', () => {
  assert.equal(expandDiceAndTermsForTTS('Roll 1d20+4 for attack.'), 'Roll 1 d 20 plus 4 for attack.');
  assert.equal(expandDiceAndTermsForTTS('The goblin has 12 hp and AC 14.'), 'The goblin has 12 hit points and armor class 14.');
  assert.equal(expandDiceAndTermsForTTS('The trap requires a DC 15 saving throw.'), 'The trap requires a DC 15 saving throw.');
  assert.equal(expandDiceAndTermsForTTS('You find 25 gp and 5 sp.'), 'You find 25 gold pieces and 5 silver pieces.');
});

test('expandDiceAndTermsForTTS normalizes all-caps screaming words to natural spoken capitalization', () => {
  assert.equal(expandDiceAndTermsForTTS('БЕГИТЕ! ВРАГИ АТАКУЮТ!'), 'Бегите! Враги атакуют!');
  assert.equal(expandDiceAndTermsForTTS('WATCH OUT! THE BRIDGE IS COLLAPSING!'), 'Watch out! The bridge is collapsing!');
});

test('buildSystem produces complete English prompts when language is en', () => {
  const systemRu = buildSystem({edition: '2024'});
  assert.ok(systemRu.includes('Ты Сказитель, русскоязычный ведущий'));

  const systemEn = buildSystem({edition: '2024', language: 'en'});
  assert.ok(systemEn.includes('You are the Storyteller (Game Master)'));
  assert.ok(systemEn.includes('AUDIO ADAPTATION FOR NEURAL TEXT-TO-SPEECH (TTS)'));
  assert.ok(systemEn.includes('ULTRA-FAST SPEECH START (FAST FIRST SENTENCE)'));
  assert.ok(systemEn.includes('CHARACTER CREATION AND GAME START (SESSION ZERO)'));
  assert.ok(systemEn.includes('Campaign ruleset: D&D 2024 / SRD 5.2.1'));
});

test('resolveOpenAiVoice routes English NPC characters and dialogue cues', () => {
  assert.equal(resolveOpenAiVoice('onyx', 'The ancient road winds deeper into the mist.'), 'onyx');
  assert.equal(resolveOpenAiVoice('onyx', 'The priestess Martha whispers: "Step carefully."'), 'nova');
  assert.equal(resolveOpenAiVoice('onyx', 'The young rogue Theon smirks and twirls his dagger.'), 'echo');
  assert.equal(resolveOpenAiVoice('onyx', 'The giant orc brute roars with fury!'), 'onyx');
});

test('defaults includes language and ttsSpeed settings', () => {
  assert.equal(defaults.language, 'ru');
  assert.equal(defaults.ttsSpeed, 1.07);
});

test('Windows launch scripts exist and are valid', () => {
  const batPath = fs.existsSync(path.resolve('Start-Windows.bat'))
    ? path.resolve('Start-Windows.bat')
    : path.resolve('..', 'Start-Windows.bat');
  const ps1Path = fs.existsSync(path.resolve('Start-Windows.ps1'))
    ? path.resolve('Start-Windows.ps1')
    : path.resolve('..', 'Start-Windows.ps1');
  assert.ok(fs.existsSync(batPath), 'Start-Windows.bat must exist');
  assert.ok(fs.existsSync(ps1Path), 'Start-Windows.ps1 must exist');

  const batContent = fs.readFileSync(batPath, 'utf8');
  assert.ok(batContent.includes('47831'));
  assert.ok(batContent.includes('node'));

  const ps1Content = fs.readFileSync(ps1Path, 'utf8');
  assert.ok(ps1Content.includes('47831'));
  assert.ok(ps1Content.includes('node'));
});
