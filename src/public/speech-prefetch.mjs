// Prepare at most one unheard segment. The caller still acknowledges only the
// audio actually played; prefetching never commits game state.
export class SpeechPrefetch {
 constructor(load){this.load=load;this.job=null;}
 warm(key,text){
  if(!text||this.job?.key===key)return;
  this.clear();const controller=new AbortController();
  const promise=Promise.resolve().then(()=>this.load(text,controller.signal)).then(value=>({ok:true,value}),error=>({ok:false,error}));
  this.job={key,controller,promise};
 }
 take(key){if(this.job?.key!==key){this.clear();return null;}const job=this.job;this.job=null;return job;}
 clear(){this.job?.controller.abort();this.job=null;}
}
