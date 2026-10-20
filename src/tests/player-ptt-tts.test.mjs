import {test} from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {mkdtemp,rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {cleanNarrationForTTS} from '../delivery.mjs';
import {buildSystem,ttsVoiceSystem} from '../prompts.mjs';

test('cleanNarrationForTTS cleans markdown symbols while keeping dramatic pauses and punctuation', () => {
  const dirty = `### Вход в склеп\n**Дверь со скрипом** открывается... В темноте видны *два янтарных глаза*.\n- Не подходи, ` + '`чужак`' + `! — шепчет голос.\n## Что вы делаете?..`;
  const clean = cleanNarrationForTTS(dirty);
  assert.equal(clean.includes('**'), false);
  assert.equal(clean.includes('*'), false);
  assert.equal(clean.includes('#'), false);
  assert.equal(clean.includes('`'), false);
  assert.ok(clean.includes('Дверь со скрипом открывается...'));
  assert.ok(clean.includes('два янтарных глаза.'));
  assert.ok(clean.includes('Не подходи, чужак! — шепчет голос.'));
  assert.ok(clean.includes('Что вы делаете?..'));
});

test('ttsVoiceSystem is included in prompt buildSystem', () => {
  const system = buildSystem({edition: '2024'});
  assert.ok(system.includes('АДАПТАЦИЯ ТЕКСТА ПОД НЕЙРОСЕТЕВОГО ЧТЕЦА (TTS)'));
  assert.ok(system.includes('НИКАКОЙ СЛУЖЕБНОЙ И ТЕХНИЧЕСКОЙ РАЗМЕТКИ'));
  assert.ok(system.includes('ПАУЗЫ, ДЫХАНИЕ И ДРАМАТИЧЕСКИЙ РИТМ'));
});

test('LAN Companion: /api/player/ptt and /api/player/turn dispatch action for the active character', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'skazitel-ptt-'));
  let child, base;
  async function boot() {
    child = spawn(process.execPath, ['server.mjs'], {
      cwd: new URL('..', import.meta.url),
      env: {
        ...process.env,
        PORT: '0',
        SKAZITEL_KEYCHAIN_HELPER: '',
        SKAZITEL_DATA: dir,
        SKAZITEL_TOKEN: 'master-token',
        SKAZITEL_PLAYER_TOKEN: 'player-secret'
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
    // 1. Create a campaign with 2 heroes (Alvari and Teon)
    const masterRes = await fetch(base + '/api/create', {
      method: 'POST',
      headers: { 'x-app-token': 'master-token', 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'Таинственная гробница',
        edition: '2024',
        characters: [
          { name: 'Альвари', archetype: 'Друид', maxHp: 18, hp: 18 },
          { name: 'Теон', archetype: 'Изобретатель', maxHp: 22, hp: 22 }
        ]
      })
    });
    const state = await masterRes.json();
    const campaignId = state.activeId;
    const alvari = state.campaigns[0].characters.find(c => c.name === 'Альвари');
    const teon = state.campaigns[0].characters.find(c => c.name === 'Теон');
    assert.ok(alvari && teon);

    // 2. Reject unauthenticated request to /api/player/turn
    const unauthRes = await fetch(base + '/api/player/turn', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ campaignId, characterId: alvari.id, text: 'Осматриваю алтарь' })
    });
    assert.equal(unauthRes.status, 403);

    // 3. Player action sent on behalf of Alvari
    const alvariTurnRes = await fetch(base + '/api/player/turn', {
      method: 'POST',
      headers: {
        'x-player-token': 'player-secret',
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        campaignId,
        characterId: alvari.id,
        text: 'Я тихо подкрадываюсь к алтарю...'
      })
    });
    assert.equal(alvariTurnRes.status, 200);
    const alvariTurn = await alvariTurnRes.json();
    assert.equal(alvariTurn.ok, true);
    assert.equal(alvariTurn.characterName, 'Альвари');

    // 4. Player action sent on behalf of Teon
    const teonTurnRes = await fetch(base + '/api/player/ptt', {
      method: 'POST',
      headers: {
        'x-player-token': 'player-secret',
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        campaignId,
        characterId: teon.id,
        text: 'Я достаю гаечный ключ и осматриваю механизм замка.'
      })
    });
    assert.equal(teonTurnRes.status, 200);
    const teonTurn = await teonTurnRes.json();
    assert.equal(teonTurn.ok, true);
    assert.equal(teonTurn.characterName, 'Теон');

    // 5. Verify the campaign journal records the exact actions under the respective characters
    const pStateRes = await fetch(base + '/api/player/state?id=' + campaignId, {
      headers: { 'x-player-token': 'player-secret' }
    });
    const pState = await pStateRes.json();
    const journalTexts = pState.campaign.journal.map(j => j.text);

    assert.ok(journalTexts.some(t => t.startsWith('Альвари: Я тихо подкрадываюсь')));
    assert.ok(journalTexts.some(t => t.startsWith('Теон: Я достаю гаечный ключ')));
  } finally {
    if (child && !child.killed) await stop();
    await rm(dir, { recursive: true, force: true });
  }
});
