// Local activity gate. Audio stays on the machine until a completed utterance is submitted.
export class VoiceGate{
 constructor({onStart=()=>{},onEnd=()=>{}}={}){this.onStart=onStart;this.onEnd=onEnd;this.reset();this.noise=.003;}
 reset(){this.active=false;this.hot=0;this.quiet=0;this.parts=[];this.pre=[];this.duration=0;}
 feed(samples,rate,playing=false){
  const seconds=samples.length/rate;let square=0,crossings=0;for(let i=0;i<samples.length;i++){square+=samples[i]*samples[i];if(i&&samples[i]*samples[i-1]<0)crossings++;}
  const rms=Math.sqrt(square/samples.length),zcr=crossings/samples.length;
  const voiced=rms>Math.max(playing?.022:.012,this.noise*3.2)&&zcr>.003&&zcr<.55;
  const chunk=new Float32Array(samples);
  if(!this.active){this.pre.push(chunk);if(this.pre.length>4)this.pre.shift();this.hot=voiced?this.hot+seconds:0;if(!voiced)this.noise=.98*this.noise+.02*Math.min(rms,.012);
   if(this.hot>=.14){this.active=true;this.parts=this.pre.slice();this.pre=[];this.duration=this.hot;this.onStart();}
  }else{this.parts.push(chunk);this.duration+=seconds;this.quiet=voiced?0:this.quiet+seconds;if(this.quiet>=.5||this.duration>=30){const parts=this.parts,endedAt=performance.now()-this.quiet*1000;this.reset();this.onEnd(parts,rate,{endedAt});}}
 }
}
export class ContinuousMic{
 constructor(callbacks){this.gate=new VoiceGate(callbacks);this.active=false;this.generation=0;}
 async start(isPlaying){
  this.stop();const generation=this.generation;
  const stream=await navigator.mediaDevices.getUserMedia({audio:{echoCancellation:true,noiseSuppression:true,autoGainControl:true},video:false});
  if(generation!==this.generation){stream.getTracks().forEach(t=>t.stop());return;}
  const ctx=new AudioContext();await ctx.resume();if(generation!==this.generation){stream.getTracks().forEach(t=>t.stop());await ctx.close();return;}
  const source=ctx.createMediaStreamSource(stream),processor=ctx.createScriptProcessor(4096,1,1),gain=ctx.createGain();gain.gain.value=0;
  this.stream=stream;this.ctx=ctx;this.source=source;this.processor=processor;this.gain=gain;this.active=true;
  processor.onaudioprocess=e=>{if(this.active)this.gate.feed(e.inputBuffer.getChannelData(0),ctx.sampleRate,isPlaying());};
  source.connect(processor);processor.connect(gain);gain.connect(ctx.destination);
 }
 stop(){this.generation++;this.active=false;this.processor?.disconnect();this.source?.disconnect();this.gain?.disconnect();this.stream?.getTracks().forEach(t=>t.stop());this.ctx?.close().catch(()=>{});this.stream=null;this.ctx=null;this.gate.reset();}
}
export function addressed(text){return /(?:^|[\s,!.?])(?:мастер|сказитель)(?:[\s,!.?:]|$)/iu.test(text);}
export function speakingCharacter(text,characters){
 const normalized=text.toLocaleLowerCase('ru').replace(/ё/g,'е').replace(/^(?:мастер|сказитель)[\s,:.!-]*/u,'').trim();
 const matches=characters.filter(c=>{const name=c.name.toLocaleLowerCase('ru').replace(/ё/g,'е');return [name,name.split(/\s+/)[0]].some(n=>normalized.startsWith(n)&&(!normalized[n.length]||/[\s,:.!—-]/u.test(normalized[n.length])));});
 return matches.length===1?matches[0].id:null;
}

// Continuous mode sends speech directly; the review preference applies only to push-to-talk.
export function continuousTurnPlan(text,campaign,selectedId){
 if(campaign?.sessionZero&&!campaign.sessionZero.complete)return {action:'send'};
 if(campaign?.pending)return {action:'dice'};
 if(campaign?.proposals?.length)return {action:'blocked'};
 const characters=campaign?.characters||[],named=speakingCharacter(text,characters);
 if(named)return {action:'send',characterId:named};
 const normalized=text.toLocaleLowerCase('ru').replace(/ё/g,'е').replace(/^(?:мастер|сказитель)[\s,:.!-]*/u,'').trim();
 const ambiguous=characters.filter(c=>{const name=c.name.toLocaleLowerCase('ru').replace(/ё/g,'е').split(/\s+/)[0];return normalized.startsWith(name)&&(!normalized[name.length]||/[\s,:.!—-]/u.test(normalized[name.length]));}).length>1;
 if(ambiguous)return {action:'choose'};
 const selected=characters.find(c=>c.id===selectedId)||(characters.length===1?characters[0]:null);
 return selected?{action:'send',characterId:selected.id}:{action:'choose'};
}

// Spoken raw result is an explicit player submission, never a random number in a sentence.
export function spokenRoll(text,mode='normal'){
 const t=text.toLowerCase().replace(/ё/g,'е').trim().replace(/[.!?]+$/,'').replace(/^(?:мастер|сказитель)[, ]+/u,'').replace(/^(?:на кубиках|на кубике|на грани|выпало|результат броска|я выбросил|мой бросок|кубик|бросок|у меня|на d20|d20|roll is|rolled)\s*[:—-]?\s*/iu,'');
 const words=['один','два','три','четыре','пять','шесть','семь','восемь','девять','десять','одиннадцать','двенадцать','тринадцать','четырнадцать','пятнадцать','шестнадцать','семнадцать','восемнадцать','девятнадцать','двадцать'];
 const enWords=['one','two','three','four','five','six','seven','eight','nine','ten','eleven','twelve','thirteen','fourteen','fifteen','sixteen','seventeen','eighteen','nineteen','twenty'];
 const parts=t.split(/\s+и\s+|\s+and\s+|\s*[,;]\s*/iu);if(parts.length!==(mode==='normal'||!mode?1:2))return null;
 const parseVal=part=>{
  if(/^\d+$/.test(part))return Number(part);
  const ruIdx=words.indexOf(part);if(ruIdx!==-1)return ruIdx+1;
  const enIdx=enWords.indexOf(part);if(enIdx!==-1)return enIdx+1;
  return null;
 };
 const values=parts.map(parseVal);if(values.some(n=>!n||n<1||n>20))return null;return parts.length===1?values[0]:values;
}
export function spokenApproval(text){
 const t=text.toLowerCase().replace(/ё/g,'е').trim().replace(/[.!?]+$/,'');
 if(/^(?:(?:мастер|сказитель)[, ]+)?подтверждаю (?:изменения|изменение здоровья|урон)$/.test(t))return true;
 if(/^(?:(?:мастер|сказитель)[, ]+)?отклоняю (?:изменения|изменение здоровья|урон)$/.test(t))return false;
 return null;
}
export function spokenHpPlan(text,campaign){
 let input=text.toLowerCase().replace(/ё/g,'е').trim().replace(/^(?:мастер|сказитель)[, ]+/u,'');const named=speakingCharacter(input,campaign.characters||[]);
 if(named){const hero=campaign.characters.find(h=>h.id===named),variants=[hero.name,hero.name.split(/\s+/)[0]].map(n=>n.toLowerCase().replace(/ё/g,'е')).sort((a,b)=>b.length-a.length);for(const name of variants)if(input.startsWith(name)&&(!input[name.length]||/[\s,:.!—-]/u.test(input[name.length]))){input=input.slice(name.length).replace(/^[\s,:.!—-]+/u,'');break;}}
 const accept=spokenApproval(input),proposals=(campaign.proposals||[]).filter(p=>!named||p.characterId===named);return accept!==null&&proposals.length===1?{proposalId:proposals[0].id,characterId:proposals[0].characterId,accept}:null;
}
