// Consume Responses SSE without exposing unvalidated JSON or reasoning to players.
export async function readResponseStream(response,log,onNarration,onFirstSentence){
 if(!response.headers.get('content-type')?.includes('text/event-stream')){const data=await response.json();await log(response,data);return data;}
 let pending='',output='',completed=null,notified=false,firstNotified=false;const decoder=new TextDecoder();
 function event(block){const raw=block.split('\n').filter(l=>l.startsWith('data:')).map(l=>l.slice(5).trimStart()).join('\n');if(!raw||raw==='[DONE]')return;const data=JSON.parse(raw);
  if(data.type==='response.output_text.delta'){output+=data.delta||'';
   if(!firstNotified&&onFirstSentence){
    const matchStart=/"narration"\s*:\s*"/.exec(output);
    if(matchStart){
     const content=output.slice(matchStart.index+matchStart[0].length);
     const sentMatch=/^((?:[^"\\]|\\.)+?[.!?…])(?=\s+[А-ЯЁA-Z«“])/.exec(content);
     if(sentMatch){
      try{
       const first=JSON.parse('"'+sentMatch[1]+'"').trim();
       if(first){firstNotified=true;try{onFirstSentence(first);}catch{}}
      }catch{}
     }
    }
   }
   if(!notified){const match=/"narration"\s*:\s*("(?:[^"\\]|\\.)*")/.exec(output);if(match){notified=true;try{onNarration?.(JSON.parse(match[1]));}catch{}}}
  }
  if(data.type==='response.completed')completed=data.response;
  if(['response.failed','response.incomplete','error'].includes(data.type))throw Error('Поток ответа OpenAI не завершён. Изменения не применены.');
 }
 try{for await(const chunk of response.body){pending=(pending+decoder.decode(chunk,{stream:true})).replace(/\r\n/g,'\n');if(pending.length>4000000)throw Error('Слишком большой поток ответа');let end;while((end=pending.indexOf('\n\n'))>=0){event(pending.slice(0,end));pending=pending.slice(end+2);}}
 pending+=decoder.decode();if(pending.trim())event(pending);if(!completed)throw Error('OpenAI закрыл поток до завершённого ответа. Изменения не применены.');await log(response,completed);return completed;
 }catch(error){await log(response,completed||{});throw error;}
}
