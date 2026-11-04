import {describe,it,expect,vi} from 'vitest';
import {IndependentGscCollector} from '../src/independent-gsc';
const secret='AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=';
const start=new Date('2026-10-31T00:15:00Z');
const later=(minutes:number)=>new Date(start.getTime()+minutes*60000);
function storage(){
 const map=new Map<string,any>();
 return {map,get:async<T>(key:string)=>structuredClone(map.get(key)) as T|undefined,put:async(key:string,value:unknown)=>{map.set(key,structuredClone(value));}};
}
function rows(init?:RequestInit,count=1,offset?:number,incomplete=false){
 const body=JSON.parse(String(init?.body)),query=body.dimensions.includes('query');
 return Response.json({responseAggregationType:'byPage',...(incomplete?{metadata:{first_incomplete_date:body.startDate}}:{}),rows:Array.from({length:count},(_,n)=>({
  keys:query?[body.startDate,'https://mavibasim.com/brosur?source='+String((offset??body.startRow)+n),'broşür '+String((offset??body.startRow)+n),'tur','DESKTOP']:[body.startDate,'https://mavibasim.com/brosur?source='+String((offset??body.startRow)+n),'tur','DESKTOP'],
  clicks:1,impressions:10,ctr:0.1,position:4,
 }))});
}
const collector=(db:ReturnType<typeof storage>,fetcher:ReturnType<typeof vi.fn>,token=async(_force:boolean)=>'TEST access token')=>new IndependentGscCollector(db as any,secret,token,fetcher as unknown as typeof fetch);
describe('bounded, recoverable independent GSC collection',()=>{
 it('uses recent missing work when both scopes of the scheduled historical date are held',async()=>{
  const db=storage(),fetcher=vi.fn(async(_url:string,init?:RequestInit)=>rows(init)),sync=collector(db,fetcher);
  db.map.set('gsc:tick-count',3);
  const held={until:later(1440).getTime(),code:'GSC_HTTP_400'};
  for(const scope of ['page','query'])db.map.set('gsc:held:2026-10-21:'+scope,held);
  expect(await sync.tick(start)).toMatchObject({status:'complete',day:'2026-10-28',scope:'page',rows:1,d1_requests:0});
  expect(fetcher).toHaveBeenCalledTimes(1);expect(db.map.get('gsc:backfill-index')).toBe(1);
  for(const scope of ['page','query'])expect(db.map.get('gsc:held:2026-10-21:'+scope)).toEqual(held);
  expect((await sync.status(start)).last_attempt).toMatchObject({status:'complete',day:'2026-10-28'});
 });
 it('retains the historical cadence when the scheduled older scope can run',async()=>{
  const db=storage(),fetcher=vi.fn(async(_url:string,init?:RequestInit)=>rows(init)),sync=collector(db,fetcher);
  db.map.set('gsc:tick-count',3);
  expect(await sync.tick(start)).toMatchObject({status:'complete',day:'2026-10-21',scope:'page',rows:1});
  expect(db.map.has('gsc:daily:2026-10-28:page')).toBe(false);expect(fetcher).toHaveBeenCalledTimes(1);
 });
 it('collects the next day automatically and retains verified previous generations',async()=>{
  const db=storage(),fetcher=vi.fn(async(_url:string,init?:RequestInit)=>rows(init)),sync=collector(db,fetcher);
  await sync.tick(start);await sync.tick(start);
  const oldPage=await db.get('gsc:daily:2026-10-28:page'),oldQuery=await db.get('gsc:daily:2026-10-28:query');
  expect(await sync.tick(later(1440))).toMatchObject({status:'complete',day:'2026-10-29',scope:'page',rows:1,d1_requests:0});
  expect(await db.get('gsc:daily:2026-10-28:page')).toEqual(oldPage);
  expect(await db.get('gsc:daily:2026-10-28:query')).toEqual(oldQuery);
  expect([...db.map.keys()].filter(k=>k.startsWith('gsc:history:'))).toHaveLength(3);
  expect((await sync.status(later(1440))).coverage).toHaveLength(3);
 });
 it('fills a missing query scope before refreshing an expired page generation',async()=>{
  const db=storage(),fetcher=vi.fn(async(_url:string,init?:RequestInit)=>rows(init)),sync=collector(db,fetcher);
  await sync.tick(start);
  const page=db.map.get('gsc:daily:2026-10-28:page');page.captured_at='2026-10-29T00:00:00Z';db.map.set('gsc:daily:2026-10-28:page',page);
  expect(await sync.tick(start)).toMatchObject({status:'complete',scope:'query'});
  expect(db.map.get('gsc:daily:2026-10-28:page')).toEqual(page);
 });
 it('refreshes authorization once after 401 without persisting authorization data in diagnostics',async()=>{
  const db=storage(),token=vi.fn(async(force:boolean)=>force?'TEST refreshed access':'TEST expired access');
  const fetcher=vi.fn(async(_url:string,init?:RequestInit)=>fetcher.mock.calls.length===1?new Response('secret provider body',{status:401}):rows(init));
  expect(await collector(db,fetcher,token).tick(start)).toMatchObject({status:'complete',rows:1});
  expect(token.mock.calls).toEqual([[false],[true]]);expect(fetcher).toHaveBeenCalledTimes(2);
  expect(JSON.stringify([...db.map.values()])).not.toMatch(/TEST expired access|TEST refreshed access|secret provider body/);
 });
 it('resumes the staged cursor after 429 backoff and preserves the actual failure across held ticks',async()=>{
  const db=storage();let request=0;
  const fetcher=vi.fn(async(_url:string,init?:RequestInit)=>{request++;return request===1?rows(init,200):request===2?new Response('private body',{status:429}):rows(init);});
  const sync=collector(db,fetcher);
  expect(await sync.tick(start)).toMatchObject({status:'partial',cursor:200});
  expect(await sync.tick(later(15))).toMatchObject({status:'held',code:'GSC_HTTP_429'});
  expect(await sync.tick(later(30))).toMatchObject({status:'held',code:'GSC_RETRY_BACKOFF'});
  expect(fetcher).toHaveBeenCalledTimes(2);
  expect((await sync.status(later(30))).last_failure).toMatchObject({code:'GSC_HTTP_429',cursor:200});
  expect(await sync.tick(later(75))).toMatchObject({status:'complete',rows:201,query_partial:false});
  expect(JSON.parse(String(fetcher.mock.calls[2][1]?.body)).startRow).toBe(200);
  expect(db.map.get('gsc:daily:2026-10-28:page').pages).toBe(2);
 });
 it('rejects a repeated identity on another API page and keeps an existing verified pointer',async()=>{
  const db=storage();let count=0;
  const fetcher=vi.fn(async(_url:string,init?:RequestInit)=>++count===1?rows(init,200):rows(init,1,0)),sync=collector(db,fetcher);
  await sync.tick(start);
  const previous={generation:'TEST prior complete generation'};db.map.set('gsc:daily:2026-10-28:page',previous);
  expect(await sync.tick(later(15))).toMatchObject({status:'held',code:'GSC_DUPLICATE_ROW'});
  expect(db.map.get('gsc:daily:2026-10-28:page')).toEqual(previous);
  expect(db.map.get('gsc:active')).toBeNull();
 });
 it('retains an incomplete marker from an earlier API page through finalization',async()=>{
  const db=storage();let count=0;
  const fetcher=vi.fn(async(_url:string,init?:RequestInit)=>++count===1?rows(init,200,0,true):rows(init,0)),sync=collector(db,fetcher);
  await sync.tick(start);
  expect(await sync.tick(later(15))).toMatchObject({status:'complete',rows:200,query_partial:true});
  expect(db.map.get('gsc:daily:2026-10-28:page').query_partial).toBe(true);
 });
 it('holds failed chunk writes without replacing the prior complete proof and can retry later',async()=>{
  const db=storage(),put=db.put;let fail=true;
  db.map.set('gsc:active',{day:'2026-10-28',scope:'page',generation:crypto.randomUUID(),cursor:0,pages:[],started_at:start.toISOString(),attempts:0,incomplete:false});
  const previous={generation:'TEST prior generation'};db.map.set('gsc:daily:2026-10-28:page',previous);
  db.put=async(key,value)=>{if(fail&&key.startsWith('gsc:part:'))throw Error('TEST private storage failure');return put(key,value);};
  const sync=collector(db,vi.fn(async(_url:string,init?:RequestInit)=>rows(init)));
  expect(await sync.tick(start)).toMatchObject({status:'held',code:'GSC_STORAGE_UNAVAILABLE'});
  expect((await sync.status(start)).last_failure).toMatchObject({phase:'storage',code:'GSC_STORAGE_UNAVAILABLE'});
  expect(db.map.get('gsc:daily:2026-10-28:page')).toEqual(previous);
  expect(db.map.get('gsc:active').cursor).toBe(0);
  expect(JSON.stringify([...db.map.values()])).not.toContain('private storage failure');
  fail=false;expect(await sync.tick(later(60))).toMatchObject({status:'complete',rows:1});
 });
 it('stops oversized streamed responses before any chunks or growth reservation are written',async()=>{
  const db=storage();let cancelled=false;
  const body=new ReadableStream<Uint8Array>({pull(controller){controller.enqueue(new Uint8Array(200000));},cancel(){cancelled=true;}});
  const sync=collector(db,vi.fn(async()=>new Response(body)));
  expect(await sync.tick(start)).toMatchObject({status:'held',code:'GSC_RESPONSE_BYTES_LIMIT'});
  expect(cancelled).toBe(true);
  expect([...db.map.keys()].some(k=>k.startsWith('gsc:part:'))).toBe(false);
  expect(db.map.has('gsc:storage-budget:v1')).toBe(false);
 });
 it('retries an interrupted final pointer publication without refetching or overwriting verified history',async()=>{
  const db=storage(),put=db.put;let fail=true,historyWrites=0;
  db.put=async(key,value)=>{
   if(key.startsWith('gsc:history:'))historyWrites++;
   if(fail&&key==='gsc:daily:2026-10-28:page')throw Error('TEST interrupted pointer write');
   return put(key,value);
  };
  const fetcher=vi.fn(async(_url:string,init?:RequestInit)=>rows(init)),sync=collector(db,fetcher);
  expect(await sync.tick(start)).toMatchObject({status:'held',code:'GSC_PUBLICATION_UNAVAILABLE'});
  expect((await sync.status(start)).last_failure).toMatchObject({phase:'publication',code:'GSC_PUBLICATION_UNAVAILABLE'});
  const history=[...db.map.entries()].find(([key])=>key.startsWith('gsc:history:'))!;
  expect(db.map.get('gsc:active')).toMatchObject({ready:true,cursor:1});
  fail=false;expect(await sync.tick(later(60))).toMatchObject({status:'complete',rows:1});
  expect(fetcher).toHaveBeenCalledTimes(1);expect(historyWrites).toBe(1);
  expect(db.map.get(history[0])).toEqual(history[1]);
  expect(db.map.get('gsc:daily:2026-10-28:page')).toEqual(history[1]);
 });
 it('excludes incomplete page manifests from complete coverage and refuses malformed metadata',async()=>{
  const db=storage(),sync=collector(db,vi.fn(async(_url:string,init?:RequestInit)=>rows(init,1,0,true)));
  await sync.tick(start);
  expect(await sync.status(start)).toMatchObject({coverage:[],incomplete_coverage:[{day:'2026-10-28',scope:'page'}]});
  const proof=db.map.get('gsc:daily:2026-10-28:page');proof.rows=999;db.map.set('gsc:daily:2026-10-28:page',proof);
  expect(await sync.status(start)).toMatchObject({coverage:[],invalid_manifests:[{day:'2026-10-28',scope:'page'}]});
 });
 it('reports persisted source-day holds separately from an idle attempt without exposing provider text',async()=>{
  const db=storage(),sync=collector(db,vi.fn(async(_url:string,init?:RequestInit)=>rows(init)));
  db.map.set('gsc:tick-count',12);db.map.set('gsc:backfill-index',2);
  db.map.set('gsc:last-attempt',{at:start.toISOString(),status:'idle'});
  db.map.set('gsc:held:2026-10-28:page',{until:later(1440).getTime(),code:'GSC_HTTP_400'});
  db.map.set('gsc:held:2026-10-19:query',{until:later(60).getTime(),code:'TEST provider private content'});
  const status=await sync.status(start);
  expect(status).toMatchObject({tick_count:12,backfill_index:2,last_attempt:{status:'idle'},held:[
   {day:'2026-10-28',scope:'page',code:'GSC_HTTP_400',active:true},
   {day:'2026-10-19',scope:'query',code:'GSC_SYNC_UNAVAILABLE',active:true},
  ]});
  expect(JSON.stringify(status)).not.toContain('TEST provider private content');
  expect(db.map.get('gsc:held:2026-10-28:page')).toMatchObject({code:'GSC_HTTP_400'});
 });
 it('resumes a daily growth hold on the next UTC day without deleting staged or historical records',async()=>{
  const db=storage(),fetcher=vi.fn(async(_url:string,init?:RequestInit)=>rows(init)),sync=collector(db,fetcher);
  db.map.set('gsc:storage-budget:v1',{version:1,measured_since:start.toISOString(),day:'2026-10-31',reserved_bytes:8*1024*1024,day_reserved_bytes:8*1024*1024});
  expect(await sync.tick(start)).toMatchObject({status:'held',code:'GSC_STORAGE_DAILY_LIMIT'});
  const active=db.map.get('gsc:active');
  expect(db.map.has('gsc:held:2026-10-28:page')).toBe(false);
  expect([...db.map.keys()].some(k=>k.startsWith('gsc:part:'))).toBe(false);
  expect(await sync.tick(later(1440))).toMatchObject({status:'complete',day:'2026-10-28',rows:1});
  expect(db.map.get('gsc:daily:2026-10-28:page').generation).toBe(active.generation);
  expect((await sync.status(later(1440))).storage_budget).toMatchObject({account_usage_measured:false,prior_usage_included:false,total_limit_bytes:128*1024*1024});
 });
 it.each(['measured','physical'])('holds before chunk writes when the %s storage cap has been reached',async kind=>{
  const db=storage();
  if(kind==='measured')db.map.set('gsc:storage-budget:v1',{version:1,measured_since:start.toISOString(),day:'2026-10-31',reserved_bytes:128*1024*1024,day_reserved_bytes:0});
  else Object.assign(db,{sql:{databaseSize:256*1024*1024}});
  expect(await collector(db,vi.fn(async(_url:string,init?:RequestInit)=>rows(init))).tick(start)).toMatchObject({status:'held',code:kind==='measured'?'GSC_STORAGE_TOTAL_LIMIT':'GSC_STORAGE_OBJECT_LIMIT'});
  expect([...db.map.keys()].some(k=>k.startsWith('gsc:part:'))).toBe(false);
  expect(db.map.get('gsc:active').cursor).toBe(0);
 });
 it('rebuilds an older in-flight identity index without a Google request or a data deletion',async()=>{
  const db=storage();let count=0;
  const fetcher=vi.fn(async(_url:string,init?:RequestInit)=>++count===1?rows(init,200):rows(init)),sync=collector(db,fetcher);
  await sync.tick(start);
  const old=db.map.get('gsc:active');delete old.incomplete;db.map.set('gsc:active',old);
  for(const key of db.map.keys())if(key.startsWith('gsc:seen:'))db.map.delete(key);
  expect(await sync.tick(later(15))).toMatchObject({status:'partial',code:'GSC_IDENTITY_INDEX_BUILDING',cursor:200});
  expect(fetcher).toHaveBeenCalledTimes(1);
  expect(await sync.tick(later(30))).toMatchObject({status:'complete',rows:201,query_partial:true});
  expect([...db.map.values()].every(v=>new TextEncoder().encode(JSON.stringify(v)).length<128*1024)).toBe(true);
 });
});
