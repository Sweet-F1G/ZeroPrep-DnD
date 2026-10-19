import {test} from 'node:test';
import assert from 'node:assert/strict';
import {localVoiceStatus,sileroSpeech,closeLocalVoice} from '../local-voice.mjs';

test('local voice rejects unknown speakers and oversized text before starting inference',async()=>{
 await assert.rejects(sileroSpeech('Привет','unknown'),/Неизвестный/);
 await assert.rejects(sileroSpeech(''),/6000/);
 await assert.rejects(sileroSpeech('а'.repeat(6001)),/6000/);
});

test('installed Silero synthesizes two queued narrations without any API key',async t=>{
 if(!(await localVoiceStatus()).installed){t.skip('LocalVoice is not installed on this machine');return;}
 try {
  const results=await Promise.all([
   sileroSpeech('Сложность 12. Бросьте d20.','eugene'),
   sileroSpeech('У старой башни зажигается свет.','xenia')
  ]);
  for(const result of results){assert.equal(result.audio.toString('ascii',0,4),'RIFF');assert.equal(result.audio.toString('ascii',8,12),'WAVE');assert.equal(result.audio.readUInt32LE(24),48000);assert.ok(result.seconds>1);assert.ok(result.synthesisSeconds>0);assert.ok(result.audio.length>10000);}
 }finally{closeLocalVoice();}
});
