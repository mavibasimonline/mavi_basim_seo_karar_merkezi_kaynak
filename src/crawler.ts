import robotsParser from 'robots-parser';
import { XMLParser } from 'fast-xml-parser';
import { Env, Fetch, hash, nowISO } from './types';
import { boundedText, ProviderError } from './google';
import { siteURL } from './urls';

const AGENT = 'MaviBasimSeoBot';
export interface Snapshot {
  status: number; redirect: string | null; canonical: string[]; robots: string[]; x_robots: string | null;
  title: string; description: string; headings: { level: number; text: string }[];
  links: string[]; hreflang: { language: string; href: string }[];
  images: { src: string; alt: string | null }[]; structured_data: unknown[];
  viewport: string | null; lang: string | null; body_hash: string; excerpt: string; rendering: 'static-html';
}
export async function parseHTML(html: string, url: string, status = 200, headers = new Headers()): Promise<Snapshot> {
  const result: Snapshot = { status,redirect:headers.get('location'),canonical:[],robots:[],x_robots:headers.get('x-robots-tag'),title:'',description:'',headings:[],links:[],hreflang:[],images:[],structured_data:[],viewport:null,lang:null,body_hash:'',excerpt:'',rendering:'static-html' };
  const body: string[] = [];
  const links = new Set<string>();
  const rewriter = new HTMLRewriter()
    .on('title', { text(t) { result.title += t.text; } })
    .on('html', { element(e) { result.lang = e.getAttribute('lang'); } })
    .on('meta', { element(e) {
      const name = e.getAttribute('name')?.toLowerCase(), content = e.getAttribute('content') || '';
      if (name === 'description') result.description = content;
      if (name === 'robots' || name === 'googlebot') result.robots.push(content);
      if (name === 'viewport') result.viewport = content;
    } })
    .on('link', { element(e) {
      const rel = (e.getAttribute('rel') || '').toLowerCase().split(/\s+/), href = e.getAttribute('href');
      if (!href) return;
      if (rel.includes('canonical')) { try { result.canonical.push(new URL(href,url).href); } catch { result.canonical.push(href); } }
      if (rel.includes('alternate') && e.getAttribute('hreflang')) result.hreflang.push({language:e.getAttribute('hreflang')!,href});
    } })
    .on('a[href]', { element(e) { const link=siteURL(e.getAttribute('href')!,url); if (link && links.size<500) links.add(link); } })
    .on('img', { element(e) { if(result.images.length<100)result.images.push({src:e.getAttribute('src') || '',alt:e.getAttribute('alt')}); } })
    .on('body', { text(t) { body.push(t.text); } });
  for(let level=1;level<=6;level++) {
    let index=-1;
    rewriter.on(`h${level}`, { element() { index=result.headings.length;result.headings.push({level,text:''}); }, text(t) { if(index>=0)result.headings[index].text+=t.text; } });
  }
  let jsonld='';
  rewriter.on('script[type="application/ld+json"]',{element(e){jsonld='';e.onEndTag(()=>{try{result.structured_data.push(JSON.parse(jsonld));}catch{result.structured_data.push({invalid_json:true});}});},text(t){jsonld+=t.text;}});
  await rewriter.transform(new Response(html)).text();
  result.title=result.title.trim();
  result.headings=result.headings.map(h=>({...h,text:h.text.trim()}));
  result.links=[...links].sort();
  const text=body.join('').replace(/\s+/g,' ').trim();
  result.excerpt=text.slice(0,2000);
  result.body_hash=await hash(text);
  return result;
}
export function snapshotDiff(previous: Snapshot, next: Snapshot): Record<string,{old:unknown;new:unknown}> {
  const diff:Record<string,{old:unknown;new:unknown}>={};
  // Error/redirect bodies do not prove that the site's title or content was removed.
  const keys:(keyof Snapshot)[]=previous.status===200&&next.status===200?Object.keys(next) as (keyof Snapshot)[]:['status','redirect'];
  for(const key of keys) if(JSON.stringify(previous[key])!==JSON.stringify(next[key])) diff[key]={old:previous[key],new:next[key]};
  return diff;
}
export function findings(snapshot: Snapshot, url: string): {code:string;severity:string;evidence:unknown}[] {
  const issues:{code:string;severity:string;evidence:unknown}[]=[];
  const add=(code:string,severity:string,evidence:unknown)=>issues.push({code,severity,evidence});
  if(snapshot.status>=400)add(`HTTP_${snapshot.status}`,'yüksek',{status:snapshot.status});
  if(snapshot.status>=300&&snapshot.status<400)add('REDIRECT','incele',{location:snapshot.redirect});
  if(/noindex/i.test([...snapshot.robots,snapshot.x_robots||''].join(',')))add('NOINDEX','incele',{robots:snapshot.robots,x_robots:snapshot.x_robots});
  if(snapshot.status===200){
    if(!snapshot.title)add('TITLE_MISSING','orta',{});
    if(!snapshot.description)add('DESCRIPTION_MISSING','düşük',{});
    if(!snapshot.headings.some(h=>h.level===1))add('H1_MISSING','orta',{});
    if(snapshot.canonical.length!==1)add('CANONICAL_COUNT','incele',{canonical:snapshot.canonical});
    else if(siteURL(snapshot.canonical[0],url)!==siteURL(url))add('CANONICAL_OTHER','incele',{canonical:snapshot.canonical[0],url});
    if(!snapshot.viewport)add('VIEWPORT_MISSING','incele',{limit:'JS ve gerçek cihaz render kontrolü yapılmadı.'});
    if(snapshot.images.some(i=>i.alt===null))add('IMAGE_ALT_MISSING','düşük',{count:snapshot.images.filter(i=>i.alt===null).length});
  }
  return issues;
}
export async function saveSnapshot(env: Env, crawlId: string, url: string, snapshot: Snapshot, observed=nowISO()): Promise<string> {
  const id=crypto.randomUUID();
  const previous=await env.DB.prepare('SELECT * FROM seo_snapshots WHERE url=? AND (?<>200 OR json_extract(snapshot_json,\'$.status\')=200) ORDER BY observed_at DESC,rowid DESC LIMIT 1').bind(url,snapshot.status).first<{id:string;observed_at:string;snapshot_json:string}>();
  const statements=[env.DB.prepare('INSERT INTO seo_snapshots VALUES(?,?,?,?,?,?)').bind(id,crawlId,url,observed,await hash(JSON.stringify(snapshot)),JSON.stringify(snapshot))];
  if(previous){
    const diff=snapshotDiff(JSON.parse(previous.snapshot_json),snapshot);
    if(Object.keys(diff).length)statements.push(env.DB.prepare('INSERT INTO seo_change_events(id,url,previous_snapshot_id,next_snapshot_id,observed_from,observed_to,diff_json) VALUES(?,?,?,?,?,?,?)')
      .bind(crypto.randomUUID(),url,previous.id,id,previous.observed_at,observed,JSON.stringify(diff)));
  }
  for(const issue of findings(snapshot,url))statements.push(env.DB.prepare('INSERT INTO crawl_findings VALUES(?,?,?,?,?,?,?)').bind(crypto.randomUUID(),id,url,issue.code,issue.severity,JSON.stringify(issue.evidence),observed));
  await env.DB.batch(statements);
  return id;
}
interface Policy { robots_text:string;fetched_at:string;next_request_at:string }
async function policy(env: Env, fetcher: Fetch): Promise<{parser:ReturnType<typeof robotsParser>;ready:boolean}> {
  let stored=await env.DB.prepare('SELECT * FROM crawl_policies WHERE origin=?').bind('https://mavibasim.com').first<Policy>();
  if(!stored||Date.now()-Date.parse(stored.fetched_at)>86400_000){
    let response:Response;
    try { response=await fetcher('https://mavibasim.com/robots.txt',{headers:{'User-Agent':AGENT},redirect:'manual',signal:AbortSignal.timeout(15_000)}); }
    catch { throw new ProviderError('ROBOTS_NETWORK_UNAVAILABLE',true); }
    if(response.status!==200&&response.status!==404)throw new ProviderError(`ROBOTS_HTTP_${response.status}`,true);
    const text=response.status===404?'':await boundedText(response,256_000);
    const stamp=nowISO();
    const next=new Date(Date.now()+5000).toISOString();
    await env.DB.prepare('INSERT INTO crawl_policies VALUES(?,?,?,?) ON CONFLICT(origin) DO UPDATE SET robots_text=excluded.robots_text,fetched_at=excluded.fetched_at,next_request_at=excluded.next_request_at')
      .bind('https://mavibasim.com',text,stamp,next).run();
    stored={robots_text:text,fetched_at:stamp,next_request_at:next};
  }
  return {parser:robotsParser('https://mavibasim.com/robots.txt',stored.robots_text),ready:Date.parse(stored.next_request_at)<=Date.now()};
}
export function sitemapURLs(xml: string): {url:string;kind:'page'|'sitemap'}[] {
  if(/<!DOCTYPE|<!ENTITY/i.test(xml))throw new ProviderError('UNSAFE_SITEMAP_XML');
  const doc=new XMLParser({ignoreAttributes:true,processEntities:false,isArray:(name)=>name==='url'||name==='sitemap'}).parse(xml);
  const source=doc.sitemapindex?.sitemap||doc.urlset?.url;
  if(!Array.isArray(source))throw new ProviderError('INVALID_SITEMAP');
  if(source.length>2000)throw new ProviderError('SITEMAP_URL_LIMIT_EXCEEDED');
  return source.flatMap((item:{loc?:unknown})=>{
    const url=typeof item.loc==='string'?siteURL(item.loc):null;
    return url?[{url,kind:doc.sitemapindex?'sitemap' as const:'page' as const}]:[];
  });
}
async function mapVerifiedPage(env:Env,url:string,snapshot:Snapshot,observed:string):Promise<void>{
  if(snapshot.status!==200||snapshot.canonical.length!==1||siteURL(snapshot.canonical[0],url)!==url)return;
  const slug=new URL(url).pathname.split('/').filter(Boolean).at(-1)||'';
  const candidates=await env.DB.prepare('SELECT id,canonical_url FROM products WHERE canonical_url=? OR id=?').bind(url,slug).all<{id:string;canonical_url:string|null}>();
  if(candidates.results.length!==1)return;
  const product=candidates.results[0];
  if(product.canonical_url&&product.canonical_url!==url)return;
  await env.DB.batch([
    env.DB.prepare('UPDATE products SET canonical_url=?,url_verified_at=? WHERE id=? AND (canonical_url IS NULL OR canonical_url=?)').bind(url,observed,product.id,url),
    env.DB.prepare("UPDATE pages SET product_id=?,canonical_url=?,mapping_source='crawl-200-self-canonical-exact-slug' WHERE url=?").bind(product.id,url,url),
  ]);
}
export async function seedCrawl(env: Env): Promise<void> {
  if(env.CRAWL_ENABLED!=='true')return;
  const stamp=nowISO();
  const products=await env.DB.prepare('SELECT canonical_url FROM products WHERE canonical_url IS NOT NULL').all<{canonical_url:string}>();
  const gsc=await env.DB.prepare('SELECT DISTINCT page FROM gsc_daily_by_page ORDER BY date DESC LIMIT 20').all<{page:string}>();
  const observedProducts=await env.DB.prepare("SELECT DISTINCT g.page FROM gsc_daily_by_page g JOIN products p ON rtrim(g.page,'/')='https://mavibasim.com/'||p.id ORDER BY g.page LIMIT 29").all<{page:string}>();
  const seeds=[{url:'https://mavibasim.com/sitemap.xml',kind:'sitemap'}, {url:'https://mavibasim.com/',kind:'page'}, ...observedProducts.results.map(p=>({url:p.page,kind:'page'})),...products.results.map(p=>({url:p.canonical_url,kind:'page'})),...gsc.results.map(p=>({url:p.page,kind:'page'}))];
  const unique=[...new Map(seeds.flatMap(s=>{const url=siteURL(s.url);return url?[[url,{url,kind:s.kind}]] as const:[];})).values()];
  // One D1 statement, even when all products have been observed by Google.
  await env.DB.prepare("INSERT OR IGNORE INTO crawl_queue(url,kind,next_crawl_at) SELECT json_extract(value,'$.url'),json_extract(value,'$.kind'),? FROM json_each(?)").bind(stamp,JSON.stringify(unique)).run();
}
export async function crawlOne(env: Env, fetcher: Fetch=fetch): Promise<void> {
  if(env.CRAWL_ENABLED!=='true')return;
  const time=nowISO(),lease=crypto.randomUUID();
  const queued=await env.DB.prepare(`UPDATE crawl_queue SET lease_token=?,lease_until=? WHERE url=(SELECT url FROM crawl_queue WHERE next_crawl_at<=? AND (lease_until IS NULL OR lease_until<?) ORDER BY CASE WHEN EXISTS(SELECT 1 FROM products p WHERE rtrim(crawl_queue.url,'/')='https://mavibasim.com/'||p.id) THEN 0 WHEN kind='sitemap' THEN 1 ELSE 2 END,next_crawl_at,url LIMIT 1) RETURNING *`)
    .bind(lease,new Date(Date.now()+120_000).toISOString(),time,time).first<{url:string;kind:string;attempts:number;depth:number}>();
  if(!queued)return;
  const id=crypto.randomUUID();
  await env.DB.prepare('INSERT INTO crawls(id,url,started_at) VALUES(?,?,?)').bind(id,queued.url,time).run();
  try{
    const {parser,ready}=await policy(env,fetcher);
    if(parser.isAllowed(queued.url,AGENT)===false)throw new ProviderError('ROBOTS_DISALLOWED');
    if(!ready)throw new ProviderError('CRAWL_DELAY',true,5);
    const delay=Math.max(5,parser.getCrawlDelay(AGENT)||0);
    // Atomically reserve the site's request budget across concurrent invocations.
    const reserved=await env.DB.prepare('UPDATE crawl_policies SET next_request_at=? WHERE origin=? AND next_request_at<=? RETURNING origin')
      .bind(new Date(Date.now()+delay*1000).toISOString(),'https://mavibasim.com',nowISO()).first();
    if(!reserved)throw new ProviderError('CRAWL_DELAY',true,delay);
    const response=await fetcher(queued.url,{headers:{'User-Agent':AGENT,'Accept':'text/html,application/xml,text/xml'},redirect:'manual',signal:AbortSignal.timeout(15_000)});
    await env.DB.prepare('UPDATE crawls SET status_code=?,robots_allowed=1,response_headers_json=? WHERE id=?')
      .bind(response.status,JSON.stringify({content_type:response.headers.get('content-type'),location:response.headers.get('location'),'x-robots-tag':response.headers.get('x-robots-tag')}),id).run();
    const discovered:{url:string;kind:'page'|'sitemap'}[]=[];
    const text=await boundedText(response,1_500_000);
    if(queued.kind==='sitemap'){
      if(response.status!==200)throw new ProviderError(`SITEMAP_HTTP_${response.status}`,response.status>=500);
      discovered.push(...sitemapURLs(text));
    }else{
      const html=response.headers.get('content-type')?.includes('text/html')?text:'';
      const snapshot=await parseHTML(html,queued.url,response.status,response.headers);
      await saveSnapshot(env,id,queued.url,snapshot);
      if(queued.depth<4)discovered.push(...snapshot.links.map(url=>({url,kind:'page' as const})));
      const redirect=siteURL(response.headers.get('location')||'',queued.url);
      if(response.status>=300&&response.status<400&&redirect)discovered.push({url:redirect,kind:'page'});
      await env.DB.prepare('INSERT OR IGNORE INTO pages(url,discovered_at,mapping_source) VALUES(?,?,?)').bind(queued.url,time,'crawl').run();
      await mapVerifiedPage(env,queued.url,snapshot,time);
    }
    // Bounded discovery per invocation; remaining sitemap URLs are revisited on subsequent daily crawls.
    const existing=await env.DB.prepare('SELECT url FROM crawl_queue LIMIT 1001').all<{url:string}>();
    const known=new Set(existing.results.map(r=>r.url));
    const slots=Math.max(0,Math.min(20,1000-known.size));
    const candidates=[...new Map(discovered.filter(d=>!known.has(d.url)).map(d=>[d.url,d])).values()];
    const statements=candidates.slice(0,slots).map(item=>env.DB.prepare('INSERT OR IGNORE INTO crawl_queue(url,kind,depth,next_crawl_at) VALUES(?,?,?,?)').bind(item.url,item.kind,queued.depth+1,time));
    for(const candidate of parser.getSitemaps().slice(0,3)){const url=siteURL(candidate);if(url)statements.push(env.DB.prepare('INSERT OR IGNORE INTO crawl_queue(url,kind,next_crawl_at) VALUES(?,?,?)').bind(url,'sitemap',time));}
    statements.push(env.DB.prepare('UPDATE crawls SET finished_at=? WHERE id=?').bind(nowISO(),id));
    statements.push(env.DB.prepare('UPDATE crawl_queue SET next_crawl_at=?,attempts=0,last_error=NULL,lease_until=NULL,lease_token=NULL WHERE url=? AND lease_token=?').bind(new Date(Date.now()+86400_000).toISOString(),queued.url,lease));
    await env.DB.batch(statements);
  }catch(error){
    const failure=error instanceof ProviderError?error:new ProviderError('CRAWL_NETWORK_OR_PARSE_ERROR',true);
    const attempts=queued.attempts+Number(failure.code!=='CRAWL_DELAY');
    const wait=failure.code==='ROBOTS_DISALLOWED'?86400:Math.max(failure.retryAfterSeconds,Math.min(86400,60*2**Math.min(attempts,10)));
    await env.DB.batch([
      env.DB.prepare('UPDATE crawls SET finished_at=?,error_code=? WHERE id=?').bind(nowISO(),failure.code,id),
      env.DB.prepare('UPDATE crawl_queue SET attempts=?,last_error=?,next_crawl_at=?,lease_until=NULL,lease_token=NULL WHERE url=? AND lease_token=?')
        .bind(attempts,failure.code,new Date(Date.now()+wait*1000).toISOString(),queued.url,lease),
    ]);
  }
}
