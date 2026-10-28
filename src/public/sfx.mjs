// Sound Effects Engine (High-fidelity recorded audio from open sound banks with procedural Web Audio fallback)
let audioCtx = null;
let sfxEnabled = localStorage.getItem('skazitel_sfx_enabled') !== 'false';
const audioBuffers = new Map();
const loadingPromises = new Map();

// Authentic recorded sounds from Creative Commons / Open Game banks (Wesnoth, DiceRoller, DnD Soundboard)
const SFX_FILES = {
  dice: ['/audio/sfx/dice.m4a', '/audio/sfx/dice2.m4a'],
  coin: ['/audio/sfx/coin.m4a'],
  sword: ['/audio/sfx/sword.m4a'],
  magic: ['/audio/sfx/magic.m4a'],
  crit: ['/audio/sfx/crit.m4a'],
  fumble: ['/audio/sfx/fumble.m4a'],
  rest: ['/audio/sfx/rest.m4a'],
  turn: ['/audio/sfx/turn.m4a']
};

function getAudioContext() {
  if (!audioCtx) {
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    if (AudioContextClass) {
      audioCtx = new AudioContextClass();
      preloadAllSfx();
    }
  }
  if (audioCtx && audioCtx.state === 'suspended') {
    audioCtx.resume().catch(() => {});
  }
  return audioCtx;
}

async function loadBuffer(url) {
  if (audioBuffers.has(url)) return audioBuffers.get(url);
  if (loadingPromises.has(url)) return loadingPromises.get(url);

  const promise = (async () => {
    try {
      const resp = await fetch(url);
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      const arrayBuf = await resp.arrayBuffer();
      const ctx = getAudioContext();
      if (!ctx) return null;
      const decoded = await ctx.decodeAudioData(arrayBuf);
      audioBuffers.set(url, decoded);
      return decoded;
    } catch (err) {
      return null;
    } finally {
      loadingPromises.delete(url);
    }
  })();

  loadingPromises.set(url, promise);
  return promise;
}

export function preloadAllSfx() {
  for (const list of Object.values(SFX_FILES)) {
    for (const url of list) {
      loadBuffer(url);
    }
  }
}

export function isSfxEnabled() {
  return sfxEnabled;
}

export function toggleSfx() {
  sfxEnabled = !sfxEnabled;
  localStorage.setItem('skazitel_sfx_enabled', String(sfxEnabled));
  if (sfxEnabled) playSfx('dice');
  return sfxEnabled;
}

export function playSfx(type) {
  if (!sfxEnabled) return;
  const ctx = getAudioContext();
  if (!ctx) return;

  const files = SFX_FILES[type];
  if (files && files.length) {
    const chosenUrl = files[Math.floor(Math.random() * files.length)];
    const buffer = audioBuffers.get(chosenUrl);
    if (buffer) {
      try {
        const source = ctx.createBufferSource();
        source.buffer = buffer;
        const gain = ctx.createGain();
        gain.gain.value = type === 'turn' ? 0.45 : type === 'dice' ? 0.85 : 0.65;
        source.connect(gain);
        gain.connect(ctx.destination);
        source.start(ctx.currentTime);
        return;
      } catch {}
    } else {
      loadBuffer(chosenUrl);
    }
  }

  // Procedural fallback if audio file buffer is not decoded yet
  playProceduralFallback(ctx, type);
}

function playProceduralFallback(ctx, type) {
  const now = ctx.currentTime;
  try {
    if (type === 'dice') {
      for (let i = 0; i < 3; i++) {
        const delay = i * 0.06;
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = 'triangle';
        osc.frequency.setValueAtTime(140 + Math.random() * 80, now + delay);
        osc.frequency.exponentialRampToValueAtTime(40, now + delay + 0.05);
        gain.gain.setValueAtTime(0.35 / (i + 1), now + delay);
        gain.gain.exponentialRampToValueAtTime(0.001, now + delay + 0.05);
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start(now + delay);
        osc.stop(now + delay + 0.06);
      }
    } else if (type === 'coin') {
      [2400, 2900, 3400].forEach((freq, idx) => {
        const t = now + idx * 0.07;
        const osc = ctx.createOscillator();
        osc.type = 'sine';
        osc.frequency.value = freq;
        const gain = ctx.createGain();
        gain.gain.setValueAtTime(0.001, t);
        gain.gain.linearRampToValueAtTime(0.14, t + 0.005);
        gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.28);
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start(t);
        osc.stop(t + 0.32);
      });
    } else if (type === 'sword') {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sawtooth';
      osc.frequency.setValueAtTime(880, now);
      osc.frequency.exponentialRampToValueAtTime(220, now + 0.15);
      gain.gain.setValueAtTime(0.3, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.2);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(now);
      osc.stop(now + 0.22);
    } else if (type === 'magic') {
      [523.25, 659.25, 783.99, 1046.50].forEach((freq, idx) => {
        const t = now + idx * 0.07;
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = 'sine';
        osc.frequency.setValueAtTime(freq, t);
        gain.gain.setValueAtTime(0.25, t);
        gain.gain.exponentialRampToValueAtTime(0.001, t + 0.25);
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start(t);
        osc.stop(t + 0.26);
      });
    } else if (type === 'crit') {
      [523.25, 659.25, 783.99, 1046.50].forEach(f => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = 'triangle';
        osc.frequency.setValueAtTime(f, now);
        gain.gain.setValueAtTime(0.2, now);
        gain.gain.exponentialRampToValueAtTime(0.001, now + 0.8);
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start(now);
        osc.stop(now + 0.85);
      });
    } else if (type === 'fumble') {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sawtooth';
      osc.frequency.setValueAtTime(180, now);
      osc.frequency.exponentialRampToValueAtTime(50, now + 0.5);
      gain.gain.setValueAtTime(0.3, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.55);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(now);
      osc.stop(now + 0.58);
    } else if (type === 'rest') {
      [440, 554.37, 659.25].forEach((f, i) => {
        const t = now + i * 0.12;
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = 'sine';
        osc.frequency.setValueAtTime(f, t);
        gain.gain.setValueAtTime(0.25, t);
        gain.gain.exponentialRampToValueAtTime(0.001, t + 0.7);
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start(t);
        osc.stop(t + 0.75);
      });
    } else if (type === 'turn') {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(880, now);
      osc.frequency.exponentialRampToValueAtTime(1320, now + 0.08);
      gain.gain.setValueAtTime(0.2, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.25);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(now);
      osc.stop(now + 0.28);
    }
  } catch {}
}

// Start preloading SFX as soon as DOM is interactive
if (typeof window !== 'undefined') {
  const initPreload = () => {
    preloadAllSfx();
    window.removeEventListener('pointerdown', initPreload);
    window.removeEventListener('keydown', initPreload);
  };
  window.addEventListener('pointerdown', initPreload, { once: true });
  window.addEventListener('keydown', initPreload, { once: true });
}
