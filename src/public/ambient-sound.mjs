// Ambient Soundscape Engine for Skazitel
// Uses Apple Silicon hardware-accelerated AAC (M4A) audio tracks for 100% stability,
// minimal CPU/memory footprint, seamless playback, and zero leaks in macOS WebKit.

export const THEME_TRACKS = {
 camp: [
  { id: 'campfire_stories', title: 'Истории у костра', author: 'Veloren · CC-BY-SA', src: '/audio/camp/campfire_stories.m4a' },
  { id: 'warmth_of_the_hearth', title: 'Тепло очага', author: 'Veloren · CC-BY-SA', src: '/audio/camp/warmth_of_the_hearth.m4a' },
  { id: 'a_peaceful_moment', title: 'Минута покоя', author: 'Veloren · CC-BY-SA', src: '/audio/camp/a_peaceful_moment.m4a' }
 ],
 tavern: [
  { id: 'fill_the_mugs', title: 'Наполняйте кружки', author: 'Veloren · CC-BY-SA', src: '/audio/tavern/fill_the_mugs.m4a' },
  { id: 'a_tale_worth_telling', title: 'Славная быль', author: 'Veloren · CC-BY-SA', src: '/audio/tavern/a_tale_worth_telling.m4a' },
  { id: 'bustle_and_bloom', title: 'Шум и веселье', author: 'Veloren · CC-BY-SA', src: '/audio/tavern/bustle_and_bloom.m4a' },
  { id: 'traveling_minstrels', title: 'Бродячие менестрели', author: 'Wesnoth · CC-BY-SA', src: '/audio/tavern/traveling_minstrels.m4a' }
 ],
 battle: [
  { id: 'battle-epic', title: 'Эпическая битва', author: 'Wesnoth · CC-BY-SA', src: '/audio/battle/battle-epic.m4a' },
  { id: 'legends_of_the_north', title: 'Легенды Севера', author: 'Wesnoth · CC-BY-SA', src: '/audio/battle/legends_of_the_north.m4a' },
  { id: 'battle_theme', title: 'Боевой натиск', author: 'Flare RPG · CC-BY-SA', src: '/audio/battle/battle_theme.m4a' },
  { id: 'boss_theme', title: 'Битва с боссом', author: 'Flare RPG · CC-BY-SA', src: '/audio/battle/boss_theme.m4a' }
 ],
 dungeon: [
  { id: 'dank_dungeon', title: 'Сырые катакомбы', author: 'Veloren · CC-BY-SA', src: '/audio/dungeon/dank_dungeon.m4a' },
  { id: 'cobbled_halls', title: 'Мощёные залы', author: 'Veloren · CC-BY-SA', src: '/audio/dungeon/cobbled_halls.m4a' },
  { id: 'cavernous_hollow', title: 'Пещерная глубина', author: 'Veloren · CC-BY-SA', src: '/audio/dungeon/cavernous_hollow.m4a' },
  { id: 'underground', title: 'Подземелье мрака', author: 'Wesnoth · CC-BY-SA', src: '/audio/dungeon/underground.m4a' }
 ],
 forest: [
  { id: 'calling_wild', title: 'Зов дикой природы', author: 'Veloren · CC-BY-SA', src: '/audio/forest/calling_wild.m4a' },
  { id: 'between_the_fairies', title: 'Среди фей', author: 'Veloren · CC-BY-SA', src: '/audio/forest/between_the_fairies.m4a' },
  { id: 'elvish-theme', title: 'Эльфийские рощи', author: 'Wesnoth · CC-BY-SA', src: '/audio/forest/elvish-theme.m4a' }
 ],
 rain: [
  { id: 'rain', title: 'Шумный ливень', author: 'Veloren · CC-BY-SA', src: '/audio/rain/rain.m4a' },
  { id: 'thunder', title: 'Далекие раскаты грома', author: 'Veloren · CC-BY-SA', src: '/audio/rain/thunder.m4a' },
  { id: 'river_quiet', title: 'Тихая лесная река', author: 'Veloren · CC-BY-SA', src: '/audio/rain/river_quiet.m4a' }
 ],
 mystery: [
  { id: 'ethereal_bonds', title: 'Эфирные узы', author: 'Veloren · CC-BY-SA', src: '/audio/mystery/ethereal_bonds.m4a' },
  { id: 'stars_like_stalactites', title: 'Звёзды как сталактиты', author: 'Veloren · CC-BY-SA', src: '/audio/mystery/stars_like_stalactites.m4a' },
  { id: 'sacred_temple', title: 'Священный храм', author: 'Veloren · CC-BY-SA', src: '/audio/mystery/sacred_temple.m4a' }
 ]
};

export class AmbientEngine {
 constructor() {
  this.currentTheme = 'off';
  this.themeIndices = {
   camp: 0,
   tavern: 0,
   battle: 0,
   dungeon: 0,
   forest: 0,
   rain: 0,
   mystery: 0
  };
  this.currentAudio = null;
  this.fadeTimer = null;
  this.duckTimer = null;
  this.navDebounceTimer = null;
  this.lastNavTime = 0;
  this.volume = parseFloat(localStorage.getItem('skazitel-ambient-volume') || '0.35');
  this.isDucked = false;
  this.isMuted = localStorage.getItem('skazitel-ambient-muted') === 'true';

  this.sfxCtx = null;
  this.sfxGain = null;
  this.noiseBuffer = null;

  this.themeLabels = {
   off: 'Выключен',
   camp: '🏕️ Лагерь (костёр)',
   tavern: '🍺 Таверна (музыка)',
   battle: '⚔️ Бой (симфония)',
   dungeon: '🏰 Подземелье (эхо)',
   forest: '🌲 Лес (атмосфера)',
   rain: '⛈️ Дождь (гроза)',
   mystery: '🔮 Тайна (эфир)'
  };

  this.onThemeChange = null;
  this.onTrackChange = null;
 }

 init() {
  if (this.currentAudio && this.currentAudio.paused && this.currentTheme !== 'off') {
   this.currentAudio.play().catch(() => {});
  }
  if (!this.sfxCtx) {
   const AudioContextClass = window.AudioContext || window.webkitAudioContext;
   if (AudioContextClass) {
    this.sfxCtx = new AudioContextClass();
    this.sfxGain = this.sfxCtx.createGain();
    this.sfxGain.gain.setValueAtTime(this.volume, this.sfxCtx.currentTime);
    this.sfxGain.connect(this.sfxCtx.destination);
    this.createNoiseBuffer();
   }
  } else if (this.sfxCtx.state === 'suspended') {
   this.sfxCtx.resume().catch(() => {});
  }
 }

 createNoiseBuffer() {
  if (!this.sfxCtx) return;
  const bufferSize = Math.floor(this.sfxCtx.sampleRate * 2);
  this.noiseBuffer = this.sfxCtx.createBuffer(1, bufferSize, this.sfxCtx.sampleRate);
  const data = this.noiseBuffer.getChannelData(0);
  for (let i = 0; i < bufferSize; i++) {
   data[i] = Math.random() * 2 - 1;
  }
 }

 getTargetVolume() {
  if (this.isMuted) return 0;
  return this.isDucked ? this.volume * 0.25 : this.volume;
 }

 setVolume(vol) {
  this.volume = Math.max(0, Math.min(1, vol));
  localStorage.setItem('skazitel-ambient-volume', String(this.volume));
  if (this.sfxGain && this.sfxCtx) {
   this.sfxGain.gain.setValueAtTime(this.isMuted ? 0 : this.volume, this.sfxCtx.currentTime);
  }
  if (this.currentAudio && !this.fadeTimer && !this.duckTimer) {
   this.currentAudio.volume = this.getTargetVolume();
  }
 }

 setMuted(muted) {
  this.isMuted = !!muted;
  localStorage.setItem('skazitel-ambient-muted', String(this.isMuted));
  if (this.currentAudio) {
   this.currentAudio.volume = this.getTargetVolume();
  }
 }

 setDucked(ducked) {
  if (this.isDucked === ducked) return;
  this.isDucked = ducked;
  if (!this.currentAudio) return;

  if (this.duckTimer) clearInterval(this.duckTimer);
  const target = this.getTargetVolume();
  const startVol = this.currentAudio.volume;
  const duration = ducked ? 250 : 600;
  const steps = 12;
  const stepTime = duration / steps;
  let step = 0;

  this.duckTimer = setInterval(() => {
   step++;
   const progress = step / steps;
   if (this.currentAudio) {
    this.currentAudio.volume = Math.max(0, Math.min(1, startVol + (target - startVol) * progress));
   }
   if (step >= steps) {
    clearInterval(this.duckTimer);
    this.duckTimer = null;
    if (this.currentAudio) this.currentAudio.volume = target;
   }
  }, stepTime);
 }

 getCurrentTrack() {
  const tracks = THEME_TRACKS[this.currentTheme];
  if (!tracks || !tracks.length) return null;
  const idx = (this.themeIndices[this.currentTheme] || 0) % tracks.length;
  return {
   ...tracks[idx],
   index: idx + 1,
   total: tracks.length,
   theme: this.currentTheme
  };
 }

 setTheme(theme, { force = false } = {}) {
  const normalized = this.themeLabels[theme] ? theme : 'camp';
  if (this.currentTheme === normalized && !force) return;

  this.currentTheme = normalized;
  if (normalized === 'off') {
   this.stopCurrent();
   this.onThemeChange?.(this.currentTheme);
   this.onTrackChange?.(null);
   return;
  }

  this.playCurrentTrack();
  this.onThemeChange?.(this.currentTheme);
 }

 nextTrack({ auto = false } = {}) {
  const now = Date.now();
  if (!auto && now - this.lastNavTime < 350) return;
  this.lastNavTime = now;

  const tracks = THEME_TRACKS[this.currentTheme];
  if (!tracks || !tracks.length) return;
  this.themeIndices[this.currentTheme] = ((this.themeIndices[this.currentTheme] || 0) + 1) % tracks.length;
  this.playCurrentTrack();
 }

 prevTrack() {
  const now = Date.now();
  if (now - this.lastNavTime < 350) return;
  this.lastNavTime = now;

  const tracks = THEME_TRACKS[this.currentTheme];
  if (!tracks || !tracks.length) return;
  const cur = this.themeIndices[this.currentTheme] || 0;
  this.themeIndices[this.currentTheme] = (cur - 1 + tracks.length) % tracks.length;
  this.playCurrentTrack();
 }

 playCurrentTrack() {
  const track = this.getCurrentTrack();
  if (!track) {
   this.stopCurrent();
   return;
  }

  // Hard stop & clean previous audio completely to prevent overlapping decoding / GPU memory buildup
  this.stopCurrent();

  const audio = new Audio();
  audio.preload = 'auto';
  audio.volume = 0;
  audio.src = track.src;

  audio.onended = () => {
   // Guard against loop on premature or zero-length events
   if (audio.currentTime > 2) {
    this.nextTrack({ auto: true });
   } else {
    console.warn('Track ended prematurely, avoiding loop');
   }
  };

  audio.onerror = (err) => {
   console.warn('Ambient audio error:', track.src, audio.error);
  };

  const playPromise = audio.play();
  if (playPromise) {
   playPromise.catch(err => {
    console.debug('Ambient autoplay gesture required:', err.message);
   });
  }

  this.currentAudio = audio;

  // Gentle fade-in over 1.2s
  const targetVol = this.getTargetVolume();
  const steps = 15;
  const stepTime = 1200 / steps;
  let step = 0;

  if (this.fadeTimer) clearInterval(this.fadeTimer);
  this.fadeTimer = setInterval(() => {
   step++;
   const progress = step / steps;
   if (this.currentAudio === audio) {
    audio.volume = Math.max(0, Math.min(1, targetVol * progress));
   }
   if (step >= steps) {
    clearInterval(this.fadeTimer);
    this.fadeTimer = null;
    if (this.currentAudio === audio) {
     audio.volume = this.getTargetVolume();
    }
   }
  }, stepTime);

  this.onTrackChange?.(track);
 }

 stopCurrent() {
  if (this.fadeTimer) {
   clearInterval(this.fadeTimer);
   this.fadeTimer = null;
  }
  if (this.duckTimer) {
   clearInterval(this.duckTimer);
   this.duckTimer = null;
  }

  const prev = this.currentAudio;
  this.currentAudio = null;
  if (!prev) return;

  // Detach all listeners immediately so it never triggers nextTrack or error handlers
  prev.onended = null;
  prev.onerror = null;
  prev.oncanplay = null;

  try {
   prev.pause();
   prev.removeAttribute('src');
   prev.load();
  } catch {}
 }

 // SFX: Physical dice roll
 playDiceSound() {
  this.init();
  if (!this.sfxCtx || this.isMuted) return;
  const ctx = this.sfxCtx;
  const now = ctx.currentTime;
  const clicks = 5 + Math.floor(Math.random() * 3);
  for (let i = 0; i < clicks; i++) {
   const t = now + i * (0.05 + Math.random() * 0.04);
   if (!this.noiseBuffer) this.createNoiseBuffer();
   if (!this.noiseBuffer) return;
   const noise = ctx.createBufferSource();
   noise.buffer = this.noiseBuffer;
   const filter = ctx.createBiquadFilter();
   filter.type = 'bandpass';
   filter.frequency.value = 750 + Math.random() * 500;
   filter.Q.value = 3.5;
   const gain = ctx.createGain();
   const isLast = i === clicks - 1;
   gain.gain.setValueAtTime(0.001, t);
   gain.gain.linearRampToValueAtTime(isLast ? 0.35 : 0.18 + Math.random() * 0.12, t + 0.003);
   gain.gain.exponentialRampToValueAtTime(0.0001, t + (isLast ? 0.09 : 0.04));

   noise.connect(filter);
   filter.connect(gain);
   gain.connect(this.sfxGain);
   noise.start(t);
   noise.stop(t + 0.12);
  }
 }

 // SFX: Coins clink
 playCoinSound() {
  this.init();
  if (!this.sfxCtx || this.isMuted) return;
  const ctx = this.sfxCtx;
  const now = ctx.currentTime;
  const pitches = [2400, 2900, 3400];
  pitches.forEach((freq, idx) => {
   const t = now + idx * 0.07;
   const osc = ctx.createOscillator();
   osc.type = 'sine';
   osc.frequency.value = freq;
   const gain = ctx.createGain();
   gain.gain.setValueAtTime(0.001, t);
   gain.gain.linearRampToValueAtTime(0.14, t + 0.005);
   gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.28);
   osc.connect(gain);
   gain.connect(this.sfxGain);
   osc.start(t);
   osc.stop(t + 0.32);
  });
 }
}

export const ambientEngine = new AmbientEngine();
