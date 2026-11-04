import {describe,it,expect,vi} from 'vitest';
import {buildIndependentContext,readIndependentContext,saveIndependentContext,independentContextStatus,answerContextQuestion,validateIndependentContext} from '../src/independent-context';
import {independentContextCron,CONTEXT_PRODUCTS_SQL,CONTEXT_SNAPSHOTS_SQL,CONTEXT_CHANGES_SQL} from '../src/independent-context-bridge';
import type {Env} from '../src/types';

const time=new Date('2026-11-04T00:15:00Z'),page='https://mavibasim.com/verified-page';
const crawl=(id:string,date:string,title:string)=>({id,url:page,observed_at:date,content_hash:'a'.repeat(64),title,
 headings_json:JSON.stringify([{level:1,text:title},{level:2,text:'Alt başlık'}]),body_hash:'b'.repeat(64),status:200});
const before=crawl('crawl-before','2026-09-20T03:00:00Z','Önce'),after=crawl('crawl-after','2026-10-08T04:00:00Z','Sonra');
function input(publication_evidence:unknown=null,published_at:unknown=null){
 return {captured_at:time.toISOString(),products:[{id:'brosur',name:'Broşür',canonical_url:page,url_verified_at:'2026-09-19T03:00:00Z'},
  {id:'magnet',name:'Magnet',canonical_url:'https://mavibasim.com/magnet',url_verified_at:null}],snapshots:[before,after],
  changes:[{id:'change-1',url:page,previous_snapshot_id:before.id,next_snapshot_id:after.id,observed_from:before.observed_at,observed_to:after.observed_at,
   published_at,publication_evidence,changed_fields_json:'["title","headings"]',before_json:JSON.stringify(before),after_json:JSON.stringify(after)}]};
}
function memory(){
 const data=new Map<string,unknown>();
 return {data,storage:{get:async<T>(key:string)=>data.get(key) as T|undefined,put:async(key:string,value:unknown)=>{data.set(key,structuredClone(value));}}};
}
describe('independent verified mapping and crawl context',()=>{
 it('retains explicit verified URL mapping and real before/after bounds without inventing a publication date',async()=>{
  const context=await buildIndependentContext(input('a note is not a deploy log','2026-10-01T00:00:00Z'),time);
  expect(context.products).toEqual([{id:'brosur',name:'Broşür',canonical_url:page,url_verified_at:'2026-09-19T03:00:00.000Z'}]);
  expect(context.products[0].canonical_url).not.toBe('https://mavibasim.com/brosur');
  expect(context.coverage.unverified_products).toBe(1);
  expect(await validateIndependentContext(context,time)).toEqual(context);
  await expect(validateIndependentContext({...context,source_hash:'0'.repeat(64)},time)).rejects.toThrow('INDEPENDENT_CONTEXT_INVALID');
  expect(context.changes[0]).toMatchObject({observed_from:'2026-09-20T03:00:00.000Z',observed_to:'2026-10-08T04:00:00.000Z',published_at:null,publication_evidence:null,
   before:{title:'Önce',h1:['Önce']},after:{title:'Sonra',h1:['Sonra']}});
  const proven=await buildIndependentContext(input(JSON.stringify({verified:true,source:'deploy_log',ref:'deploy/42'}),'2026-10-01T12:00:00Z'),time);
  expect(proven.changes[0].published_at).toBe('2026-10-01T12:00:00.000Z');
  const answer=answerContextQuestion(context,'Broşür değişiklik geçmişi','2026-10');
  expect(answer.evidence_refs[0]).toMatchObject({event_id:'change-1',published_at:null,observed_interval:{from:'2026-09-20T03:00:00.000Z',to:'2026-10-08T04:00:00.000Z'},
   before:{id:'crawl-before',title:'Önce',h1:['Önce']},after:{id:'crawl-after',title:'Sonra',h1:['Sonra']}});
  expect(answer.decision).toBe('Veri bekle');
  expect(answerContextQuestion(proven,'Broşür değişiklik geçmişi','2026-10').evidence_refs[0].published_at).toBe('2026-10-01T12:00:00.000Z');
 });
 it('never equates missing event evidence with no change, or guesses an unknown URL mapping',async()=>{
  const context=await buildIndependentContext(input(),time);
  const missing=answerContextQuestion(context,'Broşür değişiklik geçmişi','2026-08');
  expect(missing.available).toBe(false);expect(missing.answer).toContain('değişiklik yapılmadığını kanıtlamaz');
  expect(answerContextQuestion(null,'Broşür değişiklik geçmişi','2026-10').available).toBe(false);
  expect(answerContextQuestion(context,'https://mavibasim.com/brosur değişiklik geçmişi','2026-10').evidence).toEqual([]);
  expect(answerContextQuestion(context,'Site genel değişiklik geçmişi','2026-10').evidence).toHaveLength(1);
 });
 it('rejects ambiguous mappings and quarantines changes with mismatched source snapshots',async()=>{
  const rows=input();rows.products[1]={...rows.products[0],id:'another'};
  await expect(buildIndependentContext(rows,time)).rejects.toThrow('INDEPENDENT_CONTEXT_INVALID');
  const bad=input();bad.changes[0].next_snapshot_id='unrelated';
  const context=await buildIndependentContext(bad,time);
  expect(context.changes).toEqual([]);expect(context.coverage.quarantined_records).toBe(1);
 });
 it('publishes only readback-verified contexts, retains old history and detects corrupted chunks',async()=>{
  const {data,storage}=memory(),first=await buildIndependentContext(input(),time);
  await saveIndependentContext(storage,first);
  expect(await readIndependentContext(storage)).toEqual(first);
  expect(await independentContextStatus(storage)).toMatchObject({available:true,source_hash:first.source_hash,d1_requests:0});
  const nextInput=input();nextInput.captured_at='2026-11-04T06:15:00Z';
  const next=await buildIndependentContext(nextInput,new Date(nextInput.captured_at));
  const failing={...storage,put:async(key:string,value:unknown)=>{if(key.includes('part:'+next.source_hash))throw Error('STORAGE_FAILURE');await storage.put(key,value);}};
  await expect(saveIndependentContext(failing,next)).rejects.toThrow('STORAGE_FAILURE');
  expect(await readIndependentContext(storage)).toEqual(first);
  await saveIndependentContext(storage,next);
  expect(data.has('independent:context:history:'+first.source_hash)).toBe(true);
  expect(data.has('independent:context:history:'+next.source_hash)).toBe(true);
  data.set('independent:context:part:'+next.source_hash+':0',btoa('corrupt'));
  await expect(readIndependentContext(storage)).rejects.toThrow('INDEPENDENT_CONTEXT_INVALID');
 });
});

function bridgeEnv(status:unknown){
 const rows=input(),sqls:string[]=[],requests:string[]=[];
 const db={prepare:(sql:string)=>{
  sqls.push(sql);const statement={bind:()=>statement,all:async()=>({results:sql===CONTEXT_PRODUCTS_SQL?rows.products:sql===CONTEXT_SNAPSHOTS_SQL?rows.snapshots:sql===CONTEXT_CHANGES_SQL?rows.changes:[]})};return statement;
 }} as unknown as D1Database;
 const fetch=vi.fn(async(request:RequestInfo|URL,init?:RequestInit)=>{
  requests.push(String(request));
  if(init?.method==='GET')return Response.json(status);
  const context=JSON.parse(String(init?.body));return Response.json({ok:true,source_hash:context.source_hash,captured_at:context.captured_at,d1_requests:0});
 });
 return {env:{DB:db,AUTOMATION_ENABLED:'true',DRIVE_ARCHIVE_SERVICE:{fetch}} as unknown as Env&{DRIVE_ARCHIVE_SERVICE:Fetcher},sqls,requests,fetch};
}
describe('bounded context bridge independent of GSC collection',()=>{
 it('copies only metadata with three read-only source queries and verifies private readback proof',async()=>{
  const fixture=bridgeEnv({available:false,captured_at:null,d1_requests:0});
  expect(await independentContextCron(fixture.env,time)).toBe('updated');
  expect(fixture.sqls).toEqual([CONTEXT_PRODUCTS_SQL,CONTEXT_SNAPSHOTS_SQL,CONTEXT_CHANGES_SQL]);
  expect(fixture.sqls.every(sql=>/^SELECT\b/.test(sql))).toBe(true);
  expect(fixture.requests.every(url=>url==='https://archive.private/api/internal/evidence-context')).toBe(true);
 });
 it('avoids D1 for fresh cache and for existing stale cache outside its daily slot',async()=>{
  for(const [status,now] of [
   [{available:true,captured_at:time.toISOString(),d1_requests:0},time],
   [{available:true,captured_at:'2026-11-03T00:15:00Z',d1_requests:0},new Date('2026-11-04T06:15:00Z')],
  ] as const){
   const fixture=bridgeEnv(status);expect(await independentContextCron(fixture.env,now)).toBe('idle');expect(fixture.sqls).toEqual([]);
  }
 });
 it('returns held instead of throwing when source budget/access fails and never publishes an unverified cache',async()=>{
  const fixture=bridgeEnv({available:false,d1_requests:0});
  fixture.env.DB.prepare=()=>{throw Error('D1_READ_BUDGET_WAIT');};
  expect(await independentContextCron(fixture.env,time)).toBe('held');expect(fixture.fetch).toHaveBeenCalledTimes(1);
  const absent=bridgeEnv({available:false,d1_requests:0});
  expect(await independentContextCron(absent.env,new Date('2026-11-04T06:15:00Z'))).toBe('updated');
 });
});

it('retries absent metadata on a natural quarter-hour and preserves daily freshness limits',async()=>{
 const missing=bridgeEnv({available:false,d1_requests:0});
 expect(await independentContextCron(missing.env,new Date('2026-11-04T14:07:33Z'))).toBe('idle');expect(missing.sqls).toEqual([]);
 expect(await independentContextCron(missing.env,new Date('2026-11-04T14:30:00Z'))).toBe('updated');
 const context=JSON.parse(String(missing.fetch.mock.calls.at(-1)![1]!.body));expect(context.captured_at).toBe('2026-11-04T14:30:00.000Z');
 const existing=bridgeEnv({available:true,captured_at:'2026-11-03T00:15:00Z',d1_requests:0});
 expect(await independentContextCron(existing.env,new Date('2026-11-04T14:30:00Z'))).toBe('idle');expect(existing.sqls).toEqual([]);
});
