import {afterEach,describe,expect,it,vi} from 'vitest';
import probe from '../scripts/gsc_pipeline_probe';

const key='fixture-pipeline-key';
const secret='refresh_token=NEVER_EXPORT_SOURCE';
const status=(extra:Record<string,unknown>={})=>({connected:true,reauthorization_required:false,coverage:[],last_attempt:null,pending:null,d1_requests:0,...extra});
const hold=(extra:Record<string,unknown>={})=>({day:'2026-11-01',scope:'page',until:'2026-11-05T00:00:00.000Z',code:'GSC_HTTP_400',active:true,...extra});
const coverage=(extra:Record<string,unknown>={})=>({day:'2026-11-01',scope:'page',rows:2,captured_at:'2026-11-04T00:00:00Z',query_partial:false,...extra});
const request=(mode='status',body?:unknown,method='POST',auth=true)=>new Request('https://probe.private/?mode='+mode,{method,headers:auth?{Authorization:'Bearer '+key}:{},body:body===undefined?undefined:JSON.stringify(body)});
const env=(fetch:any)=>({ARCHIVE:{fetch} as any,PROBE_KEY:key});
const json=(response:Response)=>response.json<any>();
afterEach(()=>vi.useRealTimers());

describe('private bounded GSC pipeline probe',()=>{
 it('authenticates every mode and method before making service calls',async()=>{
  const fetch=vi.fn();
  for(const mode of ['status','recover','collect','readback','diagnostic','unknown'])for(const method of ['GET','POST','DELETE']){
   const result=await probe.fetch(request(mode,undefined,method,false),env(fetch));
   expect(result.status).toBe(401);expect(await json(result)).toMatchObject({ok:false,mode:null,status:null,d1_requests:0,code:'GSC_PIPELINE_UNAUTHORIZED'});
  }
  expect((await probe.fetch(request(),{...env(fetch),PROBE_KEY:''})).status).toBe(401);
  expect(fetch).not.toHaveBeenCalled();
 });
 it('rejects method, query, JSON, field and tick bounds before service calls',async()=>{
  const fetch=vi.fn();
  const bad=[request('recover',undefined,'GET'),request('unknown'),request('status&mode=collect'),request('status&secret=x'),request('collect'),request('collect',{ticks:0}),request('collect',{ticks:5}),request('collect',{ticks:'1'}),request('collect',{ticks:true}),request('collect',{ticks:1.5}),request('collect',{ticks:1,source:'cloudflare-cron'}),request('recover',{day:'2026-11-01'}),request('status',[]),request('readback',null),request('readback',{index:14}),request('readback',{index:true}),request('readback',{index:0,raw:'x'})];
  bad.push(new Request('https://probe.private/?mode=status',{method:'POST',headers:{Authorization:'Bearer '+key},body:'{'}));
  bad.push(new Request('https://probe.private/?mode=status',{method:'POST',headers:{Authorization:'Bearer '+key},body:' '.repeat(4097)}));
  for(const r of bad)expect((await probe.fetch(r,env(fetch))).status).toBeGreaterThanOrEqual(400);
  expect(fetch).not.toHaveBeenCalled();
 });
 it('returns only safe status metadata and supports GET status',async()=>{
  const fetch=vi.fn(async()=>Response.json(status({held:[{...hold(),body:secret}],refresh_token:secret,raw_queries:[secret]})));
  const response=await probe.fetch(request('status',undefined,'GET'),env(fetch)),r=await json(response);
  expect(response.status).toBe(200);expect(r).toMatchObject({ok:true,mode:'status',status:{held:[hold()]},d1_requests:0});
  expect(fetch).toHaveBeenCalledTimes(1);expect(JSON.stringify(r)).not.toContain(secret);
  expect(Object.keys(r).sort()).toEqual(['d1_requests','mode','observed_at','ok','status']);
 });
 it('runs one isolated diagnostic and forwards only safe event metadata',async()=>{
  const receipt={at:'2026-11-04T12:00:00.000Z',revision:'daily-proof-v2',status:'partial',ok:true,day:'2026-11-01',scope:'page',rows:2,cursor:2,d1_requests:0,
   last_failure:{at:'2026-11-04T11:59:00Z',status:'held',day:'2026-11-01',scope:'page',code:'GSC_SYNC_UNAVAILABLE',validation_reason:'COUNTRY',body:secret,phase:secret},body:secret,raw_queries:[secret]};
  const fetch=vi.fn(async(url:string,init?:RequestInit)=>{
   if(url.endsWith('gsc-diagnostic')){expect(init).toEqual({method:'POST'});return Response.json(receipt);}
   return Response.json(status({held:[hold()]}));
  });
  const r=await json(await probe.fetch(request('diagnostic'),env(fetch)));
  expect(r).toMatchObject({ok:true,mode:'diagnostic',diagnostic:{at:receipt.at,revision:'daily-proof-v2',status:'partial',ok:true,rows:2,last_failure:{code:'GSC_SYNC_UNAVAILABLE',validation_reason:'COUNTRY'},d1_requests:0}});
  expect(Object.keys(r.diagnostic).sort()).toEqual(['at','cursor','d1_requests','day','last_failure','ok','revision','rows','scope','status']);
  expect(JSON.stringify(r)).not.toContain(secret);expect(fetch).toHaveBeenCalledTimes(3);
 });
 it('rejects unsafe diagnostic revisions, timestamps, counters, codes and failure events',async()=>{
  const good={at:'2026-11-04T12:00:00.000Z',revision:'daily-proof-v2',status:'complete',ok:true,day:'2026-11-01',scope:'page',rows:2,cursor:2,d1_requests:0};
  for(const extra of [{revision:'previous'},{at:'yesterday'},{at:'2026-02-30T12:00:00.000Z'},{status:secret},{ok:1},{day:'2026-02-30'},{scope:'city'},{rows:'2'},{cursor:-1},{code:secret},{d1_requests:1},{last_failure:{at:secret,status:'held'}}]){
   const fetch=vi.fn(async(url:string)=>Response.json(url.endsWith('gsc-diagnostic')?{...good,...extra}:status()));
   const r=await json(await probe.fetch(request('diagnostic'),env(fetch)));
   expect(r).toMatchObject({ok:false,code:'GSC_PIPELINE_DIAGNOSTIC_INVALID'});expect(r.diagnostic).toBeUndefined();expect(JSON.stringify(r)).not.toContain(secret);expect(fetch).toHaveBeenCalledTimes(2);
  }
  const fetch=vi.fn();
  expect((await probe.fetch(request('diagnostic',undefined,'GET'),env(fetch))).status).toBe(405);
  expect((await probe.fetch(request('diagnostic',{source:'cloudflare-cron'}),env(fetch))).status).toBe(400);expect(fetch).not.toHaveBeenCalled();
 });
 it('reports a valid unsuccessful diagnostic without claiming the collector passed',async()=>{
  const fetch=vi.fn(async(url:string)=>Response.json(url.endsWith('gsc-diagnostic')?{at:'2026-11-04T12:00:00.000Z',revision:'daily-proof-v2',status:'held',ok:false,code:'GSC_TOKEN_STORAGE_UNREADABLE',d1_requests:0}:status()));
  const r=await json(await probe.fetch(request('diagnostic'),env(fetch)));
  expect(r).toMatchObject({ok:true,diagnostic:{ok:false,status:'held',code:'GSC_TOKEN_STORAGE_UNREADABLE'}});
 });
 it('recovers only active safe recent holds using the exact immutable hold metadata',async()=>{
  vi.useFakeTimers();vi.setSystemTime(new Date('2026-11-04T12:00:00Z'));
  const holds=[hold(),hold({day:'2026-10-26',scope:'query',code:'GSC_ROW_REJECTED'}),hold({day:'2026-10-25'}),hold({day:'2026-11-02'}),hold({code:'GSC_HTTP_429'}),hold({code:'GSC_OAUTH_RECONNECT_REQUIRED'}),hold({active:false})];
  const fetch=vi.fn(async(url:string,init?:RequestInit)=>{
   if(url.endsWith('gsc-retry')){
    const value=JSON.parse(init!.body as string);
    expect(Object.keys(value).sort()).toEqual(['code','day','scope','until']);expect(init!.method).toBe('POST');
    return Response.json({released:true,day:value.day,scope:value.scope,code:value.code,previous_until:value.until,released_at:new Date().toISOString(),reason:'tested_collector_upgrade',d1_requests:0,body:secret});
   }
   return Response.json(status({held:holds}));
  });
  const r=await json(await probe.fetch(request('recover',{}),env(fetch)));
  expect(r).toMatchObject({ok:true,recovery_candidates:1,released_scopes:1});expect(r.recoveries).toHaveLength(1);
  expect(r.recoveries.map((h:any)=>h.day)).toEqual(['2026-11-01']);expect(fetch).toHaveBeenCalledTimes(3);
  expect(JSON.stringify(r)).not.toContain(secret);
 });
 it('never retries more than 16, duplicate or expired candidate holds',async()=>{
  vi.useFakeTimers();vi.setSystemTime(new Date('2026-11-04T12:00:00Z'));
  for(const held of [Array.from({length:17},()=>hold()),[hold(),hold()],[hold({until:'2026-11-03T00:00:00Z'})]]){
   const fetch=vi.fn(async()=>Response.json(status({held})));
   const r=await json(await probe.fetch(request('recover'),env(fetch)));
   expect(r).toMatchObject({ok:false,code:'GSC_PIPELINE_RECOVERY_SOURCE_INVALID'});expect(fetch).toHaveBeenCalledTimes(1);
  }
 });
 it('submits generic holds through private recovery and respects its diagnostic guard',async()=>{
  vi.useFakeTimers();vi.setSystemTime(new Date('2026-11-04T12:00:00Z'));
  for(const allowed of [true,false]){
   const fetch=vi.fn(async(url:string,init?:RequestInit)=>{
    if(url.endsWith('gsc-retry')){
     const value=JSON.parse(init!.body as string);expect(value.code).toBe('GSC_SYNC_UNAVAILABLE');
     return allowed?Response.json({released:false,reason:'already_retried',d1_requests:0}):Response.json({code:'GSC_RECOVERY_DIAGNOSTIC_REQUIRED',body:secret},{status:400});
    }
    return Response.json(status({held:[hold({code:'GSC_SYNC_UNAVAILABLE'})]}));
   });
   const r=await json(await probe.fetch(request('recover'),env(fetch)));
   expect(r.ok).toBe(allowed);expect(JSON.stringify(r)).not.toContain(secret);
   if(!allowed)expect(r.code).toBe('GSC_RECOVERY_DIAGNOSTIC_REQUIRED');
  }
 });
 it('accepts already-retried receipts and rejects mismatched recovery metadata',async()=>{
  vi.useFakeTimers();vi.setSystemTime(new Date('2026-11-04T12:00:00Z'));
  for(const reply of [{released:false,reason:'already_retried',d1_requests:0},{released:true,day:'2026-11-01',scope:'query',code:'GSC_HTTP_400',previous_until:hold().until,released_at:new Date().toISOString(),reason:'tested_collector_upgrade',d1_requests:0}]){
   const fetch=vi.fn(async(url:string)=>Response.json(url.endsWith('gsc-retry')?reply:status({held:[hold()]})));
   const r=await json(await probe.fetch(request('recover'),env(fetch)));
   expect(r.ok).toBe(reply.released===false);
   if(r.ok)expect(r.recoveries).toEqual([{day:hold().day,scope:'page',code:'GSC_HTTP_400',until:hold().until,released:false,reason:'already_retried'}]);
   else expect(r.code).toBe('GSC_PIPELINE_RECOVERY_INVALID');
  }
 });
 it('bounds collection to four ticks and stops on held or idle without writing Cron source',async()=>{
  for(const stop of ['held','idle','complete']){
   let ticks=0;
   const fetch=vi.fn(async(url:string,init?:RequestInit)=>{
    if(url.endsWith('gsc-tick')){ticks++;expect(init).toEqual({method:'POST'});return Response.json({status:ticks===2?stop:'partial',day:'2026-11-01',scope:'page',rows:2,cursor:2,d1_requests:0,query:secret});}
    return Response.json(status());
   });
   const r=await json(await probe.fetch(request('collect',{ticks:4}),env(fetch)));
   expect(r.ok).toBe(true);expect(r.manual_ticks).toBe(stop==='complete'?4:2);expect(r.attempts).toHaveLength(r.manual_ticks);
   expect(JSON.stringify(r)).not.toContain(secret);expect(fetch).toHaveBeenCalledTimes(r.manual_ticks+2);
  }
 });
 it('rejects malformed tick metadata and never returns provider errors or exception text',async()=>{
  for(const reply of [{status:'partial',rows:'2',d1_requests:0},{status:secret,d1_requests:0},{status:'complete',d1_requests:1},{status:'held',code:secret,d1_requests:0}]){
   const fetch=vi.fn(async(url:string)=>Response.json(url.endsWith('gsc-tick')?reply:status()));
   const r=await json(await probe.fetch(request('collect',{ticks:4}),env(fetch)));
   expect(r).toMatchObject({ok:false,code:'GSC_PIPELINE_TICK_INVALID'});expect(fetch).toHaveBeenCalledTimes(2);expect(JSON.stringify(r)).not.toContain(secret);
  }
  for(const fetch of [async()=>{throw Error(secret);},async()=>new Response(secret,{status:429}),async()=>Response.json(status({held:[{body:secret}]}))]){
   const r=await json(await probe.fetch(request(),env(fetch)));expect(r.ok).toBe(false);expect(r.code).toMatch(/^GSC_/);expect(JSON.stringify(r)).not.toContain(secret);
  }
 });
 it('verifies every covered scope by exact metadata without exporting rows or tokens',async()=>{
  const items=[coverage(),coverage({scope:'query',rows:0})];
  const fetch=vi.fn(async(url:string)=>{
   if(url.includes('gsc-proof?')){const u=new URL(url),item=items.find(i=>i.scope===u.searchParams.get('scope'))!;
    return Response.json({available:true,verified:true,day:item.day,scope:item.scope,rows:item.rows,pages:item.rows?1:0,d1_requests:0,data:[secret],refresh_token:secret});}
   return Response.json(status({coverage:items}));
  });
  const r=await json(await probe.fetch(request('readback',{index:0}),env(fetch)));
  expect(r).toMatchObject({ok:true,content_verified_scopes:1,nonempty_content_scopes:1});expect(r.readbacks).toHaveLength(1);expect(fetch).toHaveBeenCalledTimes(2);
  expect(Object.keys(r.readbacks[0]).sort()).toEqual(['available','d1_requests','day','pages','rows','scope','verified']);expect(JSON.stringify(r)).not.toContain(secret);
 });
 it('rejects unavailable or mismatched proof metadata rather than claiming verification',async()=>{
  const good={available:true,verified:true,day:'2026-11-01',scope:'page',rows:2,pages:1,d1_requests:0};
  for(const bad of [{available:false},{verified:false},{day:'2026-10-31'},{scope:'query'},{rows:3},{pages:0},{pages:'1'},{d1_requests:1}]){
   const fetch=vi.fn(async(url:string)=>Response.json(url.includes('gsc-proof?')?{...good,...bad}:status({coverage:[coverage()]})));
   const r=await json(await probe.fetch(request('readback',{index:0}),env(fetch)));
   expect(r).toMatchObject({ok:false,code:'GSC_PIPELINE_PROOF_INVALID'});expect(r.content_verified_scopes).toBeUndefined();expect(r.readbacks).toBeUndefined();
  }
 });
});
