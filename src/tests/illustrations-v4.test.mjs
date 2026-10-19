import {test} from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs/promises';import os from 'node:os';import path from 'node:path';import {queueIllustration,checkIllustration} from '../illustrations.mjs';
test('free images use an anonymous public queue, no paid provider, safe local bytes and censorship',async()=>{
 const original=global.fetch,dir=await fs.mkdtemp(path.join(os.tmpdir(),'skazitel-images-'));let phase='queue';const id='11111111-1111-1111-1111-111111111111';
 const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jvRcAAAAASUVORK5CYII=','base64');
 global.fetch=async(url,opts)=>{assert.ok(String(url).startsWith('https://aihorde.net/api/v2/'));assert.equal(opts.headers.apikey,'0000000000');
  if(String(url).endsWith('/async')){const b=JSON.parse(opts.body);assert.equal(b.shared,true);assert.equal(b.r2,false);assert.equal(b.params.n,1);return Response.json({id});}
  if(String(url).includes('/check/'))return Response.json({done:phase!=='wait',queue_position:4,wait_time:60});
  return Response.json({generations:[{img:phase==='url'?'https://127.0.0.1/private':png.toString('base64'),censored:phase==='censored',model:'fixture'}]});
 };
 try{const job=await queueIllustration({prompt:'A misty fantasy forest'});assert.equal(job.costUsd,0);assert.equal(job.public,true);phase='wait';assert.equal((await checkIllustration(job,dir)).status,'queued');phase='url';await assert.rejects(checkIllustration(job,dir),/внешняя ссылка/);phase='censored';assert.equal((await checkIllustration(job,dir)).status,'censored');phase='ok';const ready=await checkIllustration(job,dir);assert.equal(ready.status,'ready');assert.deepEqual(await fs.readFile(path.join(dir,ready.file)),png);
 }finally{global.fetch=original;await fs.rm(dir,{recursive:true,force:true});}
});
