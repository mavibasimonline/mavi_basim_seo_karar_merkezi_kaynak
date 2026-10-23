import {beforeEach,it,expect} from 'vitest';
import {init,env,connected,enqueue,fetcher} from './helpers';
import {claimJob,processJob,enqueueDaily} from '../src/sync';
import {fetchGsc,fetchGa4,fetchKeywordPlanner,PAGE_SIZE,validateGscRow} from '../src/providers';

beforeEach(init);
const rawRow=(i=0)=>({keys:['2026-09-01',`https://mavibasim.com/page-${i}`,'tur','MOBILE'],clicks:1,impressions:10,ctr:0.1,position:2});
it('stages pagination and activates only a completed authoritative dataset',async()=>{
  const cfg=await connected();await enqueue();
  const job=await claimJob(cfg);expect(job).toBeTruthy();
  await processJob(cfg,job!,fetcher(async()=>Response.json({responseAggregationType:'byPage',rows:Array.from({length:PAGE_SIZE},(_,i)=>rawRow(i))})));
  expect(await env.DB.prepare('SELECT * FROM dataset_coverage').first()).toBeNull();
  const next=await claimJob(cfg);expect(next?.cursor).toBe(PAGE_SIZE);
  await processJob(cfg,next!,fetcher(async()=>Response.json({responseAggregationType:'byPage',rows:[]})));
  const coverage=await env.DB.prepare('SELECT * FROM dataset_coverage').first<{row_count:number;complete:number}>();
  expect(coverage?.row_count).toBe(PAGE_SIZE);expect(coverage?.complete).toBe(1);
  expect(await claimJob(cfg)).toBeNull();
});
it('retries quotas with backoff and resumes the same generation',async()=>{
  const cfg=await connected();await enqueue();const job=(await claimJob(cfg))!;
  await processJob(cfg,job,fetcher(async()=>new Response('',{status:429,headers:{'Retry-After':'120'}})));
  const saved=await env.DB.prepare('SELECT * FROM sync_jobs').first<{status:string;generation:string;cursor:number;next_attempt_at:string}>();
  expect(saved?.status).toBe('retry');expect(saved?.generation).toBe(job.generation);expect(saved?.cursor).toBe(0);
  expect(Date.parse(saved!.next_attempt_at)-Date.now()).toBeGreaterThan(119_000);
  expect(await claimJob(cfg)).toBeNull();
  expect((await env.DB.prepare('SELECT code FROM sync_errors').first<{code:string}>())?.code).toBe('GOOGLE_HTTP_429');
});
it('blocks malformed Google metrics and preserves the last valid dataset',async()=>{
  const cfg=await connected();await enqueue();const job=(await claimJob(cfg))!;
  await processJob(cfg,job,fetcher(async()=>Response.json({responseAggregationType:'byPage',rows:[{...rawRow(),clicks:100,impressions:10}]})));
  expect((await env.DB.prepare('SELECT status,error_code FROM sync_jobs').first())).toMatchObject({status:'blocked',error_code:'INVALID_GSC_ROW'});
  expect(await env.DB.prepare('SELECT * FROM dataset_coverage').first()).toBeNull();
});
it('marks incomplete or sampled data unusable and does not merge page/query dimensions',async()=>{
  const cfg=await connected();
  const page=await fetchGsc(cfg,'2026-09-01','page',0,fetcher(async()=>Response.json({responseAggregationType:'byPage',metadata:{first_incomplete_date:'2026-09-01'},rows:[rawRow()]})));
  expect(page.complete).toBe(false);
  expect(()=>validateGscRow({date:'2026-09-01',page:'https://mavibasim.com/brosur',country:'tur',device:'MOBILE',clicks:1,impressions:10,ctr:0.2,position:3},'2026-09-01')).toThrow('INVALID_GSC_ROW');
});
it('checks GA4 dimensions and keeps city sessions separate from query traffic',async()=>{
  const cfg=await connected({GA4_PROPERTY_ID:'123'});
  const reply=await fetchGa4(cfg,'2026-09-01',0,fetcher(async(_url,init)=>{
    const request=JSON.parse(init!.body as string);expect(request.dimensionFilter.filter.stringFilter.value).toBe('Organic Search');
    return Response.json({dimensionHeaders:['date','landingPagePlusQueryString','country','city','deviceCategory'].map(name=>({name})),metricHeaders:['sessions','engagedSessions'].map(name=>({name})),rowCount:1,metadata:{subjectToThresholding:true,timeZone:'Europe/Istanbul'},rows:[{dimensionValues:['20260901','/brosur','Türkiye','İstanbul','mobile'].map(value=>({value})),metricValues:[{value:'10'},{value:'8'}]}]});
  }));
  expect(reply.complete).toBe(false);expect(reply.rows[0]).toMatchObject({sessions:10,engaged_sessions:8,key_events:null});
});
it('deduplicates daily/backfill jobs and records missing connection honestly',async()=>{
  await enqueueDaily(env,new Date('2026-10-23T00:00:00Z'));
  expect((await env.DB.prepare('SELECT status,code FROM health_checks').first())).toMatchObject({status:'blocked',code:'GOOGLE_NOT_CONNECTED'});
  await connected();
  expect(await enqueueDaily(env,new Date('2026-10-24T00:00:00Z'))).toBe(true);
  expect(await enqueueDaily(env,new Date('2026-10-24T01:00:00Z'))).toBe(false);
  expect((await env.DB.prepare('SELECT count(*) AS n FROM sync_jobs').first<{n:number}>())?.n).toBe(180);
});
it('requires actual optional Ads access before making any request',async()=>{
  let calls=0;await expect(fetchKeywordPlanner(env,['broşür'],fetcher(async()=>{calls++;return Response.json({});}))).rejects.toThrow('ADS_ACCESS_NOT_CONFIGURED');
  expect(calls).toBe(0);
});
