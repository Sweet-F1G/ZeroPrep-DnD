import {spawn} from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {randomUUID} from 'node:crypto';
const root=path.dirname(fileURLToPath(import.meta.url));
const directory=process.env.SKAZITEL_VOICE_DIR||path.resolve(root,'../LocalVoice');
export const sileroSpeakers=['eugene','aidar','xenia','kseniya','baya'];
let child=null,ready=null,readyResolve,readyReject,buffer='',tail='',serial=Promise.resolve(),waiting=0;
const jobs=new Map();
async function pythonExecutable(){
 for(const relative of ['python/bin/python3','venv/bin/python']){const file=path.join(directory,relative);try{await fs.access(file);return file;}catch{}}
 throw Error('Не найдена встроенная среда локального голоса. Переустановите Сказителя.');
}
export async function localVoiceStatus(){
 try{await pythonExecutable();await fs.access(path.join(directory,'models/silero-ru.pt'));return {installed:true,engine:'Silero v5.6 · CPU',speakers:sileroSpeakers};}
 catch{return {installed:false,engine:'Silero v5.6 · CPU',speakers:sileroSpeakers};}
}
function fail(error){readyReject?.(error);for(const j of jobs.values()){clearTimeout(j.timer);j.reject(error);}jobs.clear();child=null;ready=null;buffer='';}
async function start(){
 if(ready)return ready;
 if(!(await localVoiceStatus()).installed)throw Error('Silero ещё не установлен. Нужна папка LocalVoice рядом с приложением.');
 if(ready)return ready;
 ready=new Promise((resolve,reject)=>{readyResolve=resolve;readyReject=reject;});
 const environment={...process.env,PYTHONNOUSERSITE:'1',PYTHONDONTWRITEBYTECODE:'1'};delete environment.PYTHONPATH;delete environment.PYTHONHOME;
 const instance=spawn(await pythonExecutable(),['-u',path.join(root,'silero-worker.py'),path.join(directory,'models/silero-ru.pt')],{env:environment,stdio:['pipe','pipe','pipe']});
 child=instance;buffer='';tail='';
 const timer=setTimeout(()=>{if(child===instance){instance.kill();fail(Error('Silero не загрузился за 60 секунд.'));}},60000);
 instance.stderr.on('data',bytes=>{tail=(tail+bytes.toString()).slice(-2000);});
 instance.stdout.on('data',bytes=>{
  if(child!==instance)return;
  buffer+=bytes.toString();if(buffer.length>80e6){instance.kill();fail(Error('Слишком большой ответ локальной озвучки.'));return;}
  let end;while((end=buffer.indexOf('\n'))>=0){const line=buffer.slice(0,end);buffer=buffer.slice(end+1);if(!line.trim())continue;
   let m;try{m=JSON.parse(line);}catch{instance.kill();fail(Error('Нарушен протокол локальной озвучки.'));return;}
   if(m.ready){clearTimeout(timer);readyResolve();}
   else if(m.fatal){clearTimeout(timer);fail(Error(m.fatal));}
   else {const job=jobs.get(m.id);if(!job)continue;clearTimeout(job.timer);jobs.delete(m.id);if(m.error)job.reject(Error(m.error));else {const wav=Buffer.from(m.audio||'','base64');if(wav.toString('ascii',0,4)!=='RIFF')job.reject(Error('Silero вернул некорректный звук.'));else job.resolve({audio:wav,seconds:m.seconds,synthesisSeconds:m.synthesisSeconds});}}
  }
 });
 instance.once('error',()=>{clearTimeout(timer);if(child===instance)fail(Error('Не удалось запустить Python для Silero. Проверьте установку LocalVoice.'));});
 instance.once('exit',()=>{clearTimeout(timer);if(child===instance)fail(Error('Локальная озвучка остановилась. '+(tail.includes('ModuleNotFoundError')?'Нужно восстановить библиотеки LocalVoice.':'Повторите запрос.')));});
 return ready;
}
export function closeLocalVoice(){const instance=child;fail(Error('Озвучивание остановлено.'));instance?.kill();}
export function sileroSpeech(text,speaker='eugene'){
 if(typeof text!=='string'||!text.trim()||text.length>6000)return Promise.reject(Error('Реплика для Silero должна содержать от 1 до 6000 символов.'));
 if(!sileroSpeakers.includes(speaker))return Promise.reject(Error('Неизвестный голос Silero.'));
 if(waiting>=3)return Promise.reject(Error('Silero уже озвучивает реплики. Дождитесь завершения.'));
 waiting++;
 const task=serial.then(async()=>{await start();return new Promise((resolve,reject)=>{const id=randomUUID();const timer=setTimeout(()=>closeLocalVoice(),120000);jobs.set(id,{resolve,reject,timer});child.stdin.write(JSON.stringify({id,text,speaker})+'\n',error=>{if(error){clearTimeout(timer);jobs.delete(id);reject(Error('Не удалось передать текст локальному голосу.'));}});});});
 serial=task.catch(()=>{});return task.finally(()=>{waiting--;});
}
process.once('exit',()=>child?.kill());
