import {test} from 'node:test';
import assert from 'node:assert/strict';
import {edgeVoices, edgeVoiceStatus, edgeSpeech, edgeSpeechChunks} from '../edge-voice.mjs';

test('Edge TTS voice metadata and availability', async () => {
 assert.ok(Array.isArray(edgeVoices));
 assert.ok(edgeVoices.some(v => v.id === 'ru-RU-DmitryNeural'));
 assert.ok(edgeVoices.some(v => v.id === 'ru-RU-SvetlanaNeural'));

 const status = await edgeVoiceStatus();
 assert.equal(status.installed, true);
 assert.equal(status.engine, 'Microsoft Edge Neural TTS');
 assert.equal(status.voices.length, 2);
});

test('Edge TTS synthesizes Russian speech with valid MP3 format', async () => {
 const text = 'Теон, проверьте старую башню у дороги.';
 const audio = await edgeSpeech(text, 'ru-RU-DmitryNeural');
 assert.ok(Buffer.isBuffer(audio));
 assert.ok(audio.length > 5000);
 // Verify MP3 sync frame (0xFF followed by 0xFB, 0xF3, or 0xE0-0xFF)
 assert.equal(audio[0], 0xFF);
 assert.ok((audio[1] & 0xE0) === 0xE0);
});

test('Edge TTS streaming chunks and clean cancellation', async () => {
 const ac = new AbortController();
 const chunks = [];
 for await (const chunk of edgeSpeechChunks('Первая фраза мастера для проверки потока.', 'ru-RU-SvetlanaNeural', ac.signal)) {
  chunks.push(chunk);
  if (chunks.length >= 2) {
   ac.abort();
   break;
  }
 }
 assert.ok(chunks.length >= 2);
 assert.ok(chunks.every(c => Buffer.isBuffer(c) && c.length > 0));
});
