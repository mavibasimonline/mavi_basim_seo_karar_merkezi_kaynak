import {beforeEach,describe,it,expect,vi} from 'vitest';
import {env} from 'cloudflare:workers';
import {reset,runInDurableObject} from 'cloudflare:test';
import {readIndependentSnapshot,saveIndependentSnapshot,IndependentSnapshot} from '../../src/independent-snapshot';
import type {IndependentDriveEnv} from '../../src/drive-independent';
const cfg=env as IndependentDriveEnv;
const stub=()=>cfg.DRIVE_ARCHIVE_STORE.get(cfg.DRIVE_ARCHIVE_STORE.idFromName('snapshot-regression'));
async function snapshot(label='ilk'):Promise<IndependentSnapshot>{
 const records=Array.from({length:1800},(_,i)=>({source:'fixture',source_key:String(i),section:'SORGULAR',family:'query_period',identity:['brosur',String(i)],start:'2026-09-01',end:'2026-09-30',payload:{Sorgu:('Türkçe broşür baskı '+label+' ').repeat(24),validated_metrics:{clicks:1,impressions:10,ctr:0.1,position:2}},daily_page_query_coverage:false as const,source_filters_verified:false as const}));
 const source_hash=[...new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify(records))))].map(b=>b.toString(16).padStart(2,'0')).join('');
 return {format:'independent-sheets-v1',source:'fixture',captured_at:'2026-10-30T00:00:00Z',records,quarantined_records:0,source_hash};
}
beforeEach(async()=>reset());
describe('large independent snapshots in real SQLite Durable Object storage',()=>{
 it('round-trips multi-byte data above the single-value limit and retains previous history',async()=>{
  expect('DB' in cfg).toBe(false);
  const first=await snapshot(),second=await snapshot('ikinci');
  await runInDurableObject(stub(),async(_instance,state)=>{
   const result=await saveIndependentSnapshot(state.storage,first);
   expect(result.bytes).toBeGreaterThan(1_000_000);expect(result.chunks).toBeGreaterThan(20);
   expect(await readIndependentSnapshot(state.storage)).toEqual(first);
   await saveIndependentSnapshot(state.storage,second);
   expect(await readIndependentSnapshot(state.storage)).toEqual(second);
   expect(await state.storage.get('independent:history:'+first.source_hash)).toBeDefined();
  });
 });
 it('keeps the active pointer when a new chunk write fails',async()=>{
  const first=await snapshot(),second=await snapshot('hata');
  await runInDurableObject(stub(),async(_instance,state)=>{
   await saveIndependentSnapshot(state.storage,first);
   const put=state.storage.put.bind(state.storage);
   const spy=vi.spyOn(state.storage,'put').mockImplementation(async(...args:any[])=>{
    if(String(args[0]).includes(second.source_hash)&&String(args[0]).endsWith(':1'))throw Error('FIXTURE_STORAGE_FAILURE');
    return (put as any)(...args);
   });
   await expect(saveIndependentSnapshot(state.storage,second)).rejects.toThrow('FIXTURE_STORAGE_FAILURE');
   spy.mockRestore();expect(await readIndependentSnapshot(state.storage)).toEqual(first);
  });
 });
 it('rejects missing chunks, corruption and caller hash mismatches',async()=>{
  const first=await snapshot();
  await runInDurableObject(stub(),async(_instance,state)=>{
   await expect(saveIndependentSnapshot(state.storage,{...first,source_hash:'0'.repeat(64)})).rejects.toThrow('HASH_MISMATCH');
   await saveIndependentSnapshot(state.storage,first);
   const key='independent:chunk:'+first.source_hash+':0',saved=await state.storage.get<string>(key);
   await state.storage.delete(key);await expect(readIndependentSnapshot(state.storage)).rejects.toThrow('CHUNK_MISSING');
   await state.storage.put(key,btoa('x'.repeat(48000)));await expect(readIndependentSnapshot(state.storage)).rejects.toThrow('HASH_MISMATCH');
   await state.storage.put(key,saved!);expect(await readIndependentSnapshot(state.storage)).toEqual(first);
  });
 });
});
