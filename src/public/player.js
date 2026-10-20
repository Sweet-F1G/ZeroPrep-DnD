// ============================================================================
// СКАЗИТЕЛЬ · КАРМАННЫЙ КОМПАНЬОН ДЛЯ СМАРТФОНОВ ИГРОКОВ (LAN)
// ============================================================================

const token = document.querySelector('meta[name="player-token"]')?.getAttribute('content') || '';
const headers = {
  'Content-Type': 'application/json',
  'x-player-token': token,
  'x-app-token': token
};

// Application State
let campaign = null;
let allCampaigns = [];
let selectedCampaignId = localStorage.getItem('skazitel_player_campaign') || '';
let selectedHeroId = localStorage.getItem('skazitel_player_hero') || '';
let selectedMapId = null;
let mapZoomLevel = 1.0;
let mapPixelTheme = localStorage.getItem('skazitel_map_pixel_theme') === 'true';
let rollMode = 'normal'; // 'normal' | 'adv' | 'dis'
let recentRolls = [];
let eventSource = null;

// DOM Elements
const connStatus = document.getElementById('connStatus');
const connLabel = document.getElementById('connLabel');
const campaignSelect = document.getElementById('campaignSelect');
const heroSelect = document.getElementById('heroSelect');
const playerToast = document.getElementById('playerToast');

// Navigation Tabs
const tabButtons = document.querySelectorAll('.tab-btn');
const panels = {
  hero: document.getElementById('heroPanel'),
  dice: document.getElementById('dicePanel'),
  inventory: document.getElementById('inventoryPanel'),
  map: document.getElementById('mapPanel')
};

// Initialize
initTabs();
initDiceControls();
initMapControls();
initPttControls();
loadInitialState();
connectSSE();

// ----------------------------------------------------------------------------
// Navigation Tabs
// ----------------------------------------------------------------------------
function initTabs() {
  tabButtons.forEach(btn => {
    btn.addEventListener('click', () => {
      const tabName = btn.dataset.tab;
      tabButtons.forEach(b => {
        b.classList.remove('active');
        b.setAttribute('aria-selected', 'false');
      });
      btn.classList.add('active');
      btn.setAttribute('aria-selected', 'true');

      Object.entries(panels).forEach(([name, panel]) => {
        if (!panel) return;
        if (name === tabName) {
          panel.classList.add('active');
          panel.hidden = false;
        } else {
          panel.classList.remove('active');
          panel.hidden = true;
        }
      });
    });
  });
}

function switchToTab(tabName) {
  const targetBtn = document.querySelector(`.tab-btn[data-tab="${tabName}"]`);
  if (targetBtn) targetBtn.click();
}

// ----------------------------------------------------------------------------
// Initial State Loading & Synchronization
// ----------------------------------------------------------------------------
async function loadInitialState() {
  try {
    const url = selectedCampaignId 
      ? `/api/player/state?id=${encodeURIComponent(selectedCampaignId)}` 
      : `/api/player/state`;
    const res = await fetch(url, { headers });
    if (!res.ok) throw new Error('Ошибка связи с сервером');
    const data = await res.json();
    if (data.campaign) {
      campaign = data.campaign;
      selectedCampaignId = campaign.id;
      allCampaigns = data.campaigns || [];
      renderCampaignSelect();
      renderHeroSelect();
      renderActiveHero();
      renderInventory();
      renderMap();
    }
  } catch (e) {
    showToast('Не удалось загрузить данные игры');
    setConnectionState('offline', 'ОФФЛАЙН');
  }
}

function connectSSE() {
  if (eventSource) {
    eventSource.close();
  }
  setConnectionState('connecting', 'ПОИСК...');
  const url = `/api/events?token=${encodeURIComponent(token)}`;
  eventSource = new EventSource(url);

  eventSource.onopen = () => {
    setConnectionState('connected', 'ОНЛАЙН');
  };

  eventSource.addEventListener('campaign', async () => {
    // Campaign updated on PC Master screen
    await refreshCampaignState();
  });

  eventSource.addEventListener('campaign-switch', async (e) => {
    try {
      const data = JSON.parse(e.data);
      if (data.campaignId) {
        selectedCampaignId = data.campaignId;
        localStorage.setItem('skazitel_player_campaign', selectedCampaignId);
        selectedHeroId = '';
        localStorage.removeItem('skazitel_player_hero');
        await refreshCampaignState(selectedCampaignId);
        showToast(`Мастер переключил стол: ${campaign?.name || ''}`);
      }
    } catch {}
  });

  eventSource.addEventListener('roll', (e) => {
    try {
      const rollData = JSON.parse(e.data);
      if (rollData.characterName && rollData.text) {
        addRecentRoll(rollData.characterName, rollData.title, rollData.total, rollData.d20, rollData.modifier, rollData.isCrit, rollData.isFumble);
      }
    } catch {}
  });

  eventSource.onerror = () => {
    setConnectionState('offline', 'СВЯЗЬ...');
  };
}

async function refreshCampaignState(targetCampaignId = null) {
  try {
    const idToFetch = targetCampaignId || selectedCampaignId;
    const url = idToFetch 
      ? `/api/player/state?id=${encodeURIComponent(idToFetch)}` 
      : `/api/player/state`;
    const res = await fetch(url, { headers });
    if (!res.ok) return;
    const data = await res.json();
    if (data.campaign) {
      campaign = data.campaign;
      selectedCampaignId = campaign.id;
      localStorage.setItem('skazitel_player_campaign', selectedCampaignId);
      allCampaigns = data.campaigns || [];
      renderCampaignSelect();
      renderHeroSelect();
      renderActiveHero();
      renderInventory();
      renderMap();
    }
  } catch {}
}

function renderCampaignSelect() {
  if (!campaignSelect) return;
  if (!allCampaigns || allCampaigns.length === 0) {
    campaignSelect.innerHTML = `<option value="${campaign?.id || ''}">${escapeHtml(campaign?.name || 'Текущая история')}</option>`;
    return;
  }
  campaignSelect.innerHTML = allCampaigns.map(c => `
    <option value="${c.id}" ${c.id === selectedCampaignId ? 'selected' : ''}>
      ${escapeHtml(c.name)} ${c.heroesCount ? `(${c.heroesCount} гер.)` : ''}
    </option>
  `).join('');

  campaignSelect.onchange = async () => {
    const newId = campaignSelect.value;
    if (!newId || newId === selectedCampaignId) return;
    selectedCampaignId = newId;
    localStorage.setItem('skazitel_player_campaign', newId);
    selectedHeroId = '';
    localStorage.removeItem('skazitel_player_hero');
    await refreshCampaignState(newId);
    showToast(`Загружена история: ${campaign?.name || ''}`);
  };
}

function setConnectionState(state, label) {
  if (!connStatus) return;
  connStatus.className = `status-indicator ${state}`;
  if (connLabel) connLabel.textContent = label;
}

// ----------------------------------------------------------------------------
// Hero Sheet Rendering
// ----------------------------------------------------------------------------
function getActiveHero() {
  if (!campaign || !campaign.characters || campaign.characters.length === 0) return null;
  if (!selectedHeroId) {
    selectedHeroId = campaign.characters[0].id;
  }
  const hero = campaign.characters.find(c => c.id === selectedHeroId);
  return hero || campaign.characters[0];
}

function renderHeroSelect() {
  if (!heroSelect || !campaign || !campaign.characters) return;
  const currentId = selectedHeroId;
  heroSelect.innerHTML = campaign.characters.map(h => `
    <option value="${h.id}" ${h.id === currentId ? 'selected' : ''}>
      ${escapeHtml(h.name)} (${h.archetype || h.race || 'Герой'})
    </option>
  `).join('');

  heroSelect.onchange = () => {
    selectedHeroId = heroSelect.value;
    localStorage.setItem('skazitel_player_hero', selectedHeroId);
    renderActiveHero();
    renderInventory();
  };
}

function getClassIcon(hero) {
  const text = `${hero.name || ''} ${hero.className || ''} ${hero.archetype || ''} ${hero.race || ''}`.toLowerCase();
  if (/арт|изобрет|artificer|инженер|алхим|теон/iu.test(text)) return '⚙️';
  if (/друид|друидизм|druid|альвари|звезд|природ/iu.test(text)) return '🌿';
  if (/плут|вор|разбойник|роуг|rogue|следопыт|рейнджер/iu.test(text)) return '🗡️';
  if (/жрец|клирик|паладин|cleric|paladin/iu.test(text)) return '🛡️';
  if (/воин|боец|рыцарь|варвар|fighter|barbarian/iu.test(text)) return '⚔️';
  if (/маг|чародей|колдун|волшебник|wizard|sorcerer|warlock/iu.test(text)) return '🧙';
  if (/бард|певец|bard/iu.test(text)) return '🪕';
  if (/монах|monk/iu.test(text)) return '🥋';
  return '🛡️';
}

function renderActiveHero() {
  const hero = getActiveHero();
  updatePttHero();
  if (!hero) return;

  // Name & Archetype
  const heroNameEl = document.getElementById('heroName');
  const heroMetaEl = document.getElementById('heroMeta');
  if (heroNameEl) heroNameEl.textContent = hero.name;
  if (heroMetaEl) {
    const metaParts = [hero.race, hero.archetype, hero.level ? `${hero.level} уровень` : ''].filter(Boolean);
    heroMetaEl.textContent = metaParts.join(' · ') || 'Искатель приключений';
  }

  // Portrait (Image or stylized class avatar)
  const heroPortraitEl = document.getElementById('heroPortrait');
  if (heroPortraitEl) {
    const readyPortrait = (campaign?.images || []).filter(i => i.status === 'ready' && i.kind === 'portrait' && i.characterId === hero.id).slice(-1)[0];
    if (readyPortrait && readyPortrait.file) {
      heroPortraitEl.innerHTML = `<img class="hero-portrait-img" src="/images/${readyPortrait.file}" alt="${escapeHtml(hero.name)}">`;
    } else if (hero.portraitUrl) {
      heroPortraitEl.innerHTML = `<img class="hero-portrait-img" src="${hero.portraitUrl}" alt="${escapeHtml(hero.name)}">`;
    } else {
      const icon = getClassIcon(hero);
      const initials = (hero.name || 'Г').charAt(0).toUpperCase();
      heroPortraitEl.innerHTML = `
        <div class="hero-avatar-fallback">
          <span class="avatar-icon">${icon}</span>
          <span class="avatar-initials">${initials}</span>
        </div>
      `;
    }
  }

  // HP Bar & Monitoring (Read-Only Status)
  const hpCurrentEl = document.getElementById('hpCurrent');
  const hpMaxEl = document.getElementById('hpMax');
  const hpBarFill = document.getElementById('hpBarFill');
  const hpTempEl = document.getElementById('hpTemp');
  const deathSavesEl = document.getElementById('hpDeathSaves');
  const deathSuccessEl = document.getElementById('hpDeathSuccess');
  const deathFailureEl = document.getElementById('hpDeathFailure');

  const curHp = Number(hero.hp) || 0;
  const maxHp = Number(hero.maxHp) || 10;
  const tempHp = Number(hero.tempHp) || 0;

  if (hpCurrentEl) hpCurrentEl.textContent = curHp;
  if (hpMaxEl) hpMaxEl.textContent = maxHp;
  if (hpTempEl) {
    if (tempHp > 0) {
      hpTempEl.textContent = `+${tempHp} врем.`;
      hpTempEl.hidden = false;
    } else {
      hpTempEl.hidden = true;
    }
  }

  if (deathSavesEl) {
    if (curHp === 0 && hero.deathSaves) {
      deathSavesEl.hidden = false;
      if (deathSuccessEl) deathSuccessEl.textContent = `✓ ${hero.deathSaves.successes || 0}`;
      if (deathFailureEl) deathFailureEl.textContent = `✕ ${hero.deathSaves.failures || 0}`;
    } else {
      deathSavesEl.hidden = true;
    }
  }

  if (hpBarFill) {
    const pct = Math.max(0, Math.min(100, Math.round((curHp / maxHp) * 100)));
    hpBarFill.style.width = `${pct}%`;
    hpBarFill.className = 'hp-bar-fill';
    if (pct <= 25) {
      hpBarFill.classList.add('danger');
    } else if (pct <= 50) {
      hpBarFill.classList.add('warning');
    }
  }

  // Combat badges
  const acEl = document.getElementById('statAc');
  const initEl = document.getElementById('statInit');
  const speedEl = document.getElementById('statSpeed');
  const hitDiceEl = document.getElementById('statHitDice');

  if (acEl) acEl.textContent = hero.ac || 10;
  if (speedEl) speedEl.textContent = `${hero.speed || 30} фт`;
  if (hitDiceEl) hitDiceEl.textContent = formatHitDice(hero.hitDice);

  // Initiative: hero.bonuses.dexterity or initiativeBonus
  const initBonus = hero.initiativeBonus !== undefined 
    ? hero.initiativeBonus 
    : (hero.bonuses?.dexterity !== undefined ? hero.bonuses.dexterity : calcModifier(hero.stats?.dex || 10));
  if (initEl) initEl.textContent = formatMod(initBonus);

  renderStatsGrid(hero);
  renderSkillsList(hero);

  // Features / Notes
  const featuresEl = document.getElementById('heroFeatures');
  if (featuresEl) {
    const notes = hero.notes || hero.features || hero.conditions || [];
    if (Array.isArray(notes) && notes.length > 0) {
      featuresEl.innerHTML = notes.map(n => `<div class="feature-item">◇ ${escapeHtml(typeof n === 'string' ? n : n.text || n.name)}</div>`).join('');
    } else if (typeof notes === 'string' && notes.trim()) {
      featuresEl.innerHTML = `<p>${escapeHtml(notes)}</p>`;
    } else {
      featuresEl.innerHTML = '<p class="empty-note">Особые эффекты отсутствуют.</p>';
    }
  }
}

function formatHitDice(hd) {
  if (!hd) return '1d8';
  if (typeof hd === 'object') {
    const cur = hd.current !== undefined ? hd.current : (hd.max || 1);
    const sz = hd.size || 8;
    return `${cur}d${sz}`;
  }
  return String(hd);
}

function calcModifier(score) {
  return Math.floor((Number(score) - 10) / 2);
}

function formatMod(mod) {
  const n = Number(mod) || 0;
  return n >= 0 ? `+${n}` : `${n}`;
}

const STAT_MAP = [
  { key: 'str', fullKey: 'strength', ru: 'СИЛА', abbr: 'СИЛ' },
  { key: 'dex', fullKey: 'dexterity', ru: 'ЛОВКОСТЬ', abbr: 'ЛОВ' },
  { key: 'con', fullKey: 'constitution', ru: 'ТЕЛОСЛОЖ.', abbr: 'ТЕЛ' },
  { key: 'int', fullKey: 'intelligence', ru: 'ИНТЕЛЛЕКТ', abbr: 'ИНТ' },
  { key: 'wis', fullKey: 'wisdom', ru: 'МУДРОСТЬ', abbr: 'МУД' },
  { key: 'cha', fullKey: 'charisma', ru: 'ХАРИЗМА', abbr: 'ХАР' }
];

function renderStatsGrid(hero) {
  const grid = document.getElementById('statsGrid');
  if (!grid) return;

  grid.innerHTML = STAT_MAP.map(item => {
    let mod = 0;
    if (hero.bonuses && hero.bonuses[item.fullKey] !== undefined) {
      mod = Number(hero.bonuses[item.fullKey]) || 0;
    } else if (hero.bonuses && hero.bonuses[item.key] !== undefined) {
      mod = Number(hero.bonuses[item.key]) || 0;
    } else if (hero.stats && hero.stats[item.key] !== undefined) {
      mod = calcModifier(hero.stats[item.key]);
    }

    let score = 10;
    if (hero.stats && hero.stats[item.key] !== undefined) {
      score = hero.stats[item.key];
    } else if (hero.scores && hero.scores[item.fullKey] !== undefined) {
      score = hero.scores[item.fullKey];
    } else {
      score = 10 + (mod * 2);
    }

    const saveBonus = hero.saves?.[item.fullKey] !== undefined ? hero.saves[item.fullKey] : mod;
    const hasProficientSave = saveBonus !== mod;

    return `
      <button type="button" class="stat-card-btn" data-stat="${item.key}" data-mod="${mod}" data-label="${item.ru}">
        <span class="stat-card-label">${item.abbr}</span>
        <span class="stat-card-mod">${formatMod(mod)}</span>
        <span class="stat-card-score">${score}${hasProficientSave ? `<small style="font-size:0.65rem;color:var(--text-muted);display:block;">Спас ${formatMod(saveBonus)}</small>` : ''}</span>
        <span class="stat-card-hint">Бросок d20 ↗</span>
      </button>
    `;
  }).join('');

  grid.querySelectorAll('.stat-card-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const mod = Number(btn.dataset.mod) || 0;
      const label = btn.dataset.label || 'Характеристика';
      executeRoll(20, mod, `Проверка: ${label}`);
    });
  });
}

function renderSkillsList(hero) {
  const list = document.getElementById('skillsList');
  if (!list) return;

  const standardSkills = [
    { key: 'athletics', name: 'Атлетика', stat: 'strength', abbr: 'сил' },
    { key: 'acrobatics', name: 'Акробатика', stat: 'dexterity', abbr: 'лов' },
    { key: 'sleightOfHand', name: 'Ловкость рук', stat: 'dexterity', abbr: 'лов' },
    { key: 'stealth', name: 'Скрытность', stat: 'dexterity', abbr: 'лов' },
    { key: 'arcana', name: 'Магия', stat: 'intelligence', abbr: 'инт' },
    { key: 'history', name: 'История', stat: 'intelligence', abbr: 'инт' },
    { key: 'investigation', name: 'Анализ (Расследование)', stat: 'intelligence', abbr: 'инт' },
    { key: 'nature', name: 'Природа', stat: 'intelligence', abbr: 'инт' },
    { key: 'religion', name: 'Религия', stat: 'intelligence', abbr: 'инт' },
    { key: 'animalHandling', name: 'Уход за животными', stat: 'wisdom', abbr: 'муд' },
    { key: 'insight', name: 'Проницательность', stat: 'wisdom', abbr: 'муд' },
    { key: 'medicine', name: 'Медицина', stat: 'wisdom', abbr: 'муд' },
    { key: 'perception', name: 'Внимательность', stat: 'wisdom', abbr: 'муд' },
    { key: 'survival', name: 'Выживание', stat: 'wisdom', abbr: 'муд' },
    { key: 'deception', name: 'Обман', stat: 'charisma', abbr: 'хар' },
    { key: 'intimidation', name: 'Запугивание', stat: 'charisma', abbr: 'хар' },
    { key: 'performance', name: 'Выступление', stat: 'charisma', abbr: 'хар' },
    { key: 'persuasion', name: 'Убеждение', stat: 'charisma', abbr: 'хар' }
  ];

  list.innerHTML = standardSkills.map(sk => {
    let bonus = 0;
    if (hero.bonuses && hero.bonuses[sk.key] !== undefined) {
      bonus = Number(hero.bonuses[sk.key]) || 0;
    } else if (hero.skills && hero.skills[sk.key] !== undefined) {
      bonus = Number(hero.skills[sk.key]) || 0;
    } else if (hero.bonuses && hero.bonuses[sk.stat] !== undefined) {
      bonus = Number(hero.bonuses[sk.stat]) || 0;
    } else if (hero.stats) {
      const shortStat = sk.stat === 'strength' ? 'str' : sk.stat === 'dexterity' ? 'dex' : sk.stat === 'constitution' ? 'con' : sk.stat === 'intelligence' ? 'int' : sk.stat === 'wisdom' ? 'wis' : 'cha';
      bonus = calcModifier(hero.stats[shortStat] || 10);
    }

    return `
      <button type="button" class="skill-row-btn" data-skill="${escapeHtml(sk.name)}" data-mod="${bonus}">
        <div class="skill-row-left">
          <span class="skill-name">${sk.name}</span>
          <span class="skill-stat-tag">${sk.abbr}</span>
        </div>
        <span class="skill-mod">${formatMod(bonus)}</span>
      </button>
    `;
  }).join('');

  list.querySelectorAll('.skill-row-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const mod = Number(btn.dataset.mod) || 0;
      const skillName = btn.dataset.skill || 'Навык';
      executeRoll(20, mod, `Навык: ${skillName}`);
    });
  });
}

// ----------------------------------------------------------------------------
// Map Controls & Zoom / Theme
// ----------------------------------------------------------------------------
function initMapControls() {
  const mapSelect = document.getElementById('mapSelect');
  const themeToggle = document.getElementById('mapThemeToggle');
  const zoomIn = document.getElementById('mapZoomIn');
  const zoomOut = document.getElementById('mapZoomOut');
  const resetZoom = document.getElementById('mapResetZoom');

  if (mapSelect) {
    mapSelect.addEventListener('change', () => {
      selectedMapId = mapSelect.value;
      renderMap();
    });
  }

  if (themeToggle) {
    themeToggle.classList.toggle('active', mapPixelTheme);
    themeToggle.textContent = mapPixelTheme ? '🎨 Пиксели ✓' : '🎨 Пиксели';
    themeToggle.addEventListener('click', () => {
      mapPixelTheme = !mapPixelTheme;
      localStorage.setItem('skazitel_map_pixel_theme', String(mapPixelTheme));
      themeToggle.classList.toggle('active', mapPixelTheme);
      themeToggle.textContent = mapPixelTheme ? '🎨 Пиксели ✓' : '🎨 Пиксели';
      renderMap();
      showToast(mapPixelTheme ? 'Включен пиксельный стиль (Stardew / 16-bit)!' : 'Включен классический тактический стиль');
    });
  }

  if (zoomIn) {
    zoomIn.addEventListener('click', () => {
      mapZoomLevel = Math.min(2.0, Number((mapZoomLevel + 0.2).toFixed(1)));
      applyMapZoom();
    });
  }
  if (zoomOut) {
    zoomOut.addEventListener('click', () => {
      mapZoomLevel = Math.max(0.6, Number((mapZoomLevel - 0.2).toFixed(1)));
      applyMapZoom();
    });
  }
  if (resetZoom) {
    resetZoom.addEventListener('click', () => {
      mapZoomLevel = 1.0;
      applyMapZoom();
      showToast('Масштаб сброшен');
    });
  }
}

function applyMapZoom() {
  const table = document.querySelector('.tactical-grid-table');
  if (table) {
    table.style.transform = `scale(${mapZoomLevel})`;
    table.style.transformOrigin = 'top center';
  }
}

// ----------------------------------------------------------------------------
// Dice Roller & Master Delivery
// ----------------------------------------------------------------------------
function initDiceControls() {
  // Advantage / Disadvantage Mode
  document.querySelectorAll('.mode-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.mode-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      rollMode = btn.dataset.mode || 'normal';
    });
  });

  // Dice buttons (clean physical/virtual rolls — modifiers and DC evaluated by the Master)
  document.querySelectorAll('.die-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const dieSides = Number(btn.dataset.die) || 20;
      executeRoll(dieSides, 0, `Бросок d${dieSides}`);
    });
  });
}

async function executeRoll(sides, modifier, title) {
  const hero = getActiveHero();
  const heroName = hero ? hero.name : 'Игрок';

  let d1 = Math.floor(Math.random() * sides) + 1;
  let d2 = null;
  let finalDie = d1;
  let modeNote = '';

  if (sides === 20) {
    if (rollMode === 'adv') {
      d2 = Math.floor(Math.random() * 20) + 1;
      finalDie = Math.max(d1, d2);
      modeNote = ` (преимущество: ${d1}, ${d2})`;
    } else if (rollMode === 'dis') {
      d2 = Math.floor(Math.random() * 20) + 1;
      finalDie = Math.min(d1, d2);
      modeNote = ` (помеха: ${d1}, ${d2})`;
    }
  }

  const total = finalDie + modifier;
  const isCrit = sides === 20 && finalDie === 20;
  const isFumble = sides === 20 && finalDie === 1;

  // Haptic feedback if supported on mobile
  if (window.navigator?.vibrate) {
    if (isCrit) window.navigator.vibrate([40, 30, 80]);
    else if (isFumble) window.navigator.vibrate([100]);
    else window.navigator.vibrate(30);
  }

  // Switch to Dice tab to show showcase
  switchToTab('dice');

  // Update Showcase
  const showcase = document.getElementById('rollShowcase');
  const totalEl = document.getElementById('rollTotalNumber');
  const breakdownEl = document.getElementById('rollBreakdownText');
  const critBanner = document.getElementById('critBanner');
  const fumbleBanner = document.getElementById('fumbleBanner');

  if (showcase) showcase.hidden = false;
  if (totalEl) totalEl.textContent = total;
  if (breakdownEl) {
    const modStr = modifier >= 0 ? `+${modifier}` : `${modifier}`;
    breakdownEl.textContent = `Кубик d${sides}: ${finalDie}${modifier !== 0 ? ' ' + modStr : ''}${modeNote}`;
  }
  if (critBanner) critBanner.hidden = !isCrit;
  if (fumbleBanner) fumbleBanner.hidden = !isFumble;

  addRecentRoll(heroName, title, total, sides === 20 ? finalDie : '', modifier, isCrit, isFumble);

  // Send Roll to Master Server
  try {
    await fetch(`/api/player/roll`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        campaignId: campaign?.id,
        characterId: hero?.id,
        characterName: heroName,
        title,
        total,
        d20: sides === 20 ? finalDie : '',
        modifier
      })
    });
    showToast(`🎲 Бросок ${total} отправлен Мастеру!`);
  } catch {
    showToast(`Бросок совершен (${total})`);
  }
}

function addRecentRoll(characterName, title, total, d20, modifier, isCrit, isFumble) {
  const item = {
    characterName,
    title,
    total,
    d20,
    modifier,
    isCrit,
    isFumble,
    time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
  };
  recentRolls.unshift(item);
  recentRolls = recentRolls.slice(0, 15);
  renderRecentRolls();
}

function renderRecentRolls() {
  const list = document.getElementById('recentRollsList');
  if (!list) return;

  if (recentRolls.length === 0) {
    list.innerHTML = '<p class="empty-note">Бросьте любой кубик, чтобы увидеть результат.</p>';
    return;
  }

  list.innerHTML = recentRolls.map(r => {
    const critClass = r.isCrit ? 'crit' : r.isFumble ? 'fumble' : '';
    const badge = r.isCrit ? '💥 20' : r.isFumble ? '💀 1' : '';
    return `
      <div class="roll-log-item ${critClass}">
        <div>
          <strong>${escapeHtml(r.characterName)}:</strong> ${escapeHtml(r.title)}
          <small style="color:var(--text-muted);margin-left:4px;">${r.time}</small>
        </div>
        <div>
          ${badge ? `<span style="margin-right:6px;font-weight:800;">${badge}</span>` : ''}
          <strong style="color:var(--accent-gold);font-size:1.1rem;">${r.total}</strong>
        </div>
      </div>
    `;
  }).join('');
}

// ----------------------------------------------------------------------------
// Inventory & Consumables
// ----------------------------------------------------------------------------
function getItemIcon(it) {
  if (!it) return '◈';
  const name = (it.name || '').toLowerCase();
  const cat = (it.category || '').toLowerCase();

  // Weapons & Attack
  if (/кинжал|нож|стилет|клинок/iu.test(name)) return '🗡️';
  if (/меч|палаш|рапира|сабля|шашка/iu.test(name)) return '⚔️';
  if (/лук|арбалет|болт|стрел/iu.test(name)) return '🏹';
  if (/топор|секира/iu.test(name)) return '🪓';
  if (/молот|булава|палица/iu.test(name)) return '🔨';
  if (/посох|жезл|палочк|скипетр/iu.test(name)) return '🪄';
  if (/копь[её]|пика|трезубец/iu.test(name)) return '🔱';
  if (/револьвер|пистоль|мушкет/iu.test(name)) return '🔫';
  if (cat === 'weapon') return '⚔️';

  // Armor & Defense
  if (/щит|баклер/iu.test(name)) return '🛡️';
  if (/шлем|каска/iu.test(name)) return '🪖';
  if (/сапог|ботинк|туфл/iu.test(name)) return '👢';
  if (/перчатк|рукавиц/iu.test(name)) return '🧤';
  if (/плащ|накидк/iu.test(name)) return '🧥';
  if (/кольчуг|доспех|кирас|панцирь|кожан/iu.test(name) || cat === 'armor') return '🦺';

  // Jewelry & Magic items
  if (/кольц|перстен/iu.test(name)) return '💍';
  if (/амулет|медальон|талисман|ожерел|подвеск/iu.test(name)) return '📿';

  // Potions & Drinks
  if (/зелье|эликсир|снадоб|настойк|бальзам|яд|флакон/iu.test(name) || cat === 'potion') return '🧪';
  if (/вод|вино|эль|пиво|фляг|бутыл/iu.test(name)) return '🍷';

  // Scrolls, Books, Maps
  if (/свиток|манускрипт/iu.test(name)) return '📜';
  if (/книг|гримуар|фолиант|дневник/iu.test(name)) return '📖';
  if (/карт|план|схем/iu.test(name)) return '🗺️';

  // Rations & Food
  if (/па[её]к|рацион|хлеб|сыр|мясо|яблок|еда|припас/iu.test(name) || cat === 'food') return '🍖';

  // Tools & Adventure Gear
  if (/факел|фонарь|свеч/iu.test(name)) return '🕯️';
  if (/вер[её]вк|канат|цепь/iu.test(name)) return '🪢';
  if (/крюк|кошк/iu.test(name)) return '🪝';
  if (/отмычк|воровск/iu.test(name)) return '🗝️';
  if (/ключ/iu.test(name)) return '🔑';
  if (/компас/iu.test(name)) return '🧭';
  if (/колокольчик/iu.test(name)) return '🔔';
  if (/перо|чернил/iu.test(name)) return '🪶';
  if (/набор|инструмент|молоток|клещ/iu.test(name) || cat === 'tool') return '⚒️';

  // Containers
  if (/рюкзак|ранец|мешок|сумк/iu.test(name) || cat === 'container') return '🎒';
  if (/сундук|шкатулк|лар/iu.test(name)) return '📦';

  // Treasure & Wealth
  if (/монет|золот|серебр|медяк|кошел/iu.test(name)) return '🪙';
  if (/самоцвет|алмаз|рубин|сапфир|изумруд|камень|жемчуг/iu.test(name) || cat === 'treasure') return '💎';
  if (/корон|тиар|диадем/iu.test(name)) return '👑';
  if (cat === 'quest') return '✦';

  return '◈';
}

function renderInventory() {
  const hero = getActiveHero();
  if (!hero || !campaign) return;

  // Wallet
  const walletEl = document.getElementById('playerWallet');
  if (walletEl) {
    const wallet = campaign.wallet || {};
    const cp = wallet.group || 0;
    const gp = Math.floor(cp / 100);
    const sp = Math.floor((cp % 100) / 10);
    const leftCp = cp % 10;
    walletEl.textContent = `${gp} зм, ${sp} см, ${leftCp} мм`;
  }

  // Consumables Quick Bar
  const consumablesList = document.getElementById('consumablesList');
  const inventoryList = document.getElementById('playerInventoryList');
  const items = campaign.inventory || [];

  const potions = items.filter(it => it.category === 'potion' || /зелье|припас|еда|эликсир/iu.test(it.name));

  if (consumablesList) {
    if (potions.length === 0) {
      consumablesList.innerHTML = '<p class="empty-note">Нет готовых зелий или припасов.</p>';
    } else {
      consumablesList.innerHTML = potions.map(it => {
        const icon = getItemIcon(it);
        return `
          <div class="consumable-item">
            <div class="consumable-left">
              <span class="item-icon-badge">${icon}</span>
              <div class="item-text-info">
                <strong>${escapeHtml(it.name)}</strong>
                <span class="inv-qty">×${it.quantity || 1}</span>
              </div>
            </div>
            <button type="button" class="consumable-btn" data-id="${it.id}" data-name="${escapeHtml(it.name)}">
              Использовать
            </button>
          </div>
        `;
      }).join('');

      consumablesList.querySelectorAll('.consumable-btn').forEach(btn => {
        btn.addEventListener('click', async () => {
          const itemId = btn.dataset.id;
          const itemName = btn.dataset.name;
          try {
            const res = await fetch(`/api/player/action`, {
              method: 'POST',
              headers,
              body: JSON.stringify({
                campaignId: campaign.id,
                characterId: hero.id,
                action: 'item',
                itemId,
                itemName
              })
            });
            if (!res.ok) throw new Error();
            const data = await res.json();
            showToast(`Использовано: ${itemName}`);
            await refreshCampaignState();
          } catch {
            showToast('Не удалось использовать предмет');
          }
        });
      });
    }
  }

  // Full items list
  if (inventoryList) {
    if (items.length === 0) {
      inventoryList.innerHTML = '<p class="empty-note">Инвентарь отряда пуст.</p>';
    } else {
      inventoryList.innerHTML = items.map(it => {
        const icon = getItemIcon(it);
        const isEquipped = it.carrierId === hero.id && it.equipped;
        return `
          <div class="inv-row ${isEquipped ? 'equipped' : ''}">
            <div class="inv-row-top">
              <div class="inv-row-left">
                <span class="item-icon-badge">${icon}</span>
                <span class="inv-item-name">${escapeHtml(it.name)}</span>
                ${isEquipped ? '<span class="inv-equipped-tag">Надето</span>' : ''}
              </div>
              <span class="inv-qty">×${it.quantity || 1}</span>
            </div>
            ${it.description ? `<p class="inv-desc">${escapeHtml(it.description)}</p>` : ''}
          </div>
        `;
      }).join('');
    }
  }
}

// ----------------------------------------------------------------------------
// Tactical & Regional Map
// ----------------------------------------------------------------------------
function renderMap() {
  const renderArea = document.getElementById('mapRenderArea');
  const mapSelect = document.getElementById('mapSelect');
  const scaleInfo = document.getElementById('mapScaleInfo');
  const legendEl = document.getElementById('mapLegend');
  const inspector = document.getElementById('mapCellInspector');
  if (!renderArea || !campaign) return;

  const maps = campaign.maps || [];
  if (maps.length === 0) {
    renderArea.innerHTML = '<p class="empty-note">Карта местности пока не развёрнута Мастером.<br><small style="color:var(--text-muted);margin-top:6px;display:block;">Мастер может начертить тактическую сетку или карту региона на экране стола.</small></p>';
    if (scaleInfo) scaleInfo.textContent = 'Нет активных карт';
    if (legendEl) legendEl.innerHTML = '';
    if (mapSelect) mapSelect.innerHTML = '<option value="">Нет карт</option>';
    return;
  }

  // Populate map dropdown
  if (mapSelect) {
    const currentId = selectedMapId && maps.some(m => m.id === selectedMapId) ? selectedMapId : maps[0].id;
    selectedMapId = currentId;
    mapSelect.innerHTML = maps.map(m => {
      const isWorld = (m.feetPerCell >= 500) || /мир|регион|тракт|королевств|земл/iu.test(m.name);
      const icon = isWorld ? '🌍' : '⚔️';
      return `<option value="${m.id}" ${m.id === currentId ? 'selected' : ''}>${icon} ${escapeHtml(m.name)} (${m.width}×${m.height})</option>`;
    }).join('');
  }

  const activeMap = maps.find(m => m.id === selectedMapId) || maps[0];
  const isWorld = (activeMap.feetPerCell >= 500) || /мир|регион|тракт|королевств|земл/iu.test(activeMap.name);
  const scaleText = isWorld 
    ? (activeMap.feetPerCell >= 5000 ? `1 кл = ${(activeMap.feetPerCell / 5280).toFixed(1)} мили (~1 лига)` : `1 кл = ${activeMap.feetPerCell} фт`)
    : `1 кл = ${activeMap.feetPerCell || 5} фт`;

  if (scaleInfo) {
    scaleInfo.innerHTML = `<strong>${isWorld ? '🌍 Карта региона' : '⚔️ Тактическая схема'}:</strong> ${escapeHtml(activeMap.name)} · <span>${activeMap.width}×${activeMap.height}</span> · <span>${scaleText}</span>`;
  }

  const width = activeMap.width || 12;
  const height = activeMap.height || 12;
  const tokens = activeMap.tokens || [];

  const colLabels = Array.from({ length: width }, (_, i) => String.fromCharCode(65 + (i % 26)) + (i >= 26 ? Math.floor(i / 26) : ''));

  // Build grid HTML
  let html = `<div class="tactical-grid-wrapper ${mapPixelTheme ? 'pixel-theme' : ''}">`;

  // Check if there is an artistic illustration banner
  const mapImage = (campaign.images || []).filter(i => i.status === 'ready' && (i.kind === 'scene' || i.kind === 'map') && /карт|картограф|map|overworld|регион/iu.test(i.prompt || '')).slice(-1)[0];
  if (mapImage && mapImage.file) {
    html += `
      <div class="map-illustration-banner">
        <img src="/images/${mapImage.file}" alt="Карта сцены" class="map-banner-img">
        <div class="map-banner-badge">🎨 Иллюстрация окружения</div>
      </div>
    `;
  }

  html += `<table class="tactical-grid-table"><thead><tr><th class="tactical-coord-header corner"></th>`;
  for (let x = 0; x < width; x++) {
    html += `<th class="tactical-coord-header col-header">${colLabels[x]}</th>`;
  }
  html += `</tr></thead><tbody>`;

  for (let y = 0; y < height; y++) {
    html += `<tr><th class="tactical-coord-header row-header">${y + 1}</th>`;
    for (let x = 0; x < width; x++) {
      const cellTokens = tokens.filter(t => t.x === x && t.y === y);
      const coordLabel = `${colLabels[x]}${y + 1}`;

      if (cellTokens.length > 0) {
        const topToken = cellTokens[0];
        const kind = topToken.kind || 'object';
        const icon = getTokenIcon(topToken);
        const tokenLabel = topToken.label || topToken.id || 'Маркер';
        const countBadge = cellTokens.length > 1 ? `<span class="cell-multi-badge">${cellTokens.length}</span>` : '';

        html += `
          <td class="tactical-grid-cell has-token token-${kind}" 
              data-coord="${coordLabel}" 
              data-tokens="${escapeHtml(JSON.stringify(cellTokens))}"
              title="${coordLabel}: ${escapeHtml(tokenLabel)}">
            <span class="token-icon">${icon}</span>
            ${countBadge}
          </td>
        `;
      } else {
        html += `<td class="tactical-grid-cell empty-cell" data-coord="${coordLabel}">·</td>`;
      }
    }
    html += `</tr>`;
  }

  html += `</tbody></table></div>`;

  if (activeMap.description) {
    html += `<p class="map-card-desc">📜 ${escapeHtml(activeMap.description)}</p>`;
  }

  renderArea.innerHTML = html;
  applyMapZoom();

  // Cell click inspection
  renderArea.querySelectorAll('.tactical-grid-cell').forEach(cell => {
    cell.addEventListener('click', () => {
      renderArea.querySelectorAll('.tactical-grid-cell.selected-cell').forEach(c => c.classList.remove('selected-cell'));
      cell.classList.add('selected-cell');

      const coord = cell.dataset.coord;
      const tokensData = cell.dataset.tokens ? JSON.parse(cell.dataset.tokens) : [];
      const detailEl = document.getElementById('mapCellDetail');

      if (inspector) inspector.hidden = false;
      if (detailEl) {
        if (tokensData.length > 0) {
          detailEl.innerHTML = `
            <div class="cell-inspect-head">
              <strong>Клетка ${coord}</strong>: ${tokensData.length === 1 ? '1 объект' : tokensData.length + ' объекта(-ов)'}
            </div>
            <div class="cell-inspect-tokens">
              ${tokensData.map(t => `
                <div class="inspect-token-pill ${t.kind || 'object'}">
                  <span>${getTokenIcon(t)}</span>
                  <strong>${escapeHtml(t.label || t.id)}</strong>
                  <small>(${t.kind === 'hero' ? 'Герой' : t.kind === 'enemy' ? 'Враг / Опасность' : 'Ориентир / Местность'})</small>
                </div>
              `).join('')}
            </div>
          `;
        } else {
          detailEl.innerHTML = `<span style="color:var(--text-muted);">Клетка <strong>${coord}</strong>: свободное пространство (${scaleText}).</span>`;
        }
      }
    });
  });

  // Token Legend
  if (legendEl) {
    const heroesCount = tokens.filter(t => t.kind === 'hero').length;
    const enemiesCount = tokens.filter(t => t.kind === 'enemy').length;
    const objectsCount = tokens.filter(t => t.kind !== 'hero' && t.kind !== 'enemy').length;

    legendEl.innerHTML = `
      <div class="legend-badges-row">
        <span class="legend-badge hero">🛡️ Отряд: ${heroesCount}</span>
        ${enemiesCount > 0 ? `<span class="legend-badge enemy">💀 Враги / Опасности: ${enemiesCount}</span>` : ''}
        <span class="legend-badge object">◇ Ориентиры: ${objectsCount}</span>
      </div>
    `;
  }
}

function getTokenIcon(token) {
  if (!token) return '◇';
  const kind = token.kind || 'object';
  const label = (token.label || token.id || '').toLowerCase();

  if (kind === 'hero') {
    if (/(?:плут|вор|разбой|следопыт|ловк|роуг|rogue|стрелок)/iu.test(label)) return '🗡️';
    if (/(?:жрец|клирик|паладин|храмов|священ|альвари|cleric|paladin)/iu.test(label)) return '🛡️';
    if (/(?:воин|боец|рыцар|солдат|варвар|теон|fighter|warrior|barbarian)/iu.test(label)) return '⚔️';
    if (/(?:маг|чародей|колдун|волшебн|иллюз|wizard|sorcerer|mage|warlock)/iu.test(label)) return '🧙';
    if (/(?:лучник|рейнджер|archer|ranger)/iu.test(label)) return '🏹';
    if (/(?:бард|певец|bard)/iu.test(label)) return '🪕';
    if (/(?:друид|шаман|druid)/iu.test(label)) return '🌿';
    if (/(?:монах|monk)/iu.test(label)) return '🥋';
    if (/(?:отряд|партия|лагерь|стоянка)/iu.test(label)) return '🏕️';
    return '🛡️';
  }

  if (kind === 'enemy') {
    if (/(?:волк|пес|собак|зверь|гонч|wolf|hound|beast)/iu.test(label)) return '🐺';
    if (/(?:скелет|нежить|зомби|мертв|упырь|гуль|ghoul|skeleton|zombie|undead)/iu.test(label)) return '💀';
    if (/(?:гоблин|орк|кобольд|тролль|огр|демон|бес|goblin|orc|kobold|demon|devil|fiend)/iu.test(label)) return '👹';
    if (/(?:паук|паучи|spider)/iu.test(label)) return '🕷️';
    if (/(?:дракон|виверн|змий|dragon|wyvern)/iu.test(label)) return '🐉';
    if (/(?:культист|бандит|наемник|граби|разбой|bandit|thug|cultist)/iu.test(label)) return '🗡️';
    if (/(?:призрак|дух|тень|фантом|ghost|specter|shadow|wraith)/iu.test(label)) return '👻';
    if (/(?:босс|главарь|вождь|капитан|boss|король)/iu.test(label)) return '👑';
    if (/(?:логово|катакомб|руины|лабиринт|пещера)/iu.test(label)) return '🕳️';
    return '💀';
  }

  // Objects & World Landmarks
  if (/(?:город|столиц|крепост|замок|castle|town|city)/iu.test(label)) return '🏰';
  if (/(?:башн|руин|tower)/iu.test(label)) return '🗼';
  if (/(?:деревн|поселени|хутор|селение|village)/iu.test(label)) return '🏘️';
  if (/(?:таверн|трактир|постоял|питейная|inn|tavern)/iu.test(label)) return '🍺';
  if (/(?:лагерь|палатк|костер|кострищ|camp|fire)/iu.test(label)) return '🔥';
  if (/(?:тракт|дорог|троп|путь|перекресток|мост|road|bridge)/iu.test(label)) return '🛤️';
  if (/(?:лес|пущ|чащ|дубрав|дерев|forest|woods)/iu.test(label)) return '🌲';
  if (/(?:гора|кряж|перевал|пик|скал|хребет|mountain)/iu.test(label)) return '⛰️';
  if (/(?:река|озер|вод|переправ|ручей|river|lake)/iu.test(label)) return '🌊';
  if (/(?:сундук|ларь|ящик|бочка|трофей|chest|crate|barrel|box)/iu.test(label)) return '📦';
  if (/(?:дверь|ворота|проход|решетка|люк|door|gate|hatch)/iu.test(label)) return '🚪';
  if (/(?:ловушка|растяжка|нажим|trap)/iu.test(label)) return '⚠️';
  if (/(?:алтарь|статуя|монумент|altar|statue)/iu.test(label)) return '🗿';
  if (/(?:фонтан|колодец|well|fountain)/iu.test(label)) return '⛲';
  if (/(?:колонна|стена|завал|столб|pillar|column|wall)/iu.test(label)) return '🏛️';
  if (/(?:стол|стул|бар|стойка|table|chair)/iu.test(label)) return '🪑';

  return '◇';
}

// ----------------------------------------------------------------------------
// Utilities
// ----------------------------------------------------------------------------
function showToast(text) {
  if (!playerToast) return;
  playerToast.textContent = text;
  playerToast.hidden = false;
  clearTimeout(playerToast._timer);
  playerToast._timer = setTimeout(() => {
    playerToast.hidden = true;
  }, 2400);
}

function escapeHtml(str) {
  return String(str || '').replace(/[&<>"']/g, m => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;'
  })[m]);
}

// ----------------------------------------------------------------------------
// Push-to-Talk (PTT) Mobile Voice Companion
// ----------------------------------------------------------------------------
let pttRecording = null;
let pttRecordHeld = false;
let pttBusy = false;

function initPttControls() {
  const pttBtn = document.getElementById('playerPttBtn');
  const toggleBtn = document.getElementById('pttTextToggleBtn');
  const sendTextBtn = document.getElementById('pttSendTextBtn');
  const textInput = document.getElementById('pttTextInput');
  const textRow = document.getElementById('pttTextInputRow');

  if (pttBtn) {
    pttBtn.addEventListener('pointerdown', e => {
      e.preventDefault();
      try { pttBtn.setPointerCapture(e.pointerId); } catch {}
      startPttRecording();
    });
    pttBtn.addEventListener('pointerup', e => {
      e.preventDefault();
      stopPttRecording();
    });
    pttBtn.addEventListener('pointercancel', e => {
      e.preventDefault();
      stopPttRecording();
    });
    pttBtn.addEventListener('keydown', e => {
      if ((e.code === 'Space' || e.key === 'Enter') && !e.repeat && !pttRecording) {
        e.preventDefault();
        startPttRecording();
      }
    });
    pttBtn.addEventListener('keyup', e => {
      if ((e.code === 'Space' || e.key === 'Enter') && pttRecording) {
        e.preventDefault();
        stopPttRecording();
      }
    });
  }

  if (toggleBtn && textRow) {
    toggleBtn.addEventListener('click', () => {
      const willShow = textRow.hidden;
      textRow.hidden = !willShow;
      if (willShow && textInput) {
        textInput.focus();
      }
    });
  }

  if (sendTextBtn) {
    sendTextBtn.addEventListener('click', () => {
      sendPttTextAction();
    });
  }

  if (textInput) {
    textInput.addEventListener('keydown', e => {
      if (e.key === 'Enter') {
        e.preventDefault();
        sendPttTextAction();
      }
    });
  }
}

function updatePttHero() {
  const hero = getActiveHero();
  const name = hero ? hero.name : '—';
  const badge = document.getElementById('pttHeroBadgeName');
  const btnText = document.getElementById('pttBtnText');
  const status = document.getElementById('pttStatusText');
  const textInput = document.getElementById('pttTextInput');
  if (badge) badge.textContent = name;
  if (btnText && !pttRecording && !pttBusy) {
    btnText.textContent = hero ? `Говорить от лица: ${name}` : 'Удерживайте для хода';
  }
  if (status && !pttRecording && !pttBusy) {
    status.textContent = 'Зажмите кнопку для хода';
  }
  if (textInput) {
    textInput.placeholder = `Действие от лица ${name}...`;
  }
}

function wav(chunks, sampleRate) {
  const n = chunks.reduce((a, c) => a + c.length, 0);
  const buffer = new ArrayBuffer(44 + n * 2);
  const v = new DataView(buffer);
  const str = (o, s) => { for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)); };
  str(0, 'RIFF');
  v.setUint32(4, 36 + n * 2, true);
  str(8, 'WAVE');
  str(12, 'fmt ');
  v.setUint32(16, 16, true);
  v.setUint16(20, 1, true);
  v.setUint16(22, 1, true);
  v.setUint32(24, sampleRate, true);
  v.setUint32(28, sampleRate * 2, true);
  v.setUint16(32, 2, true);
  v.setUint16(34, 16, true);
  str(36, 'data');
  v.setUint32(40, n * 2, true);
  let offset = 44;
  for (const c of chunks) {
    for (const s of c) {
      v.setInt16(offset, Math.max(-1, Math.min(1, s)) * (s < 0 ? 32768 : 32767), true);
      offset += 2;
    }
  }
  return new Uint8Array(buffer);
}

async function startPttRecording() {
  if (pttBusy || pttRecording) return;
  const hero = getActiveHero();
  if (!hero) {
    showToast('Сначала выберите героя');
    return;
  }
  pttRecordHeld = true;
  let stream = null, ctx = null;
  try {
    if (!navigator.mediaDevices?.getUserMedia) {
      throw new Error('Микрофон недоступен. Откройте в Safari или Chrome.');
    }
    stream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      video: false
    });
    if (!pttRecordHeld) {
      stream.getTracks().forEach(t => t.stop());
      return;
    }
    ctx = new AudioContext();
    await ctx.resume();
    const source = ctx.createMediaStreamSource(stream);
    const processor = ctx.createScriptProcessor(4096, 1, 1);
    const gain = ctx.createGain();
    gain.gain.value = 0;
    const chunks = [];
    processor.onaudioprocess = e => {
      chunks.push(new Float32Array(e.inputBuffer.getChannelData(0)));
    };
    source.connect(processor);
    processor.connect(gain);
    gain.connect(ctx.destination);

    pttRecording = {
      stream, ctx, source, processor, gain, chunks,
      rate: ctx.sampleRate,
      hero,
      startedAt: performance.now()
    };

    const pttBtn = document.getElementById('playerPttBtn');
    const pttIcon = document.getElementById('pttBtnIcon');
    const pttText = document.getElementById('pttBtnText');
    const pttStatus = document.getElementById('pttStatusText');

    if (pttBtn) pttBtn.classList.add('recording');
    if (pttIcon) pttIcon.textContent = '🔴';
    if (pttText) pttText.textContent = `Говорите за ${hero.name}...`;
    if (pttStatus) pttStatus.textContent = 'Идёт запись... отпустите для отправки';

    if (navigator.vibrate) navigator.vibrate(40);
  } catch (e) {
    stream?.getTracks().forEach(t => t.stop());
    if (ctx) await ctx.close().catch(() => {});
    pttRecordHeld = false;
    showToast(e.name === 'NotAllowedError' ? 'Разрешите доступ к микрофону в настройках браузера' : (e.message || 'Ошибка микрофона'));
  }
}

async function stopPttRecording() {
  pttRecordHeld = false;
  if (!pttRecording) return;
  const r = pttRecording;
  pttRecording = null;
  r.processor.disconnect();
  r.source.disconnect();
  r.gain.disconnect();
  r.stream.getTracks().forEach(t => t.stop());
  await r.ctx.close().catch(() => {});

  const pttBtn = document.getElementById('playerPttBtn');
  const pttIcon = document.getElementById('pttBtnIcon');
  const pttText = document.getElementById('pttBtnText');
  const pttStatus = document.getElementById('pttStatusText');

  if (pttBtn) pttBtn.classList.remove('recording');

  const totalSamples = r.chunks.reduce((sum, c) => sum + c.length, 0);
  if (totalSamples < r.rate * 0.25) {
    updatePttHero();
    showToast('Удерживайте кнопку и говорите фразу');
    return;
  }

  pttBusy = true;
  if (pttBtn) pttBtn.classList.add('busy');
  if (pttIcon) pttIcon.textContent = '⏳';
  if (pttText) pttText.textContent = 'Обработка Мастером...';
  if (pttStatus) pttStatus.textContent = `Передаём ход Мастеру за ${r.hero.name}...`;

  try {
    const bytes = wav(r.chunks, r.rate);
    let binary = '';
    for (let i = 0; i < bytes.length; i += 8192) {
      binary += String.fromCharCode(...bytes.subarray(i, i + 8192));
    }
    const res = await fetch('/api/player/ptt', {
      method: 'POST',
      headers,
      body: JSON.stringify({
        campaignId: campaign?.id,
        characterId: r.hero.id,
        audio: btoa(binary),
        mime: 'audio/wav'
      })
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || 'Ошибка отправки хода');
    }
    const data = await res.json();
    showToast(`✨ ${r.hero.name}: «${data.text}» отправлено!`);
    if (navigator.vibrate) navigator.vibrate([30, 50, 30]);
    await refreshCampaignState();
  } catch (e) {
    showToast(e.message || 'Не удалось передать ход');
  } finally {
    pttBusy = false;
    if (pttBtn) pttBtn.classList.remove('busy');
    if (pttIcon) pttIcon.textContent = '🎙️';
    updatePttHero();
  }
}

async function sendPttTextAction() {
  const input = document.getElementById('pttTextInput');
  const text = input?.value?.trim();
  if (!text) return;
  const hero = getActiveHero();
  if (!hero) {
    showToast('Сначала выберите героя');
    return;
  }
  pttBusy = true;
  const pttBtn = document.getElementById('playerPttBtn');
  if (pttBtn) pttBtn.classList.add('busy');
  showToast(`Отправляем ход за ${hero.name}...`);
  try {
    const res = await fetch('/api/player/turn', {
      method: 'POST',
      headers,
      body: JSON.stringify({
        campaignId: campaign?.id,
        characterId: hero.id,
        text
      })
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || 'Ошибка отправки');
    }
    const data = await res.json();
    input.value = '';
    showToast(`✨ ${hero.name}: «${text}» отправлено!`);
    await refreshCampaignState();
  } catch (e) {
    showToast(e.message || 'Не удалось передать ход');
  } finally {
    pttBusy = false;
    if (pttBtn) pttBtn.classList.remove('busy');
    updatePttHero();
  }
}
