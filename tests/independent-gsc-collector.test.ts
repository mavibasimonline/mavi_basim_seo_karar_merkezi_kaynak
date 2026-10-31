import {describe,it,expect,vi} from 'vitest';
import {IndependentGscCollector} from '../src/independent-gsc';
import {independentGscCron} from '../src/independent-gsc-bridge';
const time=new Date('2026-10-31T00:15:00Z');
function storage(){
 const map=new Map<string,unknown>();
 return {map,get:async<T>(key:string)=>map.get(key) as T|undefined,put:async(key:string,value:unknown)=>{map.set(key,value);}} as any;
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
  expect(fetcher).toHaveBeenCalledTimes(2);
 });
 it('never overwrites the last valid proof on invalid provider metrics',async()=>{
  const db=storage(),fetcher=vi.fn(async()=>Response.json({responseAggregationType:'byPage',rows:[{keys:['2026-10-28','https://mavibasim.com/brosur','tur','DESKTOP'],clicks:30,impressions:1,ctr:1,position:2}]}));
  const collector=new IndependentGscCollector(db,'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=',async()=> 'test-access',fetcher as unknown as typeof fetch);
  expect(await collector.tick(time)).toMatchObject({status:'held',d1_requests:0});
  expect(await db.get('gsc:daily:2026-10-28:page')).toBeUndefined();
  expect(await db.get('gsc:active')).toBeTruthy();
 });
 it('GSC cron refuses missing private service instead of touching legacy D1',async()=>{
  expect(await independentGscCron({AUTOMATION_ENABLED:'true'} as any,time)).toBe('unavailable');
  const fetch=vi.fn(async()=>Response.json({connected:false,d1_requests:0}));
  expect(await independentGscCron({AUTOMATION_ENABLED:'true',DRIVE_ARCHIVE_SERVICE:{fetch}} as any,new Date('2026-10-31T12:30:00Z'))).toBe('unavailable');
  expect(fetch).toHaveBeenCalledTimes(1);
 });
});
