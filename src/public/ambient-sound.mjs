// Ambient Soundscape Engine for Skazitel
// Uses Apple Silicon hardware-accelerated AAC (M4A) audio tracks for 100% stability,
// minimal CPU/memory footprint, seamless playback, and zero leaks in macOS WebKit.
import { playSfx } from '/sfx.mjs';

export const THEME_TRACKS = {
 camp: [
  { id: 'campfire_stories', title: 'Истории у костра', author: 'Veloren · CC-BY-SA', src: '/audio/camp/campfire_stories.m4a' },
  { id: 'warmth_of_the_hearth', title: 'Тепло очага', author: 'Veloren · CC-BY-SA', src: '/audio/camp/warmth_of_the_hearth.m4a' },
  { id: 'a_peaceful_moment', title: 'Минута покоя', author: 'Veloren · CC-BY-SA', src: '/audio/camp/a_peaceful_moment.m4a' },
  { id: 'wanderer', title: 'Странник', author: 'Wesnoth · CC-BY-SA', src: '/audio/camp/wanderer.m4a' },
  { id: 'revelation', title: 'Откровение у костра', author: 'Wesnoth · CC-BY-SA', src: '/audio/camp/revelation.m4a' },
  { id: 'loyalists', title: 'Верные присяге', author: 'Wesnoth · CC-BY-SA', src: '/audio/camp/loyalists.m4a' }
 ],
 tavern: [
  { id: 'fill_the_mugs', title: 'Наполняйте кружки', author: 'Veloren · CC-BY-SA', src: '/audio/tavern/fill_the_mugs.m4a' },
  { id: 'a_tale_worth_telling', title: 'Славная быль', author: 'Veloren · CC-BY-SA', src: '/audio/tavern/a_tale_worth_telling.m4a' },
  { id: 'bustle_and_bloom', title: 'Шум и веселье', author: 'Veloren · CC-BY-SA', src: '/audio/tavern/bustle_and_bloom.m4a' },
  { id: 'traveling_minstrels', title: 'Бродячие менестрели', author: 'Wesnoth · CC-BY-SA', src: '/audio/tavern/traveling_minstrels.m4a' },
  { id: 'three_sheets', title: 'Хмельной перепляс', author: 'Wesnoth · CC-BY-SA', src: '/audio/tavern/three-sheets.m4a' },
  { id: 'knolls', title: 'Холмы и трактиры', author: 'Wesnoth · CC-BY-SA', src: '/audio/tavern/knolls.m4a' },
  { id: 'fiesta_del_pueblo', title: 'Праздник в селении', author: 'Veloren · CC-BY-SA', src: '/audio/tavern/fiesta_del_pueblo.m4a' }
 ],
 battle: [
  { id: 'battle-epic', title: 'Эпическая битва', author: 'Wesnoth · CC-BY-SA', src: '/audio/battle/battle-epic.m4a' },
  { id: 'legends_of_the_north', title: 'Легенды Севера', author: 'Wesnoth · CC-BY-SA', src: '/audio/battle/legends_of_the_north.m4a' },
  { id: 'battle_theme', title: 'Боевой натиск', author: 'Flare RPG · CC-BY-SA', src: '/audio/battle/battle_theme.m4a' },
  { id: 'boss_theme', title: 'Битва с боссом', author: 'Flare RPG · CC-BY-SA', src: '/audio/battle/boss_theme.m4a' },
  { id: 'battle_for_wesnoth', title: 'Битва за Веснот', author: 'Wesnoth · CC-BY-SA', src: '/audio/battle/battle.m4a' },
  { id: 'casualties_of_war', title: 'Жертвы войны', author: 'Wesnoth · CC-BY-SA', src: '/audio/battle/casualties_of_war.m4a' },
  { id: 'frantic', title: 'Неистовая схватка', author: 'Wesnoth · CC-BY-SA', src: '/audio/battle/frantic.m4a' },
  { id: 'siege_of_laurelmor', title: 'Осада Лорелмора', author: 'Wesnoth · CC-BY-SA', src: '/audio/battle/siege_of_laurelmor.m4a' }
 ],
 dungeon: [
  { id: 'dank_dungeon', title: 'Сырые катакомбы', author: 'Veloren · CC-BY-SA', src: '/audio/dungeon/dank_dungeon.m4a' },
  { id: 'cobbled_halls', title: 'Мощёные залы', author: 'Veloren · CC-BY-SA', src: '/audio/dungeon/cobbled_halls.m4a' },
  { id: 'cavernous_hollow', title: 'Пещерная глубина', author: 'Veloren · CC-BY-SA', src: '/audio/dungeon/cavernous_hollow.m4a' },
  { id: 'underground', title: 'Подземелье мрака', author: 'Wesnoth · CC-BY-SA', src: '/audio/dungeon/underground.m4a' },
  { id: 'the_deep_path', title: 'Тропа глубин', author: 'Wesnoth · CC-BY-SA', src: '/audio/dungeon/the_deep_path.m4a' },
  { id: 'ruination', title: 'Древние руины', author: 'Veloren · CC-BY-SA', src: '/audio/dungeon/ruination.m4a' },
  { id: 'cave_ambience', title: 'Эхо подземелий', author: 'Veloren · CC-BY-SA', src: '/audio/dungeon/cave.m4a' }
 ],
 forest: [
  { id: 'calling_wild', title: 'Зов дикой природы', author: 'Veloren · CC-BY-SA', src: '/audio/forest/calling_wild.m4a' },
  { id: 'between_the_fairies', title: 'Среди фей', author: 'Veloren · CC-BY-SA', src: '/audio/forest/between_the_fairies.m4a' },
  { id: 'elvish-theme', title: 'Эльфийские рощи', author: 'Wesnoth · CC-BY-SA', src: '/audio/forest/elvish-theme.m4a' },
  { id: 'silvan_sanctuary', title: 'Лесное святилище', author: 'Wesnoth · CC-BY-SA', src: '/audio/forest/silvan_sanctuary.m4a' },
  { id: 'transience', title: 'Дыхание рощи', author: 'Wesnoth · CC-BY-SA', src: '/audio/forest/transience.m4a' },
  { id: 'elf_land', title: 'Земли эльфов', author: 'Wesnoth · CC-BY-SA', src: '/audio/forest/elf-land.m4a' }
 ],
 rain: [
  { id: 'rain', title: 'Шумный ливень', author: 'Veloren · CC-BY-SA', src: '/audio/rain/rain.m4a' },
  { id: 'thunder', title: 'Далекие раскаты грома', author: 'Veloren · CC-BY-SA', src: '/audio/rain/thunder.m4a' },
  { id: 'river_quiet', title: 'Тихая лесная река', author: 'Veloren · CC-BY-SA', src: '/audio/rain/river_quiet.m4a' },
  { id: 'wind', title: 'Порывы ветра', author: 'Veloren · CC-BY-SA', src: '/audio/rain/wind.m4a' },
  { id: 'river_loud', title: 'Бурный речной поток', author: 'Veloren · CC-BY-SA', src: '/audio/rain/river_loud.m4a' }
 ],
 mystery: [
  { id: 'ethereal_bonds', title: 'Эфирные узы', author: 'Veloren · CC-BY-SA', src: '/audio/mystery/ethereal_bonds.m4a' },
  { id: 'stars_like_stalactites', title: 'Звёзды как сталактиты', author: 'Veloren · CC-BY-SA', src: '/audio/mystery/stars_like_stalactites.m4a' },
  { id: 'sacred_temple', title: 'Священный храм', author: 'Veloren · CC-BY-SA', src: '/audio/mystery/sacred_temple.m4a' },
  { id: 'suspense', title: 'Тревожное ожидание', author: 'Wesnoth · CC-BY-SA', src: '/audio/mystery/suspense.m4a' },
  { id: 'into_the_shadows', title: 'Во тьму теней', author: 'Wesnoth · CC-BY-SA', src: '/audio/mystery/into_the_shadows.m4a' },
  { id: 'mysty_temple', title: 'Туманное святилище', author: 'Veloren · CC-BY-SA', src: '/audio/mystery/mysty_temple.m4a' }
 ]
};

export class AmbientEngine {
 constructor() {
  this.currentTheme = 'off';
  this.shuffle = localStorage.getItem('skazitel-ambient-shuffle') !== 'false';

  // Randomize initial starting track index for each theme on app launch
  this.themeIndices = {
   camp: Math.floor(Math.random() * (THEME_TRACKS.camp?.length || 1)),
   tavern: Math.floor(Math.random() * (THEME_TRACKS.tavern?.length || 1)),
   battle: Math.floor(Math.random() * (THEME_TRACKS.battle?.length || 1)),
   dungeon: Math.floor(Math.random() * (THEME_TRACKS.dungeon?.length || 1)),
   forest: Math.floor(Math.random() * (THEME_TRACKS.forest?.length || 1)),
   rain: Math.floor(Math.random() * (THEME_TRACKS.rain?.length || 1)),
   mystery: Math.floor(Math.random() * (THEME_TRACKS.mystery?.length || 1))
  };

  this.currentAudio = null;
  this.fadeTimer = null;
  this.duckTimer = null;
  this.navDebounceTimer = null;
  this.lastNavTime = 0;
  this.volume = parseFloat(localStorage.getItem('skazitel-ambient-volume') || '0.35');
  this.isDucked = false;
  this.isMuted = localStorage.getItem('skazitel-ambient-muted') === 'true';

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
  this.onShuffleChange = null;
 }

 init() {
  if (this.currentAudio && this.currentAudio.paused && this.currentTheme !== 'off') {
   this.currentAudio.play().catch(() => {});
  }
 }

 setShuffle(val) {
  this.shuffle = !!val;
  localStorage.setItem('skazitel-ambient-shuffle', String(this.shuffle));
  this.onShuffleChange?.(this.shuffle);
 }

 toggleShuffle() {
  this.setShuffle(!this.shuffle);
  return this.shuffle;
 }

 getTargetVolume() {
  if (this.isMuted) return 0;
  return this.isDucked ? this.volume * 0.25 : this.volume;
 }

 setVolume(vol) {
  this.volume = Math.max(0, Math.min(1, vol));
  localStorage.setItem('skazitel-ambient-volume', String(this.volume));
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

 setTheme(theme, { force = false, randomize = true } = {}) {
  const normalized = this.themeLabels[theme] ? theme : 'camp';
  if (this.currentTheme === normalized && !force) return;

  this.currentTheme = normalized;
  if (normalized === 'off') {
   this.stopCurrent();
   this.onThemeChange?.(this.currentTheme);
   this.onTrackChange?.(null);
   return;
  }

  // Randomize track within the newly chosen theme when shuffle is on
  const tracks = THEME_TRACKS[normalized];
  if (this.shuffle && randomize && tracks && tracks.length > 1) {
   this.themeIndices[normalized] = Math.floor(Math.random() * tracks.length);
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

  const cur = this.themeIndices[this.currentTheme] || 0;
  if (this.shuffle && tracks.length > 1) {
   let nextIdx;
   do {
    nextIdx = Math.floor(Math.random() * tracks.length);
   } while (nextIdx === cur);
   this.themeIndices[this.currentTheme] = nextIdx;
  } else {
   this.themeIndices[this.currentTheme] = (cur + 1) % tracks.length;
  }

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

  prev.onended = null;
  prev.onerror = null;
  prev.oncanplay = null;

  try {
   prev.pause();
   prev.removeAttribute('src');
   prev.load();
  } catch {}
 }

 // High-fidelity recorded SFX via sfx.mjs (physical dice rolls & coin clinks)
 playDiceSound() {
  if (this.isMuted) return;
  playSfx('dice');
 }

 playCoinSound() {
  if (this.isMuted) return;
  playSfx('coin');
 }
}

export const ambientEngine = new AmbientEngine();
