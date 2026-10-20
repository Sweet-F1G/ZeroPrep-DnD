import {test} from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {mkdtemp,rm} from 'node:fs/promises';
import https from 'node:https';
import os from 'node:os';
import path from 'node:path';
import {cleanNarrationForTTS,resolveOpenAiVoice,resolveEdgeVoice,extractSpeaker,narrationParts} from '../delivery.mjs';
import {buildSystem,ttsVoiceSystem,coreSystem} from '../prompts.mjs';

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

test('cleanNarrationForTTS strips speaker prefixes so names are never read aloud by TTS', () => {
  assert.equal(cleanNarrationForTTS('[Старуха] А теперь гляньте, чего он там высмотрел.'), 'А теперь гляньте, чего он там высмотрел.');
  assert.equal(cleanNarrationForTTS('Старуха: «А ну не сметь трогать кувшин!»'), 'А ну не сметь трогать кувшин!');
  assert.equal(cleanNarrationForTTS('**Старуха:** «Куда лезешь?»'), 'Куда лезешь?');
  assert.equal(cleanNarrationForTTS('**Старуха**: «Куда лезешь?»'), 'Куда лезешь?');
  assert.equal(cleanNarrationForTTS('*Старуха:* «Куда лезешь?»'), 'Куда лезешь?');
  assert.equal(cleanNarrationForTTS('**Баба-Яга:** Уходи отсюда!'), 'Уходи отсюда!');
  assert.equal(cleanNarrationForTTS('Старуха — «А ну не сметь!»'), 'А ну не сметь!');
  assert.equal(cleanNarrationForTTS('Фёдор: Ну и пошло оно всё!'), 'Ну и пошло оно всё!');
  assert.equal(cleanNarrationForTTS('[speaker:Марта]: Да точно, бабушка права.'), 'Да точно, бабушка права.');
  assert.equal(cleanNarrationForTTS('«Марта: Да точно!»'), 'Да точно!');
});

test('narrationParts preserves speaker across multi-sentence dialogue without saying names aloud', () => {
  const dialogue = 'Старуха: «Ну, хоть слушать перестал. А теперь гляньте, чего он там высмотрел.»';
  const parts = narrationParts(dialogue);
  assert.equal(parts.length, 2);
  assert.equal(parts[0], '[Старуха] «Ну, хоть слушать перестал.');
  assert.equal(parts[1], '[Старуха] А теперь гляньте, чего он там высмотрел.»');

  // Both sentences resolve to female voice (Nova)
  assert.equal(resolveOpenAiVoice('onyx', parts[0]), 'nova');
  assert.equal(resolveOpenAiVoice('onyx', parts[1]), 'nova');

  // Neither sentence will have the word "Старуха" read aloud
  assert.equal(cleanNarrationForTTS(parts[0]), 'Ну, хоть слушать перестал.');
  assert.equal(cleanNarrationForTTS(parts[1]), 'А теперь гляньте, чего он там высмотрел.');

  // Markdown bolded dialogue splits cleanly and preserves speaker voice
  const boldDialogue = '**Старуха:** «Ну, хоть слушать перестал. А теперь гляньте, чего он там высмотрел.»';
  const boldParts = narrationParts(boldDialogue);
  assert.equal(boldParts.length, 2);
  assert.equal(boldParts[0], '[Старуха] «Ну, хоть слушать перестал.');
  assert.equal(boldParts[1], '[Старуха] А теперь гляньте, чего он там высмотрел.»');
  assert.equal(resolveOpenAiVoice('onyx', boldParts[0]), 'nova');
  assert.equal(resolveOpenAiVoice('onyx', boldParts[1]), 'nova');
  assert.equal(cleanNarrationForTTS(boldParts[0]), 'Ну, хоть слушать перестал.');
  assert.equal(cleanNarrationForTTS(boldParts[1]), 'А теперь гляньте, чего он там высмотрел.');

  // Multi-speaker on one line splits cleanly into distinct voices
  const multi = 'Фёдор: Ну и пошло оно всё! Марта: Да точно! Старуха: А ну не сметь!';
  const multiParts = narrationParts(multi);
  assert.equal(multiParts.length, 3);
  assert.equal(resolveOpenAiVoice('onyx', multiParts[0]), 'onyx');
  assert.equal(resolveOpenAiVoice('onyx', multiParts[1]), 'nova');
  assert.equal(resolveOpenAiVoice('onyx', multiParts[2]), 'nova');
  assert.equal(cleanNarrationForTTS(multiParts[0]), 'Ну и пошло оно всё!');
  assert.equal(cleanNarrationForTTS(multiParts[1]), 'Да точно!');
  assert.equal(cleanNarrationForTTS(multiParts[2]), 'А ну не сметь!');
});

test('ttsVoiceSystem is included in prompt buildSystem and coreSystem forbids DM self-arguing', () => {
  const system = buildSystem({edition: '2024'});
  assert.ok(system.includes('АДАПТАЦИЯ ТЕКСТА ПОД НЕЙРОСЕТЕВОГО ЧТЕЦА (TTS)'));
  assert.ok(system.includes('НИКАКОЙ СЛУЖЕБНОЙ И ТЕХНИЧЕСКОЙ РАЗМЕТКИ'));
  assert.ok(system.includes('ПАУЗЫ, ДЫХАНИЕ И ДРАМАТИЧЕСКИЙ РИТМ'));
  assert.ok(system.includes('РАЗМЕТКА МНОГОГОЛОСИЯ И ДИАЛОГОВ'));
  assert.ok(coreSystem.includes('КАТЕГОРИЧЕСКИ ЗАПРЕЩЕНО СПОРИТЬ С САМИМ СОБОЙ'));
});

test('resolveOpenAiVoice routes voices dynamically by character and dialogue cues', () => {
  // Base narrator
  assert.equal(resolveOpenAiVoice('onyx', 'Тропинка петляет среди мрачных сосен.'), 'onyx');
  
  // Female NPC dialogue / tags
  assert.equal(resolveOpenAiVoice('onyx', '«Не ходите туда», — шепчет жрица Альвари.'), 'nova');
  assert.equal(resolveOpenAiVoice('onyx', 'Трактирщица с улыбкой ставит кружку на стол: «Угощайтесь, путники».'), 'nova');
  assert.equal(resolveOpenAiVoice('onyx', 'Старуха поднимает костлявую руку: «Вы опоздали».'), 'nova');

  // Young male / bard / agile companion
  assert.equal(resolveOpenAiVoice('onyx', 'Теон усмехается и ловко достает отмычку.'), 'echo');
  assert.equal(resolveOpenAiVoice('onyx', '«Я знаю тайный ход!» — восклицает юноша.'), 'echo');
  assert.equal(resolveOpenAiVoice('onyx', 'Бард перебирает струны лютни и запевает балладу.'), 'echo');

  // Monster / orc / brute
  assert.equal(resolveOpenAiVoice('alloy', 'Огромный орк рычит и заносит тяжелый топор.'), 'onyx');
  assert.equal(resolveOpenAiVoice('nova', 'Древний дракон гремит чешуей во тьме пещеры.'), 'onyx');
});

test('resolveEdgeVoice routes voices dynamically between male and female', () => {
  assert.equal(resolveEdgeVoice('ru-RU-DmitryNeural', 'Лес погружается во мрак.'), 'ru-RU-DmitryNeural');
  assert.equal(resolveEdgeVoice('ru-RU-DmitryNeural', '«Будьте осторожны», — тихо произносит жрица.'), 'ru-RU-SvetlanaNeural');
  assert.equal(resolveEdgeVoice('ru-RU-SvetlanaNeural', 'Голос рассказчика спокоен и глубок.'), 'ru-RU-SvetlanaNeural');
  assert.equal(resolveEdgeVoice('ru-RU-DmitryNeural', '[Старуха] А ну не сметь!'), 'ru-RU-SvetlanaNeural');
  assert.equal(resolveEdgeVoice('ru-RU-DmitryNeural', '[Фёдор] Пошли!'), 'ru-RU-DmitryNeural');
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

    // 6. Mobile audio format check: verify audio/m4a and audio/aac are accepted by MIME validator
    const invalidMimeRes = await fetch(base + '/api/player/ptt', {
      method: 'POST',
      headers: { 'x-player-token': 'player-secret', 'Content-Type': 'application/json' },
      body: JSON.stringify({
        campaignId,
        characterId: alvari.id,
        audio: Buffer.from('RIFF....WAVEfmt ').toString('base64'),
        mime: 'application/pdf'
      })
    });
    assert.equal(invalidMimeRes.status, 400);
    const invalidErr = await invalidMimeRes.json();
    assert.match(invalidErr.error, /Неподдерживаемый аудиоформат/);

    // Empty audio is rejected cleanly
    const emptyAudioRes = await fetch(base + '/api/player/ptt', {
      method: 'POST',
      headers: { 'x-player-token': 'player-secret', 'Content-Type': 'application/json' },
      body: JSON.stringify({
        campaignId,
        characterId: alvari.id,
        audio: '',
        mime: 'audio/m4a'
      })
    });
    assert.equal(emptyAudioRes.status, 400);
    const emptyErr = await emptyAudioRes.json();
    assert.match(emptyErr.error, /Опишите действие героя/);

    // 7. Verify /api/lan-info returns playerHttpsUrl for seamless browser voice
    const lanRes = await fetch(base + '/api/lan-info', {
      headers: { 'x-app-token': 'master-token' }
    });
    assert.equal(lanRes.status, 200);
    const lanInfo = await lanRes.json();
    assert.ok(lanInfo.playerUrl.startsWith('http://'));
    assert.ok(lanInfo.playerHttpsUrl.startsWith('https://'));
    assert.ok(Number.isInteger(lanInfo.httpsPort));

    // 8. Verify HTTPS server responds with status 200
    const httpsRes = await new Promise((resolve, reject) => {
      https.get(lanInfo.playerHttpsUrl, { rejectUnauthorized: false }, res => {
        resolve(res.statusCode);
      }).on('error', reject);
    });
    assert.equal(httpsRes, 200);
  } finally {
    if (child && !child.killed) await stop();
    await rm(dir, { recursive: true, force: true });
  }
});
