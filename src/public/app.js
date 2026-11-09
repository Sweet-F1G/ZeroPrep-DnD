import {ContinuousMic,addressed,speakingCharacter,continuousTurnPlan,spokenRoll,spokenApproval,spokenHpPlan} from '/voice-input.mjs';
const $=id=>document.getElementById(id), token=document.querySelector('meta[name="app-token"]').content;
import {skills,abilities,skillAbilities,editions} from '/rule-data.mjs';
import {LiveVoice} from '/live-voice.mjs';
import {SpeechPrefetch} from '/speech-prefetch.mjs';
import {ambientEngine} from '/ambient-sound.mjs';
import {playSfx, toggleSfx, isSfxEnabled} from '/sfx.mjs';
import {translations, getLanguage, setLanguage, t, initLanguage, applyTranslations} from '/i18n.mjs';
let activeSpeechRequest=null;
let deliveryPlaying=false,refreshJob=null;
let mapWindowFloating = localStorage.getItem('skazitel-map-floating') !== '0';
let mapWindowMinimized = false;
let mapWindowMaximized = false;
const speechPrefetch=new SpeechPrefetch((text,signal)=>loadSpeech(text,null,signal));
let liveDelegating=false;
const liveVoice=new LiveVoice({api,delegate:async(text,id)=>{
 const campaignId=activeId;if(!current())throw Error('Выберите кампанию');
 if(busy)throw Error('Предыдущий ход ещё обрабатывается');
 liveDelegating=true;
 try{
  const before=current().journal.filter(x=>x.role==='assistant').at(-1)?.id;
  if(!(await handleTableSpeech(text))){const plan=continuousTurnPlan(text,current(),selectedId);if(plan.action!=='send')return plan.message||'Уточните имя героя и действие.';selectedId=plan.characterId||selectedId;await turn({text,requestId:'live-'+id},{keepDraft:true});}
  if(activeId!==campaignId)return 'Игра переключена на другую кампанию.';
  const c=current(),latest=c.journal.filter(x=>x.role==='assistant').at(-1);
  if(latest&&latest.id!==before)return latest.text;
  if(c.pending)return 'Назовите результат физического броска: на кубике четырнадцать.';
  if(c.proposals.length||c.actionProposals?.length)return 'Есть изменения, ожидающие подтверждения игроков. Назовите героя и подтвердите или отклоните предложение.';
  return 'Действие обработано. Проверьте обновлённые данные на игровом столе.';
 }finally{liveDelegating=false;}
},status:message=>{if(state){$('listenState').textContent=message;renderListening();}},onError:error=>toast('Live: '+error.message)});
let voiceLatency=null;
function finishVoiceLatency(){if(!voiceLatency)return;const row=voiceLatency;voiceLatency=null;const totalMs=performance.now()-row.endedAt,speechMs=row.speechStarted?performance.now()-row.speechStarted:0;$('voiceLatency').textContent='Ответ через '+(totalMs/1000).toFixed(1)+' с';api('voice-latency',{totalMs,sttMs:row.sttMs,turnMs:row.turnMs,speechMs}).catch(()=>{});}
let lastVisibleHeroId=null;
let state,activeId=localStorage.getItem('skazitel-active'),selectedId,busy=false,toastTimer,currentAudio,currentAudioURL,speechVersion=0,recording=null,recordStarting=false,recordHeld=false,spaceHeld=false,interruptionActive=false,voiceActive=false,clockRequest=false,clockTimedOut=null,spaceTimer,speechDone=null,deliveryRun=0,deliveryCancel=null,voiceQueue=[],voiceProcessing=false,voiceEpoch=0;
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
function toast(message){$('toast').textContent=message;$('toast').hidden=false;clearTimeout(toastTimer);toastTimer=setTimeout(()=>$('toast').hidden=true,9000);}
function askConfirm({title='Подтверждение',message,okText='Удалить безвозвратно'}){
 return new Promise(resolve=>{
  const dlg=$('confirmDialog');
  if(!dlg){resolve(confirm(message));return;}
  $('confirmTitle').textContent=title;
  $('confirmMessage').textContent=message;
  $('confirmOkBtn').textContent=okText;
  let done=false;
  const finish=val=>{if(done)return;done=true;dlg.close();resolve(val);};
  $('confirmOkBtn').onclick=()=>finish(true);
  $('confirmCancelBtn').onclick=()=>finish(false);
  dlg.onclose=()=>finish(false);
  dlg.showModal();
 });
}
async function api(route,data){const r=await fetch('/api/'+route,{method:data===undefined?'GET':'POST',headers:{'x-app-token':token,...(data===undefined?{}:{'Content-Type':'application/json'})},...(route==='live-meter'?{keepalive:true}:{}),...(data===undefined?{}:{body:JSON.stringify({requestId:crypto.randomUUID(),...data})})});if(!r.ok){const e=await r.json();throw Error(e.error||'Ошибка сервера');}return r.json();}
function current(){return state?.campaigns.find(x=>x.id===activeId);}
function setBusy(value,label){busy=value;$('listeningMode').disabled=value||!!recording||recordStarting;document.body.classList.toggle('busy',value);$('status').textContent=label||(value?t('statusBusy'):t('statusIdle'));for(const id of ['send','mic','begin','undo','new','sessionZero','seed','import','settings','export','editHeroes'])$(id).disabled=value;document.querySelectorAll('#rollForm button,#proposals button').forEach(el=>el.disabled=value);}
function choose(id){if(busy||recording||recordStarting)return;stopListening();pauseReactionClock();haltNarration();interruptionActive=false;lastKnownMapHash='';activeId=id;localStorage.setItem('skazitel-active',id);api('settings',{activeCampaignId:id}).catch(()=>{});selectedId=null;render();scrollToLatest();}
function scrollToLatest(){const target=current()?.pending?$('rollPanel'):$('journal').lastElementChild;target?.scrollIntoView({block:'end'});}
function render(){
 applyTranslations();
 const c=current();$('campaigns').innerHTML=state.campaigns.map(x=>`<div class="campaign-item-row"><button class="campaign-item ${x.id===activeId?'active':''}" data-campaign="${x.id}">${esc(x.name)}<small>${x.characters.length} ${getLanguage()==='en'?'heroes':'героя'} · ${x.journal.length} ${t('eventsCount').toLowerCase()}</small></button><button class="campaign-delete-btn" data-delete-campaign="${x.id}" title="${getLanguage()==='en'?'Delete campaign':'Удалить партию'} «${esc(x.name)}»" aria-label="Delete «${esc(x.name)}»" type="button">✕</button></div>`).join('');
 $('providerDot').textContent=state.config.provider==='demo'?'◌':'●';$('welcome').hidden=!!c;$('table').hidden=!c;$('export').disabled=!c;$('undo').disabled=!c?.canUndo||busy;
 renderSessionCost(state.usage);renderListening();if(!c)return;
 if(!c.characters.some(x=>x.id===selectedId))selectedId=c.characters[0]?.id;
 $('crumb').textContent=c.name;$('title').textContent=c.name;$('settingText').title=c.setting;$('settingText').textContent=c.sessionZero&&!c.sessionZero.complete?(state.config.provider==='demo'?(getLanguage()==='en'?`Session Zero · Question ${c.sessionZero.step+1} of 5`:`Нулевая сессия · ${c.sessionZero.step===5?'проверка договорённостей':`вопрос ${c.sessionZero.step+1} из 5`} · отвечайте голосом или текстом`):(getLanguage()==='en'?'Adventure Prep · Discuss the world and heroes with the DM':'Подготовка приключения · Обсудите мир и героев с Мастером')):c.setting;
 $('modeBadge').hidden=state.config.provider!=='demo'&&state.lastTextRoute?.provider!=='openrouter.ai';$('modeBadge').title=(editions[c.edition]||editions.legacy)+' · '+(state.lastTextRoute?.model||state.config.model);$('modeBadge').textContent=state.lastTextRoute?.provider==='openrouter.ai'&&state.config.reserveProvider==='openrouter'?'FREE RESERVE · GEMMA 4 31B':state.config.provider==='demo'?(getLanguage()==='en'?'DEMO NO-AI':'УЧЕБНЫЙ РЕЖИМ · БЕЗ ИИ'):`${state.config.provider.toUpperCase()} · ${state.config.model}`;
 const scene=(c.images||[]).findLast(i=>i.kind==='scene'&&i.status==='ready');$('sceneArt').hidden=!scene;if(scene){$('sceneArtImage').src='/images/'+scene.file;$('sceneArtImage').alt=scene.prompt;}
 $('entryCount').textContent=`${c.journalTotal??c.journal.length} ${t('eventsCount')}`;

 $('journal').innerHTML=c.journal.map((x,i)=>{if(x.role==='user'&&x.text==='Игрок подтвердил операцию с листом, памятью или вещами.')return '';let text=x.text;const verified=x.role==='system'&&text.startsWith('VERIFIED_ROLL ');if(verified){try{const r=JSON.parse(text.slice(14));text=`${r.character} · ${r.kind==='save'?'Спасбросок · ':r.kind==='death'?'От смерти · ':''}${skills[r.skill]}: d20 ${r.dice?.length===2?'['+r.dice.join(', ')+'] → ':''}${r.raw} ${r.bonus>=0?'+':'−'} ${Math.abs(r.bonus)} = ${r.total} / Сл ${r.dc} · ${r.success?'Успех':'Провал'}`;}catch{}}
 if(x.role==='system'&&!verified)return `<details class="compact-event"><summary>◇ ${esc(text.split('\n')[0].slice(0,140))}</summary><p>${esc(text)}</p></details>`;
  return `<article class="entry ${esc(x.role)}${x.isWhisper?' is-whisper':''}"><div class="entry-label"><span>${x.isWhisper?'<span class="whisper-badge">🤫 ШЁПОТ</span>':''}${x.role==='assistant'?'✦ СКАЗИТЕЛЬ':x.role==='user'?'ДЕЙСТВИЕ ГЕРОЯ':'◇ ИГРОВОЕ СОБЫТИЕ'}</span><time>${new Date(x.at).toLocaleTimeString('ru-RU',{hour:'2-digit',minute:'2-digit'})}</time></div><p>${esc(text)}${c.delivery?.entryId===x.id?`<span class="narrating">${text?' ':''}${esc(c.delivery.displayText||c.delivery.text?.replace(/^\[[^\]]+\]\s*/,'')||'')}</span>`:''}</p>${x.role==='assistant'?`<button class="replay" data-replay="${i}">▷ Озвучить</button>`:''}${x.automaticChanges?.length?`<details class="automatic-changes"><summary>✓ Записано мастером · ${x.automaticChanges.length}</summary>${x.automaticChanges.map(t=>`<p>${esc(t)}</p>`).join('')}</details>`:''}${x.tacticalHints?.length?`<div class="tactical-hints">${x.tacticalHints.map(h=>`<p>✦ ${esc(h.text)}</p>`).join('')}</div>`:''}${x.illustrationSuggestion?`<div class="image-suggestion"><span>✧ ${esc(x.illustrationSuggestion.reason)}</span><button class="quiet" data-suggest-image="${x.id}">Предлагаю иллюстрацию ↗</button></div>`:''}</article>`;}).slice(-50).join('');
 const pw=$('partyWallet');if(pw)pw.textContent=money(c.wallet?.group||0);
 const charsEl=$('characters');if(charsEl)charsEl.innerHTML=c.characters.map(renderHero).join('');
 if(lastVisibleHeroId!==selectedId){document.querySelector('.hero.selected')?.scrollIntoView({block:'nearest'});lastVisibleHeroId=selectedId;}
 $('speaker').innerHTML=c.characters.map(x=>`<option value="${x.id}">${esc(x.name)}</option>`).join('');$('speaker').value=selectedId;
 $('sessionZeroGuide').hidden=!c.sessionZero||c.sessionZero.complete;
 const boostNotice=$('sessionZeroBoostNotice');
 if(boostNotice){
  const boostActive=c.sessionZero&&!c.sessionZero.complete&&state.config.provider==='openai'&&/^gpt-6(?:[.-]|$)/.test(state.config.model)&&state.config.sessionZeroBoost!=='off';
  boostNotice.innerHTML=boostActive?'<br><strong style="color:var(--accent-glow,#79c0ff);">🧠 Включён умный буст рассуждений:</strong> Мастер глубоко продумывает сюжет, фракции, NPC и героев (high reasoning).':'';
 }
 $('partyHints').hidden=true;$('speaker').hidden=!!c.sessionZero&&!c.sessionZero.complete;$('editHeroes').disabled=busy||!c.characters.length;
 $('startHint').hidden=!!c.journal.length;$('rollPanel').hidden=!c.pending;
 if(c.pending){const p=c.pending,h=c.characters.find(x=>x.id===p.characterId),bonus=p.kind==='death'?0:p.kind==='save'?h.saves[p.skill]:h.bonuses[p.skill];$('rollTitle').textContent=`${h.name} · ${p.kind==='save'?'Спасбросок: ':p.kind==='death'?'От смерти: ':''}${skills[p.skill]} · Сл ${p.dc}`;$('rollStakes').textContent=`${p.reason}. ${p.stakes}`;$('rollMath').textContent=`${p.mode==='advantage'?'Два d20, больший':p.mode==='disadvantage'?'Два d20, меньший':'d20'} ${bonus>=0?'+':''}${bonus} → итог`;$('secondDieLabel').hidden=!p.mode||p.mode==='normal';$('raw2').required=!$('secondDieLabel').hidden;if($('raw').dataset.pending!==JSON.stringify(p)){$('raw').value='';$('raw2').value='';$('raw').dataset.pending=JSON.stringify(p);}}
 $('actionProposals').innerHTML=(c.actionProposals||[]).map((p,i)=>`<div class="proposal"><strong>Действие ${i+1}</strong><p>${esc(actionDescription(p.action,c))}</p><button data-action-proposal="${p.id}" data-accept="yes">Подтвердить</button><button data-action-proposal="${p.id}" data-accept="no">Отклонить</button><small>Голосом: «подтверждаю действие${c.actionProposals.length>1?' '+(i+1):''}»</small></div>`).join('');
 $('proposals').innerHTML=c.proposals.map(p=>`<div class="proposal">${esc(c.characters.find(x=>x.id===p.characterId)?.name)}: HP ${p.hpDelta>0?'+':''}${p.hpDelta}. ${esc(p.reason)}<br><button data-proposal="${p.id}" data-accept="yes">✓ Применить</button><button data-proposal="${p.id}" data-accept="no">Отклонить</button></div>`).join('');
 $('reactionPanel').hidden=!c.reaction;if(c.reaction){$('reactionPrompt').textContent=c.reaction.prompt;$('reactionStakes').textContent=c.reaction.stakes;}
 $('passReaction').disabled=busy;$('reactNow').disabled=busy;
 if(!busy&&!recording)$('status').textContent=c.reaction?'Сцена на паузе — ждём решения игроков':interruptionActive?'Мастер прерван — ваша реплика':state.config.listeningMode==='continuous'?(ambientMic.active?'Мастер слушает игроков':'Включите микрофон для постоянного прослушивания'):'Мастер слушает по кнопке';
 $('send').disabled=busy||!!c.pending||!!c.proposals.length;$('message').disabled=!!c.pending||!!c.proposals.length;$('mic').disabled=busy;
 renderCombatTracker();
 renderTacticalHud();
 const mapCount=c.maps?.length||0,mapTokensCount=(c.maps||[]).reduce((acc,m)=>acc+(m.tokens?.length||0),0),currentMapHash=`${mapCount}:${mapTokensCount}`;
 if(lastKnownMapHash&&lastKnownMapHash!==currentMapHash&&mapCount>0){
  if(!tacticalHudOpen){toggleTacticalHud(true);switchHudTab('map');}
  const statusEl=$('hudStatus');
  if(statusEl){statusEl.textContent='● Карта обновлена';setTimeout(()=>{if(statusEl.textContent==='● Карта обновлена')statusEl.textContent='';},4500);}
 }
 lastKnownMapHash=currentMapHash;
 if($('ambientAutoSync')?.checked){
  const targetTheme=c.encounter?.active?'battle':(c.dm?.ambient||'camp');
  ambientEngine.setTheme(targetTheme);
 }
}
async function refresh(){
 if(refreshJob)return refreshJob;
 refreshJob=(async()=>{
  state=await api('state');
  if(!current())activeId=state.campaigns.find(c=>c.id===state.config.activeCampaignId)?.id||state.campaigns[0]?.id;
  render();scrollToLatest();
  const d=current()?.delivery;
  if(d&&!busy&&!deliveryPlaying&&!voiceActive&&!interruptionActive&&!liveVoice.active&&!liveDelegating){
   if($('autoVoice')?.checked&&state.config.ttsProvider!=='off')void playDelivery();
   else {state=await api('delivery',{id:activeId,deliveryId:d.id,action:'finish'});render();}
  }
 })();
 try{await refreshJob;}finally{refreshJob=null;}
}
function stopVoice(){speechPrefetch.clear();activeSpeechRequest?.abort();activeSpeechRequest=null;speechDone?.(false);speechDone=null;speechVersion++;voiceActive=false;ambientEngine.setDucked(false);if(currentAudio){currentAudio.pause();currentAudio.remove();currentAudio=null;}if(currentAudioURL){URL.revokeObjectURL(currentAudioURL);currentAudioURL=null;}window.speechSynthesis?.cancel();window.webkit?.messageHandlers?.nativeVoice?.postMessage({stop:true});if(state)renderListening();}
async function loadSpeech(text,preview,signal){
 const isEdgePreview=preview&&(preview.startsWith('ru-RU-')||preview==='edge');
 const isOpenAIPreview=preview&&(preview.startsWith('openai:')||['onyx','fable','echo','alloy','nova','shimmer'].includes(preview));
 const isElevenPreview=preview&&(preview.startsWith('elevenlabs:'));
 if(!preview&&(state.config.ttsProvider==='openai'||state.config.ttsProvider==='edge'||state.config.ttsProvider==='elevenlabs')){
  const r=await fetch('/api/speech-prepare',{method:'POST',signal,headers:{'Content-Type':'application/json','x-app-token':token},body:JSON.stringify({text})});
  if(!r.ok)throw Error((await r.json()).error);const prepared=await r.json();
  const cancel=()=>api('speech-cancel',{ticket:prepared.url.split('/').at(-1)}).catch(()=>{});
  if(signal?.aborted)cancel();else signal?.addEventListener('abort',cancel,{once:true});
  // WKWebView can probe media URLs with multiple Range requests. Consume the
  // one-use ticket via fetch, then give its decoder a stable, seekable Blob URL.
  const audio=await fetch(prepared.url,{signal});if(!audio.ok)throw Error('Не удалось получить аудио: HTTP '+audio.status);
  const blob=await audio.blob();if(!blob.size)throw Error('Сервис вернул пустое аудио');return blob;
 }
 const voiceParam=isEdgePreview?{preview:'edge',voice:preview}:isOpenAIPreview?{preview:'openai',voice:preview.replace(/^openai:/,''),ttsModel:$('settingsForm')?.elements?.ttsModel?.value||'tts-1'}:isElevenPreview?{preview:'elevenlabs',voice:preview.replace(/^elevenlabs:/,''),elevenModel:$('settingsForm')?.elements?.elevenModel?.value||'eleven_flash_v2_5'}:preview?{preview:'silero',speaker:preview}:{};
 const r=await fetch('/api/speech',{method:'POST',signal,headers:{'Content-Type':'application/json','x-app-token':token},body:JSON.stringify({text,...voiceParam})});
 if(!r.ok)throw Error((await r.json()).error);return r.blob();
}
async function speak(text,preview=null,delivery=null){
 if(liveDelegating)return true;
 const prepared=delivery?speechPrefetch.take(delivery.key):null;
 const isEdgePreview=preview&&(preview.startsWith('ru-RU-')||preview==='edge');
 const isOpenAIPreview=preview&&(preview.startsWith('openai:')||['onyx','fable','echo','alloy','nova','shimmer'].includes(preview));
 const isElevenPreview=preview&&(preview.startsWith('elevenlabs:'));
 stopVoice();const version=speechVersion,provider=isEdgePreview?'edge':isOpenAIPreview?'openai':isElevenPreview?'elevenlabs':preview?'silero':state.config.ttsProvider;if(provider==='off')return true;
 voiceActive=true;ambientEngine.setDucked(true);renderListening();
 const completed=new Promise(resolve=>{speechDone=resolve;});
 try{
  if(provider==='openai'||provider==='silero'||provider==='edge'||provider==='elevenlabs'){
   activeSpeechRequest=prepared?.controller||new AbortController();
   let blob;if(prepared){const result=await prepared.promise;if(!result.ok)throw result.error;blob=result.value;}else blob=await loadSpeech(text,preview,activeSpeechRequest.signal);
   if(version!==speechVersion)return false;
   currentAudioURL=URL.createObjectURL(blob);currentAudio=new Audio(currentAudioURL);currentAudio.id='masterAudio';currentAudio.hidden=true;document.getElementById('masterAudio')?.remove();document.body.append(currentAudio);
   currentAudio.onplaying=()=>{$('voicePlayback').textContent='● Голос звучит';finishVoiceLatency();};
   currentAudio.onended=()=>voiceFinished(version);currentAudio.onerror=()=>{toast('Не удалось воспроизвести аудио · код '+(currentAudio?.error?.code||'неизвестен'));voiceFinished(version,false);};await currentAudio.play();
   if(version===speechVersion&&delivery?.nextText)speechPrefetch.warm(delivery.nextKey,delivery.nextText);
   if(preview){
    if(isEdgePreview)$('edgeStatus').textContent='Воспроизводится выбранный голос Edge.';
    else if(isOpenAIPreview)$('openaiStatus').textContent='Воспроизводится выбранный голос OpenAI.';
    else if(isElevenPreview)$('elevenlabsStatus').textContent='Воспроизводится выбранный голос ElevenLabs.';
    else $('sileroStatus').textContent='Воспроизводится выбранный голос Silero.';
   }
  }else if(window.webkit?.messageHandlers?.nativeVoice){window.webkit.messageHandlers.nativeVoice.postMessage({text,speechId:version});}
  else{
   if(!window.speechSynthesis)throw Error('Системный голос недоступен');
   const u=new SpeechSynthesisUtterance(text);u.lang='ru-RU';u.onend=()=>voiceFinished(version);u.onerror=()=>voiceFinished(version,false);speechSynthesis.speak(u);
  }
 }catch(e){if(version===speechVersion){voiceFinished(version,false);toast('Озвучивание: '+e.message);if(preview){if(isEdgePreview)$('edgeStatus').textContent=e.message;else if(isOpenAIPreview)$('openaiStatus').textContent=e.message;else $('sileroStatus').textContent=e.message;}}}
 return completed;
}
async function cancelDelivery(){
 const c=current(),d=c?.delivery;if(!d)return;
 if(deliveryCancel)return deliveryCancel;
 const campaignId=c.id;
 deliveryCancel=api('delivery',{id:campaignId,deliveryId:d.id,action:'interrupt'}).then(next=>{if(activeId===campaignId){state=next;render();}}).catch(e=>toast(e.message)).finally(()=>{deliveryCancel=null;});
 return deliveryCancel;
}
function haltNarration(){deliveryRun++;stopVoice();return cancelDelivery();}
async function playDelivery(){
 if(deliveryPlaying)return;
 deliveryPlaying=true;
 try {
 if(voiceLatency)voiceLatency.speechStarted=performance.now();
 const run=++deliveryRun,campaignId=activeId;
 while(run===deliveryRun&&activeId===campaignId&&current()?.delivery){
  const d=current().delivery;
  $('status').textContent=`Мастер говорит · часть ${d.index+1}/${d.total} · пробел — перебить`;
  const ok=await speak(d.text,null,{key:d.id+':'+d.index,nextKey:d.id+':'+(d.index+1),nextText:d.nextText});
  if(run!==deliveryRun)return;
  if(!ok){await cancelDelivery();return;}
  try{const next=await api('delivery',{id:campaignId,deliveryId:d.id,index:d.index,action:'ack'});if(run!==deliveryRun)return;state=next;render();$('journal').lastElementChild?.scrollIntoView({block:'end'});}
  catch(e){toast(e.message);await haltNarration();return;}
 }
 }finally{deliveryPlaying=false;}
}
async function turn(data,{keepDraft=false}={}){
 if(busy)return;
 await haltNarration();const voiceAtStart=speechVersion;setBusy(true);let shouldPlay=false;
 try{
  const turnStarted=performance.now();const sendingInterrupted=interruptionActive;interruptionActive=false;
  if(state?.config?.vision!=='off'&&visionStream)captureVisionFrame().catch(()=>{});
  state=await api('turn',{id:activeId,characterId:selectedId,interrupted:sendingInterrupted,rollId:current()?.pending?.id,visionObservation:state?.config?.vision!=='off'?latestVisionObservation:undefined,voiceDelivery:!liveDelegating&&!liveVoice.active&&$('autoVoice').checked&&state.config.ttsProvider!=='off',...data});
  if(voiceLatency)voiceLatency.turnMs=performance.now()-turnStarted;
  const interruptedDuringReply=speechVersion!==voiceAtStart;interruptionActive=interruptedDuringReply;if(!keepDraft)$('message').value='';render();$('mic').focus({preventScroll:true});
  if(current()?.delivery){if(interruptedDuringReply)await cancelDelivery();else shouldPlay=true;}
  else if(!liveDelegating&&!liveVoice.active&&$('autoVoice').checked&&!interruptedDuringReply){const latest=current().journal.filter(x=>x.role==='assistant').at(-1);if(latest)speak(latest.text);}
  setTimeout(()=>{const target=current()?.pending?$('rollPanel'):$('journal').lastElementChild;target?.scrollIntoView({behavior:'smooth',block:'end'});},50);
 }catch(e){voiceLatency=null;toast(e.message);if(liveDelegating)throw e;}finally{setBusy(false);render();}
 if(shouldPlay)playDelivery();
}
function resourceFields(r={}){return `<div class="resource-form" data-resource-id="${esc(r.id||crypto.randomUUID())}"><div class="two-col"><label>Название<input data-resource="name" value="${esc(r.name||'')}" required></label><label>Восстановление<select data-resource="recovery">${Object.entries({manual:r.resetOn?'По событию, указанному ниже':'Только вручную',shortRest:'Короткий и долгий отдых',longRest:'Долгий отдых',turn:'Начало хода · вручную',gameTime:'Игровое время',recharge:'Бросок перезарядки · вручную'}).map(([k,v])=>`<option value="${k}" ${r.recovery===k?'selected':''}>${v}</option>`).join('')}</select></label></div><label>Полное восстановление при событии<select data-resource="resetOn">${Object.entries({none:"Не привязано к событию",scene:"Новая сцена",battle:"Новый бой",session:"Новая игровая сессия",adventure:"Новое приключение"}).map(([k,v])=>`<option value="${k}" ${(r.resetOn||"none")===k?"selected":""}>${v}</option>`).join("")}</select></label><p class="dialog-note">Событие фиксирует мастер по ходу игры. Перезапуск приложения и повторное объявление того же события не восстанавливают применения.</p><div class="bonus-grid">${[['max','Максимум',r.max??1],['current','Осталось',r.current??r.max??1],['recoverAmount','Восстановить за короткий отдых',r.recoverAmount??r.max??1],['minutes','Игровых минут',r.minutes??60]].map(([k,v,n])=>`<label ${k==='minutes'&&r.recovery!=='gameTime'||k==='recoverAmount'&&!['shortRest','gameTime'].includes(r.recovery)?'hidden':''}>${v}<input data-resource="${k}" type="number" min="${k==='current'?0:1}" max="525600" value="${n}" required></label>`).join('')}</div><button type="button" data-remove-resource class="quiet">Убрать ресурс</button></div>`;}
function heroFields(c={}){return `<div class="hero-form" ${c.id?`data-id="${c.id}"`:''}><div class="two-col"><label>Имя<input data-field="name" value="${esc(c.name||'')}" required maxlength="80"></label><label>Описание<input data-field="description" value="${esc(c.description||'')}" maxlength="500"></label></div><div class="two-col"><label>Класс<input data-field="className" value="${esc(c.className||'')}"></label><label>Уровень<input data-field="level" type="number" min="1" max="20" value="${c.level??1}" required></label></div><div class="bonus-grid">${[['maxHp','Максимум HP',c.maxHp??20,1,9999],['hp','Текущие HP',c.hp??c.maxHp??20,0,9999],['tempHp','Временные HP',c.tempHp??0,0,9999],['ac','КД',c.ac??12,0,50]].map(([k,v,n,min,max])=>`<label>${v}<input data-field="${k}" type="number" min="${min}" max="${max}" value="${n}" required></label>`).join('')}</div><details><summary>Характеристики, навыки и спасброски</summary><label>Бонусы<select data-field="bonusMode"><option value="manual" ${c.bonusMode!=='calculated'?'selected':''}>Готовые числа из листа · ручной режим</option><option value="calculated" ${c.bonusMode==='calculated'?'selected':''}>Считать по характеристикам и владению</option></select></label><div class="calculated-fields" ${c.bonusMode!=='calculated'?'hidden':''}><div class="bonus-grid">${Object.entries(abilities).map(([k,v])=>`<label>${v}<input data-score="${k}" type="number" min="1" max="30" value="${c.abilityScores?.[k]??10}" required></label>`).join('')}</div><div class="bonus-grid">${Object.entries(skillAbilities).map(([k])=>`<label>${skills[k]}<select data-training="${k}">${['Без владения','Владение','Экспертиза'].map((v,i)=>`<option value="${i}" ${(c.training?.[k]||0)===i?'selected':''}>${v}</option>`).join('')}</select></label>`).join('')}</div><div class="bonus-grid">${Object.entries(abilities).map(([k,v])=>`<label>Спасбросок: ${v}<select data-save-training="${k}"><option value="0">Без владения</option><option value="1" ${c.saveTraining?.[k]?'selected':''}>Владение</option></select></label>`).join('')}</div></div><div class="manual-fields" ${c.bonusMode==='calculated'?'hidden':''}><div class="bonus-grid">${Object.entries(skills).map(([k,v])=>`<label>${v}<input data-bonus="${k}" type="number" min="-20" max="50" value="${c.bonuses?.[k]??0}" required></label>`).join('')}</div><div class="bonus-grid">${Object.entries(abilities).map(([k,v])=>`<label>Спасбросок: ${v}<input data-save="${k}" type="number" min="-20" max="50" value="${c.saves?.[k]??c.bonuses?.[k]??0}" required></label>`).join('')}</div></div></details><details><summary>Способности, ячейки и заряды</summary><p class="dialog-note">Добавляйте только известные из листа значения. Класс пока не заполняет их автоматически. Ход и перезарядка отмечаются вручную; отдых и игровое время восстанавливают заданные ресурсы.</p><div class="resource-forms">${(c.resources||[]).map(resourceFields).join('')}</div><button type="button" data-add-resource class="quiet">＋ Ресурс или ячейки заклинаний</button></details><details><summary>Кости здоровья</summary><p class="dialog-note">Уровень меняет бонус мастерства в режиме расчёта. Количество костей, классовые способности и ячейки при повышении уровня нужно сверить с листом.</p><div class="bonus-grid">${[['size','Граней',c.hitDice?.size??8],['max','Всего костей',c.hitDice?.max??c.level??1],['current','Осталось',c.hitDice?.current??c.level??1]].map(([k,v,n])=>`<label>${v}<input data-hit-dice="${k}" type="number" min="${k==='current'?0:k==='size'?4:1}" max="${k==='size'?12:20}" value="${n}" required></label>`).join('')}</div></details><details><summary>Состояния и заметки</summary><label>Состояния через запятую<input data-list="conditions" value="${esc((c.conditions||[]).join(', '))}"></label><label>Концентрация<input data-field="concentration" value="${esc(c.concentration||'')}"></label><label>Заметки<textarea data-field="notes">${esc(c.notes||'')}</textarea></label></details></div>`;}
function readHeroes(container){return [...container.querySelectorAll('.hero-form')].map(el=>{const old=current()?.characters.find(h=>h.id===el.dataset.id)||{},c={...old,sheetVerified:true,id:el.dataset.id,bonuses:{},saves:{},abilityScores:{},training:{},saveTraining:{},resources:[]};el.querySelectorAll('[data-field]').forEach(x=>c[x.dataset.field]=x.type==='number'?Number(x.value):x.value);for(const [attribute,key] of [['bonus','bonuses'],['save','saves'],['score','abilityScores'],['training','training'],['save-training','saveTraining']])el.querySelectorAll(`[data-${attribute}]`).forEach(x=>c[key][x.getAttribute('data-'+attribute)]=Number(x.value));c.hitDice={};el.querySelectorAll('[data-hit-dice]').forEach(x=>c.hitDice[x.dataset.hitDice]=Number(x.value));c.conditions=el.querySelector('[data-list="conditions"]').value.split(',').map(s=>s.trim()).filter(Boolean);el.querySelectorAll('.resource-form').forEach(row=>{const previous=old.resources?.find(r=>r.id===row.dataset.resourceId)||{};const r={...previous,id:row.dataset.resourceId};row.querySelectorAll('[data-resource]').forEach(x=>r[x.dataset.resource]=x.type==='number'?Number(x.value):x.value);if(r.resetOn==='none')r.resetOn=null;c.resources.push(r);});return c;});}
document.addEventListener('click',e=>{const add=e.target.closest('[data-add-resource]'),remove=e.target.closest('[data-remove-resource]');if(add)add.closest('.hero-form').querySelector('.resource-forms').insertAdjacentHTML('beforeend',resourceFields());if(remove)remove.closest('.resource-form').remove();});
document.addEventListener('change',e=>{if(e.target.matches('[data-field="bonusMode"]')){const form=e.target.closest('.hero-form');form.querySelector('.manual-fields').hidden=e.target.value==='calculated';form.querySelector('.calculated-fields').hidden=e.target.value!=='calculated';}});
function openNew(){stopListening();pauseReactionClock();$('campaignForm').reset();$('heroForms').innerHTML=heroFields();$('campaignDialog').showModal();}
async function created(route,data){setBusy(true,'Готовим игровой стол…');try{state=await api(route,data);activeId=state.activeId;localStorage.setItem('skazitel-active',activeId);api('settings',{activeCampaignId:activeId}).catch(()=>{});selectedId=null;render();scrollToLatest();}catch(e){toast(e.message);}finally{setBusy(false);render();}}
$('new').onclick=openNew;$('welcomeNew').onclick=openNew;
if($('startPersona'))$('startPersona').onchange=()=>{$('customPersonaGroup').hidden=$('startPersona').value!=='custom';};
$('sessionZero').onclick=()=>{stopListening();pauseReactionClock();$('startForm').reset();if($('customPersonaGroup'))$('customPersonaGroup').hidden=true;$('startDialog').showModal();};
$('startForm').onsubmit=async e=>{e.preventDefault();const f=new FormData(e.target);const persona=f.get('persona')||'realist_dreamer',personaDetails=persona==='custom'?(f.get('personaCustom')||''):'';$('startDialog').close();await created('create',{name:f.get('name'),edition:f.get('edition'),persona,personaDetails,sessionZero:true,characters:[]});if($('autoVoice').checked)speak(current()?.journal.at(-1)?.text||'');$('mic').focus();};
$('seed').onclick=$('welcomeSeed').onclick=()=>created('create',{seed:true});
$('campaignForm').onsubmit=async e=>{e.preventDefault();const f=new FormData(e.target);$('campaignDialog').close();await created('create',{name:f.get('name'),edition:f.get('edition'),persona:f.get('persona')||'realist_dreamer',setting:f.get('setting'),source:f.get('source'),characters:readHeroes($('heroForms'))});};
$('addHero').onclick=()=>{if($('heroForms').children.length>=6)return toast('В форме демо максимум 6 героев.');$('heroForms').insertAdjacentHTML('beforeend',heroFields());};
$('sourceFile').onchange=async e=>{const f=e.target.files[0];if(!f)return;if(f.size>200000)return toast('Файл должен быть не больше 200 КБ.');$('campaignForm').elements.source.value=await f.text();};
let openAIModelsCache=null;
async function loadOpenAIModels(force=false){
 const sel=$('openaiModelSelect'),refreshBtn=$('refreshOpenAIModels'),statusEl=$('modelSelectStatus');
 if(!sel)return;
 if(openAIModelsCache&&!force){
  renderOpenAIModelOptions(openAIModelsCache);
  return;
 }
 if(refreshBtn){refreshBtn.disabled=true;refreshBtn.textContent='…';}
 if(statusEl){statusEl.hidden=false;statusEl.textContent='Загрузка списка моделей по вашему API-ключу…';}
 try{
  const r=await fetch('/api/openai/models',{headers:{'x-app-token':token}});
  const data=await r.json();
  if(!r.ok||!data.ok)throw Error(data.error||'Не удалось загрузить модели');
  openAIModelsCache=data.models||[];
  renderOpenAIModelOptions(openAIModelsCache);
  if(statusEl)statusEl.textContent=`Доступно моделей по вашему ключу: ${openAIModelsCache.length}`;
 }catch(err){
  renderOpenAIModelOptions(['gpt-6-luna','gpt-4o','gpt-4o-mini','o3','o3-mini','o1','o1-mini','gpt-5-preview']);
  if(statusEl)statusEl.textContent=`Не удалось обновить список с сервера (${err.message}). Выберите из базовых или введите вручную.`;
 }finally{
  if(refreshBtn){refreshBtn.disabled=false;refreshBtn.textContent='↻';}
 }
}
function renderOpenAIModelOptions(models){
 const sel=$('openaiModelSelect'),f=$('settingsForm');
 if(!sel||!f)return;
 const currentVal=f.elements.model?.value||'gpt-6.1-terra';
 const recommended=['gpt-6.1-terra','gpt-6-luna','gpt-6.1-sol','gpt-4o','gpt-4o-mini','o3','o3-mini','o1','o1-mini','gpt-5-preview','gpt-5.4-mini'];
 const recSet=new Set(recommended);
 const recAvailable=[],otherAvailable=[];
 for(const id of models){
  if(recSet.has(id))recAvailable.push(id);
  else otherAvailable.push(id);
 }
 recAvailable.sort((a,b)=>recommended.indexOf(a)-recommended.indexOf(b));
 if(!recAvailable.includes('gpt-6-luna'))recAvailable.unshift('gpt-6-luna');
 otherAvailable.sort();
 let html='';
 if(recAvailable.length){
  html+='<optgroup label="Рекомендуемые модели">';
  for(const id of recAvailable){
   const label=id==='gpt-6-luna'?'✦ gpt-6-luna (Основная для Сказителя)':id;
   html+=`<option value="${esc(id)}">${esc(label)}</option>`;
  }
  html+='</optgroup>';
 }
 if(otherAvailable.length){
  html+='<optgroup label="Все модели по вашему API-ключу">';
  for(const id of otherAvailable){
   html+=`<option value="${esc(id)}">${esc(id)}</option>`;
  }
  html+='</optgroup>';
 }
 html+='<optgroup label="Другой вариант"><option value="__custom__">✎ Ввести вручную…</option></optgroup>';
 sel.innerHTML=html;
 const hasOpt=[...sel.options].some(o=>o.value===currentVal);
 if(hasOpt)sel.value=currentVal;
 else sel.value='__custom__';
 updateModelFieldVisibility();
}
function updateModelFieldVisibility(){
 const f=$('settingsForm'),sel=$('openaiModelSelect'),refreshBtn=$('refreshOpenAIModels'),input=f?.elements?.model;
 if(!f||!input)return;
 const isOpenAI=f.elements.provider.value==='openai';
 if(!isOpenAI){
  if(sel)sel.hidden=true;
  if(refreshBtn)refreshBtn.style.display='none';
  if($('modelSelectStatus'))$('modelSelectStatus').hidden=true;
  input.hidden=f.elements.provider.value==='demo';
  input.required=f.elements.provider.value!=='demo';
  return;
 }
 if(sel)sel.hidden=false;
 if(refreshBtn)refreshBtn.style.display='';
 if(sel&&sel.value==='__custom__'){
  input.hidden=false;
  input.required=true;
  input.placeholder='Точный ID модели из кабинета провайдера';
 }else{
  input.hidden=true;
  input.required=false;
  if(sel&&sel.value)input.value=sel.value;
 }
}
function voiceControls(){
 const f=$('settingsForm'),live=f.elements.voicePipeline.value==='live',text=f.elements.provider.value,stt=f.elements.sttProvider.value,tts=f.elements.ttsProvider.value;
 let sharedGroq=false;try{sharedGroq=text==='compatible'&&new URL(f.elements.baseUrl.value).hostname==='api.groq.com';}catch{}
 const show=(name,used)=>{const field=f.elements[name];field.disabled=!used;field.closest('label').hidden=!used;};
 show('serviceTier',text==='openai');show('liveModel',live);$('liveNote').hidden=!live;show('imageModel',f.elements.imageProvider.value==='openai');show('imageQuality',f.elements.imageProvider.value==='openai');show('sttProvider',!live);show('sttModel',!live);show('ttsProvider',!live);
 show('model',text!=='demo');show('baseUrl',text==='compatible');show('reasoningEffort',text==='openai'&&/^gpt-6(?:[.-]|$)/.test(f.elements.model.value));show('sessionZeroBoost',text==='openai'&&/^gpt-6(?:[.-]|$)/.test(f.elements.model.value));$('openaiCacheNote').hidden=text!=='openai';
 updateModelFieldVisibility();
 for(const name of ['openai','gemini','compatible','groq','elevenlabs']){
  const used=({openai:text==='openai'||stt==='openai'||tts==='openai',gemini:text==='gemini'||stt==='gemini',compatible:text==='compatible'&&!sharedGroq||f.elements.reserveProvider.value==='openrouter',groq:sharedGroq||stt==='groq',elevenlabs:tts==='elevenlabs'})[name];
  const section=$('keyPools').querySelector(`[data-pool="${name}"]`);
  if(section){section.hidden=name==='compatible'&&sharedGroq&&f.elements.reserveProvider.value!=='openrouter';section.querySelector('.pool-use').textContent=used?'Используется сейчас':'Сейчас не используется';}
 }
 f.elements.reserveProvider.disabled=!sharedGroq;if(!sharedGroq)f.elements.reserveProvider.value='off';
 $('reserveNote').hidden=!sharedGroq;
 $('sttKeyNote').textContent=(stt==='groq'&&sharedGroq?'Ведущий и распознавание используют список ключей Groq. ':'')+'Запись отправляется в выбранный сервис; на диск она не сохраняется.';
 $('sileroControls').hidden=live||tts!=='silero';f.elements.sileroSpeaker.disabled=tts!=='silero';
 $('testSilero').disabled=!state.localVoice?.installed;
 $('openaiControls').hidden=live||tts!=='openai';if(f.elements.voice)f.elements.voice.disabled=tts!=='openai';if(f.elements.ttsModel)f.elements.ttsModel.disabled=tts!=='openai';
 $('sileroStatus').textContent=state.localVoice?.installed?'Silero установлен. Озвучивание на вашем компьютере, без API-ключа.':'Silero пока не установлен: нужна папка LocalVoice рядом с приложением.';
 $('edgeControls').hidden=live||tts!=='edge';if(f.elements.edgeVoice)f.elements.edgeVoice.disabled=tts!=='edge';
 $('elevenlabsControls').hidden=live||tts!=='elevenlabs';
 if(f.elements.elevenVoice)f.elements.elevenVoice.disabled=tts!=='elevenlabs';
 if(f.elements.elevenModel)f.elements.elevenModel.disabled=tts!=='elevenlabs';
 const customVoice=f.elements.elevenVoice?.value==='__custom__';
 if($('elevenCustomVoiceLabel'))$('elevenCustomVoiceLabel').hidden=!customVoice||tts!=='elevenlabs';
 if(f.elements.elevenCustomVoice)f.elements.elevenCustomVoice.disabled=!customVoice||tts!=='elevenlabs';
 const names={demo:'Учебный режим',openai:'OpenAI',gemini:'Gemini',compatible:sharedGroq?'Groq':'Совместимый API',groq:'Groq Whisper',silero:'Silero локально',edge:'Edge Neural онлайн',elevenlabs:'ElevenLabs Flash',system:'Системный голос',off:'Без озвучивания'};
 $('connectionSummary').textContent='Ведущий: '+names[text]+(live?' · Голосовой канал: OpenAI Live':' · Распознавание: '+names[stt]+' · Голос: '+names[tts]);
}
const poolNames={groq:'Groq',openai:'OpenAI',gemini:'Gemini',compatible:'Совместимый API',elevenlabs:'ElevenLabs'};
function poolRow(row={},index=0){
 const saved=!!row.saved;
 let status=saved?(state.keyStorage?.persistent?'✓ Сохранён в Связке ключей macOS':'✓ Подключён в этом сеансе'):'Новый · ещё не сохранён';
 if(row.status!==null&&row.status!==undefined){status+=row.status>=200&&row.status<300?' · Последний запрос успешен':` · Последний отказ: ${row.status?'HTTP '+row.status:'сеть'}`;}
 if(row.retryAt>Date.now())status+=' · Пауза для этого запроса до '+new Date(row.retryAt).toLocaleTimeString('ru-RU');
 return `<div class="key-row" data-key-id="${esc(row.id||crypto.randomUUID())}" data-saved="${saved}"><div class="key-row-heading"><strong class="key-role">${index?'Резерв '+index:'Основной'}</strong><div class="key-row-actions"><button type="button" data-key-action="up" aria-label="Переместить ключ выше">↑</button><button type="button" data-key-action="down" aria-label="Переместить ключ ниже">↓</button><button type="button" data-key-action="remove">Удалить</button></div></div><span class="key-save-state">${esc(status)}</span><label>API-ключ<input type="password" autocomplete="new-password" spellcheck="false" aria-label="${index?'Резервный':'Основной'} API-ключ" placeholder="${saved?'•••••••• — сохранён; ввод нужен только для замены':'Вставьте новый API-ключ'}"></label></div>`;
}
function renumberPool(section){
 const rows=[...section.querySelectorAll('.key-row')];rows.forEach((r,i)=>{r.querySelector('.key-role').textContent=i?'Резерв '+i:'Основной';r.querySelector('[data-key-action="up"]').disabled=i===0;r.querySelector('[data-key-action="down"]').disabled=i===rows.length-1;});
 section.querySelector('.pool-count').textContent='Ключей: '+rows.length;
}
function keyFields(){
 $('keyPools').innerHTML=Object.entries(poolNames).map(([name,title])=>{
  const rows=state.keyPools?.[name]||[];
  return `<details class="key-pool" data-pool="${name}" ${name===($('settingsForm').elements.provider.value==='openai'?'openai':'groq')?'open':''}><summary>${title} <span class="pool-count">Ключей: ${rows.length}</span></summary><p class="pool-use"></p><div class="key-rows">${rows.map(poolRow).join('')}</div><button type="button" class="quiet" data-add-key="${name}">＋ Добавить ключ ${title}</button></details>`;
 }).join('');
 document.querySelectorAll('.key-pool').forEach(renumberPool);
 $('clearKeys').dataset.confirm='';$('clearKeys').textContent='Удалить сохранённые ключи';
 $('keyStorageNote').textContent=(state.keyStorage?.loading?'Восстанавливаем ключи из Связки ключей macOS…':state.keyStorage?.error)|| (state.keyStorage?.persistent?'Все ключи и их порядок сохраняются в защищённой Связке ключей macOS и восстанавливаются после перезапуска. Значения скрыты, чтобы случайно их не раскрыть.':'Ключи подключены до закрытия приложения. Постоянное хранение доступно в приложении macOS.');
 $('keyPools').inert=!!state.keyStorage?.loading;
 $('settingsForm').querySelector('[type="submit"]').disabled=!!state.keyStorage?.loading;
 voiceControls();
}
$('keyPools').onclick=e=>{
 const add=e.target.closest('[data-add-key]');
 if(add){const section=add.closest('.key-pool'),rows=section.querySelector('.key-rows');if(rows.children.length>=100)return toast('Максимум 100 ключей на сервис.');rows.insertAdjacentHTML('beforeend',poolRow({},rows.children.length));renumberPool(section);rows.lastElementChild.querySelector('input').focus();return;}
 const button=e.target.closest('[data-key-action]');if(!button)return;
 const row=button.closest('.key-row'),section=row.closest('.key-pool');
 if(button.dataset.keyAction==='up'&&row.previousElementSibling)row.previousElementSibling.before(row);
 if(button.dataset.keyAction==='down'&&row.nextElementSibling)row.nextElementSibling.after(row);
 if(button.dataset.keyAction==='remove'){row.remove();toast('Строка удалена из списка. Нажмите «Сохранить настройки», чтобы применить.');}
 renumberPool(section);
};
$('keyPools').oninput=e=>{const row=e.target.closest('.key-row');if(row)row.querySelector('.key-save-state').textContent=e.target.value.trim()?'Изменён · сохранится после нажатия «Сохранить настройки»':row.dataset.saved==='true'?'✓ Сохранённый ключ остаётся без изменений':'Новый · ещё не сохранён';};
$('settings').onclick=async()=>{stopListening();pauseReactionClock();try{state=await api('state');}catch{}const f=$('settingsForm');for(const[k,v]of Object.entries(state.config))if(f.elements[k])f.elements[k].value=v;if(f.elements.ttsModel&&(f.elements.ttsModel.value==='gpt-4o-mini-tts'||!f.elements.ttsModel.value))f.elements.ttsModel.value='tts-1';if(f.elements.elevenVoice){const match=[...f.elements.elevenVoice.options].find(o=>o.value===state.config.elevenVoice);if(match){f.elements.elevenVoice.value=match.value;if($('elevenCustomVoiceLabel'))$('elevenCustomVoiceLabel').hidden=true;}else if(state.config.elevenVoice){f.elements.elevenVoice.value='__custom__';if(f.elements.elevenCustomVoice)f.elements.elevenCustomVoice.value=state.config.elevenVoice;if($('elevenCustomVoiceLabel'))$('elevenCustomVoiceLabel').hidden=false;}}keyFields();if(f.elements.provider.value==='openai')loadOpenAIModels();$('settingsDialog').showModal();};
$('settingsForm').elements.voicePipeline.onchange=voiceControls;
$('settingsForm').elements.imageProvider.onchange=voiceControls;
$('settingsForm').elements.ttsProvider.onchange=e=>{const f=$('settingsForm');if(e.target.value==='openai'&&(!f.elements.ttsModel.value||f.elements.ttsModel.value==='gpt-4o-mini-tts'))f.elements.ttsModel.value='tts-1';voiceControls();};
$('testSilero').onclick=async()=>{$('testSilero').disabled=true;$('sileroStatus').textContent='Готовим голос… Первая загрузка может занять несколько секунд.';try{await speak('Закат ложится на старую башню. За дверью слышатся шаги. Теон, сделайте проверку восприятия: сложность 12. Бросьте d20. Что вы делаете?',$('settingsForm').elements.sileroSpeaker.value);}finally{$('testSilero').disabled=false;}};
$('testEdge').onclick=async()=>{$('testEdge').disabled=true;$('edgeStatus').textContent='Связываемся с нейросетью Edge…';try{await speak('Закат ложится на старую башню. За дверью слышатся шаги. Теон, сделайте проверку восприятия: сложность 12. Бросьте d20. Что вы делаете?',$('settingsForm').elements.edgeVoice.value);$('edgeStatus').textContent='Озвучено нейросетью Edge. Без ключей и оплаты.';}catch(err){$('edgeStatus').textContent='Ошибка Edge TTS: '+err.message;}finally{$('testEdge').disabled=false;}};
$('testOpenAI').onclick=async()=>{$('testOpenAI').disabled=true;$('openaiStatus').textContent='Связываемся с OpenAI…';try{await speak('Закат ложится на старую башню. За дверью слышатся шаги. Теон, сделайте проверку восприятия: сложность 12. Бросьте d20. Что вы делаете?','openai:'+$('settingsForm').elements.voice.value);$('openaiStatus').textContent='Озвучено выбранным голосом OpenAI ('+$('settingsForm').elements.voice.value+').';}catch(err){$('openaiStatus').textContent='Ошибка OpenAI TTS: '+err.message;}finally{$('testOpenAI').disabled=false;}};
$('settingsForm').elements.elevenVoice?.addEventListener('change',voiceControls);
$('testElevenLabs')?.addEventListener('click',async()=>{
 $('testElevenLabs').disabled=true;
 $('elevenlabsStatus').textContent='Связываемся с ElevenLabs…';
 try{
  const f=$('settingsForm');
  const v=f.elements.elevenVoice.value==='__custom__'?f.elements.elevenCustomVoice.value.trim():f.elements.elevenVoice.value;
  await speak('Закат ложится на старую башню. За дверью слышатся шаги. Теон, сделайте проверку восприятия: сложность 12. Бросьте d20. Что вы делаете?','elevenlabs:'+v);
  $('elevenlabsStatus').textContent='Озвучено выбранным голосом ElevenLabs ('+v+').';
 }catch(err){
  $('elevenlabsStatus').textContent='Ошибка ElevenLabs: '+err.message;
 }finally{
  $('testElevenLabs').disabled=false;
 }
});
$('testMultiVoice')?.addEventListener('click',async()=>{
 $('testMultiVoice').disabled=true;
 $('openaiStatus').textContent='Запуск демонстрации многоголосия (4 персонажа)…';
 try{
  const parts=[
   'За старой башней сгущаются сумерки. В тишине раздаётся шорох сухих трав.',
   '«Не произносите истинные имена после заката», — тихо шепчет жрица Альвари, сжимая свой посох.',
   'Теон усмехается и ловко крутит медную шестерню: «Не переживай, Альвари, моя пушка уже заряжена».',
   'Внезапно из темноты за деревьями тяжело рычит огромный орк, гремя железом и занося топор!'
  ];
  const run=++deliveryRun;
  for(let i=0;i<parts.length;i++){
   if(run!==deliveryRun)break;
   const part=parts[i];
   const nextPart=parts[i+1]||null;
   const ok=await speak(part,null,nextPart?{nextText:nextPart}:null);
   if(!ok||run!==deliveryRun)break;
  }
  $('openaiStatus').textContent='Демонстрация завершена. Озвучено 4 разными голосами OpenAI.';
 }catch(err){$('openaiStatus').textContent='Ошибка демо: '+err.message;}
 finally{$('testMultiVoice').disabled=false;}
});
$('openaiModelSelect').onchange=()=>{const f=$('settingsForm'),sel=$('openaiModelSelect');if(sel.value==='__custom__'){f.elements.model.hidden=false;f.elements.model.required=true;f.elements.model.focus();}else{f.elements.model.hidden=true;f.elements.model.required=false;f.elements.model.value=sel.value;}voiceControls();};
$('refreshOpenAIModels').onclick=()=>loadOpenAIModels(true);
$('settingsForm').elements.provider.onchange=e=>{const f=$('settingsForm');const presets={openai:['gpt-6.1-terra','https://api.openai.com/v1'],gemini:['gemini-2.0-flash','https://generativelanguage.googleapis.com'],compatible:['','https://openrouter.ai/api/v1']};if(presets[e.target.value]){[f.elements.model.value,f.elements.baseUrl.value]=presets[e.target.value];}if(e.target.value==='openai'){f.elements.reasoningEffort.value='low';$('keyPools').querySelector('[data-pool="openai"]').open=true;loadOpenAIModels();}voiceControls();};
$('settingsForm').elements.sttProvider.onchange=e=>{$('settingsForm').elements.sttModel.value=({gemini:'gemini-2.0-flash',groq:'whisper-large-v3-turbo',openai:'gpt-4o-mini-transcribe'})[e.target.value];voiceControls();};
$('settingsForm').elements.baseUrl.oninput=voiceControls;
$('settingsForm').elements.model.oninput=()=>{const f=$('settingsForm'),sel=$('openaiModelSelect');if(f.elements.provider.value==='openai'&&sel){const match=[...sel.options].find(o=>o.value===f.elements.model.value);if(match)sel.value=match.value;else sel.value='__custom__';}voiceControls();};
$('settingsForm').elements.reserveProvider.onchange=voiceControls;
$('settingsForm').onsubmit=async e=>{
 e.preventDefault();const data=Object.fromEntries(new FormData(e.target));if(data.ttsModel==='gpt-4o-mini-tts'||!data.ttsModel)data.ttsModel='tts-1';if(data.elevenVoice==='__custom__')data.elevenVoice=data.elevenCustomVoice?.trim()||'JBFqnCBsd6RMkjVDRZzb';data.keyPools={};
 for(const section of $('keyPools').querySelectorAll('[data-pool]')){
  if(section.hidden)continue;
  const rows=[...section.querySelectorAll('.key-row')];
  // Only submit a service when it has saved entries or an edited list. Empty new rows must be filled or removed.
  const values=rows.map(row=>({id:row.dataset.keyId,key:row.querySelector('input').value}));
  const old=state.keyPools?.[section.dataset.pool]||[];
  if(values.length!==old.length||values.some((r,i)=>r.id!==old[i]?.id||r.key.trim()))data.keyPools[section.dataset.pool]=values;
 }
 const submit=e.target.querySelector('[type="submit"]');submit.disabled=true;
 try{state=await api('settings',data);e.target.reset();for(const [k,v] of Object.entries(state.config))if(e.target.elements[k])e.target.elements[k].value=v;keyFields();if(state.config.vision==='off')stopVisionCamera(false);else if(!visionStream)startVisionCamera();render();toast(state.keyStorage?.persistent?'Все ключи и порядок резервов сохранены. Они останутся после перезапуска.':'Ключи подключены только в текущем сеансе.');}
 catch(err){toast(err.message);}finally{submit.disabled=false;}
};
$('clearKeys').onclick=async()=>{
 const button=$('clearKeys');
 if(button.dataset.confirm!=='yes'){button.dataset.confirm='yes';button.textContent='Подтвердить удаление всех ключей';return;}
 button.disabled=true;
 try{state=await api('settings',{clearKeys:true});keyFields();voiceControls();toast('Сохранённые ключи удалены.');}
 catch(err){toast(err.message);}
 finally{button.disabled=false;}
};
document.querySelectorAll('[data-close]').forEach(x=>x.onclick=()=>x.closest('dialog').close());
$('campaigns').onclick=async e=>{
 const del=e.target.closest('[data-delete-campaign]');
 if(del){
  e.stopPropagation();
  e.preventDefault();
  const c=state.campaigns.find(x=>x.id===del.dataset.deleteCampaign);
  if(!c)return;
  const ok=await askConfirm({
   title:'Удалить партию?',
   message:`Вы уверены, что хотите удалить партию «${c.name}»?\n\nВсе записи журнала, листы персонажей, карты и память этой кампании будут стёрты безвозвратно.`,
   okText:'Удалить партию'
  });
  if(!ok)return;
  try{
   const res=await api('campaign/delete',{id:c.id});
   toast(`Кампания «${c.name}» удалена`);
   state=res;
   activeId=res.activeCampaignId||state.campaigns?.[0]?.id||null;
   if(activeId)localStorage.setItem('skazitel-active',activeId);else localStorage.removeItem('skazitel-active');
   selectedId=null;
   render();
  }catch(err){
   toast('Ошибка удаления: '+err.message);
  }
  return;
 }
 const b=e.target.closest('[data-campaign]');if(b)choose(b.dataset.campaign);
};
$('characters').onclick=e=>{const growth=e.target.closest('[data-growth]');if(growth){openProgress(growth.dataset.growth);return;}const bag=e.target.closest('[data-inventory]'),portrait=e.target.closest('[data-portrait]');if(bag){openInventory(bag.dataset.inventory);return;}if(portrait){openIllustrations({kind:'portrait',characterId:portrait.dataset.portrait});return;}const sheet=e.target.closest('[data-sheet]');if(sheet){openSheet(sheet.dataset.sheet);return;}const b=e.target.closest('[data-hero]');if(b&&!busy&&!recording){selectedId=b.dataset.hero;render();}};
$('characters').onkeydown=e=>{if(e.key==='Enter')e.target.click();};
$('speaker').onchange=e=>{selectedId=e.target.value;render();};
$('send').onclick=async()=>{const text=$('message').value;if(current()?.sessionZero&&!current().sessionZero.complete){await turn({text});return;}if(await handleTableSpeech(text))$('message').value='';else await turn({text});};
$('begin').onclick=()=>turn({text:'Опиши стартовую сцену, учитывая материалы кампании. Не продолжай за игроков.'});
$('rollForm').onsubmit=e=>{
  e.preventDefault();
  ambientEngine.playDiceSound();
  playSfx('dice');
  const v1=Number($('raw').value);
  const v2=$('secondDieLabel').hidden?null:Number($('raw2').value);
  const chosen=v2!==null?Math.max(v1,v2):v1;
  if(chosen===20)setTimeout(()=>playSfx('crit'),250);
  else if(chosen===1)setTimeout(()=>playSfx('fumble'),250);
  turn({raw:$('secondDieLabel').hidden?v1:[v1,v2]});
};
$('undo').onclick=async()=>{if(busy)return;await haltNarration();try{state=await api('undo',{id:activeId});render();toast('Последнее действие отменено.');}catch(e){toast(e.message);}};
$('proposals').onclick=async e=>{const b=e.target.closest('[data-proposal]');if(!b||busy)return;try{state=await api('proposal',{id:activeId,proposalId:b.dataset.proposal,accept:b.dataset.accept==='yes'});render();}catch(err){toast(err.message);}};
$('editHeroes').onclick=()=>openSheet(selectedId||current()?.characters[0]?.id);
$('heroEditForm').onsubmit=async e=>{e.preventDefault();try{state=await api('heroes',{id:activeId,characters:current().characters.map(h=>readHeroes($('heroEditFields')).find(x=>x.id===h.id)||h)});$('heroDialog').close();render();}catch(err){toast(err.message);}};
function download(obj,name){const url=URL.createObjectURL(new Blob([JSON.stringify(obj,null,2)],{type:'application/json'}));const a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),30000);}
$('export').onclick=async()=>{try{const data=await api('export?id='+encodeURIComponent(activeId));if(window.webkit?.messageHandlers?.nativeExport)window.webkit.messageHandlers.nativeExport.postMessage({text:JSON.stringify(data,null,2),name:current().name+'.json'});else download(data,current().name+'.json');}catch(e){toast(e.message);}};
$('import').onclick=()=>$('importFile').click();$('importFile').onchange=async e=>{const f=e.target.files[0];if(!f)return;if(f.size>15e6)return toast('Сохранение слишком большое.');try{await created('import',JSON.parse(await f.text()));}catch(err){toast('Не удалось прочитать JSON: '+err.message);}e.target.value='';};
function cleanNarration(text){
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
function normalizeSpeakerPrefix(line) {
 return line
  .replace(/^(\*{1,2}|_{1,2})([А-ЯЁ][А-ЯЁа-яёA-Za-z0-9 _-]+)\1\s*:/u, '$2:')
  .replace(/^(\*{1,2}|_{1,2})([А-ЯЁ][А-ЯЁа-яёA-Za-z0-9 _-]+):\1\s*/u, '$2: ')
  .replace(/^(\*{1,2}|_{1,2})\[([А-ЯЁа-яёA-Za-z0-9 _-]+)\]\1\s*:/u, '[$2]:')
  .replace(/^([А-ЯЁ][А-ЯЁа-яёA-Za-z0-9 _-]+)\s*—\s*([«"“])/u, '$1: $2');
}
function splitNarration(text){
 if(!text)return [];
 const raw=String(text);
 const normalized=raw
  .replace(/(?<=[.!?…»”])\s+(?=(?:\[[А-ЯЁа-яёA-Za-z0-9 _-]+\]|(?:\*{1,2}|_{1,2})?[А-ЯЁ][А-ЯЁа-яёA-Za-z0-9 _-]+(?:\*{1,2}|_{1,2})?\s*:))/gu,'\n');
 const lines=normalized.split(/\n+/).map(l=>l.trim()).filter(Boolean);
 const parts=[];
 for(let line of lines){
  line=normalizeSpeakerPrefix(line);
  const tagMatch=line.match(/^[«"“]?\[([А-ЯЁа-яёA-Za-z0-9 _-]+)\][:\s—-]*(.*)$/u)
              ||line.match(/^[«"“]?([А-ЯЁ][А-ЯЁа-яёA-Za-z0-9 _-]+)\s*:\s*(?:—\s*)?(.*)$/u);
  if(tagMatch){
   const speaker=tagMatch[1].trim(),speech=tagMatch[2].trim();
   if(!speech)continue;
   const sents=speech.split(/(?<=[.!?…][»"”]?)\s+(?=[А-ЯЁA-Z«“])/u).map(s=>s.trim()).filter(Boolean);
   let inQuotes=speech.startsWith('«')||speech.startsWith('"')||speech.startsWith('“');
   let quoteClosed=false;
   for(const s of sents){
    if(quoteClosed){parts.push(s);}
    else{
     parts.push(`[${speaker}] ${s}`);
     if(inQuotes&&(s.endsWith('»')||s.endsWith('"')||s.endsWith('”')||s.includes('»')||s.includes('”'))){quoteClosed=true;}
    }
   }
   continue;
  }
  const sents=line.split(/(?<=[.!?…])\s+(?=[А-ЯЁA-Z«“—])/u).map(s=>s.trim()).filter(Boolean);
  let activeSpeaker=null;
  for(let i=0;i<sents.length;i++){
   const s=sents[i];
   const isQuote=s.startsWith('—')||s.startsWith('«')||s.startsWith('"');
   if(isQuote&&!activeSpeaker&&i>0){
    const prev=sents[i-1];
    const m=prev.match(/(?<!\p{L})(Старуха|Марта|Фёдор|Теон|Альвари|жрица|девушка|женщина|бабка|ведьма|орк|рыцарь|кузнец|трактирщица|хозяйка)(?!\p{L})/iu);
    if(m)activeSpeaker=m[1];
   }
   if(isQuote&&activeSpeaker){
    parts.push(`[${activeSpeaker}] ${s}`);
   }else if(activeSpeaker&&!/^(?:Она|Он|Они|Мастер|Ведущий|Брось|Что|Внезапно|Но|И|Тогда|После)\b/u.test(s)){
    parts.push(`[${activeSpeaker}] ${s}`);
   }else{
    activeSpeaker=null;
    parts.push(s);
   }
  }
 }
 return parts.reduce((a,s)=>{if(s.length>650){const words=s.split(/\s+/);let part='';for(const w of words){if(part.length+w.length>600){a.push(part);part='';}part+=(part?' ':'')+w;}if(part)a.push(part);}else a.push(s);return a;},[]);
}
async function replayEntry(text){
 const parts=splitNarration(text);
 if(!parts.length)return;
 const run=++deliveryRun;
 for(let i=0;i<parts.length;i++){
  if(run!==deliveryRun)break;
  const part=parts[i];
  const nextPart=parts[i+1]||null;
  const ok=await speak(part,null,nextPart?{nextText:nextPart}:null);
  if(!ok||run!==deliveryRun)break;
 }
}
$('demoVoiceBtn')?.addEventListener('click',async()=>{
 $('campaignToolsDialog').close();
 if(busy)return;
 try{
  toast('Запуск демонстрации многоголосия…');
  state=await api('demo-voice',{id:activeId});
  render();
  if($('autoVoice')?.checked){playDelivery();}
 }catch(e){toast(e.message);}
});
$('journal').onclick=e=>{const art=e.target.closest('[data-suggest-image]');if(art){const suggestion=current().journal.find(x=>x.id===art.dataset.suggestImage)?.illustrationSuggestion;if(suggestion)openIllustrations(suggestion);return;}const b=e.target.closest('[data-replay]');if(b)replayEntry(current().journal[Number(b.dataset.replay)].text);};$('stopVoice').onclick=()=>interruptMaster();
function interruptMaster({focus=true}={}){
 pauseReactionClock();liveVoice.interrupt();haltNarration();interruptionActive=true;
 if(busy){$('status').textContent='Озвучка остановлена. Дождитесь ответа, затем вмешайтесь.';return;}
 render();
 if(current()?.pending){$('raw').focus();toast('Озвучка остановлена. Сейчас мастер ждёт результат броска.');}
 else if(current()?.proposals.length){$('proposals').scrollIntoView({block:'end'});toast('Озвучка остановлена. Подтвердите или отклоните предложенные изменения HP.');}
 else if(focus){$('message').focus({preventScroll:true});toast('Мастер прерван. Напишите ответ или нажмите «К голосу», затем удерживайте пробел.');}
}
$('reactNow').onclick=()=>interruptMaster();
$('passReaction').onclick=()=>passReaction(false);
$('focusVoice').onclick=()=>{if(state.config.listeningMode==='continuous'){$('status').tabIndex=-1;$('status').focus({preventScroll:true});}else $('mic').focus({preventScroll:true});};
$('resumeReaction').onclick=()=>{interruptionActive=false;sendClock('resume');};
$('message').addEventListener('input',()=>{if($('message').value.trim())pauseReactionClock();});
// WAV is accepted by both STT adapters and works in native WebKit and Chrome.
function wav(chunks,sampleRate){const n=chunks.reduce((a,c)=>a+c.length,0),buffer=new ArrayBuffer(44+n*2),v=new DataView(buffer);const str=(o,s)=>{for(let i=0;i<s.length;i++)v.setUint8(o+i,s.charCodeAt(i));};str(0,'RIFF');v.setUint32(4,36+n*2,true);str(8,'WAVE');str(12,'fmt ');v.setUint32(16,16,true);v.setUint16(20,1,true);v.setUint16(22,1,true);v.setUint32(24,sampleRate,true);v.setUint32(28,sampleRate*2,true);v.setUint16(32,2,true);v.setUint16(34,16,true);str(36,'data');v.setUint32(40,n*2,true);let offset=44;for(const c of chunks)for(const s of c){v.setInt16(offset,Math.max(-1,Math.min(1,s))*(s<0?32768:32767),true);offset+=2;}return new Uint8Array(buffer);}
function speechKeyPresent(){const provider=state.config.sttProvider;if(provider!=='groq')return !!state.keysPresent[provider];let shared=false;try{shared=state.config.provider==='compatible'&&new URL(state.config.baseUrl).hostname==='api.groq.com';}catch{}return !!state.keysPresent.groq||(shared&&!!state.keysPresent.compatible);}
async function startRecording(){
 if(busy||recording||recordStarting||$('mic').disabled)return;
 recordHeld=true;recordStarting=true;ambientEngine.setDucked(true);pauseReactionClock();if(voiceActive)interruptionActive=true;haltNarration();if(current()?.reaction)interruptionActive=true;let stream,ctx;
 try{
  const provider=state.config.sttProvider;let hasKey=!!state.keysPresent[provider];
  if(provider==='groq'){let sameProvider=false;try{sameProvider=state.config.provider==='compatible'&&new URL(state.config.baseUrl).hostname==='api.groq.com';}catch{}hasKey=hasKey||(sameProvider&&!!state.keysPresent.compatible);}
  if(!hasKey)throw Error('Добавьте API-ключ '+({groq:'Groq',gemini:'Gemini',openai:'OpenAI'}[provider]||provider)+' в «Модели и голос» для распознавания речи.');
  if(!navigator.mediaDevices?.getUserMedia)throw Error('Микрофон недоступен в этом окне. Откройте приложение или локальный адрес в Chrome.');
  stream=await navigator.mediaDevices.getUserMedia({audio:{echoCancellation:true,noiseSuppression:true},video:false});
  if(!recordHeld){stream.getTracks().forEach(x=>x.stop());return;}
  ctx=new AudioContext();await ctx.resume();
  const source=ctx.createMediaStreamSource(stream),processor=ctx.createScriptProcessor(4096,1,1),gain=ctx.createGain();gain.gain.value=0;
  const chunks=[];processor.onaudioprocess=e=>{chunks.push(new Float32Array(e.inputBuffer.getChannelData(0)));};source.connect(processor);processor.connect(gain);gain.connect(ctx.destination);
  recording={stream,ctx,source,processor,gain,chunks,rate:ctx.sampleRate,campaignId:activeId,characterId:selectedId};
  recording.timer=setTimeout(stopRecording,60000);$('mic').classList.add('recording');$('speaker').disabled=true;$('send').disabled=true;$('settings').disabled=true;
  $('status').textContent='Запись… Назовите героя и действие, затем отпустите кнопку.';
 }catch(e){
  stream?.getTracks().forEach(x=>x.stop());if(ctx)await ctx.close().catch(()=>{});
  toast(e.name==='NotAllowedError'?'Разрешите «Сказителю» доступ к микрофону в настройках macOS.':e.name==='NotFoundError'?'Микрофон не найден. Подключите его и повторите запись.':e.message||'Не удалось открыть микрофон');recordHeld=false;
 }finally{recordStarting=false;if(recording&&!recordHeld)stopRecording();}
}
async function stopRecording(){
 recordHeld=false;ambientEngine.setDucked(false);if(!recording)return;
 const r=recording;recording=null;clearTimeout(r.timer);setBusy(true,'Распознаём речь…');
 r.processor.disconnect();r.source.disconnect();r.gain.disconnect();r.stream.getTracks().forEach(x=>x.stop());await r.ctx.close();$('mic').classList.remove('recording');
 let transcript='';const recordedEndedAt=performance.now(),sttStarted=performance.now();
 try{
  if(r.chunks.reduce((n,x)=>n+x.length,0)<r.rate*.25)return;
  const bytes=wav(r.chunks,r.rate);let binary='';for(let i=0;i<bytes.length;i+=8192)binary+=String.fromCharCode(...bytes.subarray(i,i+8192));
  const result=await api('transcribe',{audio:btoa(binary),mime:'audio/wav',campaignId:r.campaignId});transcript=result.text.trim();
  if(!transcript)throw Error('Речь не распознана. Повторите запись ближе к микрофону.');
  if(!current()?.pending&&state.config.voiceSendMode!=='direct'){$('message').value=transcript;if(state.config.voiceSendMode!=='direct'){$('message').focus();toast('Проверьте расшифровку и нажмите ↗ для отправки мастеру.');}}
 }catch(e){toast(e.message);}finally{setBusy(false);$('speaker').disabled=false;render();}
 try{if(transcript&&activeId===r.campaignId){
  if(state.config.voiceSendMode==='direct'){
   voiceLatency={endedAt:recordedEndedAt,sttMs:performance.now()-sttStarted};
   if(await handleTableSpeech(transcript))return;
   selectedId=speakingCharacter(transcript,current().characters)||r.characterId;await turn({text:transcript});
  }else if(current()?.pending){const value=spokenRoll(transcript,current()?.pending?.mode);if(value!==null){$('raw').value=Array.isArray(value)?value[0]:value;if(Array.isArray(value))$('raw2').value=value[1];$('raw').focus();toast('Проверьте и подтвердите число '+value);}else toast('Назовите одно число с грани d20.');}
 }
 }catch(e){toast(e.message);}
}

$('mic').onpointerdown=e=>{if(spaceHeld)return;e.preventDefault();$('mic').setPointerCapture(e.pointerId);interruptMaster({focus:false});if(state.config.listeningMode==='ptt')startRecording();};
$('mic').onpointerup=()=>{if(!spaceHeld)stopRecording();};$('mic').onpointercancel=()=>{if(!spaceHeld)stopRecording();};
function acceptsSpaceToTalk(e){
 const target=document.activeElement;
 return !e.isComposing&&!e.altKey&&!e.ctrlKey&&!e.metaKey&&!document.querySelector('dialog[open]')&&!!current()&&!target?.isContentEditable&&!target?.closest('input,textarea,select,a,[role="button"]')&&(!target?.closest('button')||target===$('mic')||target===$('stopVoice'));
}
document.addEventListener('keydown',e=>{
 if((e.metaKey||e.ctrlKey)&&e.key==='Enter'&&!document.querySelector('dialog[open]')){e.preventDefault();if(!$('send').disabled)turn({text:$('message').value});}
 if((e.metaKey||e.ctrlKey)&&(e.key==='b'||e.key==='B'||e.key==='и'||e.key==='И')){e.preventDefault();toggleSidebar();}
 if((e.key==='['||e.key==='х'||e.key==='Х')&&!e.metaKey&&!e.ctrlKey&&!e.altKey&&!document.querySelector('dialog[open]')){
  const target=document.activeElement;
  if(!target?.isContentEditable&&!target?.closest('input,textarea,select')){e.preventDefault();toggleSidebar();}
 }
 if(e.code==='Space'&&(spaceHeld||acceptsSpaceToTalk(e))){
  e.preventDefault();if(!e.repeat&&!spaceHeld){spaceHeld=true;interruptMaster({focus:false});$('mic').focus({preventScroll:true});spaceTimer=setTimeout(()=>{if(spaceHeld&&!busy&&state.config.listeningMode==='ptt')startRecording();},240);}
 }
 if((e.code==='KeyM'||e.key==='m'||e.key==='ь'||e.key==='M'||e.key==='Ь')&&!e.metaKey&&!e.ctrlKey&&!e.altKey&&!document.querySelector('dialog[open]')){
  const target=document.activeElement;
  if(!target?.isContentEditable&&!target?.closest('input,textarea,select')){
   e.preventDefault();
   toggleTacticalHud();
  }
 }
 if((e.code==='KeyW'||e.key==='w'||e.key==='ц'||e.key==='W'||e.key==='Ц')&&!e.metaKey&&!e.ctrlKey&&!e.altKey&&!document.querySelector('dialog[open]')){
  const target=document.activeElement;
  if(!target?.isContentEditable&&!target?.closest('input,textarea,select')&&tacticalHudOpen){
   e.preventDefault();
   toggleHudWide();
  }
 }
});
document.addEventListener('keyup',e=>{if(e.code==='Space'&&spaceHeld){e.preventDefault();spaceHeld=false;clearTimeout(spaceTimer);stopRecording();}});
window.addEventListener('blur',()=>{pauseReactionClock();spaceHeld=false;clearTimeout(spaceTimer);if(recording||recordStarting)stopRecording();stopListening();});
function voiceFinished(version,ok=true){if(version===speechVersion){$('voicePlayback').textContent=ok?'✓ Озвучка завершена':'Озвучка остановлена';voiceActive=false;ambientEngine.setDucked(false);renderListening();const done=speechDone;speechDone=null;done?.(ok);}}
window.addEventListener('skazitel-voice-ended',e=>voiceFinished(e.detail));
async function sendClock(action){
 const c=current(),r=c?.reaction;if(!r||clockRequest||busy)return;
 clockRequest=true;
 try{const next=await api('reaction-clock',{id:c.id,reactionId:r.id,action});state=next;render();}
 catch(e){toast(e.message);}finally{clockRequest=false;}
}
function pauseReactionClock(){
 const r=current()?.reaction;if(!r||r.paused)return;
 // Pause locally immediately, so typing cannot race the next countdown tick.
 const remaining=r.deadlineAt?Math.max(0,r.deadlineAt-Date.now()):r.remainingMs;
 if(!busy&&!clockRequest)sendClock('pause');
 r.remainingMs=remaining;r.paused=true;r.deadlineAt=null;
}
function passReaction(timedOut){
 const r=current()?.reaction;if(!r||busy)return;
 turn({text:timedOut?'Время на вмешательство истекло. Никто не начал отвечать. Продолжи сцену по правилам.':'Никто не вмешивается. Продолжи сцену и разреши угрозу по правилам.',passReaction:true,reactionId:r.id,timedOut,interrupted:false});
}
setInterval(()=>{
 const r=current()?.reaction;if(!r)return;
 const ms=r.deadlineAt?Math.max(0,r.deadlineAt-Date.now()):r.remainingMs;
 $('reactionClock').textContent=r.paused?'Ⅱ Таймер на паузе':voiceActive?'Отсчёт после озвучки · '+r.timeoutSeconds+' с':Math.ceil(ms/1000)+' с на вмешательство';
 $('reactionClock').classList.toggle('urgent',!r.paused&&!voiceActive&&ms<=5000);
 $('resumeReaction').hidden=!r.paused||ms<=0;
 if(busy||clockRequest||r.paused||voiceActive||current()?.delivery||document.hidden||!document.hasFocus())return;
 if($('message').value.trim()||recording||recordStarting){pauseReactionClock();return;}
 if(r.deadlineAt===null){sendClock('start');return;}
 if(ms<=0&&clockTimedOut!==r.id){clockTimedOut=r.id;passReaction(true);}
},200);
let ambientStarting=false;
const ambientMic=new ContinuousMic({
 onStart(){ambientEngine.setDucked(true);pauseReactionClock();if(state.config.bargeInMode==='any'){interruptionActive=true;haltNarration();}$('listenState').textContent='Слышу речь…';$('liveMicHint').textContent='Слышу речь… После паузы реплика отправится мастеру.';},
 onEnd(chunks,rate,timing){ambientEngine.setDucked(false);if(voiceQueue.length>=3){stopListening();toast('Накопилось несколько реплик. Микрофон остановлен: дождитесь обработки.');return;}voiceQueue.push({chunks,rate,endedAt:timing?.endedAt??performance.now(),campaignId:activeId,selectedId,epoch:voiceEpoch});drainVoiceQueue();}
});
function renderListening(){
 const continuous=state?.config.listeningMode==='continuous'||state?.config.voicePipeline==='live';$('mic').hidden=continuous;$('stopVoice').hidden=!voiceActive&&!interruptionActive;$('listeningMode').value=state?.config.listeningMode||'ptt';$('listeningMode').disabled=busy||recording||recordStarting;
 $('mic').setAttribute('aria-label',continuous?'Перебить мастера: пробел':'Говорить: удерживайте пробел или кнопку');$('mic').querySelector('small').textContent=continuous?'ПЕРЕБИТЬ':'ПРОБЕЛ';
 $('liveMicPanel').hidden=!continuous;
 const live=state.config.voicePipeline==='live';if(live){$('liveMicHint').textContent='OpenAI Live + Luna · около $0,05/мин подключения + текстовая модель';$('listenState').textContent=liveVoice.active?'● OpenAI Live · микрофон включён':'Live выключен';}
 const toggle=$('listenToggle');toggle.textContent=live?(liveVoice.starting?'Подключаем Live…':liveVoice.active?'■ Отключить Live':'🎙 Подключить Live · платно'):ambientStarting?'Подключаем микрофон…':ambientMic.active?'■ Выключить микрофон':'🎙 Включить микрофон';
 toggle.classList.toggle('is-listening',live?liveVoice.active:ambientMic.active);toggle.setAttribute('aria-pressed',String(live?liveVoice.active:ambientMic.active));toggle.disabled=ambientStarting||liveVoice.starting;if(live)return;
 $('liveMicHint').textContent=ambientMic.active?'Микрофон включён · реплики отправляются автоматически. Без имени действует выбранный герой.':'Включите микрофон и говорите. Реплики отправляются автоматически, без проверки текста.';
 $('listenState').textContent=ambientMic.active?'● Слушаю · запись речи до паузы':continuous?'Микрофон выключен':'Удерживайте пробел для записи';
}
function stopListening(){liveVoice.stop();voiceEpoch++;voiceQueue=[];ambientMic.stop();if(state)renderListening();}
$('listeningMode').onchange=async e=>{const mode=e.target.value;stopListening();try{state=await api('settings',{listeningMode:mode});render();}catch(err){toast(err.message);render();}};
$('listenToggle').onclick=async()=>{
 if(state.config.voicePipeline==='live'){if(liveVoice.active||liveVoice.starting)await liveVoice.stop();else{await haltNarration();await liveVoice.start();}renderListening();return;}
 if(ambientMic.active){stopListening();return;}
 ambientStarting=true;renderListening();
 try{if(!current()||!current().characters.length&&(!current().sessionZero||current().sessionZero.complete))throw Error('Сначала добавьте героя или начните нулевую сессию.');if(!speechKeyPresent())throw Error('Сначала подключите ключ распознавания в «Модели и голос».');await ambientMic.start(()=>voiceActive);renderListening();if(ambientMic.active){$('status').tabIndex=-1;$('status').focus({preventScroll:true});}}catch(e){stopListening();toast('Не удалось включить постоянный микрофон: '+e.message);}finally{ambientStarting=false;renderListening();}
};
let lastAmbientRequest=0;
async function drainVoiceQueue(){
 if(Date.now()-lastAmbientRequest<500||document.querySelector('dialog[open]'))return;
 if(voiceProcessing||busy||!voiceQueue.length)return;voiceProcessing=true;
 const item=voiceQueue.shift();if(item.campaignId!==activeId){voiceProcessing=false;return;}
 let transcript='';const sttStarted=performance.now();lastAmbientRequest=Date.now();setBusy(true,'Распознаём реплику…');
 try{
  const bytes=wav(item.chunks,item.rate);let binary='';for(let i=0;i<bytes.length;i+=8192)binary+=String.fromCharCode(...bytes.subarray(i,i+8192));
  transcript=(await api('transcribe',{audio:btoa(binary),mime:'audio/wav',campaignId:item.campaignId})).text.trim();
 }catch(e){toast(e.message);}finally{setBusy(false);render();}
 try{
  if(item.epoch!==voiceEpoch||item.campaignId!==activeId||!transcript||transcript.length<2)return;
  if(state.config.bargeInMode==='addressed'&&!addressed(transcript))return;
  voiceLatency={endedAt:item.endedAt??sttStarted,sttMs:performance.now()-sttStarted};
  pauseReactionClock();await haltNarration();interruptionActive=true;
  if(await handleTableSpeech(transcript))return;
  const plan=continuousTurnPlan(transcript,current(),item.selectedId);
  if(plan.action==='send'){
   selectedId=plan.characterId;render();$('listenState').textContent='Отправляю реплику мастеру…';
   await turn({text:transcript,characterId:plan.characterId},{keepDraft:true});
  }else{
   const draft=$('message').value.trim();$('message').value=draft?draft+'\n'+transcript:transcript;
   toast(plan.action==='blocked'?'Сначала подтвердите или отклоните изменение HP. Реплика сохранена в поле ввода.':'Не удалось однозначно выбрать героя. Выберите персонажа и отправьте реплику.');
  }
 }catch(e){toast(e.message);}finally{voiceProcessing=false;renderListening();}
}
async function handleTableSpeech(text){
 const c=current();if(!c)return false;
 if(c.sessionZero&&!c.sessionZero.complete){await turn({text},{keepDraft:true});return true;}
 if(c.pending){const raw=spokenRoll(text,c.pending.mode);if(raw!==null)await turn({raw},{keepDraft:true});else{toast('Скажите «на кубике четырнадцать» — одно число с грани, без бонуса.');if($('autoVoice').checked)speak('Назовите число на грани. Например: на кубике четырнадцать.');}return true;}
 const actionMatch=/^(?:(?:мастер|сказитель)[, ]+)?(подтверждаю|отклоняю) действие(?: (\d+))?[.!?]*$/iu.exec(text.trim());
 if(actionMatch&&(c.actionProposals||[]).length){const index=actionMatch[2]?Number(actionMatch[2])-1:c.actionProposals.length===1?0:-1;const proposal=c.actionProposals[index];if(!proposal){toast('Назовите номер действия из карточки.');return true;}await decideAction(proposal.id,actionMatch[1].toLowerCase()==='подтверждаю');return true;}
 if(c.proposals.length){const plan=spokenHpPlan(text,c);if(plan){state=await api('proposal',{id:c.id,proposalId:plan.proposalId,accept:plan.accept});render();const h=current().characters.find(h=>h.id===plan.characterId);if($('autoVoice').checked)speak(plan.accept?`${h.name}: здоровье ${h.hp} из ${h.maxHp}.`:'Изменение здоровья отклонено.');}else{toast('Назовите героя: «Лира, подтверждаю изменения» или «Лира, отклоняю изменения». Несколько изменений одного героя подтвердите в карточках.');if($('autoVoice').checked)speak('Для подтверждения назовите героя и скажите: подтверждаю изменения. Для отказа: отклоняю изменения.');}return true;}
 return false;
}
setInterval(drainVoiceQueue,250);
window.addEventListener('pagehide',()=>{liveVoice.stop();ambientMic.stop();voiceQueue=[];});
const limitNames={'x-ratelimit-limit-tokens':'Лимит токенов в окне','x-ratelimit-remaining-tokens':'Осталось токенов в окне','x-ratelimit-reset-tokens':'Сброс окна токенов через','x-ratelimit-limit-requests':'Лимит запросов в окне','x-ratelimit-remaining-requests':'Осталось запросов в окне','x-ratelimit-reset-requests':'Сброс окна запросов через','retry-after':'Повторить запрос через'};
const costMoney=value=>'$'+Number(value||0).toFixed(value<1?4:2);
function renderSessionCost(report){
 const cost=report?.cost;if(!cost)return;
 const unknown=cost.unknown>0,label=costMoney(cost.usd)+(unknown?' + ?':'');
 $('sessionCostValue').textContent=(cost.estimated?'≈ ':'')+label;
 $('sessionCost').classList.toggle('partial',unknown);$('sessionCost').classList.toggle('over-budget',cost.usd>=10);
 $('sessionCost').title=`С ${new Date(cost.startedAt).toLocaleString('ru-RU')}: ${costMoney(cost.usd)}. `+(unknown?`Не учтено в сумме: ${cost.unknown} запросов без тарифа или данных о расходе. `:'')+'Расчёт приложения в USD; баланс провайдера может отличаться. Нажмите для подробностей.';
 if(report.error){$('sessionCostValue').textContent='Ошибка учёта';$('sessionCost').title=report.error;return;}
 for(const threshold of [8,10])if(cost.usd>=threshold){const key='skazitel-cost-warning-'+cost.id+'-'+threshold;if(!localStorage.getItem(key)){localStorage.setItem(key,'seen');toast(threshold===8?'Расход сессии достиг $8. До ориентира $10 осталось около $2.':'Расход сессии достиг $10. Игра продолжается; новые запросы могут увеличить сумму.');}}
}
let costPollBusy=false;
async function refreshSessionCost(){
 if(!state||document.hidden||costPollBusy)return;costPollBusy=true;
 try{const report=await api('usage');state.usage=report;renderSessionCost(report);}catch{$('sessionCostValue').textContent='Нет связи';$('sessionCost').title='Не удалось обновить расход. Последние данные доступны после восстановления связи.';}finally{costPollBusy=false;}
}
setInterval(refreshSessionCost,2000);
document.addEventListener('visibilitychange',()=>{if(!document.hidden)refreshSessionCost();});
async function showUsage(){
 try{const report=await api('usage');const n=v=>v===null?'—':Number(v).toLocaleString('ru-RU');renderSessionCost(report);$('groqBilling').value=state.config.groqBilling||'free';
  $('usageContent').innerHTML=(report.error?`<p role="alert">${esc(report.error)}</p>`:'')+`<div class="usage-totals"><p>С начала сессии: <strong>${costMoney(report.cost?.usd)}</strong>${report.cost?.unknown?` + неучтённые запросы: ${report.cost.unknown}`:""}</p><p>Начало: ${new Date(report.cost?.startedAt).toLocaleString("ru-RU")}. Сумма расчётная, USD; налоги, кредиты и скидки аккаунта не учитываются. Тарифы проверены ${esc(report.cost?.pricingDate)}.</p><p>Счётчик обновляется после ответа API, в том числе при озвучке. Неизвестный тариф или отсутствие данных о расходе обозначаются «?», а не нулём. Silero и системный голос не вызывают платный API. OpenAI TTS без отчёта о расходе остаётся неучтённым.</p><p>За этот запуск: <strong>${n(report.session.total)}</strong> токенов · ${report.session.requests} запросов</p><p>За ${esc(report.todayUTC)} UTC: <strong>${n(report.today.total)}</strong> токенов</p><p>Без данных о токенах: ${report.all.unknown} запросов. Сохранено до ${report.retention} запросов.</p></div>`+report.groups.map(g=>`<section class="usage-group"><strong>${esc(g.name)}</strong><p>Вход ${n(g.input)} · выход ${n(g.output)} · всего ${n(g.total)}<br>Чтение кеша ${n(g.cached)}${g.input?` (${Math.round((g.cached||0)/g.input*100)}% входа)`:""} · запись кеша ${n(g.cacheWrite)} · рассуждения ${n(g.reasoning)}</p>${Object.keys(g.limits).length?`<p class="dialog-note">Лимиты, сообщённые провайдером на ${new Date(g.limitsAt).toLocaleString('ru-RU')}:<br>${Object.entries(g.limits).map(([k,v])=>esc(limitNames[k]||k)+': '+esc(v)).join('<br>')}</p>`:'<p class="dialog-note">Провайдер не сообщил остаток лимитов.</p>'}</section>`).join('')+`<p class="dialog-note">Учитываются только запросы этого приложения. Остатки относятся к ключу последнего ответа и не суммируются между резервами. Это снимок на момент ответа, а не текущий баланс аккаунта.</p><table class="usage-table"><thead><tr><th>Время / запрос</th><th>Вход</th><th>Выход</th><th>Всего</th><th>USD</th><th>Время API</th></tr></thead><tbody>${report.recent.map(r=>`<tr><td>${new Date(r.at).toLocaleTimeString('ru-RU')} · ${esc(({narration:'Ответ мастера',summary:'Сводка',stt:'Распознавание',tts:'Озвучка',image:'Иллюстрация',live:'Live · оценка', 'live-finalization-unconfirmed':'Live · итог не подтверждён','latency-probe':'Проверка задержки'})[r.kind]||r.kind)} · HTTP ${r.status}</td><td>${n(r.input)}</td><td>${n(r.output)}</td><td>${n(r.total)}</td><td>${r.cost?.usd===null||!r.cost?"?":costMoney(r.cost.usd)}</td><td>${Number.isFinite(r.elapsedMs)?(r.elapsedMs/1000).toFixed(1)+" с":"—"}</td></tr>`).join('')}</tbody></table>`;
 }catch(e){toast(e.message);}
}
$('usage').onclick=()=>{stopListening();pauseReactionClock();showUsage();$('usageDialog').showModal();};$('usageRefresh').onclick=showUsage;
$('sessionCost').onclick=()=>$('usage').click();
$('groqBilling').onchange=async e=>{try{const next=await api('settings',{groqBilling:e.target.value});state.config=next.config;await showUsage();}catch(error){toast(error.message);}};
$('newCostSession').onclick=async()=>{try{const report=await api('cost-session',{action:'new'});state.usage=report;renderSessionCost(report);await showUsage();toast('Новый отсчёт начат. История расходов сохранена.');}catch(error){toast(error.message);}};
function showMemory(){const c=current(),valid=c.summaryValid;$('memoryText').value=valid?c.summary.text:'';$('memoryInfo').textContent=valid?`В сводке ${c.summary.count} старых записей. Полный журнал: ${c.journal.length} записей.`:'Активной сводки нет. Полная история передаётся модели.';$('memorySave').disabled=!valid;$('memoryClear').disabled=!valid;}
$('memory').onclick=async()=>{if(!current()||busy)return;stopListening();pauseReactionClock();await haltNarration();showMemory();$('memoryDialog').showModal();};
async function memoryAction(action){if(busy)return;setBusy(true,'Обновляем память…');$('memoryCreate').disabled=true;try{state=await api('summary',{id:activeId,action,text:$('memoryText').value});render();showMemory();toast('Память обновлена. Полный журнал сохранён.');}catch(e){toast(e.message);}finally{setBusy(false);$('memoryCreate').disabled=false;render();}}
$('memoryCreate').onclick=()=>memoryAction('create');$('memoryClear').onclick=()=>memoryAction('clear');$('memoryForm').onsubmit=e=>{e.preventDefault();memoryAction('edit');};
setInterval(async()=>{if(!state?.keyStorage?.loading||busy)return;try{const next=await api('state');state.keyStorage=next.keyStorage;state.keysPresent=next.keysPresent;state.keyPools=next.keyPools;if($('settingsDialog').open&&!$('keyPools').querySelector('input:focus'))keyFields();}catch{}},1500);
refresh().catch(e=>toast(e.message));

function renderHero(h){const low=(h.resources||[]).filter(r=>r.current<r.max).slice(0,3);const portrait=current()?.images?.findLast(i=>i.status==='ready'&&i.kind==='portrait'&&i.characterId===h.id);return `<article class="hero ${h.id===selectedId?'selected':''}"><div class="compact-hero"><button class="portrait-button" data-portrait="${h.id}" aria-label="Портрет ${esc(h.name)}" title="Создать или обновить портрет">${portrait?`<img class="hero-portrait" src="/images/${portrait.file}" width="64" height="64" alt="Портрет ${esc(h.name)}">`:`<span>${esc(h.name.slice(0,1))}</span><small>＋ портрет</small>`}</button><button data-hero="${h.id}" class="hero-name" aria-label="Выбрать ${esc(h.name)}">${esc(h.name)}<small>${h.className?esc(h.className)+' · ':''}${h.level||1} ур.${h.sheetVerified?'':' · лист нужно сверить'} · КД ${h.ac}</small></button><button data-sheet="${h.id}" class="quiet" aria-label="Лист ${esc(h.name)}">Лист ↗</button></div><div class="hp"><span>HP</span><strong>${h.hp}/${h.maxHp}${h.tempHp?' + '+h.tempHp+' врем.':''}</strong></div><progress class="hp-progress" max="${h.maxHp}" value="${h.hp}" aria-label="Здоровье ${esc(h.name)}"></progress>${h.hp===0?`<small>От смерти: ✓ ${h.deathSaves?.successes||0} / ✕ ${h.deathSaves?.failures||0}</small>`:''}${h.concentration?`<small>Концентрация: ${esc(h.concentration)}</small>`:''}${(h.conditions||[]).length?`<p class="condition-chips">${h.conditions.map(x=>`<span>${esc(x)}</span>`).join('')}</p>`:''}${low.length?`<p class="resource-chips">${low.map(r=>`<span>${esc(r.name)} ${r.current}/${r.max}</span>`).join('')}</p>`:''}<button class="hero-growth quiet" data-growth="${h.id}">${h.progression?.pending?`✦ Доступен ${h.progression.pending.targetLevel} уровень`:'↗ Развитие и способности'}</button><button class="hero-inventory" data-inventory="${h.id}">▣ Инвентарь <small>${money(current()?.wallet?.[h.id]||0)}</small></button></article>`;}
async function openSheet(id){await haltNarration();const hero=current()?.characters.find(h=>h.id===id);if(!hero)return toast('Сначала создайте героя');stopListening();pauseReactionClock();$('campaignToolsDialog').close();$('heroEditFields').innerHTML=heroFields(hero);$('heroDialog').showModal();}
function actionDescription(a,c){const hero=c.characters.find(h=>h.id===a.characterId)?.name||'Группа',item=c.inventory?.find(i=>i.id===a.itemId),resource=c.characters.find(h=>h.id===a.characterId)?.resources?.find(r=>r.id===a.resourceId);return ({'map.update':()=>`Обновить карту: ${a.map?.name||a.map?.id}`,'map.remove':()=>`Удалить карту: ${c.maps?.find(m=>m.id===a.mapId)?.name||a.mapId}`,'item.update':()=>`Обновить ${item?.name||'вещь'}: ${Object.keys(a.patch||{}).join(', ')}`,'feature.remove':()=>`${hero}: удалить способность ${a.recordId}`,'spell.remove':()=>`${hero}: удалить заклинание ${a.recordId}`,'resource.remove':()=>`${hero}: удалить ресурс ${a.recordId}`,'progression.award':()=>`Награда: ${a.reason||''}`,'progression.levelup':()=>`${hero}: повышение уровня с выбранными изменениями`,'feature.learn':()=>`${hero}: способность ${a.entry?.name}`,'spell.learn':()=>`${hero}: заклинание ${a.entry?.name}`,'world.update':()=>`Обновить журнал мира: ${a.entry?.visibility==='gm'?'скрытая запись':a.entry?.name||''}`,'hero.record':()=>`${hero}: заполнить сведения листа`,'memory.add':()=>`Записать: ${a.note?.text||''}`,'memory.status':()=>`Обновить: ${c.memory?.find(n=>n.id===a.memoryId)?.title||'запись'} → ${a.status}`,'sheet.patch':()=>`${hero}: ${Object.entries(a.patch||{}).map(([k,v])=>typeof v==='object'&&!Array.isArray(v)?Object.entries(v).map(([field,value])=>`${k==='saves'?'спасбросок ':''}${skills[field]||field}: ${value}`).join(', '):`${({level:'уровень',hp:'HP',maxHp:'максимум HP',tempHp:'временные HP',ac:'КД',conditions:'состояния',concentration:'концентрация',className:'класс',notes:'заметка'}[k]||k)}: ${Array.isArray(v)?v.join(', '):v}`).join('; ')}`,'resource.use':()=>`${hero}: потратить ${a.amount||1} × ${resource?.name||'ресурс'}`,'resource.add':()=>`${hero}: добавить ${a.resource?.name}, ${a.resource?.current??a.resource?.max}/${a.resource?.max}`,'item.add':()=>`Добавить: ${a.item?.name} ×${a.item?.quantity||1}`,'item.consume':()=>`Потратить: ${item?.name||'вещь'} ×${a.quantity||1}`,'item.transfer':()=>`Передать ${item?.name||'вещь'} ×${a.quantity||item?.quantity} → ${c.characters.find(h=>h.id===a.ownerId)?.name||'группа'}`,'item.equip':()=>`${a.equipped?'Экипировать':'Снять'}: ${item?.name}`,'item.store':()=>`Переместить ${item?.name} в контейнер`,'item.buy':()=>`Купить ${item?.name} ×${a.quantity||1} за ${a.costCp} мм`,'wallet.change':()=>`Казна: ${a.deltaCp>0?'+':''}${a.deltaCp} мм`,'rest':()=>`${a.kind==='long'?'Долгий':'Короткий'} отдых`,'time.advance':()=>`Продвинуть время на ${a.minutes} минут`,'loot.roll':()=>`Определить находку по таблице ${a.table==='ruins'?'руины':'дорога'}`,'loot.claim':()=>`Получить найденную добычу`}[a.type]||(()=>a.reason||'Игровое действие'))();}
async function tableActions(actions){if(busy)return;if(actions?.some(a=>['wallet.change','loot.claim','item.buy'].includes(a.type)))ambientEngine.playCoinSound();setBusy(true,'Обновляем состояние…');try{state=await api('actions',{id:activeId,actions});render();return true;}catch(e){toast(e.message);return false;}finally{setBusy(false);render();}}
async function decideAction(proposalId,accept){if(busy)return;setBusy(true);try{state=await api('action-proposal',{id:activeId,proposalId,accept});render();if($('autoVoice').checked)speak(current().journal.at(-1)?.text||'Действие обработано.');}catch(e){toast(e.message);}finally{setBusy(false);render();}}
$('actionProposals').onclick=e=>{const b=e.target.closest('[data-action-proposal]');if(b)decideAction(b.dataset.actionProposal,b.dataset.accept==='yes');};
function openTool(id){if(!current())return toast('Сначала откройте игру');stopListening();pauseReactionClock();$('campaignToolsDialog').close();$(id).showModal();}
$('campaignTools').onclick=()=>{stopListening();pauseReactionClock();$('storageNote').textContent=current()?`${editions[current().edition]||editions.legacy}. Игровое время: ${Math.floor((current().clockMinutes||0)/60)} ч ${(current().clockMinutes||0)%60} мин. Сохранение в SQLite; исходная JSON-копия сохранена в Backups. ${state.storage?.mirrorError||''}`:'Откройте или создайте игру.';$('campaignToolsDialog').showModal();};
for(const id of ['usage','memory','new','import','export','seed','editHeroes']){const handler=$(id).onclick;$(id).onclick=e=>{$('campaignToolsDialog').close();handler?.(e);};}
$('deleteCampaign')?.addEventListener('click',async()=>{
 const c=current();
 if(!c)return toast('Сначала откройте кампанию');
 const ok=await askConfirm({
  title:'Удалить текущую кампанию?',
  message:`Вы уверены, что хотите удалить кампанию «${c.name}»?\n\nВсе записи журнала, листы персонажей, карты и память этой кампании будут стёрты безвозвратно.`,
  okText:'Удалить кампанию'
 });
 if(!ok)return;
 try{
  const res=await api('campaign/delete',{id:c.id});
  $('campaignToolsDialog').close();
  toast(`Кампания «${c.name}» удалена`);
  state=res;
  activeId=res.activeCampaignId||state.campaigns?.[0]?.id||null;
  if(activeId)localStorage.setItem('skazitel-active',activeId);else localStorage.removeItem('skazitel-active');
  selectedId=null;
  render();
 }catch(e){
  toast('Ошибка удаления: '+e.message);
 }
});
const noteKinds={fact:'Факт',promise:'Обещание',quest:'Задание',npc:'Персонаж',place:'Место',rumor:'Слух'},noteStatuses={active:'Открыто',fulfilled:'Выполнено',broken:'Нарушено',closed:'Закрыто',overdue:'Просрочено'};
function renderNotebook(){const notes=current()?.memory||[];$('notebookList').innerHTML=notes.length?notes.toReversed().map(n=>`<article class="notebook-card"><small>${noteKinds[n.kind]} · ${noteStatuses[n.status]}${n.deadlineMinutes!==null?' · срок: '+n.deadlineMinutes+' игровых мин.':''}</small><p>${esc(n.text)}</p><small>Источник: ${esc(n.sourceId?.slice(0,8)||'импорт')}</small>${['active','overdue'].includes(n.status)?`<button class="quiet" data-note="${n.id}" data-note-status="${['promise','quest'].includes(n.kind)?'fulfilled':'closed'}">${['promise','quest'].includes(n.kind)?'Отметить выполнение':'Закрыть'}</button>`:''}</article>`).join(''):'<p class="dialog-note">Записей пока нет. Обещания и задания сохраняются здесь отдельно от рассказа.</p>';}
$('notebook').onclick=()=>{renderNotebook();openTool('notebookDialog');};
$('noteForm').onsubmit=async e=>{e.preventDefault();const data=Object.fromEntries(new FormData(e.target));if(await tableActions([{type:'memory.add',note:{kind:data.kind,text:data.text,actorId:selectedId||'',deadlineMinutes:data.deadline?(current().clockMinutes||0)+Number(data.deadline):null}}])){e.target.reset();renderNotebook();}};
$('notebookList').onclick=async e=>{const b=e.target.closest('[data-note]');if(b&&await tableActions([{type:'memory.status',memoryId:b.dataset.note,status:b.dataset.noteStatus}]))renderNotebook();};
const ownerOptions=()=>`<option value="group">Общие вещи группы</option>`+current().characters.map(h=>`<option value="${h.id}">${esc(h.name)}</option>`).join('');
const categoryIcons={weapon:'⚔',armor:'⛨',potion:'⚗',food:'◒',tool:'⚒',treasure:'◇',container:'▣',quest:'✦',other:'◈'};
function renderInventory(){const c=current(),owner=$('inventoryOwner').value||'group',items=(c.inventory||[]).filter(i=>i.ownerId===owner);$('walletView').textContent=`Кошелёк: ${Math.floor((c.wallet?.[owner]||0)/100)} зм · ${(c.wallet?.[owner]||0)%100} мм`;
 $('inventoryList').innerHTML=items.length?items.map(i=>`<article class="inventory-card"><span class="item-icon" data-item-category="${i.category}">${categoryIcons[i.category]}</span><div><strong>${esc(i.name)} ×${i.quantity}</strong><p>${esc(i.description)}</p><small>Носит: ${esc(c.characters.find(h=>h.id===i.carrierId)?.name||'группа')}${i.weight?' · '+i.weight*i.quantity+' фунт.':''}${i.equipped?' · экипировано':''}</small><div><button class="quiet" data-transfer-item="${i.id}">Передать</button><button class="quiet" data-consume-item="${i.id}">Использовать 1</button></div></div></article>`).join(''):'<p class="dialog-note">Вещей пока нет.</p>';
 $('lootList').innerHTML=(c.loot||[]).filter(l=>!l.claimed).map(l=>`<p>${esc(l.item?.name||'Без предметов')}, ${l.copper} мм <button class="quiet" data-claim-loot="${l.id}">Получить</button></p>`).join('');applyInventoryIcons();}
function money(cp){return `${Math.floor(cp/100)} зм${cp%100?' · '+cp%100+' мм':''}`;}
function openInventory(owner='group'){if(!current())return;const c=current();$('inventoryOwner').innerHTML=ownerOptions();$('inventoryOwner').value=owner;$('lootSource').innerHTML=c.journal.filter(e=>['user','assistant'].includes(e.role)&&e.text).slice(-20).reverse().map(e=>`<option value="${e.id}">${esc(e.text.slice(0,100))}</option>`).join('');renderInventory();openTool('inventoryDialog');}
$('inventory').onclick=()=>openInventory();$('partyInventory').onclick=()=>openInventory();
$('inventoryOwner').onchange=renderInventory;
$('itemForm').onsubmit=async e=>{e.preventDefault();const d=Object.fromEntries(new FormData(e.target)),owner=$('inventoryOwner').value;if(await tableActions([{type:'item.add',item:{...d,quantity:Number(d.quantity),ownerId:owner,carrierId:owner}}])){e.target.reset();renderInventory();}};
$('walletForm').onsubmit=async e=>{e.preventDefault();if(await tableActions([{type:'wallet.change',ownerId:$('inventoryOwner').value,deltaCp:Number(new FormData(e.target).get('deltaCp'))}])){e.target.reset();renderInventory();}};
$('inventoryList').onclick=async e=>{const consume=e.target.closest('[data-consume-item]'),transfer=e.target.closest('[data-transfer-item]');if(consume&&await tableActions([{type:'item.consume',itemId:consume.dataset.consumeItem,quantity:1}]))renderInventory();if(transfer){const item=current().inventory.find(i=>i.id===transfer.dataset.transferItem);$('transferOwner').innerHTML=ownerOptions();$('transferForm').elements.itemId.value=item.id;$('transferForm').elements.quantity.max=item.quantity;$('transferForm').elements.quantity.value=1;$('transferDialog').showModal();}};
$('transferForm').onsubmit=async e=>{e.preventDefault();const d=Object.fromEntries(new FormData(e.target));if(await tableActions([{type:'item.transfer',itemId:d.itemId,ownerId:d.ownerId,quantity:Number(d.quantity)}])){$('transferDialog').close();renderInventory();}};
$('rollLoot').onclick=async()=>{if(await tableActions([{type:'loot.roll',table:$('lootTable').value,sourceId:$('lootSource').value}]))renderInventory();};
$('lootList').onclick=async e=>{const b=e.target.closest('[data-claim-loot]');if(b&&await tableActions([{type:'loot.claim',lootId:b.dataset.claimLoot}]))renderInventory();};
async function searchHistory(){try{const d=await api('archive?id='+encodeURIComponent(activeId)+'&q='+encodeURIComponent($('archiveQuery').value));$('archiveResults').innerHTML=d.results.length?d.results.map(e=>`<article class="notebook-card"><small>${esc(e.kind||e.role||'Событие')}</small><p>${esc(e.text)}</p></article>`).join(''):'<p>Ничего не найдено.</p>';}catch(e){toast(e.message);}}
$('history').onclick=()=>{openTool('historyDialog');searchHistory();};$('archiveForm').onsubmit=e=>{e.preventDefault();searchHistory();};
let iconCatalog=[];
const iconDefaults={weapon:'crossed-swords',armor:'round-shield',potion:'potion-ball',food:'meat',tool:'crossed-hammer',treasure:'gem-chain',container:'locked-chest',quest:'scroll-unfurled',other:'backpack'};
function inventoryIcon(category,name){const hints={меч:'sword',кинжал:'dagger',топор:'axe',лук:'bow',щит:'shield',шлем:'helmet',зелье:'potion',веревка:'rope',верёвка:'rope',кольцо:'ring',книга:'book',свиток:'scroll',камень:'gem',ключ:'key',факел:'torch',рюкзак:'backpack',сундук:'chest',паек:'food',паёк:'food'};const hint=Object.entries(hints).find(([word])=>name.toLowerCase().includes(word))?.[1];if(hint==='rope')return iconCatalog.find(i=>i.id.endsWith('-rope-coil'))?.file;return (hint&&iconCatalog.find(i=>i.tags.includes(hint))||iconCatalog.find(i=>i.id.endsWith('-'+iconDefaults[category]))||iconCatalog.find(i=>i.tags.includes(iconDefaults[category]?.split('-')[0])))?.file;}
function applyInventoryIcons(){document.querySelectorAll('[data-item-category]').forEach(el=>{const file=inventoryIcon(el.dataset.itemCategory,el.closest('.inventory-card').querySelector('strong').textContent);if(file)el.innerHTML=`<img src="/icons/${file}?v=${iconCatalog.find(i=>i.file===file)?.sha256.slice(0,8)||'4'}" width="32" height="32" alt="">`;});}
fetch('/icons/manifest.json?v=0.4.0').then(r=>r.ok?r.json():null).then(d=>{iconCatalog=d?.icons||[];applyInventoryIcons();}).catch(()=>{});

function renderIllustrations(){$('illustrationList').innerHTML=(current()?.images||[]).toReversed().map(i=>`<article class="notebook-card">${i.status==='ready'?`<img class="scene-illustration" src="/images/${i.file}" alt="${esc(i.prompt)}">`:''}<p>${esc(i.prompt)}</p><small>${({queued:'В бесплатной очереди',ready:'Готово',failed:'Ошибка сервиса',censored:'Скрыто фильтром'}[i.status]||i.status)}${i.queuePosition!==null&&i.queuePosition!==undefined?' · позиция '+i.queuePosition:''}${i.waitSeconds?' · оценка '+i.waitSeconds+' с':''} · ${i.provider==='openai'?'OpenAI · платно':'$0'}</small>${i.status==='queued'?`<button class="quiet" data-check-image="${i.id}">Проверить очередь</button>`:''}${i.message?`<p>${esc(i.message)}</p>`:''}</article>`).join('');}
function imageProviderUI(){const paid=state.config.imageProvider==='openai',f=$('illustrationForm');$('imageConsent').hidden=paid;f.elements.publicConsent.required=!paid;$('imageProviderNote').textContent=paid?'OpenAI · '+state.config.imageModel+' · '+state.config.imageQuality+'. Генерация платная, только по кнопке. Квадрат 1024×1024: low ≈ $0,006, medium ≈ $0,053, high ≈ $0,211 плюс входной запрос.':'AI Horde: бесплатная публичная очередь; описание и результат могут передаваться в LAION.';$('imageSubmit').textContent=paid?'Сгенерировать · платно':'В бесплатную очередь';}
function openIllustrations({kind='scene',characterId='',prompt=''}={}){if(!current())return;const form=$('illustrationForm');form.reset();imageProviderUI();$('portraitHero').innerHTML=current().characters.map(h=>`<option value="${h.id}">${esc(h.name)}</option>`).join('');$('illustrationKind').value=kind;if(characterId)$('portraitHero').value=characterId;$('portraitLabel').hidden=kind!=='portrait';form.elements.prompt.value=prompt;portraitDraftValue=prompt;$('portraitPromptTools').hidden=kind!=='portrait';$('portraitPromptStatus').textContent='';renderIllustrations();openTool('illustrationsDialog');if(kind==='portrait'&&!prompt)suggestPortraitPrompt();}
$('illustrations').onclick=()=>openIllustrations();
$('illustrationKind').onchange=()=>{const portrait=$('illustrationKind').value==='portrait';$('portraitLabel').hidden=!portrait;$('portraitPromptTools').hidden=!portrait;if(portrait)suggestPortraitPrompt();};
$('portraitHero').onchange=()=>suggestPortraitPrompt();
$('illustrationForm').onsubmit=async e=>{e.preventDefault();const d=Object.fromEntries(new FormData(e.target));$('imageSubmit').disabled=true;try{state=await api('image-request',{id:activeId,kind:d.kind,characterId:d.characterId,prompt:d.prompt,publicConsent:d.publicConsent==='on'});render();renderIllustrations();}catch(err){toast(err.message);}finally{$('imageSubmit').disabled=false;}};
$('illustrationList').onclick=async e=>{const b=e.target.closest('[data-check-image]');if(!b)return;b.disabled=true;try{state=await api('image-check',{id:activeId,imageId:b.dataset.checkImage});render();renderIllustrations();}catch(err){toast(err.message);}finally{b.disabled=false;}};

let imagePollBusy=false,imagePollIndex=0;
setInterval(async()=>{if(!$('illustrationsDialog').open||imagePollBusy)return;const jobs=(current()?.images||[]).filter(i=>i.status==='queued');if(!jobs.length)return;const job=jobs[imagePollIndex++%jobs.length],id=activeId;imagePollBusy=true;try{const next=await api('image-check',{id,imageId:job.id});if(activeId===id){state=next;render();renderIllustrations();}}catch{}finally{imagePollBusy=false;}},12000);

$('dmTools').onclick=()=>{const d=current()?.dm||{};const f=$('dmForm');f.elements.autonomy.value=d.autonomy||'automatic';f.elements.hints.value=d.hints||'contextual';f.elements.strict.checked=!!d.strict;$('dmChanges').innerHTML=(d.changes||[]).toReversed().slice(0,30).map(x=>`<p class="dialog-note">${esc(x.text)}</p>`).join('')||'<p class="dialog-note">Автоматических изменений пока нет.</p>';$('worldRecords').innerHTML=(d.world||[]).map(x=>`<article class="notebook-card"><strong>${esc(x.name)}</strong><small> · ${esc(x.kind)} · ${esc(x.state)}</small><p>${esc(x.description)}</p>${x.stage?`<p>${esc(x.stage)}</p>`:''}</article>`).join('')||'<p class="dialog-note">Здесь появятся установленные NPC, места, отношения и этапы заданий.</p>';openTool('dmDialog');};
$('dmForm').onsubmit=async e=>{e.preventDefault();const f=e.target;if(await tableActions([{type:'dm.configure',autonomy:f.elements.autonomy.value,hints:f.elements.hints.value,strict:f.elements.strict.checked}]))$('dmDialog').close();};
function openProgress(id){const h=current()?.characters.find(h=>h.id===id);if(!h)return;const p=h.progression||{};$('progressTitle').textContent='Развитие · '+h.name;$('progressInfo').innerHTML=`<p>${h.level} уровень · мастерство +${h.proficiency} · ${p.mode==='xp'?`${p.xp??'неизвестно'} XP`:'по сюжетным рубежам'}</p>${p.pending?`<p class="growth-ready">✦ Доступен ${p.pending.targetLevel} уровень: ${esc(p.pending.reason)}</p>`:''}${(p.review||[]).map(x=>`<p class="dialog-note">Сверить: ${esc(x)}</p>`).join('')}`;const f=$('progressForm');f.elements.characterId.value=id;f.elements.mode.value=p.mode||'milestone';f.elements.xp.value=p.xp??'';$('progressFeatures').innerHTML=`<h3>Особенности</h3>${(h.features||[]).map(x=>`<article class="notebook-card"><strong>${esc(x.name)}</strong><p>${esc(x.description)}</p><small>${esc(x.source)}</small></article>`).join('')}<h3>Заклинания</h3>${(h.spells||[]).map(x=>`<article class="notebook-card"><strong>${esc(x.name)}</strong><small> · ${x.level?x.level+' круг':'кантрип'}${x.concentration?' · концентрация':''}</small><p>${esc(x.description)}</p></article>`).join('')}`;openTool('progressDialog');}
$('progressForm').onsubmit=async e=>{e.preventDefault();const f=e.target;if(f.elements.mode.value==='xp'&&f.elements.xp.value==='')return toast('Укажите подтверждённый XP, неизвестное не считается нулём');if(await tableActions([{type:'progression.configure',characterId:f.elements.characterId.value,mode:f.elements.mode.value,xp:Number(f.elements.xp.value)}]))openProgress(f.elements.characterId.value);};

let portraitDraftValue='',portraitDraftRequest=0;
async function suggestPortraitPrompt(force=false){
 if($('illustrationKind').value!=='portrait'||!current())return;
 const field=$('illustrationForm').elements.prompt;
 if(!force&&field.value.trim()&&field.value!==portraitDraftValue){$('portraitPromptStatus').textContent='Вы изменили описание. Кнопка «Составить по описанию героя» заменит его новым черновиком.';return;}
 const campaignId=activeId,heroId=$('portraitHero').value,previous=field.value,request=++portraitDraftRequest;
 $('suggestPortraitPrompt').disabled=true;$('portraitPromptStatus').textContent='Собираю описание из листа героя…';
 try{const draft=await api('image-prompt',{id:campaignId,characterId:heroId});
  if(request!==portraitDraftRequest||activeId!==campaignId||$('portraitHero').value!==heroId||$('illustrationKind').value!=='portrait'||!$('illustrationsDialog').open)return;
  if(field.value!==previous){$('portraitPromptStatus').textContent='Ваши правки сохранены. Для нового черновика нажмите кнопку.';return;}
  field.value=draft.prompt;portraitDraftValue=draft.prompt;
  $('portraitPromptStatus').textContent='Черновик по данным кампании: '+(draft.used.join(', ')||'общий портрет')+'. Можно поправить перед отправкой. '+draft.missing.join(' ');
 }catch(err){if(request===portraitDraftRequest)$('portraitPromptStatus').textContent=err.message;}
 finally{if(request===portraitDraftRequest)$('suggestPortraitPrompt').disabled=false;}
}
$('suggestPortraitPrompt').onclick=()=>suggestPortraitPrompt(true);

$('maps').onclick=()=>{const maps=current()?.maps||[];$('mapsList').innerHTML=maps.map(m=>`<article class="notebook-card"><h3>${esc(m.name)}</h3><p>${esc(m.description)}</p><p>${m.width} × ${m.height} · ${m.feetPerCell} футов на клетку</p><div class="map-scroll"><table class="game-map"><tbody>${Array.from({length:m.height},(_,y)=>`<tr>${Array.from({length:m.width},(_,x)=>`<td>${m.tokens.filter(t=>t.x===x&&t.y===y).map(t=>`<span title="${esc(t.kind)}">${esc(t.label||t.id)}</span>`).join('')}</td>`).join('')}</tr>`).join('')}</tbody></table></div></article>`).join('')||'<p>Карт пока нет. Попросите мастера составить карту известного места.</p>';openTool('mapsDialog');};

document.addEventListener('change',event=>{
 const row=event.target.closest('.resource-form');if(!row)return;
 const recovery=row.querySelector('[data-resource="recovery"]').value;
 row.querySelector('[data-resource="minutes"]').closest('label').hidden=recovery!=='gameTime';
 row.querySelector('[data-resource="recoverAmount"]').closest('label').hidden=!['shortRest','gameTime'].includes(recovery);
 const boundary=row.querySelector('[data-resource="resetOn"]').value;
 row.querySelector('[data-resource="recovery"] option[value="manual"]').textContent=boundary==='none'?'Только вручную':'По событию, указанному ниже';
});

$('testVoice').onclick=async()=>{const button=$('testVoice');button.disabled=true;$('testVoiceStatus').textContent='Проверяем голос…';try{const f=$('settingsForm'),tts=f.elements.ttsProvider.value;if(tts==='off')throw Error('Выбран режим без озвучки. Сначала выберите голос.');let previewParam=null;if(tts==='edge')previewParam=f.elements.edgeVoice.value;else if(tts==='openai')previewParam='openai:'+f.elements.voice.value;else if(tts==='silero')previewParam=f.elements.sileroSpeaker.value;else if(tts==='elevenlabs')previewParam='elevenlabs:'+(f.elements.elevenVoice.value==='__custom__'?f.elements.elevenCustomVoice.value.trim():f.elements.elevenVoice.value);const ok=await speak('Проверка. Голос Сказителя работает.',previewParam);$('testVoiceStatus').textContent=ok?'✓ Аудио воспроизведено до конца':'Воспроизведение остановлено или завершилось с ошибкой';}catch(error){$('testVoiceStatus').textContent=error.message;}finally{button.disabled=false;}};

let tacticalHudOpen = false;
let activeHudTab = 'map';
let hudInventoryOwner = 'group';
let lastKnownMapHash = '';
let mapGenerating = false;
let hudWideMode = localStorage.getItem('skazitel-hud-wide') === 'true';
let mapZoomMode = localStorage.getItem('skazitel-map-zoom') || 'fit';

function toggleSidebar(forceState){
 const isCollapsed = forceState !== undefined ? forceState : !document.body.classList.contains('sidebar-collapsed');
 document.body.classList.toggle('sidebar-collapsed', isCollapsed);
 localStorage.setItem('skazitel-sidebar-collapsed', String(isCollapsed));
 const toggleBtn = $('toggleSidebar');
 if(toggleBtn){
  toggleBtn.classList.toggle('active', isCollapsed);
  toggleBtn.title = isCollapsed ? 'Развернуть меню историй (⌘B / [)' : 'Свернуть меню историй (⌘B / [)';
 }
}

function setMapZoomMode(mode){
 mapZoomMode = mode;
 localStorage.setItem('skazitel-map-zoom', mode);
 document.querySelectorAll('.map-grid-container').forEach(el=>{
  el.classList.toggle('zoom-fit', mode === 'fit');
 });
 $('mapZoomFit')?.classList.toggle('active', mode === 'fit');
 $('mapZoomToggle')?.classList.toggle('active', mode === '100%');
}

function toggleHudWide(forceState){
 hudWideMode = forceState !== undefined ? forceState : !hudWideMode;
 localStorage.setItem('skazitel-hud-wide', String(hudWideMode));
 document.querySelector('.table-grid')?.classList.toggle('wide-hud', tacticalHudOpen && hudWideMode);
 const btn = $('toggleHudWide');
 if(btn){
  btn.classList.toggle('active', hudWideMode);
  btn.textContent = hudWideMode ? '⤡' : '⤢';
  btn.title = hudWideMode ? 'Компактный дисплей стола (W)' : 'Развернуть широкий дисплей карты (W)';
 }
}

function getCellTerrainClass(tokens){
 if(!tokens||!tokens.length) return '';
 for(const t of tokens){
  const label = (t.label || t.id || '').toLowerCase();
  if(/(?:костер|огонь|пламя|факел|жар|лава|печь|fire|flame|torch|lava)/i.test(label)) return 'cell-terrain-fire';
  if(/(?:фонтан|колодец|вода|водоем|озеро|ручей|бассейн|река|fountain|well|water|river|pond)/i.test(label)) return 'cell-terrain-water';
  if(/(?:дерево|куст|заросли|трава|лес|растение|tree|bush|forest|vine|plant)/i.test(label)) return 'cell-terrain-nature';
  if(/(?:ловушка|растяжка|нажим|мина|яма|trap|pit)/i.test(label)) return 'cell-terrain-trap';
  if(/(?:колонна|стена|завал|столб|камень|валун|скала|обвал|pillar|column|wall|rock|stone|boulder)/i.test(label)) return 'cell-terrain-stone';
 }
 return '';
}

function getTokenIcon(token){
 if(!token) return '◇';
 const kind = token.kind || 'object';
 const label = (token.label || token.id || '').toLowerCase();
 if(kind === 'hero'){
  if(/(?:арт|изобрет|инженер|алхим|теон|artificer)/i.test(label)) return '⚙️';
  if(/(?:друид|шаман|травник|альвари|druid)/i.test(label)) return '🌿';
  if(/(?:бард|скальд|певец|музык|лира|bard)/i.test(label)) return '🪕';
  if(/(?:жрец|клирик|священ|целител|капеллан|cleric)/i.test(label)) return '🛡️';
  if(/(?:паладин|храмов|крестонос|paladin)/i.test(label)) return '⚜️';
  if(/(?:воин|боец|рыцар|солдат|варвар|берсерк|fighter|warrior|barbarian)/i.test(label)) return '⚔️';
  if(/(?:плут|вор|разбой|следопыт|ловк|ассасин|роуг|rogue|стрэндж)/i.test(label)) return '🗡️';
  if(/(?:лучник|стрелок|егерь|охотник|рейнджер|ranger|archer)/i.test(label)) return '🏹';
  if(/(?:монах|единобор|кунг|monk)/i.test(label)) return '🥋';
  if(/(?:чародей|sorcerer)/i.test(label)) return '🔮';
  if(/(?:колдун|чернокниж|warlock)/i.test(label)) return '🧿';
  if(/(?:маг|волшебн|иллюз|архимаг|wizard|mage)/i.test(label)) return '🧙';
  return '👤';
 }
 if(kind === 'enemy'){
  // Undead
  if(/(?:скелет|костяк|skeleton)/i.test(label)) return '💀';
  if(/(?:зомби|упырь|гуль|мертв|ghoul|zombie|undead)/i.test(label)) return '🧟';
  if(/(?:вампир|князь\s+тьмы|vampire)/i.test(label)) return '🧛';
  if(/(?:лич|некромант|lich|necromancer)/i.test(label)) return '☠️';
  if(/(?:призрак|дух|тень|фантом|банши|ghost|specter|shadow|wraith|banshee)/i.test(label)) return '👻';
  // Beasts / Animals
  if(/(?:волк|пес|собак|зверь|гонч|wolf|hound)/i.test(label)) return '🐺';
  if(/(?:медведь|гризли|bear)/i.test(label)) return '🐻';
  if(/(?:кабан|вепрь|секач|boar)/i.test(label)) return '🐗';
  if(/(?:паук|паучи|тарантул|spider|arachnid)/i.test(label)) return '🕷️';
  if(/(?:змея|гадюка|василиск|кобра|snake|viper|basilisk)/i.test(label)) return '🐍';
  if(/(?:крыса|мышь|грызун|rat)/i.test(label)) return '🐀';
  if(/(?:летучая\s+мышь|нетопырь|bat)/i.test(label)) return '🦇';
  // Humanoid enemies
  if(/(?:гоблин|кобольд|goblin|kobold)/i.test(label)) return '👺';
  if(/(?:орк|варг|полуорк|orc)/i.test(label)) return '👹';
  if(/(?:тролль|огр|великан|гигант|циклоп|troll|ogre|giant|cyclops)/i.test(label)) return '🧌';
  if(/(?:культист|фанатик|сектан|cultist)/i.test(label)) return '🕯️';
  if(/(?:разбой|бандит|наемник|граби|головорез|thug|bandit|mercenary)/i.test(label)) return '🗡️';
  if(/(?:ассасин|наемный\s+убийца|assassin|ninja)/i.test(label)) return '🥷';
  if(/(?:снайпер|стрелок|арбалетчик|archer|crossbowman)/i.test(label)) return '🎯';
  if(/(?:всадник|кавалерист|rider|cavalry)/i.test(label)) return '🏇';
  // Monsters & Bosses
  if(/(?:дракон|виверн|змий|тиамат|dragon|wyvern|drake)/i.test(label)) return '🐉';
  if(/(?:демон|бес|черт|дьявол|имп|demon|devil|fiend|imp)/i.test(label)) return '👿';
  if(/(?:мимик|слизь|студень|желе|mimic|ooze|slime|cube)/i.test(label)) return '🧪';
  if(/(?:элементаль|голем|elemental|golem)/i.test(label)) return '🗿';
  if(/(?:энт|дендроид|леший|treant)/i.test(label)) return '🪵';
  if(/(?:босс|главарь|вождь|капитан|король|командир|boss|chief|lord)/i.test(label)) return '👑';
  return '💀';
 }
 // Objects & Terrain
 if(/(?:сундук|ларь|ящик|короб|сейф|трофей|chest|crate|box|safe)/i.test(label)) return '📦';
 if(/(?:сокровищ|золото|клад|монеты|драгоцен|алмаз|treasure|gold|gem)/i.test(label)) return '💎';
 if(/(?:дверь|ворота|проход|решетка|люк|door|gate|hatch|portal)/i.test(label)) return '🚪';
 if(/(?:костер|огонь|пламя|факел|жар|печь|жаровня|fire|flame|torch)/i.test(label)) return '🔥';
 if(/(?:ловушка|растяжка|нажим|мина|яма|trap|pit)/i.test(label)) return '⚠️';
 if(/(?:алтарь|саркофаг|гробниц|могила|святилищ|altar|tomb|shrine|sarcophagus)/i.test(label)) return '⚰️';
 if(/(?:фонтан|колодец|вода|водоем|озеро|бассейн|fountain|well|water|pool)/i.test(label)) return '⛲';
 if(/(?:дерево|дуб|сосна|роща|лес|tree|forest|wood)/i.test(label)) return '🌲';
 if(/(?:куст|заросли|трава|кустарник|bush|vine)/i.test(label)) return '🌿';
 if(/(?:колонна|столб|стена|обелиск|pillar|column|wall|obelisk)/i.test(label)) return '🏛️';
 if(/(?:камень|валун|скала|завал|обвал|rock|boulder|rubble)/i.test(label)) return '🪨';
 if(/(?:стол|стул|бар|стойка|мебель|скамья|table|chair|bench)/i.test(label)) return '🪑';
 if(/(?:лестниц|трап|ступен|подъем|спуск|ladder|stairs)/i.test(label)) return '🪜';
 if(/(?:мост|переправа|bridge)/i.test(label)) return '🌉';
 if(/(?:книга|свиток|фолиант|записка|гримуар|book|scroll|tome)/i.test(label)) return '📜';
 if(/(?:зелье|флакон|колба|эликсир|снадобье|potion|flask|vial)/i.test(label)) return '🧪';
 if(/(?:кровать|нары|спальник|постель|bed|cot)/i.test(label)) return '🛏️';
 if(/(?:повозка|телега|карета|фургон|wagon|cart|carriage)/i.test(label)) return '🛒';
 if(/(?:клетка|темница|решетка|цепи|cage|chains)/i.test(label)) return '⛓️';
 if(/(?:гриб|споры|mushroom|fungus)/i.test(label)) return '🍄';
 if(/(?:портал|разлом|руна|магический\s+круг|portal|rift|rune)/i.test(label)) return '🌀';
 return '◇';
}

function toggleTacticalHud(forceState){
 const next = forceState !== undefined ? forceState : !tacticalHudOpen;
 tacticalHudOpen = next;
 const grid = document.querySelector('.table-grid');
 const hud = $('tacticalHud');
 $('toggleTacticalHud')?.classList.toggle('active', tacticalHudOpen);

 if(!tacticalHudOpen){
  if(hud) hud.hidden = true;
  grid?.classList.remove('split-mode');
  grid?.classList.remove('wide-hud');
  return;
 }

 if(mapWindowFloating){
  hud?.classList.add('floating-window');
  grid?.classList.remove('split-mode');
  grid?.classList.remove('wide-hud');
  applySavedMapWindowGeometry();
  if(hud) hud.hidden = false;
  const mb = $('hudMinibar');
  if(mb) mb.hidden = true;
  mapWindowMinimized = false;
 } else {
  hud?.classList.remove('floating-window');
  grid?.classList.add('split-mode');
  grid?.classList.toggle('wide-hud', hudWideMode);
  if(hud) hud.hidden = false;
 }

 renderTacticalHud();
}

function setMapWindowMode(floating){
 mapWindowFloating = floating;
 localStorage.setItem('skazitel-map-floating', mapWindowFloating ? '1' : '0');
 const dockBtn = $('toggleHudDockMode');
 if(dockBtn){
  dockBtn.textContent = mapWindowFloating ? t('hudDockBtn') : t('hudUndockBtn');
 }
 if(tacticalHudOpen){
  toggleTacticalHud(true);
 }
}

function saveMapWindowGeometry(){
 const hud = $('tacticalHud');
 if(!hud || !mapWindowFloating) return;
 const geom = {
  left: hud.style.left,
  top: hud.style.top,
  width: hud.style.width,
  height: hud.style.height,
  maximized: mapWindowMaximized
 };
 localStorage.setItem('skazitel-map-window-geom', JSON.stringify(geom));
}

function applySavedMapWindowGeometry(){
 const hud = $('tacticalHud');
 if(!hud) return;
 try {
  const saved = JSON.parse(localStorage.getItem('skazitel-map-window-geom') || '{}');
  hud.style.left = saved.left || 'calc(50vw - 360px)';
  hud.style.top = saved.top || '75px';
  hud.style.width = saved.width || '720px';
  hud.style.height = saved.height || '540px';
  mapWindowMaximized = !!saved.maximized;
 } catch {
  hud.style.left = 'calc(50vw - 360px)';
  hud.style.top = '75px';
  hud.style.width = '720px';
  hud.style.height = '540px';
 }
}

function switchHudTab(tabName){
 activeHudTab = tabName;
 document.querySelectorAll('.hud-tab').forEach(btn=>{
  const match = btn.dataset.tab === tabName;
  btn.classList.toggle('active', match);
  btn.setAttribute('aria-selected', match ? 'true' : 'false');
 });
 if($('hudMapPanel')) $('hudMapPanel').hidden = tabName !== 'map';
 if($('hudDiaryPanel')) $('hudDiaryPanel').hidden = tabName !== 'diary';
 if($('hudInventoryPanel')) $('hudInventoryPanel').hidden = tabName !== 'inventory';
 renderTacticalHud();
}

function renderHudMap(){
 const c = current();
 const panel = $('hudMapPanel');
 if(!panel || !c) return;
 if(mapGenerating){
  panel.innerHTML = `<div class="hud-empty-state">
   <span style="display:inline-block;animation:spin 1.5s linear infinite;">⚙️</span>
   <h3 style="font-family:Georgia,serif;font-size:18px;margin:10px 0 6px;">Нейросеть чертит тактическую схему…</h3>
   <p>Анализируем местность, расставляем укрытия, врагов и отряд на координатной сетке <strong>без озвучивания</strong>.</p>
  </div>`;
  return;
 }
 const maps = c.maps || [];
 if(!maps.length){
  panel.innerHTML = `<div class="hud-empty-state">
   <span>🗺️</span>
   <h3 style="font-family:Georgia,serif;font-size:18px;margin:0 0 8px;">Тактическая схема не развернута</h3>
   <p>Нейросеть может составить координатную сетку с укрытиями, врагами и позициями героев по текущей сцене или материалам кампании — <strong>без озвучивания и лишних реплик</strong>.</p>
   <div class="hud-map-actions-row">
    <button type="button" class="hud-quick-btn primary-hud-btn" id="generateMapFromScene">✨ Тактическая сетка сцены</button>
    <button type="button" class="hud-quick-btn" id="generateWorldMap">🌍 Карта региона / мира</button>
    <button type="button" class="hud-quick-btn" id="generateMapCustom">✎ Свой фокус…</button>
   </div>
  </div>`;
  return;
 }
 panel.innerHTML = maps.map(m => {
  const colLabels = Array.from({length: m.width}, (_, i) => String.fromCharCode(65 + (i % 26)) + (i >= 26 ? Math.floor(i / 26) : ''));
  const heroTokens = (m.tokens || []).filter(t => t.kind === 'hero');
  const enemyTokens = (m.tokens || []).filter(t => t.kind === 'enemy');
  const objectTokens = (m.tokens || []).filter(t => t.kind !== 'hero' && t.kind !== 'enemy');
  const scaleText = m.feetPerCell >= 5000 ? `1 кл = ${(m.feetPerCell / 5280).toFixed(1)} мили (~1 лига)` : `1 кл = ${m.feetPerCell} фт`;
  return `<article class="tactical-map-card">
   <div class="tactical-map-header">
    <div>
     <h3 class="tactical-map-title">${esc(m.name)}</h3>
     <span class="tactical-map-scale">${m.width}×${m.height} · ${scaleText}</span>
    </div>
    <div class="tactical-map-btns">
     <button type="button" class="hud-mini-btn" id="hudAddWorldMap" title="Создать обзорную карту региона">🌍 Карта региона</button>
     <button type="button" class="hud-mini-btn" data-remap-scene="${m.id}" title="Перечертить сетку под текущую сцену">⟳ Обновить сетку</button>
     <button type="button" class="hud-mini-btn" id="hudAddNewMap" title="Создать дополнительную схему">＋ Схема</button>
    </div>
   </div>
   ${m.description ? `<p class="tactical-map-desc">${esc(m.description)}</p>` : ''}
   <div class="tactical-cell-inspect-bar" id="inspectBar_${m.id}">
    <span>Коснитесь любой клетки сетки, чтобы узнать расстояние и объекты</span>
    <small>${scaleText}</small>
   </div>
   <div class="map-grid-container ${mapZoomMode === 'fit' ? 'zoom-fit' : ''}">
    <table class="tactical-grid-table">
     <thead>
      <tr>
       <th class="row-header"></th>
       ${colLabels.map(col => `<th>${col}</th>`).join('')}
      </tr>
     </thead>
     <tbody>
      ${Array.from({length: m.height}, (_, y) => `<tr>
       <th class="row-header">${y + 1}</th>
       ${Array.from({length: m.width}, (_, x) => {
        const cellTokens = (m.tokens || []).filter(t => t.x === x && t.y === y);
        const terrainClass = getCellTerrainClass(cellTokens);
        const tokensJson = esc(JSON.stringify(cellTokens));
        let isFogShrouded = false;
        if (m.fogOfWar) {
          const coordKey = `${x},${y}`;
          const isRevealed = m.revealedCells && m.revealedCells.includes(coordKey);
          if (!isRevealed) {
            const inVision = heroTokens.some(h => Math.max(Math.abs(h.x - x), Math.abs(h.y - y)) <= 6);
            if (!inVision) isFogShrouded = true;
          }
        }
        const fogClass = isFogShrouded ? ' cell-fog-shrouded' : '';
        return `<td class="tactical-grid-cell ${terrainClass}${fogClass}" data-coord="${colLabels[x]}${y + 1}" data-x="${x}" data-y="${y}" data-tokens="${tokensJson}">
         ${cellTokens.map(t => {
          const kind = t.kind || 'object';
          const label = t.label || t.id;
          const initial = label.slice(0, 2);
          const icon = getTokenIcon(t);
          return `<span class="token-badge token-${kind}" title="${esc(label)} (${kind}) · ${colLabels[x]}${y + 1}" data-token-id="${esc(t.id)}"><span class="token-ico">${icon}</span><span class="token-txt">${esc(initial)}</span></span>`;
         }).join('')}
        </td>`;
       }).join('')}
      </tr>`).join('')}
     </tbody>
    </table>
   </div>
   <div class="token-roster">
    ${heroTokens.map(t => `<div class="token-roster-item"><span class="token-badge token-hero" style="width:20px;height:20px;font-size:11px;"><span class="token-ico">${getTokenIcon(t)}</span></span><span>${esc(t.label||t.id)}</span><small>${colLabels[t.x]}${t.y+1}</small></div>`).join('')}
    ${enemyTokens.map(t => `<div class="token-roster-item"><span class="token-badge token-enemy" style="width:20px;height:20px;font-size:11px;"><span class="token-ico">${getTokenIcon(t)}</span></span><span>${esc(t.label||t.id)}</span><small>${colLabels[t.x]}${t.y+1}</small></div>`).join('')}
    ${objectTokens.map(t => `<div class="token-roster-item"><span class="token-badge token-object" style="width:20px;height:20px;font-size:11px;"><span class="token-ico">${getTokenIcon(t)}</span></span><span>${esc(t.label||t.id)}</span><small>${colLabels[t.x]}${t.y+1}</small></div>`).join('')}
   </div>
  </article>`;
 }).join('');

 panel.querySelectorAll('.tactical-grid-cell').forEach(cell => {
  cell.addEventListener('click', () => {
   const card = cell.closest('.tactical-map-card');
   if (!card) return;
   card.querySelectorAll('.tactical-grid-cell.selected-cell').forEach(c => c.classList.remove('selected-cell'));
   cell.classList.add('selected-cell');

   const coord = cell.dataset.coord;
   const x = parseInt(cell.dataset.x, 10);
   const y = parseInt(cell.dataset.y, 10);
   const tokens = cell.dataset.tokens ? JSON.parse(cell.dataset.tokens) : [];
   const inspectBar = card.querySelector('.tactical-cell-inspect-bar');

   const activeMap = (c.maps || [])[0];
   const heroTokens = (activeMap?.tokens || []).filter(t => t.kind === 'hero');
   let distStr = '';
   if (heroTokens.length > 0) {
    const hero = heroTokens[0];
    const dx = Math.abs(x - hero.x), dy = Math.abs(y - hero.y);
    const cellsDist = Math.max(dx, dy);
    const feetDist = cellsDist * (activeMap.feetPerCell || 5);
    distStr = ` · Расстояние от ${esc(hero.label || hero.id)}: <strong>${feetDist} фт</strong> (${cellsDist} кл)`;
   }

   if (inspectBar) {
    if (tokens.length > 0) {
     const tokensDesc = tokens.map(t => `${getTokenIcon(t)} ${esc(t.label || t.id)}`).join(', ');
     inspectBar.innerHTML = `<span>Клетка <strong>${coord}</strong>: ${tokensDesc}${distStr}</span><small>${scaleText}</small>`;
    } else {
     inspectBar.innerHTML = `<span>Клетка <strong>${coord}</strong>: свободное пространство${distStr}</span><small>${scaleText}</small>`;
    }
   }
  });
 });

 $('mapZoomFit')?.classList.toggle('active', mapZoomMode === 'fit');
 $('mapZoomToggle')?.classList.toggle('active', mapZoomMode === '100%');
 const activeMap = (c.maps || [])[0];
 if ($('hudFogToggle')) {
  $('hudFogToggle').classList.toggle('active', !!activeMap?.fogOfWar);
  $('hudFogToggle').textContent = activeMap?.fogOfWar ? '🌫️ Туман: ВКЛ' : '🌫️ Туман: ВЫКЛ';
 }
}

function renderHudDiary(){
 const c = current();
 const panel = $('hudDiaryPanel');
 if(!panel || !c) return;
 const world = c.dm?.world || [];
 const memory = c.memory || [];
 
 const npcs = world.filter(w => w.kind === 'npc');
 const quests = world.filter(w => w.kind === 'quest');
 const clues = world.filter(w => w.kind === 'clue');
 
 if(!world.length && !memory.length){
  panel.innerHTML = `<div class="hud-empty-state">
   <span>📜</span>
   <h3 style="font-family:Georgia,serif;font-size:18px;margin:0 0 8px;">Дневник приключения чист</h3>
   <p>По ходу истории мастер автоматически заносит сюда картотеку встреченных NPC, их отношение к отряду, активные задания и зацепки.</p>
  </div>`;
  return;
 }

 let html = '';

 if(c.dm?.location || c.dm?.weather || c.dm?.dateLabel){
  html += `<div class="diary-card" style="border-left:3px solid var(--gold);background:#16231b;">
   <div class="diary-card-top">
    <strong class="diary-card-title">📍 Текущая обстановка</strong>
    <span class="quest-progress-tag">Сессия ${c.dm.session || 1} · Сцена ${c.dm.scene || 1}</span>
   </div>
   <p><strong>Место:</strong> ${esc(c.dm.location || 'Не указано')}</p>
   ${c.dm.dateLabel ? `<p><strong>Время/дата:</strong> ${esc(c.dm.dateLabel)}</p>` : ''}
   ${c.dm.weather ? `<p><strong>Погода:</strong> ${esc(c.dm.weather)}</p>` : ''}
  </div>`;
 }

 if(quests.length){
  html += `<section class="diary-section">
   <div class="diary-heading"><span>АКТИВНЫЕ ЗАДАНИЯ И ЦЕЛИ (${quests.length})</span></div>
   ${quests.map(q => `<article class="diary-card">
    <div class="diary-card-top">
     <strong class="diary-card-title">${esc(q.name)}</strong>
     <span class="quest-progress-tag">${esc(q.state || 'в процессе')}</span>
    </div>
    <p>${esc(q.description)}</p>
    ${q.stage ? `<p style="color:var(--gold);font-size:11px;margin-top:4px;">✦ Текущий этап: ${esc(q.stage)}</p>` : ''}
    ${q.location ? `<div class="diary-meta"><span>Место: ${esc(q.location)}</span></div>` : ''}
   </article>`).join('')}
  </section>`;
 }

 if(npcs.length){
  html += `<section class="diary-section">
   <div class="diary-heading"><span>КАРТОТЕКА ПЕРСОНАЖЕЙ (NPC · ${npcs.length})</span></div>
   ${npcs.map(npc => {
    const att = (npc.attitude || 'нейтрален').toLowerCase();
    const attClass = /(?:враг|неприя|агресс|hostile)/i.test(att) ? 'attitude-hostile' : /(?:друг|союз|верн|friendly|loyal)/i.test(att) ? 'attitude-friendly' : 'attitude-neutral';
    return `<article class="diary-card">
     <div class="diary-card-top">
      <strong class="diary-card-title">${esc(npc.name)}</strong>
      <span class="attitude-badge ${attClass}">${esc(npc.attitude || 'Нейтрален')}</span>
     </div>
     <p>${esc(npc.description)}</p>
     ${npc.stage ? `<p style="font-size:11px;color:#c9a973;margin-top:4px;">✦ Что известно: ${esc(npc.stage)}</p>` : ''}
     <div class="diary-meta">
      ${npc.location ? `<span>📍 ${esc(npc.location)}</span>` : ''}
      ${npc.state ? `<span>Статус: ${esc(npc.state)}</span>` : ''}
     </div>
    </article>`;
   }).join('')}
  </section>`;
 }

 if(clues.length){
  html += `<section class="diary-section">
   <div class="diary-heading"><span>ЗАЦЕПКИ И ТАЙНЫ (${clues.length})</span></div>
   ${clues.map(cl => `<article class="diary-card">
    <div class="diary-card-top">
     <strong class="diary-card-title">🔍 ${esc(cl.name)}</strong>
     <span class="quest-progress-tag">${esc(cl.state || 'найдено')}</span>
    </div>
    <p>${esc(cl.description)}</p>
    ${cl.location ? `<div class="diary-meta"><span>Найдено: ${esc(cl.location)}</span></div>` : ''}
   </article>`).join('')}
  </section>`;
 }

 panel.innerHTML = html;
}

function renderHudInventory(){
 const c = current();
 const panel = $('hudInventoryPanel');
 if(!panel || !c) return;

 const owners = [{id: 'group', name: 'Общая казна'}].concat(c.characters.map(h => ({id: h.id, name: h.name})));
 if(!owners.some(o => o.id === hudInventoryOwner)) hudInventoryOwner = 'group';

 const items = (c.inventory || []).filter(i => i.ownerId === hudInventoryOwner);
 const walletCp = c.wallet?.[hudInventoryOwner] || 0;
 const unclaimedLoot = (c.loot || []).filter(l => !l.claimed);

 let html = `<div class="hud-inv-owners">
  ${owners.map(o => `<button type="button" class="hud-inv-owner-btn ${o.id === hudInventoryOwner ? 'active' : ''}" data-hud-owner="${esc(o.id)}">${esc(o.name)}</button>`).join('')}
 </div>`;

 html += `<div class="hud-wallet-badge">
  <span>Кошелёк: <strong>${Math.floor(walletCp / 100)} зм · ${walletCp % 100} мм</strong></span>
  <button type="button" class="hud-item-btn" id="hudAddWallet">± Монеты</button>
 </div>`;

 if(unclaimedLoot.length){
  html += `<div style="background:#262a1c;border:1px solid #756a48;border-radius:6px;padding:9px 12px;">
   <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px;">
    <strong style="color:var(--gold);font-size:11px;">✦ НАЙДЕННАЯ ДОБЫЧА (${unclaimedLoot.length})</strong>
   </div>
   ${unclaimedLoot.map(l => `<div style="display:flex;justify-content:space-between;align-items:center;font-size:11px;margin-top:4px;">
    <span>${esc(l.item?.name || 'Монеты')}, ${l.copper} мм</span>
    <button type="button" class="hud-item-btn" data-claim-loot="${l.id}">Забрать</button>
   </div>`).join('')}
  </div>`;
 }

 if(!items.length){
  html += `<p class="dialog-note" style="text-align:center;padding:18px 0;">У ${hudInventoryOwner === 'group' ? 'группы' : 'героя'} пока нет предметов.</p>`;
 } else {
  html += `<div class="hud-items-grid">
   ${items.map(i => {
    const icon = categoryIcons[i.category] || '◈';
    const isConsumable = ['potion', 'food', 'other'].includes(i.category) || /(?:зелье|эликсир|свиток|еда|паёк)/i.test(i.name);
    return `<div class="hud-item-row">
     <span class="hud-item-icon">${icon}</span>
     <div class="hud-item-info">
      <div class="hud-item-name">${esc(i.name)} ×${i.quantity}${i.equipped ? ' <small style="color:var(--gold);">· экипировано</small>' : ''}</div>
      ${i.description ? `<div class="hud-item-desc" title="${esc(i.description)}">${esc(i.description)}</div>` : ''}
     </div>
     <div class="hud-item-actions">
      ${isConsumable ? `<button type="button" class="hud-item-btn" data-consume-item="${i.id}" title="Использовать 1 шт.">Использовать</button>` : ''}
      <button type="button" class="hud-item-btn" data-transfer-item="${i.id}" title="Передать другому герою">Передать</button>
     </div>
    </div>`;
   }).join('')}
  </div>`;
 }

 panel.innerHTML = html;
}

function renderTacticalHud(){
 if(!tacticalHudOpen) return;
 if(activeHudTab === 'map') renderHudMap();
 else if(activeHudTab === 'diary') renderHudDiary();
 else if(activeHudTab === 'inventory') renderHudInventory();
}

$('toggleTacticalHud').onclick = () => toggleTacticalHud();
$('closeTacticalHud').onclick = () => toggleTacticalHud(false);
$('toggleSidebar')?.addEventListener('click', () => toggleSidebar());
$('collapseSidebar')?.addEventListener('click', () => toggleSidebar(true));
$('mapZoomFit')?.addEventListener('click', () => setMapZoomMode('fit'));
$('mapZoomToggle')?.addEventListener('click', () => setMapZoomMode('100%'));
$('toggleHudWide')?.addEventListener('click', () => toggleHudWide());
$('tacticalHud')?.querySelector('.hud-tabs')?.addEventListener('click', e => {
 const b = e.target.closest('[data-tab]');
 if(b) switchHudTab(b.dataset.tab);
});
async function requestMapGeneration(focus = '', mode = 'tactical'){
 if(mapGenerating || busy || !current()) return;
 mapGenerating = true;
 renderTacticalHud();
 const statusEl = $('hudStatus');
 if(statusEl) statusEl.textContent = mode === 'world' ? '● Создаём карту региона…' : '● Чертим карту…';
 try {
  const res = await api('generate-map', { id: activeId, focus, mode });
  if(res.state){
   state = res.state;
   render();
   if(!tacticalHudOpen) toggleTacticalHud(true);
   switchHudTab('map');
  }
  toast(mode === 'world' ? 'Обзорная карта региона создана!' : 'Тактическая схема создана!');
 } catch(err){
  toast('Не удалось создать карту: ' + err.message);
 } finally {
  mapGenerating = false;
  renderTacticalHud();
  if(statusEl && (statusEl.textContent === '● Чертим карту…' || statusEl.textContent === '● Создаём карту региона…')) statusEl.textContent = '';
 }
}

$('hudMapPanel')?.addEventListener('click', e => {
 if(e.target.closest('#generateWorldMap') || e.target.closest('#hudAddWorldMap')){
  requestMapGeneration('Карта региона и окрестных земель', 'world');
  return;
 }
 if(e.target.closest('#generateMapFromScene') || e.target.closest('#askMasterForMap')){
  requestMapGeneration('', 'tactical');
  return;
 }
 if(e.target.closest('#generateMapCustom') || e.target.closest('#hudAddNewMap')){
  const custom = prompt('Укажите фокус или название местности для карты (например: «Подвал башни с тайным алтарём», «Засада на тракте», «План второго этажа»):', current()?.dm?.location || '');
  if(custom !== null) requestMapGeneration(custom.trim(), 'tactical');
  return;
 }
 if(e.target.closest('[data-remap-scene]')){
  requestMapGeneration('', 'tactical');
  return;
 }
});
$('hudInventoryPanel')?.addEventListener('click', async e => {
 const ownerBtn = e.target.closest('[data-hud-owner]');
 if(ownerBtn){
  hudInventoryOwner = ownerBtn.dataset.hudOwner;
  renderHudInventory();
  return;
 }
 const consumeBtn = e.target.closest('[data-consume-item]');
 if(consumeBtn){
  if(await tableActions([{type:'item.consume',itemId:consumeBtn.dataset.consumeItem,quantity:1}])){
   renderHudInventory();
  }
  return;
 }
 const transferBtn = e.target.closest('[data-transfer-item]');
 if(transferBtn){
  openInventory(hudInventoryOwner);
  return;
 }
 const claimBtn = e.target.closest('[data-claim-loot]');
 if(claimBtn){
  if(await tableActions([{type:'loot.claim',lootId:claimBtn.dataset.claimLoot}])){
   renderHudInventory();
  }
  return;
 }
 if(e.target.closest('#hudAddWallet')){
  openInventory(hudInventoryOwner);
  return;
 }
});

const ambientShortNames = {
 camp: 'Лагерь',
 tavern: 'Таверна',
 battle: 'Бой',
 dungeon: 'Подземелье',
 forest: 'Лес',
 rain: 'Дождь',
 mystery: 'Тайна',
 off: 'Без музыки'
};

function updateAmbientTrackDisplay(track) {
 const bar = document.querySelector('.ambient-track-bar');
 if (!track || ambientEngine.currentTheme === 'off') {
  if (bar) bar.style.opacity = '0.45';
  if ($('ambientTrackTitle')) $('ambientTrackTitle').textContent = 'Музыка выключена';
  if ($('ambientTrackAuthor')) $('ambientTrackAuthor').textContent = 'Выберите атмосферу ниже';
  return;
 }
 if (bar) bar.style.opacity = '1';
 if ($('ambientTrackTitle')) $('ambientTrackTitle').textContent = `${track.title} (${track.index}/${track.total})`;
 if ($('ambientTrackAuthor')) $('ambientTrackAuthor').textContent = track.author;
}

function updateAmbientUI(){
 const theme = ambientEngine.currentTheme;
 if ($('ambientCurrentLabel')) {
  $('ambientCurrentLabel').textContent = ambientShortNames[theme] || theme;
 }
 document.querySelectorAll('.ambient-theme-opt').forEach(btn => {
  btn.classList.toggle('active', btn.dataset.ambient === theme);
 });
 updateAmbientTrackDisplay(ambientEngine.getCurrentTrack());
}

ambientEngine.onThemeChange = updateAmbientUI;
ambientEngine.onTrackChange = updateAmbientTrackDisplay;

const initAudioOnGesture = () => {
 ambientEngine.init();
};
window.addEventListener('pointerdown', initAudioOnGesture, { once: true });
window.addEventListener('keydown', initAudioOnGesture, { once: true });

$('ambientPrevBtn')?.addEventListener('click', e => {
 e.stopPropagation();
 ambientEngine.prevTrack();
});

$('ambientNextBtn')?.addEventListener('click', e => {
 e.stopPropagation();
 ambientEngine.nextTrack();
});

$('ambientBtn')?.addEventListener('click', e => {
 e.stopPropagation();
 const popup = $('ambientPopup');
 if (popup) popup.hidden = !popup.hidden;
});

document.addEventListener('click', e => {
 if (!e.target.closest('.ambient-widget')) {
  const popup = $('ambientPopup');
  if (popup && !popup.hidden) popup.hidden = true;
 }
});

$('ambientVolume')?.addEventListener('input', e => {
 const val = Number(e.target.value);
 ambientEngine.setVolume(val);
 if ($('ambientVolVal')) $('ambientVolVal').textContent = Math.round(val * 100) + '%';
});

$('ambientAutoSync')?.addEventListener('change', e => {
 if (e.target.checked && current()) {
  const targetTheme = current().encounter?.active ? 'battle' : (current().dm?.ambient || 'camp');
  ambientEngine.setTheme(targetTheme);
 }
});

$('ambientShuffle')?.addEventListener('change', e => {
 ambientEngine.setShuffle(e.target.checked);
});

document.querySelectorAll('.ambient-theme-opt').forEach(btn => {
 btn.addEventListener('click', () => {
  const theme = btn.dataset.ambient;
  if ($('ambientAutoSync')) $('ambientAutoSync').checked = false;
  ambientEngine.setTheme(theme, { force: true });
  updateAmbientUI();
 });
});

if ($('ambientShuffle')) {
 $('ambientShuffle').checked = ambientEngine.shuffle;
}
if ($('ambientVolume')) {
 $('ambientVolume').value = ambientEngine.volume;
 if ($('ambientVolVal')) $('ambientVolVal').textContent = Math.round(ambientEngine.volume * 100) + '%';
}
updateAmbientUI();

if(localStorage.getItem('skazitel-sidebar-collapsed') === 'true'){
 document.body.classList.add('sidebar-collapsed');
 $('toggleSidebar')?.classList.add('active');
}
if(hudWideMode){
 $('toggleHudWide')?.classList.add('active');
 if($('toggleHudWide')) $('toggleHudWide').textContent = '⤡';
}
$('mapZoomFit')?.classList.toggle('active', mapZoomMode === 'fit');
$('mapZoomToggle')?.classList.toggle('active', mapZoomMode === '100%');

// LAN Companion Integration for Players' Smartphones
let lanEventSource = null;

function connectMasterSSE() {
  if (lanEventSource) {
    try { lanEventSource.close(); } catch {}
  }
  lanEventSource = new EventSource(`/api/events?token=${encodeURIComponent(token)}`);
  
  lanEventSource.addEventListener('roll', (e) => {
    try {
      const data = JSON.parse(e.data);
      if (data.text) {
        toast(data.text);
        refresh();
      }
    } catch {}
  });

  lanEventSource.addEventListener('lan-clients', (e) => {
    try {
      const data = JSON.parse(e.data);
      const badge = $('lanBadge');
      if (badge) {
        const count = data.count || 0;
        const extCount = Math.max(0, count - 1);
        badge.textContent = extCount;
        badge.hidden = extCount <= 0;
      }
    } catch {}
  });

  lanEventSource.addEventListener('player-turn-start', e => {
    const data=JSON.parse(e.data);
    if(data.campaignId!==activeId)return;
    deliveryRun++;stopVoice();interruptionActive=false;
    $('status').textContent='Мастер обрабатывает реплику с телефона…';
  });
  lanEventSource.addEventListener('player-turn', e => {
    const data=JSON.parse(e.data);
    if(data.campaignId===activeId){interruptionActive=false;refresh().catch(err=>toast(err.message));}
  });
  lanEventSource.addEventListener('campaign', () => {
    refresh();
  });

  lanEventSource.addEventListener('campaign-deleted', (e) => {
    try {
      const data = JSON.parse(e.data);
      state.campaigns = (state.campaigns || []).filter(x => x.id !== data.campaignId);
      if (activeId === data.campaignId) {
        activeId = data.activeCampaignId || state.campaigns[0]?.id || null;
      }
      render();
    } catch {}
  });

  lanEventSource.addEventListener('combat-update', (e) => {
    try {
      const data = JSON.parse(e.data);
      if (current() && data.campaignId === activeId) {
        current().initiative = data.initiative;
        renderCombatTracker();
        playSfx('turn');
      }
    } catch {}
  });
}

let activeLanInfo = null, activeLanMode = 'https';

function renderLanModal() {
  if (!activeLanInfo) return;
  const info = activeLanInfo;
  const input = $('lanUrlInput');
  const statusNote = $('lanStatusNote');
  const qrContainer = $('lanQrCode');
  const hint = $('lanModeHint');
  const btnHttps = $('lanModeHttps');
  const btnHttp = $('lanModeHttp');

  const useHttps = activeLanMode === 'https' && !!info.playerHttpsUrl;
  const targetUrl = useHttps ? info.playerHttpsUrl : info.playerUrl;

  if (btnHttps) btnHttps.classList.toggle('active', useHttps);
  if (btnHttp) btnHttp.classList.toggle('active', !useHttps);

  if (input) input.value = targetUrl;
  if (statusNote) {
    statusNote.textContent = info.ips.length > 0 
      ? `Локальный IP: ${info.primaryIp} · Порт: ${useHttps ? info.httpsPort : info.port}. Подключено смартфонов: ${Math.max(0, (info.clientsCount || 1) - 1)}` 
      : 'Wi-Fi / LAN IP не обнаружен. Проверьте подключение к роутеру.';
  }

  if (hint) {
    if (useHttps) {
      hint.innerHTML = '✦ <strong>Бесшовный микрофон:</strong> удерживайте кнопку на экране телефона и говорите прямо в браузере.<br><em>При первом входе:</em> телефон покажет предупреждение локального сертификата — нажмите <strong>«Подробнее / Дополнительно» → «Перейти на сайт»</strong>.';
    } else {
      hint.innerHTML = 'Обычный режим без предупреждений безопасности. Аудиозапись будет использовать вызов диктофона телефона или текстовый ввод действий.';
    }
  }

  if (qrContainer && typeof qrcode === 'function') {
    try {
      const qr = qrcode(0, 'M');
      qr.addData(targetUrl);
      qr.make();
      qrContainer.innerHTML = qr.createSvgTag(5, 10);
    } catch (err) {
      qrContainer.innerHTML = '<p class="dialog-note">Не удалось создать QR</p>';
    }
  }
}

$('lanModeHttps')?.addEventListener('click', () => {
  activeLanMode = 'https';
  renderLanModal();
});

$('lanModeHttp')?.addEventListener('click', () => {
  activeLanMode = 'http';
  renderLanModal();
});

$('lanCompanionBtn')?.addEventListener('click', async () => {
  const dialog = $('lanDialog');
  if (!dialog) return;
  dialog.showModal();

  try {
    const info = await api('lan-info');
    activeLanInfo = info;
    activeLanMode = info.playerHttpsUrl ? 'https' : 'http';
    renderLanModal();
  } catch (err) {
    toast('Не удалось получить сетевой адрес: ' + err.message);
  }
});

$('copyLanUrlBtn')?.addEventListener('click', () => {
  const input = $('lanUrlInput');
  if (!input || !input.value) return;
  navigator.clipboard.writeText(input.value).then(() => {
    toast('✓ Ссылка скопирована в буфер обмена!');
  }).catch(() => {
    input.select();
    document.execCommand('copy');
    toast('✓ Ссылка скопирована!');
  });
});

connectMasterSSE();

// SFX Toggle
const sfxBtn = $('sfxToggleBtn');
if (sfxBtn) {
  sfxBtn.classList.toggle('muted', !isSfxEnabled());
  sfxBtn.textContent = isSfxEnabled() ? '🔊 SFX' : '🔇 SFX';
  sfxBtn.onclick = () => {
    const enabled = toggleSfx();
    sfxBtn.classList.toggle('muted', !enabled);
    sfxBtn.textContent = enabled ? '🔊 SFX' : '🔇 SFX';
    toast(enabled ? '🔊 Звуковые эффекты включены' : '🔇 Звуковые эффекты выключены');
  };
}

// Combat Tracker
function renderCombatTracker() {
  const c = current();
  const bar = $('combatTracker');
  if (!bar) return;
  if (!c || !c.initiative?.active) {
    bar.hidden = true;
    return;
  }
  bar.hidden = false;
  const roundEl = $('combatRoundText');
  if (roundEl) roundEl.textContent = `Раунд ${c.initiative.round || 1}`;

  const orderList = $('combatOrderList');
  if (orderList) {
    orderList.innerHTML = (c.initiative.order || []).map((cb, idx) => {
      const isTurn = idx === (c.initiative.turnIndex || 0);
      const isHero = cb.kind === 'hero';
      const hpStr = cb.hp != null && cb.maxHp ? ` · ❤️ ${cb.hp}/${cb.maxHp}` : '';
      return `<div class="combat-turn-chip ${isHero ? 'hero' : 'enemy'} ${isTurn ? 'active' : ''}">
        ${isTurn ? '<span style="color:var(--gold);">▶</span> ' : ''}
        <span>${esc(cb.name)}</span>
        <span class="init-val">⚡ ${cb.initiative}</span>
        ${hpStr ? `<span class="hp-val">${hpStr}</span>` : ''}
      </div>`;
    }).join('');
  }
}

$('combatNextTurnBtn')?.addEventListener('click', async () => {
  if (busy || !activeId) return;
  try {
    const res = await api('combat/next', { id: activeId });
    if (current()) current().initiative = res.initiative;
    renderCombatTracker();
    playSfx('turn');
  } catch (e) {
    toast(e.message);
  }
});

$('combatEndBtn')?.addEventListener('click', async () => {
  if (busy || !activeId) return;
  const ok = await askConfirm({
    title: 'Завершить бой',
    message: 'Завершить текущий бой и очистить инициативу?',
    okText: 'Завершить бой'
  });
  if (!ok) return;
  try {
    const res = await api('combat/end', { id: activeId });
    if (current()) current().initiative = res.initiative;
    renderCombatTracker();
    toast('Бой завершён.');
  } catch (e) {
    toast(e.message);
  }
});

$('hudCombatStartBtn')?.addEventListener('click', async () => {
  if (busy || !activeId) return;
  try {
    playSfx('sword');
    const res = await api('combat/start', { id: activeId });
    if (current()) current().initiative = res.initiative;
    renderCombatTracker();
    toast('⚔️ Тактический бой начат! Инициатива подсчитана.');
  } catch (e) {
    toast(e.message);
  }
});

// Fog of War Toggle
$('hudFogToggle')?.addEventListener('click', async () => {
  if (busy || !activeId) return;
  const c = current();
  const m = (c.maps || [])[0];
  if (!m) return toast('Нет активной карты');
  try {
    const res = await api('map/fog', { id: activeId, mapId: m.id, action: 'toggle' });
    if (res.map) {
      const idx = (c.maps || []).findIndex(x => x.id === res.map.id);
      if (idx >= 0) c.maps[idx] = res.map;
    }
    renderHudMap();
    toast(res.map?.fogOfWar ? '🌫️ Туман войны активирован' : '☀️ Туман войны рассеян');
  } catch (e) {
    toast(e.message);
  }
});

// Random Generator Dialog
let currentGenType = 'encounter';
let lastGenResult = null;

$('hudRandomGenBtn')?.addEventListener('click', () => {
  const dlg = $('randomGenDialog');
  if (dlg) dlg.showModal();
});

document.querySelectorAll('.random-gen-tabs .tab-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.random-gen-tabs .tab-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    currentGenType = btn.dataset.gen;
    const applyBtn = $('randomGenApplyBtn');
    if (applyBtn) applyBtn.hidden = true;
    $('randomGenResult').innerHTML = '<p class="dialog-note">Нажмите «Сгенерировать», чтобы создать случайное событие или награду.</p>';
  });
});

$('randomGenRollBtn')?.addEventListener('click', async () => {
  if (!activeId) return toast('Откройте кампанию');
  playSfx('dice');
  $('randomGenResult').innerHTML = '<p class="dialog-note">Создаём генерацию на основе мира...</p>';
  try {
    const res = await api('generate/random', { id: activeId, type: currentGenType, apply: false });
    lastGenResult = res;
    renderGenResult(res);
  } catch (err) {
    $('randomGenResult').innerHTML = `<p class="dialog-note" style="color:var(--danger-crimson);">${esc(err.message)}</p>`;
  }
});

$('randomGenApplyBtn')?.addEventListener('click', async () => {
  if (!activeId || !lastGenResult) return;
  try {
    const res = await api('generate/random', { id: activeId, type: currentGenType, apply: true, ...lastGenResult });
    playSfx('magic');
    toast('✓ Успешно применено к кампании!');
    $('randomGenDialog').close();
    await refresh();
  } catch (err) {
    toast('Ошибка применения: ' + err.message);
  }
});

function renderGenResult(res) {
  const container = $('randomGenResult');
  const applyBtn = $('randomGenApplyBtn');
  if (!container) return;

  if (res.type === 'encounter' && res.encounter) {
    const enc = res.encounter;
    container.innerHTML = `
      <div class="random-gen-card">
        <h4>⚔️ ${esc(enc.name)}</h4>
        <div class="card-subtitle">Опасность (CR): ${esc(enc.cr || '1')} · Опыт: ${enc.xp || 200} XP</div>
        <p>${esc(enc.description || '')}</p>
        ${enc.tactics ? `<p><strong>Тактика врагов:</strong> ${esc(enc.tactics)}</p>` : ''}
        ${enc.enemies?.length ? `<ul>${enc.enemies.map(e => `<li><strong>${esc(e.name)}</strong> (КД ${e.ac}, HP ${e.hp}, инициатива +${e.initiativeBonus||0})</li>`).join('')}</ul>` : ''}
      </div>
    `;
    if (applyBtn) {
      applyBtn.hidden = false;
      applyBtn.textContent = '⚔️ Развернуть на карте и начать бой';
    }
  } else if (res.type === 'loot' && res.loot) {
    const loot = res.loot;
    container.innerHTML = `
      <div class="random-gen-card">
        <h4>💎 ${esc(loot.name)}</h4>
        <div class="card-subtitle">Уровень сокровищ: ${esc(loot.tier || 'Обычный')}</div>
        <p><strong>Золотые монеты:</strong> ${loot.gold || 0} зм</p>
        ${loot.items?.length ? `<strong>Предметы:</strong><ul>${loot.items.map(it => `<li>${esc(it.name)}: <small>${esc(it.description || '')}</small></li>`).join('')}</ul>` : ''}
      </div>
    `;
    if (applyBtn) {
      applyBtn.hidden = false;
      applyBtn.textContent = '💎 Положить в казну и инвентарь';
    }
  } else if (res.type === 'npc' && res.npc) {
    const npc = res.npc;
    container.innerHTML = `
      <div class="random-gen-card">
        <h4>👤 ${esc(npc.name)}</h4>
        <div class="card-subtitle">${esc(npc.race || '')} · ${esc(npc.role || '')} · Отношение: ${esc(npc.attitude || 'Нейтрален')}</div>
        ${npc.trait ? `<p><strong>Особенность:</strong> ${esc(npc.trait)}</p>` : ''}
        ${npc.secret ? `<p><strong>Секрет / Тайна:</strong> ${esc(npc.secret)}</p>` : ''}
      </div>
    `;
    if (applyBtn) {
      applyBtn.hidden = false;
      applyBtn.textContent = '📜 Записать в картотеку мира';
    }
  }
}

// ==========================================================================
// APPLE HIG THEME MANAGER (Light / Dark Mode Switcher)
// ==========================================================================
function initThemeManager() {
  const saved = localStorage.getItem('skazitel-color-theme');
  const prefersDark = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
  const initialTheme = saved || (prefersDark ? 'dark' : 'light');
  applyTheme(initialTheme);

  const btn = $('themeToggleBtn');
  if (btn) {
    btn.addEventListener('click', () => {
      const current = document.documentElement.getAttribute('data-theme') || (prefersDark ? 'dark' : 'light');
      const nextTheme = current === 'dark' ? 'light' : 'dark';
      applyTheme(nextTheme);
      localStorage.setItem('skazitel-color-theme', nextTheme);
      if (typeof playSfx === 'function') playSfx('dice');
      toast(nextTheme === 'dark' ? '🌙 Тёмная тема Apple HIG (Dark Mode)' : '☀️ Светлая тема Apple HIG (Light Mode)');
    });
  }

  if (window.matchMedia) {
    window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', e => {
      if (!localStorage.getItem('skazitel-color-theme')) {
        applyTheme(e.matches ? 'dark' : 'light');
      }
    });
  }
}

function applyTheme(theme) {
  document.documentElement.setAttribute('data-theme', theme);
  const btn = $('themeToggleBtn');
  if (btn) {
    btn.innerHTML = theme === 'dark' 
      ? '🌙 <span class="theme-text">Тёмная</span>' 
      : '☀️ <span class="theme-text">Светлая</span>';
    btn.title = `Текущая тема: ${theme === 'dark' ? 'Тёмная (Dark Mode)' : 'Светлая (Light Mode)'}. Нажмите для переключения`;
  }
}

initThemeManager();

// ==========================================================================
// TACTICAL MAP WINDOW (Apple HIG Floating Window + Docking)
// ==========================================================================
function initMapWindow() {
  const hud = $('tacticalHud');
  const header = $('hudWindowHeader');
  const grip = $('hudResizeGrip');

  // Traffic lights
  $('hudWindowClose')?.addEventListener('click', () => {
    toggleTacticalHud(false);
  });

  $('hudWindowMinimize')?.addEventListener('click', () => {
    if (hud) hud.hidden = true;
    mapWindowMinimized = true;
    const mb = $('hudMinibar');
    if (mb) mb.hidden = false;
    tacticalHudOpen = false;
    $('toggleTacticalHud')?.classList.remove('active');
  });

  $('hudWindowZoom')?.addEventListener('click', () => {
    if (!hud) return;
    mapWindowMaximized = !mapWindowMaximized;
    if (mapWindowMaximized) {
      hud.dataset.prevLeft = hud.style.left;
      hud.dataset.prevTop = hud.style.top;
      hud.dataset.prevWidth = hud.style.width;
      hud.dataset.prevHeight = hud.style.height;
      hud.style.left = '24px';
      hud.style.top = '24px';
      hud.style.width = 'calc(100vw - 48px)';
      hud.style.height = 'calc(100vh - 48px)';
    } else {
      hud.style.left = hud.dataset.prevLeft || 'calc(50vw - 360px)';
      hud.style.top = hud.dataset.prevTop || '75px';
      hud.style.width = hud.dataset.prevWidth || '720px';
      hud.style.height = hud.dataset.prevHeight || '540px';
    }
    saveMapWindowGeometry();
  });

  // Minibar restore
  $('hudMinibarRestore')?.addEventListener('click', () => {
    const mb = $('hudMinibar');
    if (mb) mb.hidden = true;
    mapWindowMinimized = false;
    toggleTacticalHud(true);
  });

  // Dock / Undock toggle
  $('toggleHudDockMode')?.addEventListener('click', () => {
    setMapWindowMode(!mapWindowFloating);
  });

  // Dragging by header (in floating mode)
  if (header && hud) {
    let isDragging = false, dragStartX = 0, dragStartY = 0, winX = 0, winY = 0;
    header.addEventListener('mousedown', e => {
      if (!hud.classList.contains('floating-window')) return;
      if (e.target.closest('button, input, select, .hud-tabs, .hud-controls')) return;
      isDragging = true;
      dragStartX = e.clientX;
      dragStartY = e.clientY;
      const rect = hud.getBoundingClientRect();
      winX = rect.left;
      winY = rect.top;
      e.preventDefault();
    });

    window.addEventListener('mousemove', e => {
      if (!isDragging) return;
      const dx = e.clientX - dragStartX;
      const dy = e.clientY - dragStartY;
      const nextX = Math.max(10, Math.min(window.innerWidth - 120, winX + dx));
      const nextY = Math.max(10, Math.min(window.innerHeight - 60, winY + dy));
      hud.style.left = nextX + 'px';
      hud.style.top = nextY + 'px';
      hud.style.right = 'auto';
      hud.style.bottom = 'auto';
    });

    window.addEventListener('mouseup', () => {
      if (isDragging) {
        isDragging = false;
        saveMapWindowGeometry();
      }
    });
  }

  // Resizing by corner grip
  if (grip && hud) {
    let isResizing = false, resizeStartX = 0, resizeStartY = 0, startW = 0, startH = 0;
    grip.addEventListener('mousedown', e => {
      if (!hud.classList.contains('floating-window')) return;
      isResizing = true;
      resizeStartX = e.clientX;
      resizeStartY = e.clientY;
      const rect = hud.getBoundingClientRect();
      startW = rect.width;
      startH = rect.height;
      e.preventDefault();
      e.stopPropagation();
    });

    window.addEventListener('mousemove', e => {
      if (!isResizing) return;
      const dw = e.clientX - resizeStartX;
      const dh = e.clientY - resizeStartY;
      const nextW = Math.max(380, Math.min(window.innerWidth - 20, startW + dw));
      const nextH = Math.max(260, Math.min(window.innerHeight - 20, startH + dh));
      hud.style.width = nextW + 'px';
      hud.style.height = nextH + 'px';
    });

    window.addEventListener('mouseup', () => {
      if (isResizing) {
        isResizing = false;
        saveMapWindowGeometry();
      }
    });
  }

  // Initial dock button label
  const dockBtn = $('toggleHudDockMode');
  if (dockBtn) {
    dockBtn.textContent = mapWindowFloating ? t('hudDockBtn') : t('hudUndockBtn');
  }
}

// ==========================================================================
// RESIZABLE SPLIT-PANE LAYOUT (Story / Map / Party)
// ==========================================================================
function initSplitResizers() {
  const left = $('splitResizerLeft');
  const right = $('splitResizerRight');
  const grid = document.querySelector('.table-grid');

  try {
    const saved = JSON.parse(localStorage.getItem('skazitel-split-widths') || '{}');
    if (saved.party && saved.party >= 200 && saved.party <= 600) {
      document.documentElement.style.setProperty('--party-width', saved.party + 'px');
    }
    if (saved.hud && saved.hud >= 320 && saved.hud <= 900) {
      document.documentElement.style.setProperty('--hud-width', saved.hud + 'px');
    }
  } catch {}

  let draggingResizer = null, startX = 0, startVal = 0;
  const onMouseDown = (resizer, e) => {
    draggingResizer = resizer;
    resizer.classList.add('dragging');
    startX = e.clientX;
    const isSplitMode = grid?.classList.contains('split-mode');
    if (resizer === left) {
      if (isSplitMode) {
        startVal = $('tacticalHud')?.getBoundingClientRect().width || 520;
      } else {
        startVal = document.querySelector('.party')?.getBoundingClientRect().width || 270;
      }
    } else {
      startVal = document.querySelector('.party')?.getBoundingClientRect().width || 270;
    }
    e.preventDefault();
  };

  left?.addEventListener('mousedown', e => onMouseDown(left, e));
  right?.addEventListener('mousedown', e => onMouseDown(right, e));

  window.addEventListener('mousemove', e => {
    if (!draggingResizer) return;
    const dx = e.clientX - startX;
    const isSplitMode = grid?.classList.contains('split-mode');
    if (draggingResizer === left) {
      if (isSplitMode) {
        const nextW = Math.max(320, Math.min(window.innerWidth - 450, startVal - dx));
        document.documentElement.style.setProperty('--hud-width', nextW + 'px');
      } else {
        const nextW = Math.max(220, Math.min(550, startVal - dx));
        document.documentElement.style.setProperty('--party-width', nextW + 'px');
      }
    } else {
      const nextW = Math.max(220, Math.min(550, startVal - dx));
      document.documentElement.style.setProperty('--party-width', nextW + 'px');
    }
  });

  window.addEventListener('mouseup', () => {
    if (draggingResizer) {
      draggingResizer.classList.remove('dragging');
      draggingResizer = null;
      const partyW = parseInt(getComputedStyle(document.documentElement).getPropertyValue('--party-width')) || 270;
      const hudW = parseInt(getComputedStyle(document.documentElement).getPropertyValue('--hud-width')) || 520;
      localStorage.setItem('skazitel-split-widths', JSON.stringify({ party: partyW, hud: hudW }));
    }
  });
}

// ==========================================================================
// UI SCALE MANAGER (A- / 100% / A+)
// ==========================================================================
function initUiScale() {
  let uiScale = parseFloat(localStorage.getItem('skazitel-ui-scale') || '1.0');
  const setScale = val => {
    uiScale = Math.max(0.75, Math.min(1.30, Math.round(val * 100) / 100));
    document.documentElement.style.setProperty('--ui-scale', uiScale);
    document.body.style.zoom = uiScale === 1.0 ? '' : uiScale;
    localStorage.setItem('skazitel-ui-scale', uiScale.toFixed(2));
    const resetBtn = $('uiScaleResetBtn');
    if (resetBtn) resetBtn.textContent = Math.round(uiScale * 100) + '%';
  };
  setScale(uiScale);
  $('uiScaleDownBtn')?.addEventListener('click', () => setScale(uiScale - 0.15));
  $('uiScaleResetBtn')?.addEventListener('click', () => setScale(1.0));
  $('uiScaleUpBtn')?.addEventListener('click', () => setScale(uiScale + 0.15));
}

// ==========================================================================
// BILINGUAL LANGUAGE MANAGER (RU / EN Toggle)
// ==========================================================================
function initLanguageManager() {
  initLanguage();
  const btn = $('langToggleBtn');
  if (btn) {
    btn.addEventListener('click', () => {
      const current = getLanguage();
      const next = current === 'ru' ? 'en' : 'ru';
      setLanguage(next);
      api('settings', { language: next }).catch(() => {});
      render();
      if (typeof playSfx === 'function') playSfx('dice');
      toast(next === 'en' ? '🌐 Language switched to English' : '🌐 Язык переключён на русский');
    });
  }
}

initMapWindow();
initSplitResizers();
initUiScale();
initLanguageManager();





// The native details control supplies keyboard activation; dismiss without
// affecting microphone shortcuts or closing unrelated dialogs.
const tableViewMenu = $('tableViewMenu');
document.addEventListener('pointerdown', event => {
 if (tableViewMenu?.open && !tableViewMenu.contains(event.target)) tableViewMenu.open = false;
});
document.addEventListener('keydown', event => {
 if (event.key === 'Escape' && tableViewMenu?.open) {
  tableViewMenu.open = false;
  tableViewMenu.querySelector('summary')?.focus();
 }
});

$('tableModelSettings').onclick = () => { tableViewMenu.open = false; $('settings').click(); };

// ==========================================================================
// Local Vision System (Apple Neural Engine / Vision.framework)
// ==========================================================================
let visionStream = null;
let visionTimer = null;
let latestVisionObservation = '';

async function captureVisionFrame() {
  const video = $('visionVideo');
  const canvas = $('visionCanvas');
  if (!video || !canvas || !visionStream || video.readyState < 2) return;
  canvas.width = 320;
  canvas.height = 240;
  const ctx = canvas.getContext('2d');
  ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
  const dataUrl = canvas.toDataURL('image/jpeg', 0.6);
  try {
    const res = await api('vision/analyze', { image: dataUrl });
    if (res && res.ok) {
      latestVisionObservation = res.summary || '';
      if ($('visionFacesText')) $('visionFacesText').textContent = (res.faces || 0) + ' игроков';
      if ($('visionAttentionBadge')) {
        let badge = 'Внимание';
        if (res.attention === 'looking_down') badge = 'Вниз / телефон';
        else if (res.smiling) badge = 'Улыбки / смех';
        else if (res.speaking) badge = 'Говорит';
        else if (res.attention === 'focused') badge = 'На мастера';
        $('visionAttentionBadge').textContent = badge;
      }
      if ($('visionSummaryText')) $('visionSummaryText').textContent = res.summary || 'Мастер наблюдает за столом.';
    }
  } catch (err) {
    // Silent catch on background analyze
  }
}

async function startVisionCamera() {
  try {
    if (visionStream) {
      visionStream.getTracks().forEach(t => t.stop());
      visionStream = null;
    }
    const stream = await navigator.mediaDevices.getUserMedia({
      video: { width: 320, height: 240, frameRate: 10 }
    });
    visionStream = stream;
    const video = $('visionVideo');
    if (video) {
      video.srcObject = stream;
      video.play().catch(() => {});
    }
    if ($('visionIndicatorBtn')) $('visionIndicatorBtn').classList.remove('off');
    if ($('visionLabel')) $('visionLabel').textContent = 'Зрение стола';
    if ($('visionToggleInput')) $('visionToggleInput').checked = true;
    if ($('visionSummaryText')) $('visionSummaryText').textContent = 'Камера подключена. Наблюдение за столом активно.';
    if (visionTimer) clearInterval(visionTimer);
    // Background monitoring every 25 seconds
    visionTimer = setInterval(() => {
      captureVisionFrame().catch(() => {});
    }, 25000);
    // Initial capture after 1.5 seconds to warm up
    setTimeout(() => captureVisionFrame().catch(() => {}), 1500);
  } catch (err) {
    console.warn('Vision camera access denied or unavailable:', err);
    stopVisionCamera(false);
    if ($('visionSummaryText')) $('visionSummaryText').textContent = 'Доступ к веб-камере не предоставлен.';
  }
}

function stopVisionCamera(disableSettings = true) {
  if (visionTimer) {
    clearInterval(visionTimer);
    visionTimer = null;
  }
  if (visionStream) {
    visionStream.getTracks().forEach(t => t.stop());
    visionStream = null;
  }
  const video = $('visionVideo');
  if (video) video.srcObject = null;
  latestVisionObservation = '';
  if ($('visionIndicatorBtn')) $('visionIndicatorBtn').classList.add('off');
  if ($('visionLabel')) $('visionLabel').textContent = 'Зрение выкл';
  if ($('visionToggleInput')) $('visionToggleInput').checked = false;
  if ($('visionSummaryText')) $('visionSummaryText').textContent = 'Зрение Мастера отключено.';
  if (disableSettings && state?.config?.vision !== 'off') {
    api('settings', { vision: 'off' }).catch(() => {});
  }
}

function initVisionSystem() {
  const btn = $('visionIndicatorBtn');
  const popover = $('visionPopover');
  const closeBtn = $('closeVisionPopoverBtn');
  const toggleInput = $('visionToggleInput');
  const snapBtn = $('visionSnapNowBtn');
  const testBtn = $('testVisionBtn');
  const testStatus = $('testVisionStatus');

  if (testBtn) {
    testBtn.onclick = async () => {
      testBtn.disabled = true;
      if (testStatus) testStatus.textContent = 'Активация веб-камеры и запуск Apple Neural Engine…';
      try {
        if (!visionStream) await startVisionCamera();
        const t0 = performance.now();
        await captureVisionFrame();
        const elapsed = Math.round(performance.now() - t0);
        if (testStatus) {
          testStatus.textContent = `✓ Apple Vision: ${latestVisionObservation || 'Кадр обработан'} (${elapsed} мс)`;
        }
      } catch (err) {
        if (testStatus) testStatus.textContent = 'Ошибка теста зрения: ' + err.message;
      } finally {
        testBtn.disabled = false;
      }
    };
  }

  if (btn && popover) {
    btn.onclick = (e) => {
      e.stopPropagation();
      popover.hidden = !popover.hidden;
      if (!popover.hidden && !visionStream && state?.config?.vision !== 'off') {
        startVisionCamera();
      }
    };
  }
  if (closeBtn && popover) {
    closeBtn.onclick = (e) => {
      e.stopPropagation();
      popover.hidden = true;
    };
  }
  document.addEventListener('pointerdown', (e) => {
    if (popover && !popover.hidden && !popover.contains(e.target) && !btn?.contains(e.target)) {
      popover.hidden = true;
    }
  });

  if (toggleInput) {
    toggleInput.onchange = async () => {
      const enabled = toggleInput.checked;
      if (enabled) {
        await api('settings', { vision: 'on' }).catch(() => {});
        startVisionCamera();
        toast('👁️ Зрение Мастера включено');
      } else {
        stopVisionCamera(true);
        toast('👁️‍🗨️ Зрение Мастера выключено');
      }
    };
  }

  if (snapBtn) {
    snapBtn.onclick = () => {
      captureVisionFrame();
      toast('📸 Снимок стола передан Мастеру');
    };
  }

  // Auto-start camera if enabled in config
  setTimeout(() => {
    if (state?.config?.vision !== 'off' && navigator.mediaDevices?.getUserMedia) {
      startVisionCamera();
    }
  }, 1000);
}

initVisionSystem();

