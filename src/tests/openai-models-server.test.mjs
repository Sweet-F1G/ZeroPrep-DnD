import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {spawn} from 'node:child_process';

test('OpenAI models endpoint: key verification, filtering, sorting and safe errors', async () => {
 const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'skazitel-models-'));
 const preload = path.join(dir, 'preload.mjs');
 let child;

 const mockOpenAIModels = {
  object: 'list',
  data: [
   { id: 'whisper-1', object: 'model' },
   { id: 'tts-1', object: 'model' },
   { id: 'text-embedding-3-small', object: 'model' },
   { id: 'babbage-002', object: 'model' },
   { id: 'gpt-4o', object: 'model' },
   { id: 'gpt-4o-mini', object: 'model' },
   { id: 'o3-mini', object: 'model' },
   { id: 'gpt-6-luna', object: 'model' },
   { id: 'custom-fine-tuned-model', object: 'model' }
  ]
 };

 await fs.writeFile(preload, `
  const real = fetch;
  globalThis.fetch = async (url, options) => {
   if (String(url) === 'https://api.openai.com/v1/models') {
    const auth = options?.headers?.Authorization || options?.headers?.authorization;
    if (auth === 'Bearer invalid-key') {
     return new Response(JSON.stringify({ error: { message: 'Incorrect API key provided' } }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' }
     });
    }
    return Response.json(${JSON.stringify(mockOpenAIModels)});
   }
   return real(url, options);
  };
 `);

 child = spawn(process.execPath, ['--import', preload, 'server.mjs'], {
  cwd: new URL('..', import.meta.url),
  env: { ...process.env, PORT: '0', SKAZITEL_DATA: dir, SKAZITEL_KEYCHAIN_HELPER: '', SKAZITEL_TOKEN: 'fixture' },
  stdio: ['ignore', 'pipe', 'inherit']
 });

 try {
  const base = await new Promise((resolve, reject) => {
   let text = '';
   child.stdout.on('data', b => {
    text += b;
    const m = text.match(/SKAZITEL_URL=(http:\/\/[^\n]+)/);
    if (m) resolve(m[1]);
   });
   child.once('error', reject);
  });

  const api = async (route, data, status = 200) => {
   const r = await fetch(base + '/api/' + route, {
    method: data ? 'POST' : 'GET',
    headers: { 'x-app-token': 'fixture', 'Content-Type': 'application/json' },
    ...(data ? { body: JSON.stringify(data) } : {})
   });
   const body = await r.json();
   assert.equal(r.status, status, JSON.stringify(body));
   return body;
  };

  // 1. Without any key configured, GET returns ok: false with helpful error
  const noKeyRes = await api('openai/models', null, 200);
  assert.equal(noKeyRes.ok, false);
  assert.match(noKeyRes.error, /OpenAI API-ключ не найден/);

  // 2. POST with explicit invalid key returns ok: false with upstream error message
  const invalidKeyRes = await api('openai/models', { apiKey: 'invalid-key' }, 200);
  assert.equal(invalidKeyRes.ok, false);
  assert.match(invalidKeyRes.error, /Incorrect API key provided/);

  // 3. POST with explicit valid key filters non-chat models and prioritizes recommended models
  const validPostRes = await api('openai/models', { apiKey: 'valid-test-key' }, 200);
  assert.equal(validPostRes.ok, true);
  assert.ok(Array.isArray(validPostRes.models));
  // Filtered out whisper-1, tts-1, text-embedding-3-small, babbage-002
  assert.ok(!validPostRes.models.includes('whisper-1'));
  assert.ok(!validPostRes.models.includes('tts-1'));
  assert.ok(!validPostRes.models.includes('text-embedding-3-small'));
  assert.ok(!validPostRes.models.includes('babbage-002'));
  // Contains chat models
  assert.ok(validPostRes.models.includes('gpt-6-luna'));
  assert.ok(validPostRes.models.includes('gpt-4o'));
  assert.ok(validPostRes.models.includes('gpt-4o-mini'));
  assert.ok(validPostRes.models.includes('o3-mini'));
  assert.ok(validPostRes.models.includes('custom-fine-tuned-model'));
  // gpt-6-luna should be first
  assert.equal(validPostRes.models[0], 'gpt-6-luna');

  // 4. Set key pool in settings, then GET /api/openai/models works automatically
  await api('settings', {
   provider: 'openai',
   keyPools: {
    openai: [{ id: 'key-1', key: 'pool-test-key' }]
   }
  });

  const getWithPoolRes = await api('openai/models', null, 200);
  assert.equal(getWithPoolRes.ok, true);
  assert.ok(getWithPoolRes.models.includes('gpt-6-luna'));
 } finally {
  const stopped = new Promise(r => child.once('exit', r));
  child.kill();
  await stopped;
  await fs.rm(dir, { recursive: true, force: true });
 }
});
