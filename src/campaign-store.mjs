import {DatabaseSync} from 'node:sqlite';
import fs from 'node:fs/promises';import path from 'node:path';import {createHash,randomUUID} from 'node:crypto';
export async function createCampaignStore(directory){
 await fs.mkdir(directory,{recursive:true});const file=path.join(directory,'campaigns.sqlite');const db=new DatabaseSync(file);await fs.chmod(file,0o600);
 db.exec('PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA busy_timeout=5000;');
 db.exec('CREATE TABLE IF NOT EXISTS metadata(key TEXT PRIMARY KEY,value TEXT NOT NULL)');
 const schema=db.prepare("SELECT value FROM metadata WHERE key='schema'").get();if(schema&&schema.value!=='1'){db.close();throw Error('База кампаний создана более новой версией приложения. Сохранения не изменены.');}
 db.exec('CREATE TABLE IF NOT EXISTS campaigns(id TEXT PRIMARY KEY, data TEXT NOT NULL, revision INTEGER NOT NULL); CREATE TABLE IF NOT EXISTS audit(id INTEGER PRIMARY KEY, campaign_id TEXT NOT NULL, revision INTEGER NOT NULL, at TEXT NOT NULL, fingerprint TEXT NOT NULL, snapshot TEXT NOT NULL); CREATE TABLE IF NOT EXISTS journal_archive(campaign_id TEXT NOT NULL,event_id TEXT NOT NULL,fingerprint TEXT NOT NULL,data TEXT NOT NULL,PRIMARY KEY(campaign_id,event_id,fingerprint)); CREATE VIRTUAL TABLE IF NOT EXISTS archive USING fts5(campaign_id UNINDEXED, event_id UNINDEXED, text);');
 let generation=Number(db.prepare("SELECT value FROM metadata WHERE key='generation'").get()?.value||0),mirrorError='';
 const migrated=!!db.prepare("SELECT value FROM metadata WHERE key='migrated'").get();
 function transaction(fn){db.exec('BEGIN IMMEDIATE');try{const result=fn();db.exec('COMMIT');return result;}catch(e){db.exec('ROLLBACK');throw e;}}
 function writeCampaigns(campaigns){
  if(!Array.isArray(campaigns))throw Error('Некорректное сохранение кампаний');
  transaction(()=>{
   const actual=Number(db.prepare("SELECT value FROM metadata WHERE key='generation'").get()?.value||0);if(actual!==generation)throw Error('Сохранение изменено другим окном Сказителя. Перезапустите приложение, чтобы не затереть изменения.');
   const seen=new Set();for(const c of campaigns){if(!c||typeof c.id!=='string'||!Array.isArray(c.journal)||!Array.isArray(c.characters)||seen.has(c.id))throw Error('Некорректная кампания в сохранении');seen.add(c.id);
    const data=JSON.stringify(c),previous=db.prepare('SELECT data,revision FROM campaigns WHERE id=?').get(c.id);if(previous?.data===data)continue;
    const revision=(previous?.revision||0)+1;db.prepare('INSERT INTO campaigns VALUES(?,?,?) ON CONFLICT(id) DO UPDATE SET data=excluded.data,revision=excluded.revision').run(c.id,data,revision);
    const {undo,delivery,...snapshot}=c;const text=JSON.stringify(snapshot),fingerprint=createHash('sha256').update(text).digest('hex');
    db.prepare('INSERT INTO audit(campaign_id,revision,at,fingerprint,snapshot) VALUES(?,?,?,?,?)').run(c.id,revision,new Date().toISOString(),fingerprint,text);
    db.prepare("UPDATE audit SET snapshot='null' WHERE campaign_id=? AND revision<?").run(c.id,revision-20);
    const archiveEvent=db.prepare('INSERT OR IGNORE INTO journal_archive VALUES(?,?,?,?)');for(const event of c.journal){const text=JSON.stringify(event);archiveEvent.run(c.id,String(event.id||''),createHash('sha256').update(text).digest('hex'),text);}
    db.prepare('DELETE FROM archive WHERE campaign_id=?').run(c.id);const insert=db.prepare('INSERT INTO archive(campaign_id,event_id,text) VALUES(?,?,?)');for(const e of c.journal)insert.run(c.id,String(e.id||''),String(e.text||''));
   }
   // No implicit deletion: importing an incomplete list cannot erase another campaign.
   db.prepare("INSERT INTO metadata VALUES('generation',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").run(String(actual+1));
  });generation++;
 }
 function deleteCampaignRecord(campaignId){
  transaction(()=>{
   const actual=Number(db.prepare("SELECT value FROM metadata WHERE key='generation'").get()?.value||0);if(actual!==generation)throw Error('Сохранение изменено другим окном Сказителя. Перезапустите приложение, чтобы не затереть изменения.');
   db.prepare('DELETE FROM campaigns WHERE id=?').run(campaignId);
   db.prepare('DELETE FROM audit WHERE campaign_id=?').run(campaignId);
   db.prepare('DELETE FROM journal_archive WHERE campaign_id=?').run(campaignId);
   db.prepare('DELETE FROM archive WHERE campaign_id=?').run(campaignId);
   db.prepare("INSERT INTO metadata VALUES('generation',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").run(String(actual+1));
  });generation++;
 }
 if(!migrated){
  let legacy=[],raw;try{raw=await fs.readFile(path.join(directory,'campaigns.json'),'utf8');legacy=JSON.parse(raw);if(!Array.isArray(legacy))throw Error();}catch(e){if(e.code!=='ENOENT'){db.close();throw Error('Повреждён campaigns.json. Миграция остановлена; исходный файл сохранён.');}}
  if(raw!==undefined){const backups=path.join(directory,'Backups');await fs.mkdir(backups,{recursive:true});await fs.writeFile(path.join(backups,'campaigns-before-sqlite-'+Date.now()+'.json'),raw,{mode:0o600,flag:'wx'});}
  writeCampaigns(legacy);transaction(()=>{db.prepare("INSERT OR REPLACE INTO metadata VALUES('schema','1')").run();db.prepare("INSERT OR REPLACE INTO metadata VALUES('migrated','1')").run();});
 }
 const load=()=>db.prepare('SELECT data FROM campaigns ORDER BY rowid').all().map(r=>JSON.parse(r.data));
 return {
  load,
  async save(campaigns){writeCampaigns(campaigns);const temp=path.join(directory,'campaigns.json.'+randomUUID()+'.tmp');try{await fs.writeFile(temp,JSON.stringify(load(),null,2),{mode:0o600});await fs.rename(temp,path.join(directory,'campaigns.json'));mirrorError='';}catch{await fs.rm(temp,{force:true}).catch(()=>{});mirrorError='Основная база сохранена, но JSON-копия не обновилась. Проверьте свободное место.';}},
  async delete(campaignId){deleteCampaignRecord(campaignId);const temp=path.join(directory,'campaigns.json.'+randomUUID()+'.tmp');try{await fs.writeFile(temp,JSON.stringify(load(),null,2),{mode:0o600});await fs.rename(temp,path.join(directory,'campaigns.json'));mirrorError='';}catch{await fs.rm(temp,{force:true}).catch(()=>{});mirrorError='Основная база сохранена, но JSON-копия не обновилась. Проверьте свободное место.';}},
  status:()=>({engine:'SQLite',schema:1,generation,mirrorError,backups:'Saves/Backups',auditEvents:Number(db.prepare('SELECT count(*) AS n FROM audit').get().n)}),
  search(campaignId,query){const terms=String(query).match(/[\p{L}\d]{3,}/gu)?.slice(0,12);if(!terms?.length)return [];const match=terms.map(t=>'"'+t.replaceAll('"','')+'"*').join(' OR ');return db.prepare('SELECT event_id AS id,text FROM archive WHERE archive MATCH ? AND campaign_id=? ORDER BY rank LIMIT 20').all(match,campaignId);},
  close:()=>db.close()
 };
}
