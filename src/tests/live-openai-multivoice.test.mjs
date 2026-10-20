import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {cleanNarrationForTTS, resolveOpenAiVoice, narrationParts, normalizeIntonationAndStressForTTS} from '../delivery.mjs';

test('OpenAI TTS multi-voice delivery: voice routing, character name stripping, auto-yoification and dramatic pauses', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'skazitel-openai-tts-'));
  const preload = path.join(dir, 'preload.mjs');
  const capturedRequests = [];

  // Preload script intercepts OpenAI TTS API calls and inspects the payload sent to OpenAI
  await fs.writeFile(preload, `
    import { EventEmitter } from 'node:events';
    const real = fetch;
    globalThis.fetch = async (url, opts) => {
      const urlStr = String(url);
      if (urlStr.endsWith('/audio/speech')) {
        const body = JSON.parse(opts.body);
        // Write captured request to temp log for test verification
        await import('node:fs/promises').then(fs => 
          fs.appendFile(${JSON.stringify(path.join(dir, 'tts-requests.jsonl'))}, JSON.stringify(body) + '\\n')
        );
        // Valid minimal MP3 stream fixture
        const mp3Bytes = Buffer.from([0xff, 0xfb, 0x90, 0x64, 0x00, 0x00, 0x00, 0x00]);
        return new Response(mp3Bytes, {
          status: 200,
          headers: { 'Content-Type': 'audio/mpeg' }
        });
      }
      return real(url, opts);
    };
  `);

  let child, base;
  async function boot() {
    child = spawn(process.execPath, ['--import', preload, 'server.mjs'], {
      cwd: new URL('..', import.meta.url),
      env: {
        ...process.env,
        PORT: '0',
        SKAZITEL_KEYCHAIN_HELPER: '',
        SKAZITEL_DATA: dir,
        SKAZITEL_TOKEN: 'test-openai-master'
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

    // 1. Configure server for OpenAI TTS with key
    const settingsRes = await fetch(base + '/api/settings', {
      method: 'POST',
      headers: { 'x-app-token': 'test-openai-master', 'Content-Type': 'application/json' },
      body: JSON.stringify({
        provider: 'openai',
        ttsProvider: 'openai',
        ttsModel: 'tts-1',
        voice: 'onyx',
        keys: { openai: 'sk-test-live-key' }
      })
    });
    assert.equal(settingsRes.status, 200);

    // 2. Prepare multi-voice dialogue containing:
    // - Fedor (male, default Onyx)
    // - Marta (female, Nova)
    // - Starukha with multiple sentences (female, Nova across ALL sentences)
    // - Dramatic atmosphere with auto-yoification and em-dash pauses
    const sceneText = 'Фёдор: Ну и пошло оно все! Марта: Да точно, пора уходить. Старуха: «А ну не сметь трогать кувшин! Он старинный и проклятый.» В темном лесу потрескивает костер--все тихо...';
    const parts = narrationParts(sceneText);

    assert.equal(parts.length, 5);
    assert.equal(parts[0], '[Фёдор] Ну и пошло оно все!');
    assert.equal(parts[1], '[Марта] Да точно, пора уходить.');
    assert.equal(parts[2], '[Старуха] «А ну не сметь трогать кувшин!');
    assert.equal(parts[3], '[Старуха] Он старинный и проклятый.»');
    assert.equal(parts[4], 'В темном лесу потрескивает костер--все тихо...');

    // 3. Request speech preparation and consume audio tickets for each chunk through server
    for (let i = 0; i < parts.length; i++) {
      const part = parts[i];
      const prepRes = await fetch(base + '/api/speech-prepare', {
        method: 'POST',
        headers: { 'x-app-token': 'test-openai-master', 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: part })
      });
      assert.equal(prepRes.status, 200, `speech-prepare failed for part ${i}`);
      const { url } = await prepRes.json();
      assert.ok(url.startsWith('/api/audio/'));

      const audioRes = await fetch(base + url);
      assert.equal(audioRes.status, 200, `fetch audio failed for part ${i}`);
      const audioBytes = await audioRes.arrayBuffer();
      assert.ok(audioBytes.byteLength > 0);
    }

    // 4. Read captured OpenAI TTS payloads to verify exact requests sent upstream
    const logPath = path.join(dir, 'tts-requests.jsonl');
    const logs = (await fs.readFile(logPath, 'utf8')).trim().split('\n').map(l => JSON.parse(l));
    assert.equal(logs.length, 5);

    // Part 0: Fedor -> Onyx, name stripped, "все" auto-yoified to "всё"
    assert.equal(logs[0].model, 'tts-1');
    assert.equal(logs[0].voice, 'onyx');
    assert.equal(logs[0].input, 'Ну и пошло оно всё!');
    assert.equal(logs[0].input.includes('Фёдор'), false, 'Name must never be sent to OpenAI TTS');

    // Part 1: Marta -> Nova, name stripped
    assert.equal(logs[1].model, 'tts-1');
    assert.equal(logs[1].voice, 'nova');
    assert.equal(logs[1].input, 'Да точно, пора уходить.');
    assert.equal(logs[1].input.includes('Марта'), false);

    // Part 2: Starukha sentence 1 -> Nova, name stripped
    assert.equal(logs[2].model, 'tts-1');
    assert.equal(logs[2].voice, 'nova');
    assert.equal(logs[2].input, 'А ну не сметь трогать кувшин!');
    assert.equal(logs[2].input.includes('Старуха'), false);

    // Part 3: Starukha sentence 2 -> Nova, maintains Starukha voice
    assert.equal(logs[3].model, 'tts-1');
    assert.equal(logs[3].voice, 'nova');
    assert.equal(logs[3].input, 'Он старинный и проклятый.');
    assert.equal(logs[3].input.includes('Старуха'), false);

    // Part 4: Atmosphere -> Onyx, auto-yoified "тёмном", "костёр", "всё", and "--" -> " — "
    assert.equal(logs[4].model, 'tts-1');
    assert.equal(logs[4].voice, 'onyx');
    assert.equal(logs[4].input, 'В тёмном лесу потрескивает костёр — всё тихо...');
  } finally {
    if (child && !child.killed) await stop();
    await fs.rm(dir, { recursive: true, force: true });
  }
});
