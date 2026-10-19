import {randomBytes} from 'node:crypto';
// One-use, short-lived media tickets. Project/API keys never appear in URLs.
export class AudioStreams {
 constructor(load,{ttl=90000}={}){this.load=load;this.ttl=ttl;this.jobs=new Map();}
 prepare(text,scope=''){
  this.sweep();const key=scope+'\n'+text;for(const job of this.jobs.values())if(job.key===key&&!job.claimed&&!job.error)return job.id;
  if(this.jobs.size>=16)throw Error('Слишком много ожидающих аудиофрагментов');
  const job={id:randomBytes(24).toString('hex'),key,controller:new AbortController(),chunks:[],bytes:0,done:false,claimed:false,listeners:new Set(),expires:Date.now()+this.ttl};this.jobs.set(job.id,job);
  job.timer=setTimeout(()=>this.discard(job),this.ttl);job.timer.unref?.();
  job.task=(async()=>{try{const stream=await this.load(text,job.controller.signal);for await(const chunk of stream){job.bytes+=chunk.length;if(job.bytes>8e6)throw Error('Аудиофрагмент слишком большой');job.chunks.push(Buffer.from(chunk));for(const wake of job.listeners)wake();}}catch(error){job.error=error;}finally{job.done=true;for(const wake of job.listeners)wake();}})();return job.id;
 }
 discard(job){this.jobs.delete(job.id);clearTimeout(job.timer);job.controller.abort();for(const wake of job.listeners)wake();}
 sweep(){for(const job of this.jobs.values())if(job.expires<Date.now())this.discard(job);}
 async serve(id,res){
  const job=this.jobs.get(id);if(!job||job.claimed||job.expires<Date.now())return false;job.claimed=true;
  let index=0,closed=false;const wake=()=>{job.notify?.();};job.listeners.add(wake);
  const disconnect=()=>{closed=true;this.discard(job);wake();};res.once('close',disconnect);
  try{res.writeHead(200,{'Content-Type':'audio/mpeg','Cache-Control':'no-store','Accept-Ranges':'none'});
   while(!closed){while(index<job.chunks.length&&!closed)res.write(job.chunks[index++]);if(job.done){if(job.error)res.destroy();else res.end();break;}await new Promise(resolve=>{job.notify=resolve;});job.notify=null;}
  }finally{res.off('close',disconnect);job.listeners.delete(wake);this.discard(job);}return true;
 }
}
