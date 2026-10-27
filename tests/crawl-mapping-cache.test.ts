import {afterEach,beforeEach,expect,it,vi} from 'vitest';
import {init,env,fetcher} from './helpers';
import {crawlOne} from '../src/crawler';
import {getReport} from '../src/index';
import {cachedRead,evidenceRevision} from '../src/read-cache';

const T0=new Date('2026-10-27T09:00:00Z'),T1=new Date('2026-10-27T09:02:00Z');
const URL='https://mavibasim.com/brosur';
const html=(title='Broşür baskı',canonical='/brosur')=>`<html><head><title>${title}</title><link rel="canonical" href="${canonical}"></head><body><h1>Broşür</h1><p>Test içeriği</p></body></html>`;
beforeEach(async()=>{await init();vi.setSystemTime(T0);});
afterEach(()=>vi.useRealTimers());
async function recrawl(body=html(),status=200){
 await env.DB.prepare("INSERT OR REPLACE INTO crawl_policies VALUES('https://mavibasim.com','User-agent: *\nAllow: /',?,'2020-01-01')").bind(new Date().toISOString()).run();
 await env.DB.prepare("INSERT INTO crawl_queue(url,kind,next_crawl_at) VALUES(?,'page','2020-01-01') ON CONFLICT(url) DO UPDATE SET next_crawl_at='2020-01-01'").bind(URL).run();
 await crawlOne({...env,CRAWL_ENABLED:'true'},fetcher(async url=>{expect(url).toBe(URL);return new Response(body,{status,headers:{'content-type':'text/html'}});}));
}
const mapped=()=>env.DB.prepare("SELECT canonical_url,url_verified_at FROM products WHERE id='brosur'").first();

it('a repeat crawl keeps the verified mapping evidence stable while recording the latest successful crawl',async()=>{
 await recrawl();const before=await mapped(),revision=await evidenceRevision(env);
 vi.setSystemTime(T1);await recrawl();
 expect(await mapped()).toEqual(before);expect(await evidenceRevision(env)).toBe(revision);
 expect(await env.DB.prepare('SELECT max(finished_at) latest,count(*) n FROM crawls').first()).toMatchObject({latest:T1.toISOString(),n:2});
});
it('a stable canonical recrawl does not regenerate a source-identical report inside its TTL',async()=>{
 await recrawl();const first=await getReport(env,'2026-09');
 vi.setSystemTime(T1);await recrawl();const second=await getReport(env,'2026-09');
 expect(second.id).toBe(first.id);expect(second.created_at).toBe(first.created_at);
 expect(await env.DB.prepare('SELECT count(*) n FROM analysis_runs').first()).toMatchObject({n:1});
});
it('a stable canonical recrawl does not discard a KPI measurement inside its TTL',async()=>{
 await recrawl();let calls=0;const compute=async()=>({measured_at:new Date().toISOString(),calls:++calls});
 const first=await cachedRead(env,'TEST September KPI',compute);
 vi.setSystemTime(T1);await recrawl();expect(await cachedRead(env,'TEST September KPI',compute)).toEqual(first);expect(calls).toBe(1);
});
it('a real first URL verification still invalidates missing-mapping reports and KPI caches',async()=>{
 await env.DB.prepare("UPDATE products SET canonical_url=NULL WHERE id='brosur'").run();
 const first=await getReport(env,'2026-09');let calls=0;await cachedRead(env,'TEST mapping transition',async()=>++calls);
 vi.setSystemTime(T1);await recrawl();
 expect(await mapped()).toMatchObject({canonical_url:URL,url_verified_at:T1.toISOString()});
 expect((await getReport(env,'2026-09')).id).not.toBe(first.id);
 expect(await cachedRead(env,'TEST mapping transition',async()=>++calls)).toBe(2);
});
it('content changes retain new snapshots and change events without pretending the mapping identity changed',async()=>{
 await recrawl();const before=await mapped();vi.setSystemTime(T1);await recrawl(html('Yeni test başlığı'));
 expect(await mapped()).toEqual(before);
 expect(await env.DB.prepare('SELECT count(*) n FROM seo_snapshots').first()).toMatchObject({n:2});
 const row=await env.DB.prepare('SELECT diff_json FROM seo_change_events').first<{diff_json:string}>();
 expect(JSON.parse(row!.diff_json).title).toEqual({old:'Broşür baskı',new:'Yeni test başlığı'});
});
it.each([['other canonical',html('Test','/el-ilani'),200],['server error',html(),500]] as const)('%s cannot create a successful mapping verification',async(_label,body,status)=>{
 vi.setSystemTime(T1);await recrawl(body,status);
 expect(await mapped()).toMatchObject({canonical_url:URL,url_verified_at:null});
});
