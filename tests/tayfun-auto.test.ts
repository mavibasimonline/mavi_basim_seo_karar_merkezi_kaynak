import {describe,it,expect} from 'vitest';
import {tayfunAutoMonth,tayfunAutoTick,tayfunAutoDetail} from '../src/tayfun-auto';
function makeStore(){
 const data=new Map<string,unknown>();
 return {data,get:async<T=unknown>(key:string):Promise<T|undefined>=>data.get(key) as T|undefined,put:async(key:string,value:unknown)=>{data.set(key,value);}};
}
const secret=btoa(String.fromCharCode(...new Uint8Array(32).fill(7)));
describe('Tayfun automatic monthly SEO observations',()=>{
 it('rejects invalid periods and forged record identifiers',async()=>{
  const storage=makeStore();
  await expect(tayfunAutoMonth(storage,'2026-99')).rejects.toThrow('TAYFUN_INPUT_INVALID');
  await expect(tayfunAutoDetail(storage,secret,'not-a-uuid')).rejects.toThrow('TAYFUN_INPUT_INVALID');
 });
 it('never invents monthly SEO snapshots without a successful sitemap and crawl',async()=>{
  const storage=makeStore(),fetcher=(async()=>new Response('not found',{status:404})) as typeof fetch;
  const result=await tayfunAutoTick(storage,secret,fetcher,new Date('2026-11-06T12:00:00Z'));
  expect(result.status).toBe('held');
  const report=await tayfunAutoMonth(storage,'2026-11');
  expect(report.observed_urls).toBe(0);
  expect(report.observations).toEqual([]);
  expect(report.full_site_verified).toBe(false);
 });
 it('stores only capture timestamps, not fictional first-of-month publication dates',async()=>{
  const storage=makeStore();
  const report=await tayfunAutoMonth(storage,'2026-10');
  expect(report.observations_count).toBe(0);
  expect(report.coverage_note).toContain('gerçek tarama');
 });
});
