import {randomUUID} from 'node:crypto';
import {acceptReply} from './engine.mjs';

const YO_EXACT_WORDS = [
 [/(?<!\p{L})еще(?!\p{L})/giu, 'ещё'],
 [/(?<!\p{L})мое(?!\p{L})/giu, 'моё'],
 [/(?<!\p{L})твое(?!\p{L})/giu, 'твоё'],
 [/(?<!\p{L})свое(?!\p{L})/giu, 'своё'],
 [/(?<!\p{L})своем(?!\p{L})/giu, 'своём'],
 [/(?<!\p{L})твоем(?!\p{L})/giu, 'твоём'],
 [/(?<!\p{L})моем(?!\p{L})/giu, 'моём'],
 [/(?<!\p{L})о нем(?!\p{L})/giu, 'о нём'],
 [/(?<!\p{L})в нем(?!\p{L})/giu, 'в нём'],
 [/(?<!\p{L})на нем(?!\p{L})/giu, 'на нём'],
 [/(?<!\p{L})при нем(?!\p{L})/giu, 'при нём'],
 [/(?<!\p{L})о чем(?!\p{L})/giu, 'о чём'],
 [/(?<!\p{L})в чем(?!\p{L})/giu, 'в чём'],
 [/(?<!\p{L})на чем(?!\p{L})/giu, 'на чём'],
 [/(?<!\p{L})ни о чем(?!\p{L})/giu, 'ни о чём'],
 [/(?<!\p{L})дождем(?!\p{L})/giu, 'дождём'],
 [/(?<!\p{L})огнем(?!\p{L})/giu, 'огнём'],
 [/(?<!\p{L})копьем(?!\p{L})/giu, 'копьём'],
 [/(?<!\p{L})копье(?!\p{L})/giu, 'копьё'],
 [/(?<!\p{L})ружьем(?!\p{L})/giu, 'ружьём'],
 [/(?<!\p{L})ружье(?!\p{L})/giu, 'ружьё'],
 [/(?<!\p{L})котел(?!\p{L})/giu, 'котёл'],
 [/(?<!\p{L})костер(?!\p{L})/giu, 'костёр'],
 [/(?<!\p{L})пес(?!\p{L})/giu, 'пёс'],
 [/(?<!\p{L})лед(?!\p{L})/giu, 'лёд'],
 [/(?<!\p{L})мед(?!\p{L})/giu, 'мёд'],
 [/(?<!\p{L})слезы(?!\p{L})/giu, 'слёзы'],
 [/(?<!\p{L})слезами(?!\p{L})/giu, 'слёзами'],
 [/(?<!\p{L})колеса(?!\p{L})/giu, 'колёса'],
 [/(?<!\p{L})колесами(?!\p{L})/giu, 'колёсами'],
 [/(?<!\p{L})звезды(?!\p{L})/giu, 'звёзды'],
 [/(?<!\p{L})звездами(?!\p{L})/giu, 'звёздами'],
 [/(?<!\p{L})острие(?!\p{L})/giu, 'остриё'],
 [/(?<!\p{L})чутье(?!\p{L})/giu, 'чутьё'],
 [/(?<!\p{L})щелк(?!\p{L})/giu, 'щёлк'],
 [/(?<!\p{L})шел(?!\p{L})/giu, 'шёл'],
 [/(?<!\p{L})пошел(?!\p{L})/giu, 'пошёл'],
 [/(?<!\p{L})пошла(?!\p{L})/giu, 'пошла'],
 [/(?<!\p{L})пошло(?!\p{L})/giu, 'пошло'],
 [/(?<!\p{L})пришел(?!\p{L})/giu, 'пришёл'],
 [/(?<!\p{L})нашел(?!\p{L})/giu, 'нашёл'],
 [/(?<!\p{L})обошел(?!\p{L})/giu, 'обошёл'],
 [/(?<!\p{L})ушел(?!\p{L})/giu, 'ушёл'],
 [/(?<!\p{L})зашел(?!\p{L})/giu, 'зашёл'],
 [/(?<!\p{L})отошел(?!\p{L})/giu, 'отошёл'],
 [/(?<!\p{L})подошел(?!\p{L})/giu, 'подошёл'],
 [/(?<!\p{L})перешел(?!\p{L})/giu, 'перешёл']
];

const YO_STEMS = [
 [/(?<!\p{L})черт([а-я]*)(?!\p{L})/giu, 'чёрт'],
 [/(?<!\p{L})темн([оыаеую][йемухвм]?)(?!\p{L})/giu, 'тёмн'],
 [/(?<!\p{L})мертв([оыаеую][йемухвм]?)(?!\p{L})/giu, 'мёртв'],
 [/(?<!\p{L})тяжел([оыаеую][йемухвм]?)(?!\p{L})/giu, 'тяжёл'],
 [/(?<!\p{L})желт([оыаеую][йемухвм]?)(?!\p{L})/giu, 'жёлт'],
 [/(?<!\p{L})тепл([оыаеую][йемухвм]?)(?!\p{L})/giu, 'тёпл'],
 [/(?<!\p{L})легк([оыаеую][йемухвм]?)(?!\p{L})/giu, 'лёгк'],
 [/(?<!\p{L})зелен([оыаеую][йемухвм]?)(?!\p{L})/giu, 'зелён'],
 [/(?<!\p{L})четк([оыаеую][йемухвм]?)(?!\p{L})/giu, 'чётк'],
 [/(?<!\p{L})надежн([оыаеую][йемухвм]?)(?!\p{L})/giu, 'надёжн'],
 [/(?<!\p{L})весел([оыаеую][йемухвм]?)(?!\p{L})/giu, 'весёл']
];

const VSE_PHRASES = [
 [/(?<!\p{L})все равно(?!\p{L})/giu, 'всё равно'],
 [/(?<!\p{L})все еще(?!\p{L})/giu, 'всё ещё'],
 [/(?<!\p{L})все вокруг(?!\p{L})/giu, 'всё вокруг'],
 [/(?<!\p{L})все это(?!\p{L})/giu, 'всё это'],
 [/(?<!\p{L})вот и все(?!\p{L})/giu, 'вот и всё'],
 [/(?<!\p{L})и все же(?!\p{L})/giu, 'и всё же'],
 [/(?<!\p{L})все так же(?!\p{L})/giu, 'всё так же'],
 [/(?<!\p{L})все кончено(?!\p{L})/giu, 'всё кончено'],
 [/(?<!\p{L})все пропало(?!\p{L})/giu, 'всё пропало'],
 [/(?<!\p{L})все хорошо(?!\p{L})/giu, 'всё хорошо'],
 [/(?<!\p{L})все в порядке(?!\p{L})/giu, 'всё в порядке'],
 [/(?<!\p{L})оно все(?!\p{L})/giu, 'оно всё'],
 [/(?<!\p{L})это все(?!\p{L})/giu, 'это всё'],
 [/(?<!\p{L})все (тихо|спокойно|темно|ясно|понятно|затихло|кончилось|прошло|сгорело|готово|впереди|позади)(?!\p{L})/giu, 'всё $1']
];

export function normalizeIntonationAndStressForTTS(text){
 if(!text)return '';
 let s=String(text);

 // 1. Punctuation pauses and em-dash pacing
 s=s
  .replace(/--+/g,' — ')
  .replace(/(?<=\S)\s+-\s+(?=\S)/gu,' — ')
  .replace(/\.{2,}/g,'...')
  .replace(/\.{3}(?=[А-ЯЁа-яёA-Za-z«“])/gu,'... ')
  .replace(/(?<=[,;:!?])(?=[^\s\d,;:!?»”\)])/gu,' ')
  .replace(/\s+([,;:.!?»”])/gu,'$1');

 // 2. Common unambiguous phrases with "всё"
 for(const [re,rep] of VSE_PHRASES){
  if(rep.includes('$1')){
   s=s.replace(re,(match,p1)=>{
    const isCap=match[0]===match[0].toUpperCase();
    return (isCap?'Всё ':'всё ')+p1;
   });
  }else{
   s=s.replace(re,match=>{
    if(match[0]===match[0].toUpperCase()){
     return rep[0].toUpperCase()+rep.slice(1);
    }
    return rep;
   });
  }
 }

 // 3. Stems with grammatical endings
 for(const [re,rep] of YO_STEMS){
  s=s.replace(re,(match,ending)=>{
   const isCap=match[0]===match[0].toUpperCase();
   const stem=isCap?(rep[0].toUpperCase()+rep.slice(1)):rep;
   return stem+ending;
  });
 }

 // 4. Exact words with "ё" (guarantees accurate stress in OpenAI TTS)
 for(const [re,rep] of YO_EXACT_WORDS){
  s=s.replace(re,match=>{
   if(match[0]===match[0].toUpperCase()){
    return rep[0].toUpperCase()+rep.slice(1);
   }
   return rep;
  });
 }

 return s.trim();
}

export function expandDiceAndTermsForTTS(text){
 if(!text)return '';
 let s=String(text);
 const isRu=/[а-яё]/i.test(s);

 // 1. Dice formulas: 1d20+3 -> "1 дэ 20 плюс 3" / "1 d 20 plus 3"
 s=s.replace(/(?<![\p{L}\p{N}])(\d+)?\s*[dд](\d+)(?:\s*([+-])\s*(\d+))?(?![\p{L}\p{N}])/gui,(match,count,sides,sign,mod)=>{
  const dWord=isRu?'дэ':'d';
  let res=count?`${count} ${dWord} ${sides}`:`${dWord} ${sides}`;
  if(sign&&mod){
   const signWord=sign==='+'?(isRu?'плюс':'plus'):(isRu?'минус':'minus');
   res+=` ${signWord} ${mod}`;
  }
  return res;
 });

 // 2. Game acronyms and terms
 if(isRu){
  s=s
   .replace(/(?<![\p{L}\p{N}])(\d+)\s*(?:HP|ХП|хп)(?![\p{L}\p{N}])/gui,'$1 очков здоровья')
   .replace(/(?<![\p{L}\p{N}])(?:HP|ХП|хп)(?![\p{L}\p{N}])/gui,'очки здоровья')
   .replace(/(?<![\p{L}\p{N}])(?:КД|AC)\s*(\d+)(?![\p{L}\p{N}])/gui,'класс доспеха $1')
   .replace(/(?<![\p{L}\p{N}])(?:Сл|DC)\s*(\d+)(?![\p{L}\p{N}])/gui,'сложность $1')
   .replace(/(?<![\p{L}\p{N}])(\d+)\s*зм(?![\p{L}\p{N}])/gui,'$1 золотых')
   .replace(/(?<![\p{L}\p{N}])(\d+)\s*см(?![\p{L}\p{N}])/gui,'$1 серебряных')
   .replace(/(?<![\p{L}\p{N}])(\d+)\s*мм(?![\p{L}\p{N}])/gui,'$1 медных');
 }else{
  s=s
   .replace(/\b(\d+)\s*(?:HP|hp)\b/g,'$1 hit points')
   .replace(/\b(?:HP|hp)\b/g,'hit points')
   .replace(/\b(?:AC|ac)\s*(\d+)\b/g,'armor class $1')
   .replace(/\b(?:DC|dc)\s*(\d+)\b/g,'DC $1')
   .replace(/\b(\d+)\s*gp\b/g,'$1 gold pieces')
   .replace(/\b(\d+)\s*sp\b/g,'$1 silver pieces')
   .replace(/\b(\d+)\s*cp\b/g,'$1 copper pieces');
 }

 // 3. Normalize all-caps yelling words / sentences: "БЕГИТЕ!" -> "Бегите!"
 s=s.replace(/([.!?]\s*|^)([^.!?]+)/gu,(full,punct,sentence)=>{
  const letters=sentence.match(/[\p{L}]/gu)||[];
  const upperLetters=sentence.match(/[\p{Lu}]/gu)||[];
  if(letters.length>=3&&letters.length===upperLetters.length){
   const leadingSpaces=sentence.match(/^\s*/)[0];
   const trailingSpaces=sentence.match(/\s*$/)[0];
   let trimmed=sentence.trim().toLowerCase();
   if(/^(?:npc|rpg|dnd|str|dex|con|int|wis|cha|usa|url|api|pdf|dc)$/i.test(trimmed))return full;
   trimmed=trimmed.charAt(0).toUpperCase()+trimmed.slice(1);
   return punct+leadingSpaces+trimmed+trailingSpaces;
  }
  return full;
 });

 return s;
}

export function cleanNarrationForTTS(text){
 if(!text)return '';
 let s = String(text)
  .replace(/\*\*([^*]+)\*\*/g,'$1')
  .replace(/\*([^*]+)\*/g,'$1')
  .replace(/#{1,6}\s*/g,'')
  .replace(/`([^`]+)`/g,'$1');

 s = s
  .replace(/^[«"“]?\[(?:speaker:)?([^\]]+)\][:\s—-]*/gmi,'')
  .replace(/^[«"“]?([А-ЯЁ][А-ЯЁа-яёA-Za-z0-9 _-]+)\s*:\s*[—-]*/gmi,'')
  // An ordinary em dash is not a speaker delimiter: keep both "Князь —
  // красавец" and "На одной лапе — колечко". Only strip the legacy
  // Name — «quoted dialogue» format, also recognized by extractSpeaker.
  .replace(/^([А-ЯЁ][А-ЯЁа-яёA-Za-z0-9 _-]+)\s*—\s*(?=[«"“])/gmi,'')
  .replace(/^[\s*•-]+\s+/gm,'')
  .replace(/^[«"“]\s*/,'')
  .replace(/\s*[»"”]$/,'')
  .replace(/[ \t]+/g,' ')
  .trim();

 s = expandDiceAndTermsForTTS(s);

 return normalizeIntonationAndStressForTTS(s);
}

export function extractSpeaker(text) {
 if (!text) return null;
 const stripped = String(text)
  .replace(/\*\*([^*]+)\*\*/g,'$1')
  .replace(/\*([^*]+)\*/g,'$1');
 const m = stripped.match(/^[«"“]?\[(?:speaker:)?([^\]]+)\]/iu)
        || stripped.match(/^[«"“]?([А-ЯЁ][А-ЯЁа-яёA-Za-z0-9 _-]+)\s*:/iu)
        || stripped.match(/^([А-ЯЁ][А-ЯЁа-яёA-Za-z0-9 _-]+)\s*—\s*[«"“]/iu);
 return m ? m[1].trim() : null;
}

function normalizeSpeakerPrefix(line) {
 return line
  .replace(/^(\*{1,2}|_{1,2})([А-ЯЁ][А-ЯЁа-яёA-Za-z0-9 _-]+)\1\s*:/u, '$2:')
  .replace(/^(\*{1,2}|_{1,2})([А-ЯЁ][А-ЯЁа-яёA-Za-z0-9 _-]+):\1\s*/u, '$2: ')
  .replace(/^(\*{1,2}|_{1,2})\[([А-ЯЁа-яёA-Za-z0-9 _-]+)\]\1\s*:/u, '[$2]:')
  .replace(/^([А-ЯЁ][А-ЯЁа-яёA-Za-z0-9 _-]+)\s*—\s*([«"“])/u, '$1: $2');
}

export function narrationParts(text){
 if (!text) return [];
 const raw = String(text);
 const normalized = raw
  .replace(/(?<=[.!?…»”])\s+(?=(?:\[[А-ЯЁа-яёA-Za-z0-9 _-]+\]|(?:\*{1,2}|_{1,2})?[А-ЯЁ][А-ЯЁа-яёA-Za-z0-9 _-]+(?:\*{1,2}|_{1,2})?\s*:))/gu, '\n');
 const lines = normalized.split(/\n+/).map(l => l.trim()).filter(Boolean);
 const parts = [];

 for (let line of lines) {
  line = normalizeSpeakerPrefix(line);
  // 1. Explicit speaker tag: [Старуха]: ... or [Старуха] ... or Старуха: ...
  const tagMatch = line.match(/^[«"“]?\[([А-ЯЁа-яёA-Za-z0-9 _-]+)\][:\s—-]*(.*)$/u) 
                || line.match(/^[«"“]?([А-ЯЁ][А-ЯЁа-яёA-Za-z0-9 _-]+)\s*:\s*(?:—\s*)?(.*)$/u);

  if (tagMatch) {
   const speaker = tagMatch[1].trim();
   const speech = tagMatch[2].trim();
   if (!speech) continue;
   
   const sentences = speech.split(/(?<=[.!?…][»"”]?)\s+(?=[А-ЯЁA-Z«“])/u).map(s => s.trim()).filter(Boolean);
   let inQuotes = speech.startsWith('«') || speech.startsWith('"') || speech.startsWith('“');
   let quoteClosed = false;

   for (const sent of sentences) {
    if (quoteClosed) {
     parts.push(sent);
    } else {
     parts.push(`[${speaker}] ${sent}`);
     if (inQuotes && (sent.endsWith('»') || sent.endsWith('"') || sent.endsWith('”') || sent.includes('»') || sent.includes('”'))) {
      quoteClosed = true;
     }
    }
   }
   continue;
  }

  // 2. Multi-sentence paragraphs with possible dialogue
  const sentences = line.split(/(?<=[.!?…])\s+(?=[А-ЯЁA-Z«“—])/u).map(s => s.trim()).filter(Boolean);
  let activeSpeaker = null;

  for (let i = 0; i < sentences.length; i++) {
   const sent = sentences[i];
   const isQuote = sent.startsWith('—') || sent.startsWith('«') || sent.startsWith('"');

   if (isQuote && !activeSpeaker && i > 0) {
    const prev = sentences[i - 1];
    const m = prev.match(/(?<!\p{L})(Старуха|Марта|Фёдор|Теон|Альвари|жрица|девушка|женщина|бабка|ведьма|орк|рыцарь|кузнец|трактирщица|хозяйка)(?!\p{L})/iu);
    if (m) activeSpeaker = m[1];
   }

   if (isQuote && activeSpeaker) {
    parts.push(`[${activeSpeaker}] ${sent}`);
   } else if (activeSpeaker && !/^(?:Она|Он|Они|Мастер|Ведущий|Брось|Что|Внезапно|Но|И|Тогда|После)\b/u.test(sent)) {
    parts.push(`[${activeSpeaker}] ${sent}`);
   } else {
    activeSpeaker = null;
    parts.push(sent);
   }
  }
 }

 return parts.reduce((a, s) => {
  if (s.length > 650) {
   const words = s.split(/\s+/);
   let part = '';
   for (const w of words) {
    if (part.length + w.length > 600) { a.push(part); part = ''; }
    part += (part ? ' ' : '') + w;
   }
   if (part) a.push(part);
  } else a.push(s);
  return a;
 }, []);
}

export function stageReply(c,reply){
 acceptReply(structuredClone(c),reply); // Validate the full protocol without committing consequences.
 const entry={id:randomUUID(),role:'assistant',text:'',at:new Date().toISOString()};c.journal.push(entry);
 c.pending=null;c.proposals=[];c.reaction=null;
 c.delivery={id:randomUUID(),entryId:entry.id,parts:narrationParts(reply.narration),index:0,reply};
}

export function advanceDelivery(c,id,index){
 const d=c.delivery;if(!d||d.id!==id)return false;
 if(index!==d.index)return false; // Idempotent acknowledgement; never skip a segment.
 let entry=c.journal.find(e=>e.id===d.entryId);if(!entry)throw Error('Не найдено начало реплики');
 const partText = d.parts[d.index++].replace(/^\[[^\]]+\]\s*/, '');
 entry.text+=(entry.text?' ':'')+partText;
 if(d.index===d.parts.length){
  acceptReply(c,d.reply);
  const appended=c.journal.pop();
  entry=c.journal.find(e=>e.id===d.entryId);
  entry.text=d.reply.narration;
  if(appended.tacticalHints)entry.tacticalHints=appended.tacticalHints;
  if(appended.automaticChanges)entry.automaticChanges=appended.automaticChanges;
  for(const record of c.dm?.changes||[])if(record.sourceId===appended.id)record.sourceId=entry.id;
  for(const note of c.memory||[])if(note.sourceId===appended.id)note.sourceId=entry.id;
  for(const record of c.dm?.world||[])if(record.sourceId===appended.id)record.sourceId=entry.id;
  for(const hero of c.characters){for(const award of hero.progression?.awards||[])if(award.sourceId===appended.id)award.sourceId=entry.id;}
  if(appended.illustrationSuggestion)entry.illustrationSuggestion=appended.illustrationSuggestion;
  for(const p of c.actionProposals||[])if(p.sourceId===appended.id)p.sourceId=entry.id;
  c.delivery=null;
 }
 return true;
}

export function interruptDelivery(c){const d=c.delivery;if(!d)return;const entry=c.journal.find(e=>e.id===d.entryId);if(entry&&!entry.text)c.journal=c.journal.filter(e=>e.id!==entry.id);c.delivery=null;}

export function publicDelivery(d){
 return d?{
  id:d.id,
  entryId:d.entryId,
  index:d.index,
  total:d.parts.length,
  text:d.parts[d.index],
  displayText:d.parts[d.index]?.replace(/^\[[^\]]+\]\s*/,'')||'',
  nextText:d.parts[d.index+1]||null
 }:null;
}

export function resolveOpenAiVoice(defaultVoice = 'onyx', text = '') {
 if (!text) return defaultVoice || 'onyx';
 const textStr = String(text);

 const speaker = extractSpeaker(textStr);
 if (speaker) {
  if (/(?:Марта|Старуха|Альвари|Лира|Элия|Мира|Martha|Alvari|Lyra|Elia|Mira|женщин[а-я]*|девушк[а-я]*|эльфийк[а-я]*|жриц[а-я]*|трактирщиц[а-я]*|ведьм[а-я]*|королев[а-я]*|бабк[а-я]*|девочк[а-я]*|матер[а-я]*|хозяйк[а-я]*|чародейк[а-я]*|разбойниц[а-я]*|воительниц[а-я]*|woman|girl|witch|priestess|queen|innkeeper|lady|sorceress|[А-ЯЁ][а-яё]*(?:а|я|ия|эль|етта|ис|ова|ева))$/iu.test(speaker) && !/(?:Фёдор|Теон|Илья|Никита|Фома|дед|орк|гном|Fedor|Theon)/iu.test(speaker)) {
   return (defaultVoice === 'nova' || defaultVoice === 'shimmer') ? defaultVoice : 'nova';
  }
  if (/(?:Теон|плут|бард|юнош[а-я]*|мальчик[а-я]*|парнишк[а-я]*|ловкач|Theon|rogue|bard|youth|boy|lad)/iu.test(speaker)) {
   return defaultVoice === 'echo' ? defaultVoice : 'echo';
  }
  if (/(?:орк|гоблин|чудовищ[а-я]*|демон|дракон|великан|тролль|князь|orc|goblin|monster|demon|dragon|giant|troll|brute)/iu.test(speaker)) {
   return 'onyx';
  }
  if (/(?:Мастер|Сказитель|Рассказчик|Фёдор|DM|Narrator|GM)/iu.test(speaker)) {
   return defaultVoice || 'onyx';
  }
 }

 // Female characters / NPCs (Nova)
 const femalePattern = /(?<!\p{L})(?:женщин[а-я]*|девушк[а-я]*|эльфийк[а-я]*|жриц[а-я]*|трактирщиц[а-я]*|ведьм[а-я]*|королев[а-я]*|старух[а-я]*|бабк[а-я]*|девочк[а-я]*|матер[а-я]*|хозяйк[а-я]*|чародейк[а-я]*|разбойниц[а-я]*|воительниц[а-я]*|Альвари|Лира|Элия|Марта|Martha|Alvari|Lyra|Elia|Mira|woman|girl|witch|priestess|queen|innkeeper|lady|sorceress|она\s+(?:говорит|шепчет|отвечает|восклицает|спрашивает)|(?:сказала|ответила|прошептала|вскрикнула|спросила|улыбнулась)\s+она|she\s+(?:says|whispers|replies|asks|shouts)|(?:said|whispered|asked|replied)\s+she)(?!\p{L})/iu;
 if (femalePattern.test(textStr)) {
  return (defaultVoice === 'nova' || defaultVoice === 'shimmer') ? defaultVoice : 'nova';
 }

 // Youth / nimble companion / rogue / bard (Echo)
 const youthPattern = /(?<!\p{L})(?:мальчик[а-я]*|юнош[а-я]*|парнишк[а-я]*|плут[а-я]*|бард[а-я]*|Теон|молодой\s+(?:человек|парень|воин)|юный|Theon|youth|boy|lad|rogue|bard|young\s+(?:man|warrior|hero))(?!\p{L})/iu;
 if (youthPattern.test(textStr)) {
  return defaultVoice === 'echo' ? defaultVoice : 'echo';
 }

 // Heavy brute / monster / orc / demon / giant (Onyx)
 const brutePattern = /(?<!\p{L})(?:орк[а-я]*|гоблин[а-я]*|чудовищ[а-я]*|демон[а-я]*|дракон[а-я]*|великан[а-я]*|тролл[а-я]*|рычит|гремит|басом|чудищ[а-я]*|orc|goblin|monster|demon|dragon|giant|troll|beast|brute|growls|roars)(?!\p{L})/iu;
 if (brutePattern.test(textStr)) {
  return 'onyx';
 }

 return defaultVoice || 'onyx';
}

export function resolveEdgeVoice(defaultVoice = 'ru-RU-DmitryNeural', text = '') {
 if (!text) return defaultVoice || 'ru-RU-DmitryNeural';
 const textStr = String(text);
 const speaker = extractSpeaker(textStr);
 if (speaker && /(?:Марта|Старуха|Альвари|Лира|Элия|Мира|женщин[а-я]*|девушк[а-я]*|эльфийк[а-я]*|жриц[а-я]*|трактирщиц[а-я]*|ведьм[а-я]*|королев[а-я]*|бабк[а-я]*|девочк[а-я]*|матер[а-я]*|хозяйк[а-я]*|чародейк[а-я]*|разбойниц[а-я]*|воительниц[а-я]*|[А-ЯЁ][а-яё]*(?:а|я|ия|эль|етта|ис|ова|ева))$/iu.test(speaker) && !/(?:Фёдор|Теон|Илья|Никита|Фома|дед|орк|гном)/iu.test(speaker)) {
  return 'ru-RU-SvetlanaNeural';
 }
 const femalePattern = /(?<!\p{L})(?:женщин[а-я]*|девушк[а-я]*|эльфийк[а-я]*|жриц[а-я]*|трактирщиц[а-я]*|ведьм[а-я]*|королев[а-я]*|старух[а-я]*|бабк[а-я]*|девочк[а-я]*|матер[а-я]*|хозяйк[а-я]*|чародейк[а-я]*|разбойниц[а-я]*|воительниц[а-я]*|Альвари|Лира|Элия|Марта|она\s+(?:говорит|шепчет|отвечает|восклицает|спрашивает)|(?:сказала|ответила|прошептала|вскрикнула|спросила|улыбнулась)\s+она)(?!\p{L})/iu;
 if (femalePattern.test(textStr)) {
  return 'ru-RU-SvetlanaNeural';
 }
 return defaultVoice || 'ru-RU-DmitryNeural';
}
