import {describe,it,expect,vi} from 'vitest';
import {IndependentGscCollector} from '../src/independent-gsc';
import {independentGscCron} from '../src/independent-gsc-bridge';
const time=new Date('2026-10-31T00:15:00Z');
function storage(){
 const map=new Map<string,unknown>();
 return {map,get:async<T>(key:string)=>structuredClone(map.get(key)) as T|undefined,put:async(key:string,value:unknown)=>{map.set(key,structuredClone(value));}} as any;
}
const reply=(scope:'page'|'query')=>Response.json({
 responseAggregationType:'byPage',rows:[{keys:scope==='page'?['2026-10-28','https://mavibasim.com/brosur','tur','DESKTOP']:['2026-10-28','https://mavibasim.com/brosur','broşür baskı','tur','DESKTOP'],clicks:1,impressions:10,ctr:0.1,position:4}]
});
describe('GSC durable pipeline remains D1-free',()=>{
 it('writes verified encrypted daily page proof without D1 and skips fresh days',async()=>{
  const db=storage(),fetcher=vi.fn(async(_url:string,init?:RequestInit)=>{
   const body=JSON.parse(String(init?.body));return reply(body.dimensions.includes('query')?'query':'page');
  });
  const collector=new IndependentGscCollector(db,'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=',async()=> 'test-access',fetcher as unknown as typeof fetch);
  expect(await collector.tick(time)).toMatchObject({status:'complete',day:'2026-10-28',scope:'page',rows:1,d1_requests:0});
  const first=await db.get('gsc:daily:2026-10-28:page');
  expect(first.page_proofs[0].sha256).toMatch(/^[a-f0-9]{64}$/);
  expect(JSON.stringify([...db.map.values()])).not.toContain('broşür baskı');
  expect(await collector.tick(time)).toMatchObject({status:'complete',scope:'query',rows:1,d1_requests:0});
  expect((await collector.status(time)).coverage).toHaveLength(2);
  expect((await collector.status(time)).last_attempt).toMatchObject({status:'complete',day:'2026-10-28',scope:'query'});
  expect(fetcher).toHaveBeenCalledTimes(2);
 });
 it('never overwrites the last valid proof on invalid provider metrics',async()=>{
  const db=storage(),fetcher=vi.fn(async()=>Response.json({responseAggregationType:'byPage',rows:[{keys:['2026-10-28','https://mavibasim.com/brosur','tur','DESKTOP'],clicks:30,impressions:1,ctr:1,position:2}]}));
  const collector=new IndependentGscCollector(db,'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=',async()=> 'test-access',fetcher as unknown as typeof fetch);
  expect(await collector.tick(time)).toMatchObject({status:'held',d1_requests:0});
  expect(await db.get('gsc:daily:2026-10-28:page')).toBeUndefined();
  // Invalid metrics quarantine only that day and free the queue for other dates.
  expect(await db.get('gsc:active')).toBeNull();
  expect(await db.get('gsc:held:2026-10-28:page')).toMatchObject({code:'GSC_ROW_REJECTED'});
  expect((await collector.status(time)).last_attempt).toMatchObject({status:'held',code:'GSC_ROW_REJECTED',day:'2026-10-28'});
 });
 it('GSC cron refuses missing private service instead of touching legacy D1',async()=>{
  expect(await independentGscCron({AUTOMATION_ENABLED:'true'} as any,time)).toBe('unavailable');
  const fetch=vi.fn(async()=>Response.json({connected:false,d1_requests:0}));
  expect(await independentGscCron({AUTOMATION_ENABLED:'true',DRIVE_ARCHIVE_SERVICE:{fetch}} as any,new Date('2026-10-31T12:30:00Z'))).toBe('unavailable');
  expect(fetch).toHaveBeenCalledTimes(1);
 });
});

it('uses an idle recent slot for missing older evidence and skips already verified history without refetching',async()=>{
 const db=storage(),stamp=time.toISOString();
 const day=(ago:number)=>new Date(time.getTime()-ago*86400000).toISOString().slice(0,10);
 for(let ago=3;ago<=60;ago++)for(const scope of ['page','query'])db.map.set('gsc:daily:'+day(ago)+':'+scope,{captured_at:stamp,fixture:'preserved immutable evidence'});
 const before=structuredClone([...db.map]);
 const fetcher=vi.fn(async(_url:RequestInfo|URL,init?:RequestInit)=>{const body=JSON.parse(String(init?.body));return Response.json({responseAggregationType:'byPage',rows:[{keys:[body.startDate,'https://mavibasim.com/brosur','tur','DESKTOP'],clicks:1,impressions:10,ctr:.1,position:4}]});});
 const result=await new IndependentGscCollector(db,'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=',async()=> 'fixture-token',fetcher as typeof fetch).tick(time);
 expect(result).toMatchObject({status:'complete',day:day(61),scope:'page',rows:1});expect(fetcher).toHaveBeenCalledTimes(1);
 for(const [key,value] of before)expect(db.map.get(key)).toEqual(value);
 expect(db.map.get('gsc:backfill-index')).toBe(51);
});
it('bounds fresh-history scanning and respects source quota backoff before any work',async()=>{
 const db=storage(),fetcher=vi.fn();
 for(let ago=3;ago<=73;ago++)for(const scope of ['page','query'])db.map.set('gsc:daily:'+new Date(time.getTime()-ago*86400000).toISOString().slice(0,10)+':'+scope,{captured_at:time.toISOString()});
 const collector=new IndependentGscCollector(db,'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=',async()=> 'fixture',fetcher);
 expect(await collector.tick(time)).toMatchObject({status:'idle'});expect(db.map.get('gsc:backfill-index')).toBe(64);expect(fetcher).not.toHaveBeenCalled();
 db.map.set('gsc:retry',{until:time.getTime()+3600000});
 expect(await collector.tick(time)).toMatchObject({status:'held'});expect(db.map.get('gsc:backfill-index')).toBe(64);expect(fetcher).not.toHaveBeenCalled();
});
