import {afterEach,describe,expect,it,vi} from 'vitest';
import {tayfunSiteSeoStatus,tayfunSiteSeoTick} from '../src/tayfun-site-capture';
import {tayfunList} from '../src/tayfun-ledger';

const secret=btoa(String.fromCharCode(...new Uint8Array(32).fill(7)));
function store(){
 const data=new Map<string,unknown>();
 return {data,get:async<T=unknown>(key:string)=>data.get(key) as T|undefined,
  put:async(key:string,value:unknown)=>{data.set(key,value);}};
}
const day9=new Date('2026-11-09T08:00:00Z');
const xml='<urlset><url><loc>https://mavibasim.com/brosur</loc></url></urlset>';
afterEach(()=>vi.unstubAllGlobals());
describe('8 Kasım isteği tarihli gerçek SEO envanteri',()=>{
 it('8 Kasım sonrasında da eksik taramayı sürdürür; 9 Kasımı geriye tarihlemez',async()=>{
  const saved=store();
  vi.stubGlobal('fetch',vi.fn(async(url:string)=>{
   if(String(url).endsWith('/sitemap.xml'))return new Response(xml,{status:200,headers:{'Content-Type':'application/xml'}});
   return new Response('Erişilemiyor',{status:503});
  }));
  const result=await tayfunSiteSeoTick(saved,secret,day9,1);
  expect(result.status).toBe('partial');
  expect(result.reference_day).toBe('2026-11-08');
  expect(result.actual_day).toBe('2026-11-09');
  expect(result.recorded).toBe(0);
  expect(result.site_mutations).toBe(0);
  const report=await tayfunSiteSeoStatus(saved,day9);
  expect(report.expected_urls).toBe(1);
  expect(report.captured_count).toBe(0);
  expect(report.complete).toBe(false);
  expect((await tayfunList(saved,secret,'2026-11')).entries).toHaveLength(0);
 });
 it('doğrulanmamış sitemap için başarı raporu veya SEO kaydı üretmez',async()=>{
  const saved=store();
  vi.stubGlobal('fetch',vi.fn(async()=>new Response('hata',{status:503})));
  const result=await tayfunSiteSeoTick(saved,secret,new Date('2026-11-08T15:00:00Z'));
  expect(result).toMatchObject({status:'held',code:'SITEMAP_UNAVAILABLE'});
  const report=await tayfunSiteSeoStatus(saved,new Date('2026-11-08T15:00:00Z'));
  expect(report).toMatchObject({captured_count:0,expected_urls:0,complete:false});
 });
});
