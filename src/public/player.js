import { playSfx } from '/sfx.mjs';

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
let isWhisperMode = false;

// DOM Elements
const connStatus = document.getElementById('connStatus');
const connLabel = document.getElementById('connLabel');
const campaignSelect = document.getElementById('campaignSelect');
const heroSelect = document.getElementById('heroSelect');
const playerToast = document.getElementById('playerToast');

function showPrivateReply(narration) {
  const dialog = document.createElement('dialog');
  const title = document.createElement('h2');
  const message = document.createElement('p');
  const close = document.createElement('button');
  title.textContent = 'Ответ мастера на шёпот';
  message.textContent = narration;
  close.type = 'button';
  close.textContent = 'Закрыть';
  close.addEventListener('click', () => dialog.close());
  dialog.addEventListener('close', () => dialog.remove(), {once: true});
  dialog.append(title, message, close);
  document.body.append(dialog);
  dialog.showModal();
}

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
initRestControls();
loadInitialState();
connectSSE();

// ----------------------------------------------------------------------------
// Navigation Tabs
// ----------------------------------------------------------------------------
function initTabs() {
  tabButtons.forEach(btn => {
    const panel = panels[btn.dataset.tab];
    btn.id = `tab-${btn.dataset.tab}`;
    btn.setAttribute('aria-controls', panel.id);
    btn.tabIndex = btn.classList.contains('active') ? 0 : -1;
    panel.setAttribute('aria-labelledby', btn.id);
    btn.addEventListener('click', () => {
      const tabName = btn.dataset.tab;
      tabButtons.forEach(b => {
        b.classList.remove('active');
        b.setAttribute('aria-selected', 'false');
        b.tabIndex = -1;
      });
      btn.classList.add('active');
      btn.setAttribute('aria-selected', 'true');
      btn.tabIndex = 0;

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
    btn.addEventListener('keydown', e => {
      const buttons = Array.from(tabButtons);
      const i = buttons.indexOf(btn);
      let next;
      if (e.key === 'ArrowRight') next = (i + 1) % buttons.length;
      else if (e.key === 'ArrowLeft') next = (i + buttons.length - 1) % buttons.length;
      else if (e.key === 'Home') next = 0;
      else if (e.key === 'End') next = buttons.length - 1;
      else return;
      e.preventDefault(); buttons[next].click(); buttons[next].focus();
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
function checkHttpsPromo(httpsPort) {
  const banner = document.getElementById('httpsPromoBanner');
  const promoLink = document.getElementById('switchToHttpsLink');
  const closeBtn = document.getElementById('closeHttpsBannerBtn');
  if (!banner || !promoLink) return;

  if (window.location.protocol === 'https:' || !httpsPort) {
    banner.hidden = true;
    return;
  }

  if (sessionStorage.getItem('skazitel_dismiss_https_promo') === '1') {
    banner.hidden = true;
    return;
  }

  const hostname = window.location.hostname || '127.0.0.1';
  const targetHttpsUrl = `https://${hostname}:${httpsPort}${window.location.pathname}${window.location.search}`;
  promoLink.href = targetHttpsUrl;
  banner.hidden = false;

  closeBtn?.addEventListener('click', () => {
    banner.hidden = true;
    sessionStorage.setItem('skazitel_dismiss_https_promo', '1');
  }, { once: true });
}

async function loadInitialState() {
  try {
    const query = new URLSearchParams();
    if (selectedCampaignId) query.set('id', selectedCampaignId);
    if (selectedHeroId) query.set('heroId', selectedHeroId);
    const url = `/api/player/state` + (query.toString() ? `?${query.toString()}` : '');
    const res = await fetch(url, { headers });
    if (!res.ok) {
      if (res.status === 403) {
        setConnectionState('offline', 'ОБНОВИТЕ СТРАНИЦУ');
        showToast('Сессия стола изменилась. Отсканируйте актуальный QR-код на компьютере');
        return;
      }
      throw new Error('Ошибка связи с сервером');
    }
    const data = await res.json();
    if (data.httpsPort) {
      checkHttpsPromo(data.httpsPort);
    }
    if (data.campaign) {
      campaign = data.campaign;
      selectedCampaignId = campaign.id;
      allCampaigns = data.campaigns || [];
      renderCampaignSelect();
      renderHeroSelect();
      renderActiveHero();
      renderInventory();
      renderMap();
      renderCombatBanner();
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

  eventSource.addEventListener('combat-update', async (e) => {
    try {
      const data = JSON.parse(e.data);
      if (campaign && data.campaignId === campaign.id) {
        campaign.initiative = data.initiative;
        renderCombatBanner();
        const activeHero = getActiveHero();
        const currentCombatant = (data.initiative?.order || [])[data.initiative?.turnIndex || 0];
        if (currentCombatant && activeHero && (
          currentCombatant.id === activeHero.id ||
          currentCombatant.name?.toLowerCase() === activeHero.name?.toLowerCase()
        )) {
          showToast('⚔️ ТВОЙ ХОД в бою!');
          if (navigator.vibrate) navigator.vibrate([100, 50, 100]);
        }
      }
    } catch {}
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

// Mobile lifecycle: reconnect immediately when phone wakes from sleep or tab becomes visible
document.addEventListener('visibilitychange', () => {
  if (!document.hidden) {
    refreshCampaignState();
    if (!eventSource || eventSource.readyState === EventSource.CLOSED) {
      connectSSE();
    }
  }
});
window.addEventListener('online', () => {
  connectSSE();
  refreshCampaignState();
});

async function refreshCampaignState(targetCampaignId = null) {
  try {
    const idToFetch = targetCampaignId || selectedCampaignId;
    const query = new URLSearchParams();
    if (idToFetch) query.set('id', idToFetch);
    if (selectedHeroId) query.set('heroId', selectedHeroId);
    const url = `/api/player/state` + (query.toString() ? `?${query.toString()}` : '');
    const res = await fetch(url, { headers });
    if (!res.ok) {
      if (res.status === 403) {
        setConnectionState('offline', 'ОБНОВИТЕ СТРАНИЦУ');
        showToast('Сессия стола изменилась. Отсканируйте актуальный QR-код на компьютере');
      }
      return;
    }
    const data = await res.json();
    if (data.httpsPort) {
      checkHttpsPromo(data.httpsPort);
    }
    if (data.campaign) {
      const prevPendingId = campaign?.pending?.id;
      campaign = data.campaign;
      selectedCampaignId = campaign.id;
      localStorage.setItem('skazitel_player_campaign', selectedCampaignId);
      allCampaigns = data.campaigns || [];
      renderCampaignSelect();
      renderHeroSelect();
      renderActiveHero();
      renderInventory();
      renderMap();
      renderCombatBanner();

      if (campaign?.pending && campaign.pending.id !== prevPendingId && campaign.pending.characterId === getActiveHero()?.id) {
        showToast('🎲 Мастер ожидает ваш бросок d20!');
        if (navigator.vibrate) navigator.vibrate([60, 40, 60]);
      }
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
  renderPendingRoll();
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
    } else if (hero.portraitUrl || hero.avatar) {
      heroPortraitEl.innerHTML = `<img class="hero-portrait-img" src="${escapeHtml(hero.portraitUrl || hero.avatar)}" alt="${escapeHtml(hero.name)}">`;
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
  renderSpellSlots(hero);
  renderCombatBanner();

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

function renderSpellSlots(hero) {
  const list = document.getElementById('spellSlotsList');
  if (!list) return;
  const res = hero.resources || [];
  if (res.length === 0) {
    list.innerHTML = '<p class="empty-note">У героя нет активных ячеек или классовых способностей.</p>';
    return;
  }

  list.innerHTML = res.map(r => {
    const current = r.current !== undefined ? r.current : r.max;
    const max = r.max || 1;
    let pipsHtml = '';
    for (let i = 0; i < max; i++) {
      const isExpended = i >= current;
      pipsHtml += `<span class="slot-pip ${isExpended ? 'expended' : ''}" data-resource-id="${escapeHtml(r.id)}" data-index="${i}" title="${escapeHtml(r.name)}: ${current}/${max}"></span>`;
    }
    return `
      <div class="slot-row">
        <div class="slot-info">
          <span class="slot-name">${escapeHtml(r.name)}</span>
          <small style="color:var(--text-muted);font-size:0.75rem;">(${current}/${max})</small>
        </div>
        <div class="slot-pips">
          ${pipsHtml}
        </div>
      </div>
    `;
  }).join('');

  list.querySelectorAll('.slot-pip').forEach(pip => {
    pip.addEventListener('click', async (e) => {
      e.stopPropagation();
      const resId = pip.dataset.resourceId;
      const targetRes = res.find(r => r.id === resId);
      if (!targetRes) return;
      const isExpended = pip.classList.contains('expended');
      
      try {
        const response = await fetch('/api/player/resource', {
          method: 'POST',
          headers,
          body: JSON.stringify({
            campaignId: campaign?.id,
            characterId: hero.id,
            resourceId: resId,
            action: isExpended ? 'recover' : 'use',
            amount: 1
          })
        });
        const result = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(result.error || 'Ошибка обновления ресурса');
        targetRes.current = result.resource.current;
        playSfx('magic');
        renderSpellSlots(hero);
        showToast(`${targetRes.name}: ${targetRes.current}/${targetRes.max}`);
      } catch (err) {
        showToast(err.message || 'Ошибка обновления ресурса');
      }
    });
  });
}

function initRestControls() {
  const shortBtn = document.getElementById('shortRestBtn');
  const longBtn = document.getElementById('longRestBtn');

  if (shortBtn) {
    shortBtn.addEventListener('click', async () => {
      const hero = getActiveHero();
      if (!hero) return;
      playSfx('rest');
      showToast('☕ Короткий отдых: восстанавливаем силы...');
      try {
        const res = await fetch('/api/player/rest', {
          method: 'POST',
          headers,
          body: JSON.stringify({
            campaignId: campaign?.id,
            characterId: hero.id,
            kind: 'short'
          })
        });
        if (!res.ok) throw new Error('Ошибка отдыха');
        showToast('☕ Короткий отдых завершён!');
        await refreshCampaignState();
      } catch (e) {
        showToast(e.message);
      }
    });
  }

  if (longBtn) {
    longBtn.addEventListener('click', async () => {
      const hero = getActiveHero();
      if (!hero) return;
      playSfx('rest');
      showToast('🌙 Долгий отдых: полный покой...');
      try {
        const res = await fetch('/api/player/rest', {
          method: 'POST',
          headers,
          body: JSON.stringify({
            campaignId: campaign?.id,
            characterId: hero.id,
            kind: 'long'
          })
        });
        if (!res.ok) throw new Error('Ошибка отдыха');
        showToast('🌙 Долгий отдых: здоровье и ячейки восстановлены!');
        await refreshCampaignState();
      } catch (e) {
        showToast(e.message);
      }
    });
  }
}

function renderCombatBanner() {
  const banner = document.getElementById('playerCombatBanner');
  if (!banner) return;
  const init = campaign?.initiative;
  if (!init || !init.active) {
    banner.hidden = true;
    return;
  }
  banner.hidden = false;
  const roundEl = document.getElementById('playerCombatRound');
  const turnEl = document.getElementById('playerCombatTurn');
  if (roundEl) roundEl.textContent = `Раунд ${init.round || 1}`;
  
  const currentCombatant = (init.order || [])[init.turnIndex || 0];
  const activeHero = getActiveHero();
  const isMyTurn = currentCombatant && activeHero && (
    currentCombatant.id === activeHero.id ||
    currentCombatant.name?.toLowerCase() === activeHero.name?.toLowerCase()
  );

  banner.classList.toggle('your-turn', !!isMyTurn);
  if (turnEl) {
    turnEl.textContent = isMyTurn ? '🔥 ТВОЙ ХОД!' : `Ходит: ${currentCombatant?.name || '—'}`;
  }
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
  const pending = sides === 20 && hero && campaign?.pending?.characterId === hero.id ? campaign.pending : null;
  const effectiveMode = pending ? ({advantage:'adv', disadvantage:'dis'}[pending.mode] || 'normal') : rollMode;

  let d1 = Math.floor(Math.random() * sides) + 1;
  let d2 = null;
  let finalDie = d1;
  let modeNote = '';

  if (sides === 20) {
    if (effectiveMode === 'adv') {
      d2 = Math.floor(Math.random() * 20) + 1;
      finalDie = Math.max(d1, d2);
      modeNote = ` (преимущество: ${d1}, ${d2})`;
    } else if (effectiveMode === 'dis') {
      d2 = Math.floor(Math.random() * 20) + 1;
      finalDie = Math.min(d1, d2);
      modeNote = ` (помеха: ${d1}, ${d2})`;
    }
  }

  const total = finalDie + modifier;
  const isCrit = sides === 20 && finalDie === 20;
  const isFumble = sides === 20 && finalDie === 1;

  // Multi-step physical dice vibration
  if (window.navigator?.vibrate) {
    if (isCrit) window.navigator.vibrate([50, 40, 50, 40, 100, 50, 150]);
    else if (isFumble) window.navigator.vibrate([120, 80, 200]);
    else window.navigator.vibrate([35, 45, 30, 40, 20]);
  }

  // Procedural Web Audio SFX
  playSfx('dice');
  if (isCrit) setTimeout(() => playSfx('crit'), 300);
  else if (isFumble) setTimeout(() => playSfx('fumble'), 300);

  // Switch to Dice tab to show showcase
  switchToTab('dice');

  // 3D Animated Tumbling Physical Die
  const dice3d = document.getElementById('dice3dOverlay');
  const dice3dVal = document.getElementById('dice3dValue');
  const dice3dCube = document.getElementById('dice3dCube');
  if (dice3d && dice3dVal && dice3dCube) {
    dice3d.hidden = false;
    dice3dCube.style.animation = 'none';
    void dice3dCube.offsetWidth;
    dice3dCube.style.animation = 'rollTumble 0.7s cubic-bezier(0.2, 0.8, 0.3, 1.2)';
    dice3dVal.textContent = finalDie;
    setTimeout(() => {
      dice3d.hidden = true;
    }, 1800);
  }

  // Update Showcase
  const showcase = document.getElementById('rollShowcase');
  const totalEl = document.getElementById('rollTotalNumber');
  const breakdownEl = document.getElementById('rollBreakdownText');
  const critBanner = document.getElementById('critBanner');
  const fumbleBanner = document.getElementById('fumbleBanner');
  const deliveryStatus = document.getElementById('reSendRollBtn');
  if (deliveryStatus) { deliveryStatus.disabled = true; deliveryStatus.textContent = 'Отправляем мастеру…'; }

  if (showcase) showcase.hidden = false;
  if (totalEl) totalEl.textContent = total;
  if (breakdownEl) {
    const modStr = modifier >= 0 ? `+${modifier}` : `${modifier}`;
    breakdownEl.textContent = `Кубик d${sides}: ${finalDie}${modifier !== 0 ? ' ' + modStr : ''}${modeNote}`;
  }
  if (critBanner) critBanner.hidden = !isCrit;
  if (fumbleBanner) fumbleBanner.hidden = !isFumble;

  addRecentRoll(heroName, title, total, sides === 20 ? finalDie : '', modifier, isCrit, isFumble);

  // If the Master is awaiting a d20 roll for this hero, resolve the pending roll!
  if (pending) {
    const p = pending;
    const raw = !p.mode || p.mode === 'normal' ? finalDie : [d1, d2];
    const sent = await sendPttTextAction({ raw, rollId: p.id });
    if (deliveryStatus) deliveryStatus.textContent = sent ? '✓ Принято мастером' : 'Не подтверждено — проверьте состояние стола';
    return;
  }

  // Send Roll to Master Server
  try {
    const response = await fetch(`/api/player/roll`, {
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
    if(!response.ok)throw Error((await response.json()).error || 'Бросок не передан');
    if (deliveryStatus) deliveryStatus.textContent = '✓ Принято мастером';
    showToast(`🎲 Бросок ${total} отправлен Мастеру!`);
  } catch (error) {
    if (deliveryStatus) deliveryStatus.textContent = 'Не подтверждено — проверьте состояние стола';
    showToast(error.message || 'Бросок не передан мастеру');
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
      const terrainClass = getCellTerrainClass(cellTokens);

      let isShrouded = false;
      if (activeMap.fogOfWar) {
        const coordKey = `${x},${y}`;
        const isRevealed = activeMap.revealedCells && activeMap.revealedCells.includes(coordKey);
        if (!isRevealed) {
          const heroTokens = tokens.filter(t => t.kind === 'hero');
          const inHeroVision = heroTokens.some(h => Math.max(Math.abs(h.x - x), Math.abs(h.y - y)) <= 6);
          if (!inHeroVision) isShrouded = true;
        }
      }

      if (isShrouded) {
        html += `<td class="tactical-grid-cell cell-player-fog ${terrainClass}" data-coord="${coordLabel}" data-x="${x}" data-y="${y}" title="${coordLabel}: Туман войны">🌫️</td>`;
      } else if (cellTokens.length > 0) {
        const topToken = cellTokens[0];
        const kind = topToken.kind || 'object';
        const icon = getTokenIcon(topToken);
        const tokenLabel = topToken.label || topToken.id || 'Маркер';
        const countBadge = cellTokens.length > 1 ? `<span class="cell-multi-badge">${cellTokens.length}</span>` : '';

        html += `
          <td class="tactical-grid-cell has-token token-${kind} ${terrainClass}" 
              data-coord="${coordLabel}" 
              data-x="${x}"
              data-y="${y}"
              data-tokens="${escapeHtml(JSON.stringify(cellTokens))}"
              title="${coordLabel}: ${escapeHtml(tokenLabel)}">
            <span class="token-icon">${icon}</span>
            ${countBadge}
          </td>
        `;
      } else {
        html += `<td class="tactical-grid-cell empty-cell ${terrainClass}" data-coord="${coordLabel}" data-x="${x}" data-y="${y}">·</td>`;
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
      const x = parseInt(cell.dataset.x, 10);
      const y = parseInt(cell.dataset.y, 10);
      const tokensData = cell.dataset.tokens ? JSON.parse(cell.dataset.tokens) : [];
      const detailEl = document.getElementById('mapCellDetail');

      // Distance from current hero
      const activeHero = getActiveHero();
      let heroDistStr = '';
      if (activeHero && Number.isInteger(x) && Number.isInteger(y)) {
        const heroToken = tokens.find(t => t.kind === 'hero' && (
          (t.label || '').toLowerCase().includes(activeHero.name.toLowerCase()) ||
          activeHero.name.toLowerCase().includes((t.label || '').toLowerCase())
        )) || tokens.find(t => t.kind === 'hero');

        if (heroToken && Number.isInteger(heroToken.x) && Number.isInteger(heroToken.y)) {
          const dx = Math.abs(x - heroToken.x);
          const dy = Math.abs(y - heroToken.y);
          const cellsDist = Math.max(dx, dy);
          const feetDist = cellsDist * (activeMap.feetPerCell || 5);
          heroDistStr = ` · Дистанция от ${escapeHtml(heroToken.label || activeHero.name)}: <strong>${feetDist} фт</strong> (${cellsDist} кл)`;
        }
      }

      if (inspector) inspector.hidden = false;
      if (detailEl) {
        if (tokensData.length > 0) {
          detailEl.innerHTML = `
            <div class="cell-inspect-head">
              <strong>Клетка ${coord}</strong>: ${tokensData.length === 1 ? '1 объект' : tokensData.length + ' объекта(-ов)'}${heroDistStr}
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
          detailEl.innerHTML = `<span style="color:var(--text-muted);">Клетка <strong>${coord}</strong>: свободное пространство (${scaleText})${heroDistStr}.</span>`;
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

function getCellTerrainClass(tokens) {
  if (!tokens || !tokens.length) return '';
  for (const t of tokens) {
    const label = (t.label || t.id || '').toLowerCase();
    if (/(?:костер|огонь|пламя|факел|жар|лава|печь|fire|flame|torch|lava)/iu.test(label)) return 'cell-terrain-fire';
    if (/(?:фонтан|колодец|вода|водоем|озеро|ручей|бассейн|река|fountain|well|water|river|pond)/iu.test(label)) return 'cell-terrain-water';
    if (/(?:дерево|куст|заросли|трава|лес|растение|tree|bush|forest|vine|plant)/iu.test(label)) return 'cell-terrain-nature';
    if (/(?:ловушка|растяжка|нажим|мина|яма|trap|pit)/iu.test(label)) return 'cell-terrain-trap';
    if (/(?:колонна|стена|завал|столб|камень|валун|скала|обвал|pillar|column|wall|rock|stone|boulder)/iu.test(label)) return 'cell-terrain-stone';
  }
  return '';
}

function getTokenIcon(token) {
  if (!token) return '◇';
  const kind = token.kind || 'object';
  const label = (token.label || token.id || '').toLowerCase();

  if (kind === 'hero') {
    if (/(?:арт|изобрет|инженер|алхим|теон|artificer)/iu.test(label)) return '⚙️';
    if (/(?:друид|шаман|травник|альвари|druid)/iu.test(label)) return '🌿';
    if (/(?:бард|скальд|певец|музык|лира|bard)/iu.test(label)) return '🪕';
    if (/(?:жрец|клирик|священ|целител|капеллан|cleric)/iu.test(label)) return '🛡️';
    if (/(?:паладин|храмов|крестонос|paladin)/iu.test(label)) return '⚜️';
    if (/(?:воин|боец|рыцар|солдат|варвар|берсерк|fighter|warrior|barbarian)/iu.test(label)) return '⚔️';
    if (/(?:плут|вор|разбой|следопыт|ловк|ассасин|роуг|rogue|стрелок)/iu.test(label)) return '🗡️';
    if (/(?:лучник|рейнджер|archer|ranger)/iu.test(label)) return '🏹';
    if (/(?:монах|единобор|кунг|monk)/iu.test(label)) return '🥋';
    if (/(?:чародей|sorcerer)/iu.test(label)) return '🔮';
    if (/(?:колдун|чернокниж|warlock)/iu.test(label)) return '🧿';
    if (/(?:маг|волшебн|иллюз|архимаг|wizard|mage)/iu.test(label)) return '🧙';
    if (/(?:отряд|партия|лагерь|стоянка)/iu.test(label)) return '🏕️';
    return '👤';
  }

  if (kind === 'enemy') {
    // Undead
    if (/(?:скелет|костяк|skeleton)/iu.test(label)) return '💀';
    if (/(?:зомби|упырь|гуль|мертв|ghoul|zombie|undead)/iu.test(label)) return '🧟';
    if (/(?:вампир|князь\s+тьмы|vampire)/iu.test(label)) return '🧛';
    if (/(?:лич|некромант|lich|necromancer)/iu.test(label)) return '☠️';
    if (/(?:призрак|дух|тень|фантом|банши|ghost|specter|shadow|wraith|banshee)/iu.test(label)) return '👻';
    // Beasts / Animals
    if (/(?:волк|пес|собак|зверь|гонч|wolf|hound)/iu.test(label)) return '🐺';
    if (/(?:медведь|гризли|bear)/iu.test(label)) return '🐻';
    if (/(?:кабан|вепрь|секач|boar)/iu.test(label)) return '🐗';
    if (/(?:паук|паучи|тарантул|spider|arachnid)/iu.test(label)) return '🕷️';
    if (/(?:змея|гадюка|василиск|кобра|snake|viper|basilisk)/iu.test(label)) return '🐍';
    if (/(?:крыса|мышь|грызун|rat)/iu.test(label)) return '🐀';
    if (/(?:летучая\s+мышь|нетопырь|bat)/iu.test(label)) return '🦇';
    // Humanoid enemies
    if (/(?:гоблин|кобольд|goblin|kobold)/iu.test(label)) return '👺';
    if (/(?:орк|варг|полуорк|orc)/iu.test(label)) return '👹';
    if (/(?:тролль|огр|великан|гигант|циклоп|troll|ogre|giant|cyclops)/iu.test(label)) return '🧌';
    if (/(?:культист|фанатик|сектан|cultist)/iu.test(label)) return '🕯️';
    if (/(?:разбой|бандит|наемник|граби|головорез|thug|bandit|mercenary)/iu.test(label)) return '🗡️';
    if (/(?:ассасин|наемный\s+убийца|assassin|ninja)/iu.test(label)) return '🥷';
    if (/(?:снайпер|стрелок|арбалетчик|archer|crossbowman)/iu.test(label)) return '🎯';
    if (/(?:всадник|кавалерист|rider|cavalry)/iu.test(label)) return '🏇';
    // Monsters & Bosses
    if (/(?:дракон|виверн|змий|тиамат|dragon|wyvern|drake)/iu.test(label)) return '🐉';
    if (/(?:демон|бес|черт|дьявол|имп|demon|devil|fiend|imp)/iu.test(label)) return '👿';
    if (/(?:мимик|слизь|студень|желе|mimic|ooze|slime|cube)/iu.test(label)) return '🧪';
    if (/(?:элементаль|голем|elemental|golem)/iu.test(label)) return '🗿';
    if (/(?:энт|дендроид|леший|treant)/iu.test(label)) return '🪵';
    if (/(?:босс|главарь|вождь|капитан|король|командир|boss|chief|lord)/iu.test(label)) return '👑';
    if (/(?:логово|катакомб|руины|лабиринт|пещера)/iu.test(label)) return '🕳️';
    return '💀';
  }

  // Objects & World Landmarks
  if (/(?:город|столиц|крепост|замок|castle|town|city)/iu.test(label)) return '🏰';
  if (/(?:башн|руин|tower)/iu.test(label)) return '🗼';
  if (/(?:деревн|поселени|хутор|селение|village)/iu.test(label)) return '🏘️';
  if (/(?:таверн|трактир|постоял|питейная|inn|tavern)/iu.test(label)) return '🍺';
  if (/(?:лагерь|палатк|camp)/iu.test(label)) return '⛺';
  if (/(?:тракт|дорог|троп|путь|перекресток|road)/iu.test(label)) return '🛤️';
  if (/(?:мост|переправа|bridge)/iu.test(label)) return '🌉';
  if (/(?:гора|кряж|перевал|пик|хребет|mountain)/iu.test(label)) return '⛰️';
  if (/(?:река|озер|вод|ручей|river|lake)/iu.test(label)) return '🌊';
  if (/(?:сундук|ларь|ящик|короб|сейф|трофей|chest|crate|barrel|box|safe)/iu.test(label)) return '📦';
  if (/(?:сокровищ|золото|клад|монеты|драгоцен|алмаз|treasure|gold|gem)/iu.test(label)) return '💎';
  if (/(?:дверь|ворота|проход|решетка|люк|door|gate|hatch|portal)/iu.test(label)) return '🚪';
  if (/(?:костер|огонь|пламя|факел|жар|печь|жаровня|fire|flame|torch)/iu.test(label)) return '🔥';
  if (/(?:ловушка|растяжка|нажим|мина|яма|trap|pit)/iu.test(label)) return '⚠️';
  if (/(?:алтарь|саркофаг|гробниц|могила|святилищ|altar|tomb|shrine|sarcophagus)/iu.test(label)) return '⚰️';
  if (/(?:фонтан|колодец|well|fountain|pool)/iu.test(label)) return '⛲';
  if (/(?:дерево|дуб|сосна|роща|лес|пущ|чащ|tree|forest|woods)/iu.test(label)) return '🌲';
  if (/(?:куст|заросли|трава|кустарник|bush|vine)/iu.test(label)) return '🌿';
  if (/(?:колонна|столб|стена|обелиск|pillar|column|wall|obelisk)/iu.test(label)) return '🏛️';
  if (/(?:камень|валун|скала|завал|обвал|rock|boulder|rubble)/iu.test(label)) return '🪨';
  if (/(?:стол|стул|бар|стойка|мебель|скамья|table|chair|bench)/iu.test(label)) return '🪑';
  if (/(?:лестниц|трап|ступен|подъем|спуск|ladder|stairs)/iu.test(label)) return '🪜';
  if (/(?:книга|свиток|фолиант|записка|гримуар|book|scroll|tome)/iu.test(label)) return '📜';
  if (/(?:зелье|флакон|колба|эликсир|снадобье|potion|flask|vial)/iu.test(label)) return '🧪';
  if (/(?:кровать|нары|спальник|постель|bed|cot)/iu.test(label)) return '🛏️';
  if (/(?:повозка|телега|карета|фургон|wagon|cart|carriage)/iu.test(label)) return '🛒';
  if (/(?:клетка|темница|решетка|цепи|cage|chains)/iu.test(label)) return '⛓️';
  if (/(?:гриб|споры|mushroom|fungus)/iu.test(label)) return '🍄';
  if (/(?:портал|разлом|руна|магический\s+круг|portal|rift|rune)/iu.test(label)) return '🌀';

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
let pttRecordSequence = 0;
let pttBusy = false;

const hasMediaDevices = !!(
  (typeof navigator !== 'undefined' && navigator.mediaDevices && navigator.mediaDevices.getUserMedia) ||
  (typeof navigator !== 'undefined' && (navigator.getUserMedia || navigator.webkitGetUserMedia || navigator.mozGetUserMedia))
);

function initPttControls() {
  const pttBtn = document.getElementById('playerPttBtn');
  const toggleBtn = document.getElementById('pttTextToggleBtn');
  const sendTextBtn = document.getElementById('pttSendTextBtn');
  const textInput = document.getElementById('pttTextInput');
  const textRow = document.getElementById('pttTextInputRow');
  const audioInput = document.getElementById('playerAudioInput');
  const collapseBtn = document.getElementById('pttCollapseBtn');
  const collapsedPill = document.getElementById('pttCollapsedPill');
  const pttBar = document.getElementById('playerPttBar');
  const appContainer = document.querySelector('.player-app');
  const expandedBody = document.getElementById('pttExpandedBody');

  function setPttCollapsed(collapsed) {
    if (!pttBar) return;
    pttBar.classList.toggle('is-collapsed', collapsed);
    if (appContainer) appContainer.classList.toggle('ptt-collapsed', collapsed);
    if (collapsedPill) collapsedPill.hidden = !collapsed;
    if (expandedBody) expandedBody.hidden = collapsed;
    localStorage.setItem('skazitel_ptt_collapsed', collapsed ? '1' : '0');
  }

  const savedCollapsed = localStorage.getItem('skazitel_ptt_collapsed') === '1';
  setPttCollapsed(savedCollapsed);

  collapseBtn?.addEventListener('click', (e) => {
    e.stopPropagation();
    setPttCollapsed(true);
  });

  collapsedPill?.addEventListener('click', () => {
    setPttCollapsed(false);
  });

  const whisperBtn = document.getElementById('pttWhisperToggleBtn');
  if (whisperBtn) {
    whisperBtn.addEventListener('click', () => {
      isWhisperMode = !isWhisperMode;
      whisperBtn.classList.toggle('whisper-active', isWhisperMode);
      pttBar?.classList.toggle('whisper-mode', isWhisperMode);
      if (isWhisperMode) {
        showToast('🤫 Режим тайного шёпота включён: действие услышит только Мастер');
        if (navigator.vibrate) navigator.vibrate([25, 25]);
      } else {
        showToast('🗣️ Обычный ход: действие услышит весь стол');
      }
    });
  }

  if (audioInput) {
    audioInput.addEventListener('change', async (e) => {
      const file = e.target.files?.[0];
      audioInput.value = '';
      if (!file || pttBusy) return;

      const hero = getActiveHero();
      if (!hero) {
        showToast('Сначала выберите героя');
        return;
      }

      setPttBusy(true);
      const pttBtn = document.getElementById('playerPttBtn');
      const pttIcon = document.getElementById('pttBtnIcon');
      const pttText = document.getElementById('pttBtnText');
      const pttStatus = document.getElementById('pttStatusText');

      if (pttBtn) pttBtn.classList.add('busy');
      if (pttIcon) pttIcon.textContent = '⏳';
      if (pttText) pttText.textContent = 'Обработка записи...';
      if (pttStatus) pttStatus.textContent = `Распознавание речи для ${hero.name}...`;

      try {
        showToast('Аудио получено, расшифровываем...');
        const base64 = await new Promise((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => {
            const res = String(reader.result || '');
            const idx = res.indexOf('base64,');
            resolve(idx !== -1 ? res.substring(idx + 7) : res);
          };
          reader.onerror = reject;
          reader.readAsDataURL(file);
        });

        const mime = file.type || (file.name?.endsWith('.m4a') ? 'audio/mp4' : 'audio/wav');
        const res = await fetch('/api/player/ptt', {
          method: 'POST',
          headers,
          body: JSON.stringify({
            campaignId: campaign?.id,
            characterId: hero.id,
            audio: base64,
            mime,
            isWhisper: isWhisperMode
          })
        });

        if (!res.ok) {
          const err = await res.json().catch(() => ({}));
          throw new Error(err.error || 'Ошибка отправки хода');
        }

        const data = await res.json();
        if (data.narration?.startsWith('🤫 [Шёпотом')) showPrivateReply(data.narration);
        showToast(`✨ ${hero.name}: «${data.text}» отправлено!`);
        if (navigator.vibrate) navigator.vibrate([30, 50, 30]);
        await refreshCampaignState();
      } catch (err) {
        showPlayerSendError(err.message || 'Не удалось передать ход');
      } finally {
        setPttBusy(false);
        if (pttBtn) pttBtn.classList.remove('busy');
        if (pttIcon) pttIcon.textContent = '🎙️';
        updatePttHero();
      }
    });
  }

  if (pttBtn) {
    // Click listener: on mobile HTTP (where browser blocks getUserMedia on non-localhost/non-https), trigger native recorder
    pttBtn.addEventListener('click', e => {
      if (!hasMediaDevices) {
        e.preventDefault();
        const hero = getActiveHero();
        if (!hero) {
          showToast('Сначала выберите героя');
          return;
        }
        if (pttBusy) return;
        const input = document.getElementById('playerAudioInput');
        if (input) input.click();
      }
    });

    pttBtn.addEventListener('pointerdown', e => {
      if (!hasMediaDevices) return;
      e.preventDefault();
      try { pttBtn.setPointerCapture(e.pointerId); } catch {}
      startPttRecording();
    });
    pttBtn.addEventListener('pointerup', e => {
      if (!hasMediaDevices) return;
      e.preventDefault();
      stopPttRecording();
    });
    pttBtn.addEventListener('pointercancel', e => {
      if (!hasMediaDevices) return;
      e.preventDefault();
      stopPttRecording();
    });
    pttBtn.addEventListener('keydown', e => {
      if ((e.code === 'Space' || e.key === 'Enter') && !e.repeat && !pttRecording) {
        e.preventDefault();
        if (hasMediaDevices) {
          startPttRecording();
        } else {
          document.getElementById('playerAudioInput')?.click();
        }
      }
    });
    pttBtn.addEventListener('keyup', e => {
      if (e.code === 'Space' || e.key === 'Enter') {
        e.preventDefault();
        stopPttRecording();
      }
    });
    pttBtn.addEventListener('blur', () => { if (pttRecordHeld || pttRecording) stopPttRecording(); });
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
  const collapsedHero = document.getElementById('pttCollapsedHeroName');
  const btnText = document.getElementById('pttBtnText');
  const status = document.getElementById('pttStatusText');
  const textInput = document.getElementById('pttTextInput');
  if (badge) badge.textContent = name;
  if (collapsedHero) collapsedHero.textContent = name;
  if (btnText && !pttRecording && !pttBusy) {
    if (hasMediaDevices) {
      btnText.textContent = hero ? `Говорить от лица: ${name}` : 'Удерживайте для хода';
    } else {
      btnText.textContent = hero ? `Голос от лица: ${name}` : 'Нажмите для записи';
    }
  }
  if (status && !pttRecording && !pttBusy) {
    if (hasMediaDevices) {
      status.textContent = 'Зажмите кнопку для хода';
    } else {
      status.textContent = 'Нажмите кнопку для записи через микрофон (или ✏️ текстом)';
    }
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
  if (pttBusy || pttRecording || pttRecordHeld) return;
  const hero = getActiveHero();
  if (!hero) {
    showToast('Сначала выберите героя');
    return;
  }

  const getUM = (navigator.mediaDevices && navigator.mediaDevices.getUserMedia?.bind(navigator.mediaDevices))
    || navigator.getUserMedia?.bind(navigator)
    || navigator.webkitGetUserMedia?.bind(navigator)
    || navigator.mozGetUserMedia?.bind(navigator);

  if (!getUM) {
    document.getElementById('playerAudioInput')?.click();
    return;
  }

  pttRecordHeld = true;
  const sequence = ++pttRecordSequence;
  let stream = null, ctx = null;
  try {
    stream = await getUM({
      audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      video: false
    });
    if (!pttRecordHeld || sequence !== pttRecordSequence) {
      stream.getTracks().forEach(t => t.stop());
      return;
    }
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    ctx = new AudioContextClass();
    await ctx.resume();
    if (!pttRecordHeld || sequence !== pttRecordSequence) { stream.getTracks().forEach(t => t.stop()); await ctx.close().catch(() => {}); return; }
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
    if (sequence !== pttRecordSequence) return;
    pttRecordHeld = false;
    if (e.name === 'NotAllowedError' || e.name === 'SecurityError' || e.name === 'TypeError') {
      showToast('Прямой доступ ограничен браузером, открываем запись…');
      document.getElementById('playerAudioInput')?.click();
    } else {
      showToast(e.message || 'Ошибка микрофона');
    }
  }
}

async function stopPttRecording() {
  pttRecordHeld = false;
  pttRecordSequence++;
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

  setPttBusy(true);
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
        mime: 'audio/wav',
        isWhisper: isWhisperMode
      })
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || 'Ошибка отправки хода');
    }
    const data = await res.json();
    if (data.narration?.startsWith('🤫 [Шёпотом')) showPrivateReply(data.narration);
    showToast(isWhisperMode ? `🤫 ${r.hero.name}: «${data.text}» шепнули Мастеру!` : `✨ ${r.hero.name}: «${data.text}» отправлено!`);
    if (navigator.vibrate) navigator.vibrate([30, 50, 30]);
    await refreshCampaignState();
  } catch (e) {
    showPlayerSendError(e.message || 'Не удалось передать ход');
  } finally {
    setPttBusy(false);
    if (pttBtn) pttBtn.classList.remove('busy');
    if (pttIcon) pttIcon.textContent = '🎙️';
    updatePttHero();
  }
}

async function sendPttTextAction(rollSubmission = null) {
  if (pttBusy || pttRecording || pttRecordHeld) return false;
  const input = document.getElementById('pttTextInput');
  const text = rollSubmission ? '' : input?.value?.trim();
  if (!text && !rollSubmission) return false;
  const hero = getActiveHero();
  if (!hero) {
    showToast('Сначала выберите героя');
    return false;
  }
  setPttBusy(true);
  const pttBtn = document.getElementById('playerPttBtn');
  if (pttBtn) pttBtn.classList.add('busy');
  showToast(isWhisperMode ? `Шепчем ход за ${hero.name}...` : `Отправляем ход за ${hero.name}...`);
  try {
    const res = await fetch('/api/player/turn', {
      method: 'POST',
      headers,
      body: JSON.stringify({
        campaignId: campaign?.id,
        characterId: hero.id,
        text,
        ...(rollSubmission || {}),
        isWhisper: isWhisperMode
      })
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || 'Ошибка отправки');
    }
    const data = await res.json();
    if (data.narration?.startsWith('🤫 [Шёпотом')) showPrivateReply(data.narration);
    if(!rollSubmission && input.value.trim() === text)input.value = '';
    showToast(rollSubmission ? 'Результат броска передан мастеру' : isWhisperMode ? `🤫 ${hero.name}: «${text}» шепнули Мастеру!` : `✨ ${hero.name}: «${text}» отправлено!`);
    await refreshCampaignState();
    return true;
  } catch (e) {
    showPlayerSendError(e.message || 'Не удалось передать ход');
    return false;
  } finally {
    setPttBusy(false);
    if (pttBtn) pttBtn.classList.remove('busy');
    updatePttHero();
  }
}

function setPttBusy(value) {
 pttBusy=value;
 if(value){const error=document.getElementById('playerSendError');if(error)error.hidden=true;}
 for(const id of ['pttSendTextBtn','playerPttBtn','playerSubmitRoll','heroSelect','campaignSelect']){
  const el=document.getElementById(id);if(el)el.disabled=value;
 }
 const bar=document.getElementById('playerPttBar');
 bar?.setAttribute('aria-busy',String(value));
}
function renderPendingRoll(){
 const panel=document.getElementById('playerPendingRoll'),p=campaign?.pending;
 if(!panel)return;
 panel.hidden=!p;if(!p)return;
 const owner=campaign.characters.find(h=>h.id===p.characterId);
 const isMyRoll=getActiveHero()?.id===p.characterId;
 document.getElementById('playerRollTitle').textContent=isMyRoll
  ? '🎲 Мастер ожидает ваш бросок d20'
  : `🎲 Ожидается бросок: ${owner?.name || 'другой герой'}`;
 document.getElementById('playerRollReason').textContent=[p.reason,p.stakes].filter(Boolean).join('. ');
 const ownerEl=document.getElementById('playerRollOwner');
 if(ownerEl){
  ownerEl.innerHTML=isMyRoll
   ? `Бросает: <strong>${escapeHtml(owner?.name||'')}</strong>`
   : `Бросает: <button type="button" id="switchToPendingHeroBtn" style="color:var(--accent-gold,#d1aa5e);text-decoration:underline;background:none;border:none;cursor:pointer;font:inherit;padding:0;">Переключиться на ${escapeHtml(owner?.name||'героя')} ↗</button>`;
  document.getElementById('switchToPendingHeroBtn')?.addEventListener('click',()=>{
   selectedHeroId=p.characterId;
   localStorage.setItem('skazitel_player_hero',selectedHeroId);
   if(heroSelect)heroSelect.value=selectedHeroId;
   renderActiveHero();
  });
 }
 const virtualBtn=document.getElementById('playerRollVirtualBtn');
 if(virtualBtn)virtualBtn.hidden=!isMyRoll;
 const form=document.getElementById('playerRollForm');
 form.hidden=!isMyRoll;
 const second=document.getElementById('playerSecondDieLabel');
 second.hidden=!p.mode||p.mode==='normal';
 document.getElementById('playerRawDie2').required=!second.hidden;
 if(form.dataset.roll!==p.id){form.reset();form.dataset.roll=p.id;}
}
document.getElementById('playerRollVirtualBtn')?.addEventListener('click',()=>{
 const p=campaign?.pending;if(!p)return;
 executeRoll(20,0,p.reason?`Бросок: ${p.reason}`:'Проверка d20');
});
document.getElementById('playerRollForm')?.addEventListener('submit',event=>{
 event.preventDefault();
 const p=campaign?.pending;if(!p)return;
 const first=Number(document.getElementById('playerRawDie').value);
 const raw=!p.mode||p.mode==='normal'?first:[first,Number(document.getElementById('playerRawDie2').value)];
 sendPttTextAction({raw,rollId:p.id});
});

function showPlayerSendError(message){
 const error=document.getElementById('playerSendError');
 if(error){error.textContent='Не отправлено: '+message;error.hidden=false;}
 showToast(message);
}
