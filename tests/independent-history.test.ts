import {describe,it,expect} from 'vitest';
import {readIndependentSnapshot,saveIndependentSnapshot,withVerifiedPreviousMonth,IndependentSnapshot} from '../src/independent-snapshot';

function memoryStorage(){
 const data=new Map<string,unknown>(),lists:Array<{prefix?:string;limit?:number;startAfter?:string}>=[];
 const storage={
  get:async<T>(key:string)=>data.get(key) as T|undefined,
  put:async(key:string,value:unknown)=>{data.set(key,structuredClone(value));},
  list:async<T>(options:{prefix?:string;limit?:number;startAfter?:string})=>{
   lists.push({...options});
   return new Map([...data].filter(([key])=>(!options.prefix||key.startsWith(options.prefix))&&(!options.startAfter||key>options.startAfter))
    .sort(([a],[b])=>a<b?-1:a>b?1:0).slice(0,options.limit).map(([key,value])=>[key,value as T]));
  }
 } as unknown as DurableObjectStorage;
 return {storage,data,lists};
}
async function pack(month:string,label:string,captured_at='2026-11-04T00:00:00Z'):Promise<IndependentSnapshot>{
 const end=month==='2026-09'?'30':'31';
 const records=['OZET','URUNLER'].map(section=>({source:'fixture',source_key:section+label,section,family:'period',identity:section==='OZET'?month:'brosur',
  start:month+'-01',end:month+'-'+end,payload:{'Ürün ID':'brosur','Ürün Adı':'Broşür',label,validated_metrics:{clicks:71,impressions:900,ctr:71/900,position:3}},
  daily_page_query_coverage:false as const,source_filters_verified:false as const}));
 const source_hash=[...new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify(records))))].map(n=>n.toString(16).padStart(2,'0')).join('');
 return {format:'independent-sheets-v1',source:'fixture',captured_at,records,quarantined_records:0,source_hash};
}

describe('historical month discovery beyond the first hash-sorted metadata page',()=>{
 it('keeps the first verified capture immutable when unchanged content is refreshed',async()=>{
  const {storage,data}=memoryStorage(),first=await pack('2026-09','same','2026-10-04T00:00:00Z');
  await saveIndependentSnapshot(storage,first);
  const historyKey='independent:history:'+first.source_hash,original=structuredClone(data.get(historyKey));
  const refreshed={...first,captured_at:'2026-11-04T06:00:00Z'};
  await saveIndependentSnapshot(storage,refreshed);
  expect(data.get(historyKey)).toEqual(original);
  expect(await readIndependentSnapshot(storage)).toEqual(refreshed);
 });
 it('finds September outside the first 32 manifests without writing or replacing either archive',async()=>{
  const {storage,data,lists}=memoryStorage();
  // Real content hashes: make September sort after 32 unrelated October sources.
  let september=await pack('2026-09','sept-0');
  for(let i=1;september.source_hash[0]!=='f';i++)september=await pack('2026-09','sept-'+i);
  await saveIndependentSnapshot(storage,september);
  let saved=0,current=await pack('2026-10','initial');
  for(let i=0;saved<40;i++){
   const candidate=await pack('2026-10','oct-'+i);
   if(candidate.source_hash[0]>='e')continue;
   await saveIndependentSnapshot(storage,candidate);current=candidate;saved++;
  }
  const keys=[...data.keys()].filter(k=>k.startsWith('independent:history:')).sort();
  expect(keys.indexOf('independent:history:'+september.source_hash)).toBeGreaterThan(31);
  const before=structuredClone([...data]);lists.length=0;
  const joined=await withVerifiedPreviousMonth(storage,current);
  expect(joined.previous_source_hash).toBe(september.source_hash);
  expect(joined.records).toEqual([...current.records,...september.records]);
  expect(lists).toHaveLength(2);
  expect(lists[1].startAfter).toBe(keys[31]);
  expect([...data]).toEqual(before);
  expect(await readIndependentSnapshot(storage)).toEqual(current);
 });

 it('skips a damaged newer archive and retains a verified older baseline',async()=>{
  const {storage,data}=memoryStorage();
  const older=await pack('2026-09','older','2026-10-03T00:00:00Z');
  const newer=await pack('2026-09','newer','2026-10-04T00:00:00Z');
  const current=await pack('2026-10','current');
  for(const snapshot of [older,newer,current])await saveIndependentSnapshot(storage,snapshot);
  data.set('independent:chunk:'+newer.source_hash+':0',btoa('damaged'));
  const before=structuredClone([...data]);
  const joined=await withVerifiedPreviousMonth(storage,current);
  expect(joined.previous_source_hash).toBe(older.source_hash);
  expect(joined.records).toEqual([...current.records,...older.records]);
  expect([...data]).toEqual(before);
 });
});
