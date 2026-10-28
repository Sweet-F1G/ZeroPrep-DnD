import {test} from 'node:test';
import assert from 'node:assert/strict';
import {cleanNarrationForTTS, extractSpeaker, narrationParts} from '../delivery.mjs';

test('narrative subjects before em dashes survive the complete speech preparation path', () => {
 const narration = 'Князь — красавец с характером. Средний, крепкий петух с ярко-рыжим оперением. На одной лапе — тонкое колечко, а перья у шеи чуть взъерошены.';
 const spoken = narrationParts(narration).map(cleanNarrationForTTS).join(' ');
 assert.equal(spoken, narration);
 assert.equal(extractSpeaker('Князь — красавец с характером.'), null);
 assert.equal(extractSpeaker('На одной лапе — тонкое колечко.'), null);
});

test('narrator tags and multiple lines do not eat narrative clauses before dashes', () => {
 assert.equal(cleanNarrationForTTS('[Сказитель] Князь — красавец с характером.'), 'Князь — красавец с характером.');
 assert.equal(cleanNarrationForTTS('**Князь** — красавец с характером.\nНа одной лапе — тонкое колечко.'), 'Князь — красавец с характером.\nНа одной лапе — тонкое колечко.');
});

test('explicit speaker prefixes remain silent while the spoken content keeps its dashes', () => {
 for (const text of ['[Марта] На одной лапе — кольцо.', 'Марта: На одной лапе — кольцо.']) {
  assert.equal(cleanNarrationForTTS(text), 'На одной лапе — кольцо.');
 }
 const dialogue = 'Старуха — «Не трогайте петуха!»';
 assert.equal(cleanNarrationForTTS(dialogue), 'Не трогайте петуха!');
 assert.equal(narrationParts(dialogue).map(cleanNarrationForTTS).join(' '), 'Не трогайте петуха!');
 assert.equal(extractSpeaker(dialogue), 'Старуха');
});
