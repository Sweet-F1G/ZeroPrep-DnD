import {test} from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {mkdtemp, rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {cleanNarrationForTTS, resolveOpenAiVoice, resolveEdgeVoice, narrationParts} from '../delivery.mjs';

test('live multi-voice dialogue: speaker tagging, voice routing, and TTS delivery without names', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'skazitel-multivoice-'));
  let child, base;

  async function boot() {
    child = spawn(process.execPath, ['server.mjs'], {
      cwd: new URL('..', import.meta.url),
      env: {
        ...process.env,
        PORT: '0',
        SKAZITEL_KEYCHAIN_HELPER: '',
        SKAZITEL_DATA: dir,
        SKAZITEL_TOKEN: 'test-master'
      },
      stdio: ['ignore', 'pipe', 'inherit']
    });
    base = await new Promise((resolve, reject) => {
      let out = '';
      child.stdout.on('data', b => {
        out += b;
        const m = out.match(/SKAZITEL_URL=(http:\/\/[^\n]+)/);
        if (m) resolve(m[1]);
      });
      child.once('error', reject);
    });
  }

  async function stop() {
    const stopped = new Promise(r => child.once('exit', r));
    child.kill();
    await stopped;
  }

  try {
    await boot();

    // Configure Edge TTS for real multi-voice synthesis test
    const settingsRes = await fetch(base + '/api/settings', {
      method: 'POST',
      headers: { 'x-app-token': 'test-master', 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ttsProvider: 'edge',
        edgeVoice: 'ru-RU-DmitryNeural'
      })
    });
    assert.equal(settingsRes.status, 200);

    // 1. Create campaign with Fedor, Marta, and Starukha (Village setting)
    const createRes = await fetch(base + '/api/create', {
      method: 'POST',
      headers: { 'x-app-token': 'test-master', 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'Деревня Большое Дрочево',
        edition: '2024',
        characters: [
          { name: 'Фёдор', archetype: 'Воин', maxHp: 24, hp: 24 },
          { name: 'Марта', archetype: 'Следопыт', maxHp: 19, hp: 19 }
        ]
      })
    });
    const state = await createRes.json();
    const campaignId = state.activeId;
    assert.ok(campaignId);

    // 2. Test multi-voice dialogue splitting across characters & multi-sentence Starukha speech
    const fullDialogue = 'Фёдор: Ну и пошло оно всё! Марта: Да точно, нечего здесь ловить. Старуха: А ну не сметь трогать кувшин! Он старинный и проклятый.';
    const parts = narrationParts(fullDialogue);

    assert.equal(parts.length, 4);
    assert.equal(parts[0], '[Фёдор] Ну и пошло оно всё!');
    assert.equal(parts[1], '[Марта] Да точно, нечего здесь ловить.');
    assert.equal(parts[2], '[Старуха] А ну не сметь трогать кувшин!');
    assert.equal(parts[3], '[Старуха] Он старинный и проклятый.');

    // 3. Verify voice routing for both OpenAI and Edge TTS
    // OpenAI voices: Onyx (male/narrator), Nova (female dialogue)
    assert.equal(resolveOpenAiVoice('onyx', parts[0]), 'onyx');
    assert.equal(resolveOpenAiVoice('onyx', parts[1]), 'nova');
    assert.equal(resolveOpenAiVoice('onyx', parts[2]), 'nova');
    assert.equal(resolveOpenAiVoice('onyx', parts[3]), 'nova');

    // Edge voices: Dmitry (male), Svetlana (female)
    assert.equal(resolveEdgeVoice('ru-RU-DmitryNeural', parts[0]), 'ru-RU-DmitryNeural');
    assert.equal(resolveEdgeVoice('ru-RU-DmitryNeural', parts[1]), 'ru-RU-SvetlanaNeural');
    assert.equal(resolveEdgeVoice('ru-RU-DmitryNeural', parts[2]), 'ru-RU-SvetlanaNeural');
    assert.equal(resolveEdgeVoice('ru-RU-DmitryNeural', parts[3]), 'ru-RU-SvetlanaNeural');

    // 4. Verify cleanNarrationForTTS ensures ZERO character names are vocalized
    assert.equal(cleanNarrationForTTS(parts[0]), 'Ну и пошло оно всё!');
    assert.equal(cleanNarrationForTTS(parts[1]), 'Да точно, нечего здесь ловить.');
    assert.equal(cleanNarrationForTTS(parts[2]), 'А ну не сметь трогать кувшин!');
    assert.equal(cleanNarrationForTTS(parts[3]), 'Он старинный и проклятый.');

    // 5. Test real Edge TTS streaming via /api/speech-prepare and /api/audio/:ticket for each part
    for (let i = 0; i < parts.length; i++) {
      const part = parts[i];
      const prepRes = await fetch(base + '/api/speech-prepare', {
        method: 'POST',
        headers: { 'x-app-token': 'test-master', 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: part })
      });
      assert.equal(prepRes.status, 200, `speech-prepare failed for part ${i}`);
      const { url } = await prepRes.json();
      assert.ok(url.startsWith('/api/audio/'));

      const audioRes = await fetch(base + url);
      assert.equal(audioRes.status, 200, `audio fetch failed for part ${i}`);
      const audioBuffer = Buffer.from(await audioRes.arrayBuffer());
      assert.ok(audioBuffer.length > 500, `audio buffer too small: ${audioBuffer.length} bytes`);
      // Verify valid MP3 header (0xFF 0xFB or ID3)
      const isMp3 = (audioBuffer[0] === 0xff && (audioBuffer[1] & 0xe0) === 0xe0) ||
                    (audioBuffer.subarray(0, 3).toString() === 'ID3');
      assert.ok(isMp3, `Audio chunk ${i} is not a valid MP3 file`);
    }

    // 6. Test bolded markdown variant: **Старуха:** «Куда лезешь? Я всё вижу!»
    const boldDialogue = '**Старуха:** «Куда лезешь? Я всё вижу!»';
    const boldParts = narrationParts(boldDialogue);
    assert.equal(boldParts.length, 2);
    assert.equal(boldParts[0], '[Старуха] «Куда лезешь?');
    assert.equal(boldParts[1], '[Старуха] Я всё вижу!»');
    assert.equal(resolveOpenAiVoice('onyx', boldParts[0]), 'nova');
    assert.equal(resolveOpenAiVoice('onyx', boldParts[1]), 'nova');
    assert.equal(cleanNarrationForTTS(boldParts[0]), 'Куда лезешь?');
    assert.equal(cleanNarrationForTTS(boldParts[1]), 'Я всё вижу!');

    // 7. Verify advanceDelivery advances cleanly without showing internal tags
    const ackRes = await fetch(base + '/api/demo-voice', {
      method: 'POST',
      headers: { 'x-app-token': 'test-master', 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: campaignId })
    });
    assert.equal(ackRes.status, 200);
    const demoState = await ackRes.json();
    assert.ok(demoState.campaigns[0].delivery);
    const delivery = demoState.campaigns[0].delivery;
    assert.ok(delivery.displayText);
    assert.equal(delivery.displayText.includes('['), false, 'Display text must not contain raw bracket tags');
  } finally {
    if (child && !child.killed) await stop();
    await rm(dir, { recursive: true, force: true });
  }
});
