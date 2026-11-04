import {it,expect,vi} from 'vitest';
import {runGscBootstrapTick,gscBootstrapStatus} from '../src/independent-gsc-bootstrap';
import {verifiedGscMonth} from '../src/independent-gsc-report';
import {GSC_BOOTSTRAP_STORAGE_LIMIT} from '../src/independent-gsc';
const secret='AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=',time=new Date('2026-11-04T08:00:00Z');
function storage(){const map=new Map<string,unknown>();return {map,get:async<T>(key:string)=>structuredClone(map.get(key)) as T|undefined,put:async(key:string,value:unknown)=>{map.set(key,structuredClone(value));}} as any;}
function source(){return vi.fn(async(_url:RequestInfo|URL,init?:RequestInit)=>{
 const p=JSON.parse(String(init?.body)),query=p.dimensions.includes('query');
 return Response.json({responseAggregationType:'byPage',rows:[{keys:query?[p.startDate,'https://mavibasim.com/brosur','broşür baskı','tur','DESKTOP']:[p.startDate,'https://mavibasim.com/brosur','tur','DESKTOP'],clicks:1,impressions:10,ctr:.1,position:4}]});
});}
it('collects both closed months directly from GSC while preserving the daily operational queue',async()=>{
 const s=storage(),fetcher=source(),active={day:'2026-11-01',scope:'query',fixture:'operational queue'};s.map.set('gsc:active',active);
 for(let i=0;i<122;i++)expect((await runGscBootstrapTick(s,secret,async()=> 'fixture-access',fetcher,time)).status).toBe('complete');
 expect(await gscBootstrapStatus(s)).toMatchObject({months:['2026-10','2026-09'],completed_scopes:122,total_scopes:122,plan_complete:true,d1_requests:0});
 expect(s.map.get('gsc:active')).toEqual(active);expect(fetcher).toHaveBeenCalledTimes(122);
 expect(await verifiedGscMonth(s,secret,'2026-10',time)).toMatchObject({available:true,days_verified:31,query_days_verified:31,total_clicks:31});
 expect(await verifiedGscMonth(s,secret,'2026-09',time)).toMatchObject({available:true,days_verified:30,query_days_verified:30,total_clicks:30});
 const before=structuredClone([...s.map].filter(([k])=>k.startsWith('gsc:history:')));
 expect(await runGscBootstrapTick(s,secret,async()=> 'unused',fetcher,time)).toMatchObject({status:'idle',plan_complete:true});
 expect([...s.map].filter(([k])=>k.startsWith('gsc:history:'))).toEqual(before);expect(fetcher).toHaveBeenCalledTimes(122);
});
it('does not select an unclosed October at the earlier date boundary',async()=>{
 const s=storage(),fetcher=source();await runGscBootstrapTick(s,secret,async()=> 'fixture',fetcher,new Date('2026-11-02T00:00:00Z'));
 expect(await gscBootstrapStatus(s)).toMatchObject({months:['2026-09','2026-08'],next:{day:'2026-09-01',scope:'query'}});
});
it('shares actual source rate backoff with the daily collector and resumes the stored target',async()=>{
 const s=storage(),fetcher=source();fetcher.mockImplementationOnce(async()=>new Response(null,{status:429}));
 expect(await runGscBootstrapTick(s,secret,async()=> 'fixture',fetcher,time)).toMatchObject({status:'held',code:'GSC_HTTP_429'});
 expect(await runGscBootstrapTick(s,secret,async()=> 'fixture',fetcher,new Date(time.getTime()+60000))).toMatchObject({status:'held',code:'GSC_RETRY_BACKOFF'});
 expect(fetcher).toHaveBeenCalledTimes(1);expect(s.map.get('gsc:daily:2026-10-01:page')).toBeUndefined();
 expect(await runGscBootstrapTick(s,secret,async()=> 'fixture',fetcher,new Date(time.getTime()+3600001))).toMatchObject({status:'complete',day:'2026-10-01',scope:'page'});
});
it('never overrides a specific OAuth or API quota hold and requires fresh proof for the legacy native failure',async()=>{
 const s=storage(),fetcher=source(),key='gsc:held:2026-10-01:page';
 for(const code of ['GSC_HTTP_429','GSC_OAUTH_RECONNECT_REQUIRED']){
  s.map.set(key,{code,until:time.getTime()+3600000});
  expect(await runGscBootstrapTick(s,secret,async()=> 'fixture',fetcher,time)).toMatchObject({status:'held',code});
 }
 s.map.set(key,{code:'GSC_SYNC_UNAVAILABLE',until:time.getTime()+3600000});
 expect(await runGscBootstrapTick(s,secret,async()=> 'fixture',fetcher,time)).toMatchObject({status:'held',code:'GSC_BOOTSTRAP_DIAGNOSTIC_REQUIRED'});
 s.map.set('gsc:diagnostic:last',{at:time.toISOString(),ok:true,readback_verified:true,revision:'daily-proof-v2',rows:1});
 expect(await runGscBootstrapTick(s,secret,async()=> 'fixture',fetcher,time)).toMatchObject({status:'complete'});
 expect(s.map.get(key)).toEqual({code:'GSC_SYNC_UNAVAILABLE',until:time.getTime()+3600000});
});
it('bounds one-time storage independently of daily ingestion without bypassing total size',async()=>{
 const s=storage(),fetcher=source();s.map.set('gsc:storage-budget:v1',{version:1,day:'2026-11-04',measured_since:time.toISOString(),reserved_bytes:8*1024*1024,day_reserved_bytes:8*1024*1024});
 expect(await runGscBootstrapTick(s,secret,async()=> 'fixture',fetcher,time)).toMatchObject({status:'complete'});
 const budget=s.map.get('gsc:storage-budget:v1') as any;expect(budget.day_reserved_bytes).toBe(8*1024*1024);expect(budget.bootstrap_reserved_bytes).toBeGreaterThan(0);
 budget.bootstrap_reserved_bytes=GSC_BOOTSTRAP_STORAGE_LIMIT;s.map.set('gsc:storage-budget:v1',budget);
 expect(await runGscBootstrapTick(s,secret,async()=> 'fixture',fetcher,time)).toMatchObject({status:'held',code:'GSC_BOOTSTRAP_STORAGE_LIMIT'});
 expect(s.map.has('gsc:daily:2026-10-01:query')).toBe(false);
});
it('keeps an empty historical source day incomplete instead of inventing zero traffic',async()=>{
 const s=storage(),fetcher=vi.fn(async()=>Response.json({responseAggregationType:'byPage',rows:[]}));
 expect(await runGscBootstrapTick(s,secret,async()=> 'fixture',fetcher,time)).toMatchObject({status:'held',code:'GSC_BOOTSTRAP_SOURCE_INCOMPLETE'});
 expect(await gscBootstrapStatus(s)).toMatchObject({completed_scopes:0,plan_complete:false});
});

it('gives the daily queue priority and keeps history isolated from a D1 quota failure',async()=>{
 const {independentGscBootstrapCron}=await import('../src/independent-gsc-bridge');
 for(const [covered,reconnect,expected] of [[13,false,'idle'],[14,true,'idle'],[14,false,'collected']] as const){
  const fetcher=vi.fn(async(url:string)=>Response.json(url.endsWith('gsc-coverage')?{connected:true,reauthorization_required:reconnect,coverage:Array(covered).fill({})}:{status:'complete',d1_requests:0}));
  const env={AUTOMATION_ENABLED:'true',DRIVE_ARCHIVE_SERVICE:{fetch:fetcher},DB:{prepare(){throw Error('D1 must not be read');}}} as any;
  expect(await independentGscBootstrapCron(env)).toBe(expected);expect(fetcher).toHaveBeenCalledTimes(expected==='collected'?2:1);
 }
});
