import {spawn} from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const root=path.dirname(fileURLToPath(import.meta.url));
const directory=process.env.SKAZITEL_VOICE_DIR||path.resolve(root,'../LocalVoice');

export const edgeVoices=[
 {id:'ru-RU-DmitryNeural',name:'Дмитрий (нейросеть Edge · баритон)'},
 {id:'ru-RU-SvetlanaNeural',name:'Светлана (нейросеть Edge · мягкий)'}
];

export async function pythonEnvironment(){
 for(const relative of ['venv/bin/python','python/bin/python3','venv/bin/python3']){
  const file=path.join(directory,relative);
  try{
   await fs.access(file);
   let realExecutable=file;
   try{realExecutable=await fs.realpath(file);}catch{}
   let sitePackages='';
   const libDir=path.join(directory,'venv/lib');
   try{
    const entries=await fs.readdir(libDir);
    for(const e of entries){
     const sp=path.join(libDir,e,'site-packages');
     try{await fs.access(sp);sitePackages=sp;break;}catch{}
    }
   }catch{}
   return {executable:realExecutable,sitePackages};
  }catch{}
 }
 try{return {executable:'python3',sitePackages:''};}catch{}
 throw Error('Не найдена среда Python для озвучивания Edge TTS.');
}

export async function pythonExecutable(){
 const env=await pythonEnvironment();
 return env.executable;
}

export async function edgeVoiceStatus(){
 try{
  await pythonEnvironment();
  return {installed:true,engine:'Microsoft Edge Neural TTS',voices:edgeVoices};
 }catch{
  return {installed:false,engine:'Microsoft Edge Neural TTS',voices:edgeVoices};
 }
}

export async function* edgeSpeechChunks(text,voice='ru-RU-DmitryNeural',signal=null){
 if(typeof text!=='string'||!text.trim())return;
 const cleanVoice=edgeVoices.some(v=>v.id===voice)?voice:'ru-RU-DmitryNeural';
 const pyEnv=await pythonEnvironment();
 const script=path.join(root,'edge-worker.py');
 const environment={...process.env,PYTHONNOUSERSITE:'1',PYTHONDONTWRITEBYTECODE:'1'};
 delete environment.__PYVENV_LAUNCHER__;
 delete environment.PYTHONHOME;
 if(pyEnv.sitePackages){
  environment.PYTHONPATH=environment.PYTHONPATH
   ? `${pyEnv.sitePackages}:${environment.PYTHONPATH}`
   : pyEnv.sitePackages;
 }

 const child=spawn(pyEnv.executable,['-s','-u',script,'--voice',cleanVoice],{env:environment,stdio:['pipe','pipe','pipe']});
 let stderr='';
 child.stderr.on('data',chunk=>{stderr=(stderr+chunk.toString()).slice(-1000);});

 if(signal){
  if(signal.aborted){child.kill('SIGTERM');throw Error('Озвучивание отменено');}
  signal.addEventListener('abort',()=>child.kill('SIGTERM'),{once:true});
 }

 child.stdin.end(text,'utf8');

 let receivedAny=false;
 try{
  for await(const chunk of child.stdout){
   if(chunk&&chunk.length>0){
    receivedAny=true;
    yield chunk;
   }
  }
 }catch(err){
  child.kill('SIGTERM');
  if(signal?.aborted)return;
  throw err;
 }

 await new Promise((resolve,reject)=>{
  if(child.exitCode!==null){
   if(child.exitCode===0||receivedAny)resolve();
   else reject(Error(stderr.trim()||`Edge TTS завершился с кодом ${child.exitCode}`));
   return;
  }
  child.once('close',code=>{
   if(code===0||receivedAny||signal?.aborted)resolve();
   else reject(Error(stderr.trim()||`Edge TTS завершился с кодом ${code}`));
  });
  child.once('error',err=>reject(Error('Не удалось запустить Edge TTS: '+err.message)));
 });
}

export async function edgeSpeech(text,voice='ru-RU-DmitryNeural',signal=null){
 const timeoutSignal=signal||AbortSignal.timeout(12000);
 const chunks=[];
 for await(const chunk of edgeSpeechChunks(text,voice,timeoutSignal)){
  chunks.push(chunk);
 }
 if(!chunks.length)throw Error('Edge TTS не вернул аудиоданные');
 return Buffer.concat(chunks);
}
