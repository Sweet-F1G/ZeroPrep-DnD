import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {credentialStore,mergeKeys} from '../credentials.mjs';
test('blank credentials preserve connected keys; replacement and explicit deletion are separate',()=>{
 const existing={compatible:'test-groq',openai:'test-openai'};
 assert.deepEqual(mergeKeys(existing,{compatible:' ',openai:''}),existing);
 assert.deepEqual(mergeKeys(existing,{compatible:' new-groq '}),{compatible:'new-groq',openai:'test-openai'});
 assert.deepEqual(mergeKeys(existing,{},true),{});
 assert.deepEqual(existing,{compatible:'test-groq',openai:'test-openai'});
 assert.throws(()=>mergeKeys(existing,{openai:'x'.repeat(4097)}));
});
test('credential bridge survives a new store instance, clears explicitly, and hides helper error output',async()=>{
 const dir=await mkdtemp(path.join(tmpdir(),'skazitel-credential-test-'));
 try{
  const helper=path.join(dir,'helper'),file=path.join(dir,'fake-keychain');
  await writeFile(helper,`#!${process.execPath}\nconst fs=require('node:fs');const file=${JSON.stringify(file)};let input='';process.stdin.on('data',b=>input+=b);process.stdin.on('end',()=>{const action=process.argv[3];if(action==='save')fs.writeFileSync(file,input);else if(action==='clear'){if(fs.existsSync(file))fs.unlinkSync(file);}else process.stdout.write(fs.existsSync(file)?fs.readFileSync(file):'{}');});`,{mode:0o700});
  const store=credentialStore(helper);assert.equal(store.persistent,true);assert.deepEqual(await store.load(),{});
  await store.save({groq:'fixture-only'});assert.deepEqual(await credentialStore(helper).load(),{groq:'fixture-only'});
  await store.save({});assert.deepEqual(await store.load(),{});
  await writeFile(helper,`#!${process.execPath}\nprocess.stderr.write('fixture-secret');process.stdout.write('fixture-secret');process.exit(1);`,{mode:0o700});
  await assert.rejects(store.load(),e=>!e.message.includes('fixture-secret')&&e.message.includes('Связку ключей'));
 }finally{await rm(dir,{recursive:true,force:true});}
});
