import {randomUUID} from 'node:crypto';
import {acceptReply} from './engine.mjs';

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
  .replace(/^([А-ЯЁ][А-ЯЁа-яёA-Za-z0-9 _-]+)\s*—\s*/gmi,'')
  .replace(/^[\s*•-]+\s+/gm,'')
  .replace(/^[«"“]\s*/,'')
  .replace(/\s*[»"”]$/,'')
  .replace(/[ \t]+/g,' ')
  .trim();

 return s;
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
   
   const sentences = speech.split(/(?<=[.!?…])\s+(?=[А-ЯЁA-Z«“])/u).map(s => s.trim()).filter(Boolean);
   for (const sent of sentences) {
    parts.push(`[${speaker}] ${sent}`);
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
  if (/(?:Марта|Старуха|Альвари|Лира|Элия|Мира|женщин[а-я]*|девушк[а-я]*|эльфийк[а-я]*|жриц[а-я]*|трактирщиц[а-я]*|ведьм[а-я]*|королев[а-я]*|бабк[а-я]*|девочк[а-я]*|матер[а-я]*|хозяйк[а-я]*|чародейк[а-я]*|разбойниц[а-я]*|воительниц[а-я]*|[А-ЯЁ][а-яё]*(?:а|я|ия|эль|етта|ис|ова|ева))$/iu.test(speaker) && !/(?:Фёдор|Теон|Илья|Никита|Фома|дед|орк|гном)/iu.test(speaker)) {
   return (defaultVoice === 'nova' || defaultVoice === 'shimmer') ? defaultVoice : 'nova';
  }
  if (/(?:Теон|плут|бард|юнош[а-я]*|мальчик[а-я]*|парнишк[а-я]*|ловкач)/iu.test(speaker)) {
   return defaultVoice === 'echo' ? defaultVoice : 'echo';
  }
  if (/(?:орк|гоблин|чудовищ[а-я]*|демон|дракон|великан|тролль|князь)/iu.test(speaker)) {
   return 'onyx';
  }
  if (/(?:Мастер|Сказитель|Рассказчик|Фёдор)/iu.test(speaker)) {
   return defaultVoice || 'onyx';
  }
 }

 // Female characters / NPCs (Nova)
 const femalePattern = /(?<!\p{L})(?:женщин[а-я]*|девушк[а-я]*|эльфийк[а-я]*|жриц[а-я]*|трактирщиц[а-я]*|ведьм[а-я]*|королев[а-я]*|старух[а-я]*|бабк[а-я]*|девочк[а-я]*|матер[а-я]*|хозяйк[а-я]*|чародейк[а-я]*|разбойниц[а-я]*|воительниц[а-я]*|Альвари|Лира|Элия|Марта|она\s+(?:говорит|шепчет|отвечает|восклицает|спрашивает)|(?:сказала|ответила|прошептала|вскрикнула|спросила|улыбнулась)\s+она)(?!\p{L})/iu;
 if (femalePattern.test(textStr)) {
  return (defaultVoice === 'nova' || defaultVoice === 'shimmer') ? defaultVoice : 'nova';
 }

 // Youth / nimble companion / rogue / bard (Echo)
 const youthPattern = /(?<!\p{L})(?:мальчик[а-я]*|юнош[а-я]*|парнишк[а-я]*|плут[а-я]*|бард[а-я]*|Теон|молодой\s+(?:человек|парень|воин)|юный)(?!\p{L})/iu;
 if (youthPattern.test(textStr)) {
  return defaultVoice === 'echo' ? defaultVoice : 'echo';
 }

 // Heavy brute / monster / orc / demon / giant (Onyx)
 const brutePattern = /(?<!\p{L})(?:орк[а-я]*|гоблин[а-я]*|чудовищ[а-я]*|демон[а-я]*|дракон[а-я]*|великан[а-я]*|тролл[а-я]*|рычит|гремит|басом|чудищ[а-я]*)(?!\p{L})/iu;
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
