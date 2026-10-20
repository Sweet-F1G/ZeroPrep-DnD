import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {spawn} from 'node:child_process';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const root = path.dirname(fileURLToPath(import.meta.url));
const serverPath = path.resolve(root, '../server.mjs');

test('Combat, Fog of War, Player Rest, Resource and Random Generator endpoints', async (t) => {
  const env = {
    ...process.env,
    PORT: '0',
    SKAZITEL_DATA: `/private/tmp/skazitel-test-${Date.now()}`
  };
  const proc = spawn('/opt/homebrew/bin/node', [serverPath], { env });

  let baseUrl = '';
  let appToken = '';
  let playerToken = '';

  await new Promise((resolve, reject) => {
    proc.stdout.on('data', (d) => {
      const text = d.toString();
      const m = /SKAZITEL_URL=(http:\/\/127\.0\.0\.1:\d+)/.exec(text);
      if (m) {
        baseUrl = m[1];
        resolve();
      }
    });
    proc.stderr.on('data', (d) => {
      const err = d.toString();
      if (err.includes('Error:')) reject(new Error(err));
    });
  });

  t.after(() => {
    try { proc.kill('SIGTERM'); } catch {}
  });

  // Read HTML to get app token
  const htmlRes = await fetch(`${baseUrl}/`);
  const html = await htmlRes.text();
  const tokenMatch = /name="app-token" content="([^"]+)"/.exec(html);
  assert.ok(tokenMatch, 'App token must be present');
  appToken = tokenMatch[1];

  // Get state & tokens
  const stateRes = await fetch(`${baseUrl}/api/lan-info`, {
    headers: { 'x-app-token': appToken }
  });
  assert.equal(stateRes.status, 200);
  const lanData = await stateRes.json();
  playerToken = lanData.playerToken;

  // 1. Create a campaign with heroes
  const campRes = await fetch(`${baseUrl}/api/create`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-app-token': appToken },
    body: JSON.stringify({
      name: 'Битва у руин',
      setting: 'Древние руины',
      characters: [
        { name: 'Варвар Торн', hp: 25, maxHp: 25, abilityScores: { dexterity: 14, constitution: 16 } },
        { name: 'Маг Элария', hp: 14, maxHp: 14, abilityScores: { dexterity: 12, intelligence: 16 } }
      ]
    })
  });
  assert.equal(campRes.status, 200);
  const campData = await campRes.json();
  const campaignId = campData.activeCampaignId || campData.activeId;
  assert.ok(campaignId);

  // 2. Test Combat Start
  const startCombatRes = await fetch(`${baseUrl}/api/combat/start`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-app-token': appToken },
    body: JSON.stringify({
      campaignId,
      enemies: [{ name: 'Гоблин-вожак', mod: 2 }]
    })
  });
  assert.equal(startCombatRes.status, 200);
  const startCombatData = await startCombatRes.json();
  assert.ok(startCombatData.ok);
  assert.equal(startCombatData.initiative.active, true);
  assert.equal(startCombatData.initiative.round, 1);
  assert.equal(startCombatData.initiative.combatants.length, 3);

  // 3. Test Combat Next Turn
  const nextTurnRes = await fetch(`${baseUrl}/api/combat/next`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-app-token': appToken },
    body: JSON.stringify({ campaignId })
  });
  assert.equal(nextTurnRes.status, 200);
  const nextTurnData = await nextTurnRes.json();
  assert.ok(nextTurnData.ok);
  assert.equal(nextTurnData.initiative.turnIndex, 1);

  // 4. Test Combat End
  const endCombatRes = await fetch(`${baseUrl}/api/combat/end`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-app-token': appToken },
    body: JSON.stringify({ campaignId })
  });
  assert.equal(endCombatRes.status, 200);
  const endCombatData = await endCombatRes.json();
  assert.ok(endCombatData.ok);

  // 5. Test Random Generator
  const genLootRes = await fetch(`${baseUrl}/api/generate/random`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-app-token': appToken },
    body: JSON.stringify({ campaignId, type: 'loot', applyToParty: true })
  });
  assert.equal(genLootRes.status, 200);
  const genLootData = await genLootRes.json();
  assert.ok(genLootData.ok);
  assert.ok(genLootData.result.item);

  // 6. Test Player Whispers
  const charId = campData.campaigns.find(c => c.id === campaignId)?.characters?.[0]?.id;
  const whisperRes = await fetch(`${baseUrl}/api/player/turn`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-player-token': playerToken },
    body: JSON.stringify({
      campaignId,
      characterId: charId,
      text: 'Я тайно проверяю замок на сундуке',
      isWhisper: true
    })
  });
  assert.equal(whisperRes.status, 200);
  const whisperData = await whisperRes.json();
  assert.ok(whisperData.ok);

  // 7. Test Rest
  const restRes = await fetch(`${baseUrl}/api/player/rest`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-player-token': playerToken },
    body: JSON.stringify({
      campaignId,
      characterId: charId,
      kind: 'short'
    })
  });
  assert.equal(restRes.status, 200);
  const restData = await restRes.json();
  assert.ok(restData.ok);
});
