import {test} from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs/promises';import os from 'node:os';import path from 'node:path';import {createCampaignStore} from '../campaign-store.mjs';import {makeCampaign} from '../engine.mjs';
test('SQLite migrates without losing JSON, persists, indexes and rejects stale writers',async()=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'skazitel-sqlite-'));let a,b;
 try{const c=makeCampaign({name:'Старая партия',characters:[{name:'Лира'}]});c.journal.push({id:'e',role:'user',text:'Кольцо обещано до заката'});const raw=JSON.stringify([c]);await fs.writeFile(path.join(dir,'campaigns.json'),raw);
 a=await createCampaignStore(dir);assert.deepEqual(a.load(),[c]);const backups=await fs.readdir(path.join(dir,'Backups'));assert.equal(await fs.readFile(path.join(dir,'Backups',backups[0]),'utf8'),raw);assert.match(a.search(c.id,'Кольцо')[0].text,/заката/);
 b=await createCampaignStore(dir);c.characters[0].hp=7;await a.save([c]);await assert.rejects(b.save([c]),/другим окном/);b.close();b=null;a.close();a=await createCampaignStore(dir);assert.equal(a.load()[0].characters[0].hp,7);assert.equal(JSON.parse(await fs.readFile(path.join(dir,'campaigns.json'),'utf8'))[0].characters[0].hp,7);
 }finally{a?.close();b?.close();await fs.rm(dir,{recursive:true,force:true});}
});
