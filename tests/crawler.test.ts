import {beforeEach,it,expect} from 'vitest';
import {init,env,fetcher} from './helpers';
import {parseHTML,snapshotDiff,saveSnapshot,findings,sitemapURLs,crawlOne,seedCrawl} from '../src/crawler';

beforeEach(init);
const html=`<!doctype html><html lang="tr"><head><title>Broşür baskı</title><meta name="description" content="Kaynak açıklama"><meta name="viewport" content="width=device-width"><link rel="canonical" href="/brosur"><link rel="alternate" hreflang="tr" href="/brosur"><script type="application/ld+json">{"@type":"Product"}</script></head><body><h1>Broşür</h1><h2>Ölçüler</h2><h6>Not</h6><p>Özgün içerik</p><img src="/a.jpg"><a href="/el-ilani">El ilanı</a><a href="https://evil.example/">dış</a></body></html>`;
it('extracts SEO inventory, headings, structured data and same-origin links',async()=>{
  const snapshot=await parseHTML(html,'https://mavibasim.com/brosur');
  expect(snapshot.title).toBe('Broşür baskı');expect(snapshot.description).toBe('Kaynak açıklama');expect(snapshot.headings.map(h=>h.level)).toEqual([1,2,6]);
  expect(snapshot.canonical).toEqual(['https://mavibasim.com/brosur']);expect(snapshot.links).toEqual(['https://mavibasim.com/el-ilani']);
  expect(snapshot.structured_data).toEqual([{'@type':'Product'}]);expect(findings(snapshot,'https://mavibasim.com/brosur').map(f=>f.code)).toContain('IMAGE_ALT_MISSING');
});
it('preserves immutable old/new snapshots and reports detection interval, never invented publication date',async()=>{
  const first=await parseHTML(html,'https://mavibasim.com/brosur'),next=await parseHTML(html.replace('Broşür baskı','Yeni başlık'),'https://mavibasim.com/brosur');
  for(const id of ['a','b'])await env.DB.prepare('INSERT INTO crawls(id,url,started_at) VALUES(?,?,?)').bind(id,'https://mavibasim.com/brosur','2026-09-01T00:00:00Z').run();
  const firstId=await saveSnapshot(env,'a','https://mavibasim.com/brosur',first,'2026-09-01T00:00:00Z');await saveSnapshot(env,'b','https://mavibasim.com/brosur',next,'2026-09-03T00:00:00Z');
  const event=await env.DB.prepare('SELECT * FROM seo_change_events').first<{published_at:string|null;observed_from:string;observed_to:string;diff_json:string}>();
  expect(event?.published_at).toBeNull();expect(JSON.parse(event!.diff_json).title).toEqual({old:'Broşür baskı',new:'Yeni başlık'});expect(event?.observed_from).toBe('2026-09-01T00:00:00Z');
  await expect(env.DB.prepare("UPDATE seo_snapshots SET content_hash='bad' WHERE id=?").bind(firstId).run()).rejects.toThrow('immutable_snapshot');
  expect(snapshotDiff(first,first)).toEqual({});
});
it('detects noindex, cross-canonical, redirects and 404 without claiming automatic fixes',async()=>{
  const snapshot=await parseHTML(html.replace('href="/brosur"','href="/el-ilani"'),'https://mavibasim.com/brosur',200,new Headers({'x-robots-tag':'noindex'}));
  expect(findings(snapshot,'https://mavibasim.com/brosur').map(f=>f.code)).toEqual(expect.arrayContaining(['NOINDEX','CANONICAL_OTHER']));
  expect(findings({...snapshot,status:404},'https://mavibasim.com/brosur').map(f=>f.code)).toContain('HTTP_404');
});
it('parses sitemap indexes and rejects off-site or entity expansion destinations',()=>{
  expect(sitemapURLs('<sitemapindex><sitemap><loc>https://mavibasim.com/a.xml</loc></sitemap></sitemapindex>')).toEqual([{url:'https://mavibasim.com/a.xml',kind:'sitemap'}]);
  expect(sitemapURLs('<urlset><url><loc>https://evil.example/</loc></url><url><loc>https://mavibasim.com/brosur</loc></url></urlset>')).toEqual([{url:'https://mavibasim.com/brosur',kind:'page'}]);
  expect(()=>sitemapURLs('<!DOCTYPE x [<!ENTITY y "boom">]><urlset/>')).toThrow('UNSAFE_SITEMAP_XML');
});
it('obeys robots denial and never fetches the page',async()=>{
  await env.DB.prepare("INSERT INTO crawl_queue(url,kind,next_crawl_at) VALUES('https://mavibasim.com/brosur','page','2020-01-01')").run();
  let calls=0;await crawlOne({...env,CRAWL_ENABLED:'true'},fetcher(async url=>{calls++;expect(url).toBe('https://mavibasim.com/robots.txt');return new Response('User-agent: *\nDisallow: /brosur');}));
  expect(calls).toBe(1);expect((await env.DB.prepare('SELECT error_code FROM crawls').first())).toMatchObject({error_code:'ROBOTS_DISALLOWED'});
});
it('records real fetched HTML and queues internal discovery without cross-origin requests',async()=>{
  await env.DB.prepare("INSERT INTO crawl_policies VALUES('https://mavibasim.com','User-agent: *\nAllow: /',?,'2020-01-01')").bind(new Date().toISOString()).run();
  await env.DB.prepare("INSERT INTO crawl_queue(url,kind,next_crawl_at) VALUES('https://mavibasim.com/brosur','page','2020-01-01')").run();
  await crawlOne({...env,CRAWL_ENABLED:'true'},fetcher(async url=>{expect(url).toBe('https://mavibasim.com/brosur');return new Response(html,{headers:{'content-type':'text/html'}});}));
  expect((await env.DB.prepare('SELECT count(*) AS n FROM seo_snapshots').first<{n:number}>())?.n).toBe(1);
  expect((await env.DB.prepare("SELECT url FROM crawl_queue WHERE url LIKE '%el-ilani'").first())).toMatchObject({url:'https://mavibasim.com/el-ilani'});
});

it('prioritizes a due product over unrelated older pages without bypassing its retry deadline',async()=>{
  await env.DB.prepare("INSERT INTO crawl_policies VALUES('https://mavibasim.com','User-agent: *\nAllow: /',?,'2020-01-01')").bind(new Date().toISOString()).run();
  await env.DB.prepare("INSERT INTO crawl_queue(url,kind,next_crawl_at) VALUES('https://mavibasim.com/blog','page','2019-01-01'),('https://mavibasim.com/brosur','page','2020-01-01'),('https://mavibasim.com/el-ilani','page','2099-01-01')").run();
  await crawlOne({...env,CRAWL_ENABLED:'true'},fetcher(async url=>{expect(url).toBe('https://mavibasim.com/brosur');return new Response(html,{headers:{'content-type':'text/html'}});}));
  expect(await env.DB.prepare("SELECT next_crawl_at FROM crawl_queue WHERE url LIKE '%el-ilani'").first()).toMatchObject({next_crawl_at:'2099-01-01'});
});
it('seeds a previously unmapped product only from an observed same-site Google URL, idempotently',async()=>{
  await env.DB.prepare("INSERT INTO products(id,group_id,name,source_folder) VALUES('zarf','print','Zarf','test/zarf'),('kutu','print','Kutu','test/kutu')").run();
  await env.DB.prepare("INSERT INTO gsc_daily_by_page VALUES('fixture','2026-09-01','https://mavibasim.com/zarf','tur','MOBILE',1,10,0.1,5)").run();
  await seedCrawl({...env,CRAWL_ENABLED:'true'});await seedCrawl({...env,CRAWL_ENABLED:'true'});
  expect(await env.DB.prepare("SELECT count(*) n FROM crawl_queue WHERE url='https://mavibasim.com/zarf'").first()).toMatchObject({n:1});
  expect(await env.DB.prepare("SELECT count(*) n FROM crawl_queue WHERE url='https://mavibasim.com/kutu'").first()).toMatchObject({n:0});
  expect(await env.DB.prepare("SELECT url_verified_at FROM products WHERE id='zarf'").first()).toMatchObject({url_verified_at:null});
});
