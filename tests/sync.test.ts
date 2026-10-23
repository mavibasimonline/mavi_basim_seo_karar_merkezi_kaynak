import {beforeEach,it,expect} from 'vitest';
import {init,env,connected,enqueue,fetcher} from './helpers';
import {claimJob,processJob,enqueueDaily} from '../src/sync';
import {fetchGsc,fetchGa4,fetchKeywordPlanner,PAGE_SIZE,validateGscRow} from '../src/providers';
import {accessToken,saveTokens,READ_SCOPES,requestJSON} from '../src/google';

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
it('refreshes expired OAuth tokens and never exposes the provider error body',async()=>{
  const cfg=await connected();await saveTokens(cfg,{access_token:'expired',refresh_token:'fixture-refresh',expires_at:0,scope:READ_SCOPES.join(' ')});
  const access=await accessToken(cfg,fetcher(async(url,init)=>{expect(url).toBe('https://oauth2.googleapis.com/token');expect(new URLSearchParams(init!.body as URLSearchParams).get('grant_type')).toBe('refresh_token');return Response.json({access_token:'renewed',expires_in:3600});}));
  expect(access).toBe('renewed');
  await expect(requestJSON('https://oauth2.googleapis.com/token',{},fetcher(async()=>new Response('secret provider detail',{status:400})))).rejects.toThrow('GOOGLE_HTTP_400');
  const stored=await env.DB.prepare('SELECT encrypted_tokens FROM oauth_credentials').first<{encrypted_tokens:string}>();expect(stored?.encrypted_tokens).not.toContain('renewed');
});
it('rejects duplicate rows spanning Google pages instead of publishing a truncated dataset',async()=>{
  const cfg=await connected();await enqueue();const job=(await claimJob(cfg))!;
  await processJob(cfg,job,fetcher(async()=>Response.json({responseAggregationType:'byPage',rows:Array.from({length:PAGE_SIZE},(_,i)=>rawRow(i))})));
  const next=(await claimJob(cfg))!;await processJob(cfg,next,fetcher(async()=>Response.json({responseAggregationType:'byPage',rows:[rawRow(0)]})));
  expect((await env.DB.prepare('SELECT complete FROM dataset_coverage').first<{complete:number}>())?.complete).toBe(0);
});
it('fences an expired lease so a stale worker cannot activate a dataset',async()=>{
  const cfg=await connected();await enqueue();const old=(await claimJob(cfg))!;
  await env.DB.prepare("UPDATE sync_jobs SET lease_until='2000-01-01'").run();const current=(await claimJob(cfg))!;expect(current.lease_token).not.toBe(old.lease_token);
  await processJob(cfg,old,fetcher(async()=>Response.json({responseAggregationType:'byPage',rows:[rawRow()]})));
  expect(await env.DB.prepare('SELECT * FROM dataset_coverage').first()).toBeNull();
  await processJob(cfg,current,fetcher(async()=>Response.json({responseAggregationType:'byPage',rows:[rawRow()]})));
  expect((await env.DB.prepare('SELECT row_count,complete FROM dataset_coverage').first())).toMatchObject({row_count:1,complete:1});
});
it('advances historical backfill in bounded daily slices toward year-over-year coverage',async()=>{
  const cfg=await connected();await enqueueDaily(cfg,new Date('2026-10-23T00:00:00Z'));
  const first=await env.DB.prepare("SELECT oldest_enqueued_day FROM backfill_progress WHERE provider='gsc'").first<{oldest_enqueued_day:string}>();
  await enqueueDaily(cfg,new Date('2026-10-24T00:00:00Z'));
  const next=await env.DB.prepare("SELECT oldest_enqueued_day FROM backfill_progress WHERE provider='gsc'").first<{oldest_enqueued_day:string}>();
  expect((Date.parse(first!.oldest_enqueued_day)-Date.parse(next!.oldest_enqueued_day))/86400_000).toBe(90);
});
it('keeps Ads close variants and requested demand scope without starting campaigns',async()=>{
  const cfg=await connected({ENABLE_GOOGLE_ADS:'true',GOOGLE_ADS_DEVELOPER_TOKEN:'fixture',GOOGLE_ADS_CUSTOMER_ID:'123',GOOGLE_ADS_API_VERSION:'v99'});
  const reply=await fetchKeywordPlanner(cfg,['broşür baskı','broşür baski'],fetcher(async(url,init)=>{
    expect(url).toContain(':generateKeywordHistoricalMetrics');const body=JSON.parse(init!.body as string);expect(body.keywords).toHaveLength(2);expect(body.keywordPlanNetwork).toBe('GOOGLE_SEARCH');
    return Response.json({results:[{text:'broşür baskı',closeVariants:['broşür baski'],keywordMetrics:{avgMonthlySearches:'100'}}]});
  }));
  expect(reply.results?.[0].keywordMetrics?.avgMonthlySearches).toBe('100');expect(reply.results).toHaveLength(1);
});
