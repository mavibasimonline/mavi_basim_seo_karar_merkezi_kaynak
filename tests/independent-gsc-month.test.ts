import {describe,it,expect} from 'vitest';
import {verifiedGscMonth,readVerifiedGscDay} from '../src/independent-gsc-report';
import {encrypt} from '../src/security';
import {GscRow} from '../src/providers';
const secret='AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=',time=new Date('2026-11-04T12:00:00Z');
function storage(){
 const map=new Map<string,unknown>();let reads=0;
 return {map,get:async<T>(key:string)=>{reads++;return map.get(key) as T|undefined;},put:async(key:string,value:unknown)=>{map.set(key,value);},reads:()=>reads} as any;
}
const digest=async(raw:string)=>[...new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(raw)))].map(x=>x.toString(16).padStart(2,'0')).join('');
const row=(day='2026-09-01',query=false):GscRow=>({date:day,page:'https://mavibasim.com/brosur',country:'tur',device:'MOBILE',clicks:2,impressions:10,ctr:0.2,position:4,...(query?{query:'broşür baskı',is_brand:0}:{})});
async function putProof(db:ReturnType<typeof storage>,day:string,scope:'page'|'query',pages:GscRow[][]){
 const generation='fixture-generation',parts=[];
 for(let index=0;index<pages.length;index++){
  const raw=JSON.stringify(pages[index]),bytes=new TextEncoder().encode(raw),chunks=Math.ceil(bytes.length/36000);
  for(let i=0;i<chunks;i++){
   const data=bytes.slice(i*36000,(i+1)*36000);
   await db.put(`gsc:part:${day}:${scope}:${generation}:${index}:${i}`,await encrypt({chunk:btoa(String.fromCharCode(...data))},secret));
  }
  parts.push({index,count:pages[index].length,bytes:bytes.length,chunks,sha256:await digest(raw)});
 }
 const proof={day,scope,generation,captured_at:'2026-10-10T00:00:00Z',rows:pages.reduce((n,p)=>n+p.length,0),pages:pages.length,
  query_partial:scope==='query',source:'GSC Search Analytics API',d1_requests:0,page_proofs:parts};
 await db.put(`gsc:daily:${day}:${scope}`,proof);return proof;
}
describe('independent monthly GSC evidence',()=>{
 it('does not manufacture totals from incomplete page coverage',async()=>{
  const result=await verifiedGscMonth(storage(),secret,'2026-09',time);
  expect(result).toMatchObject({available:false,days_verified:0,expected_days:30,d1_requests:0,total_clicks:null});
  expect(result.missing_days).toHaveLength(30);
 });
 it('allows current-month observations as partial evidence and rejects future periods',async()=>{
  const partial=await verifiedGscMonth(storage(),secret,'2026-11',new Date('2026-11-07T07:00:00Z'));
  expect(partial).toMatchObject({available:false,period_state:'kısmi',days_verified:0,expected_days:30,total_clicks:null});
  await expect(verifiedGscMonth(storage(),secret,'2026-12',new Date('2026-11-07T07:00:00Z'))).rejects.toThrow('GSC_MONTH_NOT_CLOSED');
  await expect(verifiedGscMonth(storage(),secret,'invalid')).rejects.toThrow('INVALID_MONTH');
 });
 it('decrypts and verifies both scopes before counting days and exposes traceable source hashes',async()=>{
  const db=storage();
  for(let i=1;i<=30;i++){
   const day='2026-09-'+String(i).padStart(2,'0');
   await putProof(db,day,'page',[[row(day)]]);await putProof(db,day,'query',[[row(day,true)]]);
  }
  const result=await verifiedGscMonth(db,secret,'2026-09',time);
  expect(result).toMatchObject({available:true,days_verified:30,query_days_verified:30,query_partial:true,total_clicks:60,total_impressions:300});
  expect(result.pages).toEqual([{page:'https://mavibasim.com/brosur',country:'tur',device:'MOBILE',clicks:60,impressions:300,ctr:0.2,position:4}]);
  expect(result.queries[0]).toMatchObject({query:'broşür baskı',clicks:60,is_brand:0});
  expect(result.evidence).toHaveLength(60);expect(result.evidence[0].page_hashes[0]).toMatch(/^[a-f0-9]{64}$/);
 });
 it('missing query content fails verification instead of counting its manifest',async()=>{
  const db=storage();await putProof(db,'2026-09-01','page',[[row()]]);await putProof(db,'2026-09-01','query',[[row(undefined,true)]]);
  db.map.delete('gsc:part:2026-09-01:query:fixture-generation:0:0');
  await expect(verifiedGscMonth(db,secret,'2026-09',time)).rejects.toThrow('GSC_MONTH_CHUNK_MISSING');
 });
 it('rejects a valid encrypted query chunk with a changed hash',async()=>{
  const db=storage(),p=await putProof(db,'2026-09-01','query',[[row(undefined,true)]]);
  p.page_proofs[0].sha256='0'.repeat(64);
  await expect(verifiedGscMonth(db,secret,'2026-09',time)).rejects.toThrow('GSC_MONTH_HASH_MISMATCH');
 });
 it('rejects scope confusion even when a forged chunk hash is valid',async()=>{
  const db=storage();await putProof(db,'2026-09-01','page',[[row(undefined,true)]]);
  await expect(verifiedGscMonth(db,secret,'2026-09',time)).rejects.toThrow('GSC_MONTH_ROW_SCOPE_INVALID');
 });
 it('rejects duplicate identities across API pagination',async()=>{
  const db=storage(),rows=Array.from({length:200},(_,i)=>({...row(),page:'https://mavibasim.com/product-'+i}));
  await putProof(db,'2026-09-01','page',[rows,[rows[0]]]);
  await expect(verifiedGscMonth(db,secret,'2026-09',time)).rejects.toThrow('GSC_MONTH_DUPLICATE_ROW');
 });
 it('read budgets produce explicit missing coverage and never partial monthly totals',async()=>{
  const db=storage();await putProof(db,'2026-09-01','page',[[row()]]);await putProof(db,'2026-09-02','page',[[row('2026-09-02')]]);
  const result=await verifiedGscMonth(db,secret,'2026-09',time,{maxChunkReads:1});
  expect(result).toMatchObject({available:false,days_verified:1,observed_clicks:2,total_clicks:null,query_days_verified:0,read_budget:{chunk_reads:1,budget_limited:true}});
  expect(result.missing_days).toContain('2026-09-02');expect(db.reads()).toBe(61);
 });
 it('rejects unsafe manifest counts before reading encrypted data',async()=>{
  const db=storage(),p=await putProof(db,'2026-09-01','page',[[row()]]);p.pages=NaN;
  await expect(verifiedGscMonth(db,secret,'2026-09',time)).rejects.toThrow('GSC_MONTH_MANIFEST_INVALID');
 });
 it('keeps incomplete source days out of page totals',async()=>{
  const db=storage(),p=await putProof(db,'2026-09-01','page',[[row()]]);p.query_partial=true;
  const result=await verifiedGscMonth(db,secret,'2026-09',time);
  expect(result.days_verified).toBe(0);expect(result.total_clicks).toBeNull();expect(result.pages).toEqual([]);
 });
 it('daily acceptance verifies encrypted query content before exposing a verified scope',async()=>{
  const db=storage(),p=await putProof(db,'2026-09-01','query',[[row(undefined,true)]]);
  expect(await readVerifiedGscDay(db,secret,'2026-09-01','query',time)).toMatchObject({verified:true,rows_count:1,query_partial:true,d1_requests:0});
  p.page_proofs[0].sha256='0'.repeat(64);
  await expect(readVerifiedGscDay(db,secret,'2026-09-01','query',time)).rejects.toThrow('GSC_MONTH_HASH_MISMATCH');
  expect(await readVerifiedGscDay(db,secret,'2026-09-02','query',time)).toMatchObject({verified:false,code:'GSC_DAY_MISSING'});
 });
 it('daily reader rejects nonexistent dates and recent source days',async()=>{
  await expect(readVerifiedGscDay(storage(),secret,'2026-09-31','page',time)).rejects.toThrow('INVALID_DAY');
  await expect(readVerifiedGscDay(storage(),secret,'2026-11-03','page',time)).rejects.toThrow('GSC_DAY_OUT_OF_RANGE');
 });
 it('rejects finite source metrics whose weighted aggregation would overflow',async()=>{
  const db=storage();await putProof(db,'2026-09-01','page',[[{...row(),position:1e308}]]);
  await expect(verifiedGscMonth(db,secret,'2026-09',time)).rejects.toThrow('GSC_MONTH_METRIC_OVERFLOW');
 });
 it('rejects capture timestamps before the source date',async()=>{
  const db=storage(),p=await putProof(db,'2026-09-01','page',[[row()]]);p.captured_at='2026-08-01T00:00:00Z';
  await expect(readVerifiedGscDay(db,secret,'2026-09-01','page',time)).rejects.toThrow('GSC_MONTH_CAPTURE_INVALID');
 });
});
