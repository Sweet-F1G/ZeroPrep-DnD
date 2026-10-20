import {randomUUID} from 'node:crypto';
import {acceptReply} from './engine.mjs';
export function cleanNarrationForTTS(text){
 if(!text)return '';
 return String(text)
  .replace(/\*\*([^*]+)\*\*/g,'$1')
  .replace(/\*([^*]+)\*/g,'$1')
  .replace(/#{1,6}\s*/g,'')
  .replace(/^[\s*•-]+\s+/gm,'')
  .replace(/`([^`]+)`/g,'$1')
  .replace(/[ \t]+/g,' ')
  .trim();
}
export function narrationParts(text){
 const cleaned=cleanNarrationForTTS(text);
 return cleaned.split(/(?<=[.!?…])\s+(?=[А-ЯЁA-Z«“])/u).map(s=>s.trim()).filter(Boolean).reduce((a,s)=>{if(s.length>650){const words=s.split(/\s+/);let part='';for(const w of words){if(part.length+w.length>600){a.push(part);part='';}part+=(part?' ':'')+w;}if(part)a.push(part);}else a.push(s);return a;},[]);}
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
 entry.text+=(entry.text?' ':'')+d.parts[d.index++];
 if(d.index===d.parts.length){acceptReply(c,d.reply);const appended=c.journal.pop();entry=c.journal.find(e=>e.id===d.entryId);if(appended.tacticalHints)entry.tacticalHints=appended.tacticalHints;if(appended.automaticChanges)entry.automaticChanges=appended.automaticChanges;for(const record of c.dm?.changes||[])if(record.sourceId===appended.id)record.sourceId=entry.id;for(const note of c.memory||[])if(note.sourceId===appended.id)note.sourceId=entry.id;for(const record of c.dm?.world||[])if(record.sourceId===appended.id)record.sourceId=entry.id;for(const hero of c.characters){for(const award of hero.progression?.awards||[])if(award.sourceId===appended.id)award.sourceId=entry.id;}if(appended.illustrationSuggestion)entry.illustrationSuggestion=appended.illustrationSuggestion;for(const p of c.actionProposals||[])if(p.sourceId===appended.id)p.sourceId=entry.id;c.delivery=null;}
 return true;
}
export function interruptDelivery(c){const d=c.delivery;if(!d)return;const entry=c.journal.find(e=>e.id===d.entryId);if(entry&&!entry.text)c.journal=c.journal.filter(e=>e.id!==entry.id);c.delivery=null;}
export function publicDelivery(d){return d?{id:d.id,entryId:d.entryId,index:d.index,total:d.parts.length,text:d.parts[d.index],nextText:d.parts[d.index+1]||null}:null;}
