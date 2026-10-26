import {beforeEach,it,expect} from 'vitest';
import {init,env,connected,enqueue,fetcher} from './helpers';
import {gscPageURL,siteURL,GSC_PAGE_SQL_VALID} from '../src/urls';
import {fetchGsc,validateGscRow} from '../src/providers';
import {claimJob,processJob,insertRows} from '../src/sync';
import {performance,performanceQueries} from '../src/performance';
import {dataIntegrity} from '../src/data-integrity';
import {analyze} from '../src/analysis';
import {validateAnalysis} from '../src/validation';
import {seedCrawl,sitemapURLs} from '../src/crawler';

beforeEach(init);
const DOMAIN='sc-domain:mavibasim.com',DAY='2026-08-18',TIME=new Date('2026-10-26T15:30:00Z');
const allowed=[
 'https://mavibasim.com/brosur','https://www.mavibasim.com/brosur',
 'http://mavibasim.com/brosur','http://www.mavibasim.com/brosur',
 'https://mavibasim.com','https://www.mavibasim.com/',
 'HTTPS://WWW.MAVIBASIM.COM/bro%C5%9F%C3%BCr?size=a5#source',
 'https://www.mavibasim.com/brosur/?utm_source=TEST&size=a5',
 'https://www.mavibasim.com/path/../brosur',
 'https://www.mavibasim.com/broşür',
 'https://www.mavibasim.com/?next=https%3A%2F%2Fevil.example',
];
const denied=[
 'https://evil.example/brosur','https://mavibasim.com.evil.example/brosur',
 'https://www.mavibasim.com.evil.example/brosur','https://notmavibasim.com/brosur',
 'https://api.mavibasim.com/brosur','https://www.www.mavibasim.com/brosur',
 'https://mavibasim.com@evil.example/brosur','https://user@mavibasim.com/brosur',
 'https://user:password@www.mavibasim.com/brosur','https://mavibasim.com:8443/brosur',
 'https://mavibasim.com:443/brosur','http://www.mavibasim.com:80/brosur',
 'https://mavibasim.com./brosur','https://www.mavibasim.com./brosur',
 'https://%6davibasim.com/brosur','https://mavibasım.com/brosur',
 'ftp://www.mavibasim.com/brosur','javascript:alert(1)','data:text/plain,test',
 '/brosur','brosur','//www.mavibasim.com/brosur','https:////mavibasim.com/brosur',
 'https://mavibasim.com\\@evil.example/brosur','https://www.mavibasim.com/a\\b',
 ' https://mavibasim.com/brosur','https://mavibasim.com/brosur ',
 'https://www.mavibasim.com/a\tb','https://mavibasim.com/a\nb',
 'https://mavibasim.com/a\rb','https://mavibasim.com/a\u0000b',
 'https://mavibasim.com/a\u0001b','https://mavibasim.com/a\u007fb','',
];
it.each([...allowed.map(url=>[url,true] as const),...denied.map(url=>[url,false] as const)])('TypeScript and independent SQL agree on ownership of %s',async(url,accepted)=>{
 expect(gscPageURL(url)!==null).toBe(accepted);
 if(accepted)expect(gscPageURL(url)).toBe(url);
 const result=await env.DB.prepare(`SELECT CASE WHEN ${GSC_PAGE_SQL_VALID} THEN 1 ELSE 0 END AS accepted FROM (SELECT ? AS page) d`).bind(url).first<{accepted:number}>();
 expect(result?.accepted).toBe(Number(accepted));
});
it.each([
 ['https://mavibasim.com/brosur','https://mavibasim.com/',true],
 ['https://www.mavibasim.com/brosur','https://mavibasim.com/',false],
 ['http://mavibasim.com/brosur','https://mavibasim.com/',false],
 ['https://www.mavibasim.com/brosur','https://www.mavibasim.com/',true],
 ['https://www.mavibasim.com/print/brosur','https://www.mavibasim.com/print/',true],
 ['https://www.mavibasim.com/outside','https://www.mavibasim.com/print/',false],
 ['https://www.mavibasim.com/print/../outside','https://www.mavibasim.com/print/',false],
 ['https://mavibasim.com/brosur','sc-domain:evil.example',false],
 ['https://mavibasim.com/brosur','https://evil.example/',false],
 ['https://mavibasim.com/brosur','https://mavibasim.com/?scope=all',false],
] as const)('respects actual Google property scope: %s in %s',async(url,property,accepted)=>{
 expect(gscPageURL(url,property)!==null).toBe(accepted);
});
it('does not admit untyped or relative provider URLs',()=>{
 for(const value of [null,undefined,1,{},['https://mavibasim.com/']])expect(gscPageURL(value)).toBeNull();
});
const sample=(page:string,query=false,day=DAY)=>({keys:[day,page,...(query?['broşür baskı']:[]),'tur','MOBILE'],clicks:1,impressions:10,ctr:0.1,position:3});
it('accepts four owned variants from the domain property without following them or merging identities',async()=>{
 const cfg=await connected({GSC_PROPERTY:DOMAIN});const urls=allowed.slice(0,4);let calls=0;
 const data=await fetchGsc(cfg,DAY,'page',0,fetcher(async(url,init)=>{
  calls++;expect(url).toContain('https://www.googleapis.com/webmasters/');expect(init?.method).toBe('POST');
  return Response.json({responseAggregationType:'byPage',rows:urls.map(u=>sample(u))});
 }));
 expect(data.rows.map(r=>r.page)).toEqual(urls);expect(calls).toBe(1);expect(data.complete).toBe(true);
 expect(data.notes).toContain(DOMAIN);expect(data.notes).toContain('ayrı saklanır');
});
it('keeps the legacy apex staging identity while preserving the www observation',async()=>{
 const cfg=await connected({GSC_PROPERTY:DOMAIN});
 const apex='https://mavibasim.com/brosur/?utm_source=TEST&size=a5#section';
 const www='https://www.mavibasim.com/brosur/?utm_source=TEST&size=a5#section';
 const data=await fetchGsc(cfg,DAY,'page',0,fetcher(async()=>Response.json({responseAggregationType:'byPage',rows:[sample(apex),sample(www)]})));
 expect(data.rows[0].page).toBe(siteURL(apex));expect(data.rows[1].page).toBe(www);
});
it('rejects an owned but out-of-property URL rather than silently dropping the row',async()=>{
 const cfg=await connected({GSC_PROPERTY:'https://mavibasim.com/'});
 await expect(fetchGsc(cfg,DAY,'page',0,fetcher(async()=>Response.json({responseAggregationType:'byPage',rows:[sample('https://mavibasim.com/brosur'),sample('https://www.mavibasim.com/brosur')]})))).rejects.toThrow('INVALID_GSC_ROW_PAGE_PROPERTY_SCOPE');
});
it('still rejects invalid metrics after accepting the www owner',()=>{
 expect(()=>validateGscRow({date:DAY,page:'http://www.mavibasim.com/brosur',country:'tur',device:'MOBILE',clicks:1,impressions:10,ctr:0.5,position:3},DAY)).toThrow('INVALID_GSC_ROW_CTR_RATIO');
});
it('resumes a staged 200-row query generation without rewriting its existing apex rows',async()=>{
 const cfg=await connected({GSC_PROPERTY:DOMAIN});await enqueue('gsc','query',DAY);
 await processJob(cfg,(await claimJob(cfg))!,fetcher(async()=>Response.json({responseAggregationType:'byPage',rows:Array.from({length:200},(_,i)=>sample(`https://mavibasim.com/page-${i}/?utm_source=TEST`,true))})));
 const before=(await env.DB.prepare('SELECT * FROM gsc_daily_by_query_device ORDER BY page').all()).results;
 expect(before).toHaveLength(200);expect(before.every(r=>!String(r.page).includes('utm_'))).toBe(true);
 const job=(await claimJob(cfg))!;expect(job.cursor).toBe(200);
 await processJob(cfg,job,fetcher(async()=>Response.json({responseAggregationType:'byPage',rows:[sample('http://www.mavibasim.com/brosur/?size=a5',true)]})));
 const after=(await env.DB.prepare("SELECT * FROM gsc_daily_by_query_device WHERE page NOT LIKE '%www.%' ORDER BY page").all()).results;
 expect(after).toEqual(before);
 expect(await env.DB.prepare('SELECT complete,row_count,dataset_id FROM dataset_coverage').first()).toMatchObject({complete:1,row_count:201,dataset_id:job.generation});
 expect(await env.DB.prepare("SELECT page FROM gsc_daily_by_query_device WHERE page LIKE '%www.%'").first()).toMatchObject({page:'http://www.mavibasim.com/brosur/?size=a5'});
});
it('a foreign row blocks the generation and preserves old active coverage and staged cursor',async()=>{
 const cfg=await connected({GSC_PROPERTY:DOMAIN});await enqueue('gsc','query',DAY);
 await env.DB.prepare("INSERT INTO dataset_coverage VALUES('gsc',?,'query','TEST previous',1,1,1,?,'TEST previous valid')").bind(DAY,TIME.toISOString()).run();
 await env.DB.prepare('UPDATE sync_jobs SET cursor=200').run();const job=(await claimJob(cfg))!;
 await processJob(cfg,job,fetcher(async()=>Response.json({responseAggregationType:'byPage',rows:[sample('https://www.mavibasim.com.evil.example/brosur',true)]})));
 expect(await env.DB.prepare('SELECT status,cursor,generation,error_code FROM sync_jobs').first()).toMatchObject({status:'blocked',cursor:200,generation:job.generation,error_code:'INVALID_GSC_ROW_PAGE_ORIGIN'});
 expect(await env.DB.prepare('SELECT dataset_id,complete FROM dataset_coverage').first()).toMatchObject({dataset_id:'TEST previous',complete:1});
});
async function seedObserved(){
 const cfg=await connected({GSC_PROPERTY:DOMAIN});
 await env.DB.prepare("UPDATE products SET url_verified_at=? WHERE id='brosur'").bind(TIME.toISOString()).run();
 for(const scope of ['page','query']){
  const id='TEST '+scope;const rows=[
   {dataset_id:id,date:DAY,page:'https://mavibasim.com/brosur',country:'tur',device:'MOBILE',clicks:10,impressions:100,ctr:0.1,position:2},
   {dataset_id:id,date:DAY,page:'http://www.mavibasim.com/brosur',country:'tur',device:'MOBILE',clicks:20,impressions:1000,ctr:0.02,position:12},
  ].map(r=>({...r,...(scope==='query'?{query:'broşür baskı',is_brand:0}:{})}));
  await env.DB.batch([...insertRows(env.DB,scope==='page'?'gsc_daily_by_page':'gsc_daily_by_query_device',rows),env.DB.prepare("INSERT INTO dataset_coverage VALUES('gsc',?,?,?,?,?,?,?,'TEST mixed source')").bind(DAY,scope,id,1,Number(scope==='query'),2,TIME.toISOString())]);
 }
 await env.DB.prepare("INSERT INTO health_checks VALUES('gsc',?,?,'ok',NULL)").bind(TIME.toISOString().slice(0,10),TIME.toISOString()).run();return cfg;
}
it('dashboard and independent audit accept www but do not assign its clicks to an unverified product alias',async()=>{
 const cfg=await seedObserved();
 const p=await performance(cfg,'2026-08',null,TIME);
 expect(p.series.find(r=>r.day===DAY)?.verified).toBe(true);expect(p.current).toMatchObject({clicks:30,impressions:1100});
 expect(p.current?.ctr).toBeCloseTo(30/1100);expect(p.current?.position).toBeCloseTo(12200/1100);
 expect(p.products.find(r=>r.id==='brosur')?.current?.clicks).toBe(10);
 const q=await performanceQueries(cfg,new URLSearchParams({month:'2026-08'}),TIME);
 expect(q.rows).toHaveLength(2);expect(q.rows.find(r=>r.page==='http://www.mavibasim.com/brosur')).toMatchObject({product_id:null,clicks:20});
 const report=await analyze(cfg,'2026-08',TIME);expect(await validateAnalysis(cfg,report)).toEqual([]);
 const audit=await dataIntegrity(cfg,'2026-08',TIME);expect(audit.issues.filter(i=>i.source==='gsc')).toEqual([]);
 expect(report.products.find(r=>r.id==='brosur')?.current?.clicks).toBe(10);
});
it('only a separately verified alias maps the www observation into a product',async()=>{
 const cfg=await seedObserved();
 await env.DB.prepare("INSERT INTO pages(url,product_id,discovered_at,mapping_source) VALUES('https://mavibasim.com/brosur','brosur',?,'TEST verified mapping')").bind(TIME.toISOString()).run();
 await env.DB.prepare("INSERT INTO page_aliases VALUES('http://www.mavibasim.com/brosur','https://mavibasim.com/brosur',?,'TEST independent verified redirect evidence')").bind(TIME.toISOString()).run();
 const p=await performance(cfg,'2026-08',null,TIME);expect(p.products.find(r=>r.id==='brosur')?.current?.clicks).toBe(30);
 const report=await analyze(cfg,'2026-08',TIME);expect(report.products.find(r=>r.id==='brosur')?.current?.clicks).toBe(30);expect(await validateAnalysis(cfg,report)).toEqual([]);
});
it('a tampered foreign raw record is rejected by both dashboard and independent data audit',async()=>{
 const cfg=await seedObserved();
 await env.DB.prepare("UPDATE gsc_daily_by_page SET page='https://evil.example/brosur' WHERE page LIKE '%www.%'").run();
 const p=await performance(cfg,'2026-08',null,TIME);expect(p.series.find(r=>r.day===DAY)?.verified).toBe(false);expect(p.current).toBeNull();
 const report=await analyze(cfg,'2026-08',TIME);const audit=await dataIntegrity(cfg,'2026-08',TIME);
 expect(audit.issues.some(i=>i.source==='gsc'&&i.code==='INVALID_SOURCE_URL')).toBe(true);
});
it('observed http/www URLs never expand the network crawler allowlist',async()=>{
 const cfg=await seedObserved();await seedCrawl({...cfg,CRAWL_ENABLED:'true'});
 expect(await env.DB.prepare("SELECT count(*) n FROM crawl_queue WHERE url LIKE 'http:%' OR url LIKE '%www.%'").first()).toMatchObject({n:0});
 expect(siteURL('https://www.mavibasim.com/brosur')).toBeNull();expect(siteURL('http://mavibasim.com/brosur')).toBeNull();
 expect(sitemapURLs('<urlset><url><loc>https://www.mavibasim.com/brosur</loc></url><url><loc>https://mavibasim.com/brosur</loc></url></urlset>')).toEqual([{url:'https://mavibasim.com/brosur',kind:'page'}]);
});
