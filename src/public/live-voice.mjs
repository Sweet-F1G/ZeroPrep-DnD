// Client-delegation transport: Live hears/speaks, our authenticated backend runs Luna.
export class LiveVoice {
 constructor({api,delegate,status,onError}){Object.assign(this,{api,delegate,status,onError});this.active=false;this.epoch=0;}
 async start(){
  if(this.active||this.starting)return;if(this.stopping)await this.stopping;this.finalized=false;this.usageSeconds=null;this.starting=true;const epoch=++this.epoch;this.status('Подключаем OpenAI Live…');
  try{
   this.stream=await navigator.mediaDevices.getUserMedia({audio:{echoCancellation:true,noiseSuppression:true},video:false});
   if(epoch!==this.epoch){this.stream.getTracks().forEach(t=>t.stop());return;}
   this.pc=new RTCPeerConnection();this.audio=new Audio();this.audio.autoplay=true;
   this.pc.ontrack=e=>{this.audio.srcObject=e.streams[0]||new MediaStream([e.track]);this.audio.play().catch(e=>this.onError(e));};
   this.stream.getTracks().forEach(t=>this.pc.addTrack(t,this.stream));
   this.channel=this.pc.createDataChannel('oai-events');this.transcript='';this.seen=new Set();this.chain=Promise.resolve();
   this.channel.onopen=()=>this.send({type:'session.thinking.append',delegation_id:null,content:'Игровые решения принимает только Luna через client delegation. Сначала выслушай действие игрока.'});
   this.channel.onmessage=e=>{try{this.event(JSON.parse(e.data));}catch(error){this.onError(error);}};
   this.channel.onclose=()=>{if(this.active)this.stop();};
   this.pc.onconnectionstatechange=()=>{if(['failed','closed','disconnected'].includes(this.pc?.connectionState))this.stop();};
   await this.pc.setLocalDescription(await this.pc.createOffer());
   if(this.pc.iceGatheringState!=='complete')await new Promise((resolve,reject)=>{const pc=this.pc,timer=setTimeout(()=>{pc.removeEventListener('icegatheringstatechange',check);reject(Error('Не удалось подготовить WebRTC'));},10000);function check(){if(pc.iceGatheringState==='complete'){clearTimeout(timer);pc.removeEventListener('icegatheringstatechange',check);resolve();}}pc.addEventListener('icegatheringstatechange',check);});
   if(epoch!==this.epoch)return;
   const session=await this.api('live-start',{sdp:this.pc.localDescription.sdp});this.sessionId=session.id;await this.api('live-meter',{sessionId:session.id});
   if(epoch!==this.epoch){await this.api('live-meter',{sessionId:session.id,closed:true});return;}
   await this.pc.setRemoteDescription({type:'answer',sdp:session.sdp});this.active=true;
   this.timer=setInterval(()=>this.api('live-meter',{sessionId:this.sessionId}).catch(this.onError),10000);
   this.status('● OpenAI Live · Luna принимает игровые решения');
  }catch(error){await this.stop();this.onError(error);}finally{this.starting=false;}
 }
 send(data){if(this.channel?.readyState==='open')this.channel.send(JSON.stringify(data));}
 event(event){
  if(event.type==='session.input_transcript.delta')this.transcript+=event.delta||'';
  if(event.type==='session.usage.updated'){if(Number.isFinite(event.usage?.seconds))this.usageSeconds=event.usage.seconds;return;}
  if(event.type==='session.closed'){this.finalized=true;if(Number.isFinite(event.usage?.seconds))this.usageSeconds=event.usage.seconds;this.closedAck?.();if(!this.stopping)this.stop();return;}
  if(event.type==='error'){this.onError(Error(event.error?.message||'Ошибка OpenAI Live'));return;}
  if(event.type!=='session.delegation.created'||event.delegation?.target!=='client')return;
  const id=event.delegation?.id;if(!id||this.seen.has(id))return;this.seen.add(id);
  const text=this.transcript.trim();this.transcript='';const epoch=this.epoch;
  this.chain=this.chain.then(async()=>{
   if(!this.active||epoch!==this.epoch)return;
   try{
    const answer=text?await this.delegate(text,id):'Я не разобрал реплику. Повторите имя героя и действие.';
    if(!this.active||epoch!==this.epoch)return;
    // 500 token limit per commentary; 500 chars is conservative for Russian.
    for(const part of answer.match(/[\s\S]{1,500}/g)||[])this.send({type:'session.commentary.append',event_id:crypto.randomUUID(),delegation_id:id,content:part});
   }catch(error){this.onError(error);this.send({type:'session.commentary.append',delegation_id:id,content:'Мастер не смог обработать действие. Изменения не подтверждены. Проверьте сообщение об ошибке в приложении.'});}
  });
 }
 interrupt(){this.send({type:'session.instructions.append',delegation_id:null,content:'Прекрати текущую речь и выслушай игрока.'});}
 stop(){
  if(this.stopping)return this.stopping;
  this.epoch++;this.active=false;clearInterval(this.timer);
  const task=(async()=>{
   if(this.sessionId&&!this.finalized&&this.channel?.readyState==='open'){
    this.status('Завершаем Live…');let timer;
    const closed=new Promise(resolve=>{this.closedAck=resolve;timer=setTimeout(resolve,15000);});
    this.send({type:'session.close'});await closed;clearTimeout(timer);this.closedAck=null;
   }
   this.stream?.getTracks().forEach(t=>t.stop());this.stream=null;
   const pc=this.pc;this.pc=null;pc?.close();this.audio?.pause();if(this.audio)this.audio.srcObject=null;
   const id=this.sessionId;this.sessionId=null;
   if(id)await this.api('live-meter',{sessionId:id,closed:true,finalized:this.finalized,seconds:this.usageSeconds}).catch(this.onError);
   if(id&&!this.finalized)this.onError(Error('Соединение закрыто, но итоговый расход Live не подтверждён. Проверьте Usage OpenAI.'));
   this.status('Микрофон выключен');
  })();
  this.stopping=task;task.finally(()=>{if(this.stopping===task)this.stopping=null;}).catch(()=>{});return task;
 }
}
