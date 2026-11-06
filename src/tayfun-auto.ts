// Incremental, immutable SEO observations for every URL discoverable from the owned site's sitemap.
// Runs one URL per existing 15-minute Cron, inside the existing encrypted independent archive.
// Never edits live pages, erases old observations, touches D1, or invents historical capture dates.
import {parseHTML} from './crawler';
import {boundedText} from './google';
import {encrypt,decrypt} from './security';
import {siteURL} from './urls';
import robotsParser from 'robots-parser';
import {tayfunSitemap} from './tayfun-sitemap';

type Storage={get<T=unknown>(key:string):Promise<T|undefined>;put(key:string,value:unknown):Promise<unknown>};
type RecordSummary={id:string;url:string;month:string;observed_at:string;status:number;hash:string;title:string;changed:boolean;prior_id:string|null};
type AutoObservation=RecordSummary&{seo:Record<string,unknown>;source:'live-static-html';full_content_saved:boolean;limitations:string[]};
type MonthlyIndex={version:1;observations:RecordSummary[];updated_at:string};
type Progress={version:1;cursor:number;processed:number;last_run:string;last_url:string|null;last_error:string|null};
const ROOT='tayfun:auto:v1:',MONTH=ROOT+'month:',RECORD=ROOT+'observation:',LATEST=ROOT+'last:',PROGRESS=ROOT+'progress';
const MAX_PER_MONTH=2600,MAX_HTML=1_500_000;
const owned=(url:string)=>typeof url==='string'&&siteURL(url)===url;
const validMonth=(m:string)=>/^20\d{2}-(0[1-9]|1[0-2])$/.test(m);
const sha=async(source:string)=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(source)))).map(b=>b.toString(16).padStart(2,'0')).join('');
const idFor=async(url:string)=>sha(url);
async function monthIndex(storage:Storage,month:string):Promise<MonthlyIndex>{
 const existing=await storage.get<MonthlyIndex>(MONTH+month);
 if(!existing)return {version:1,observations:[],updated_at:''};
 if(existing.version!==1||!Array.isArray(existing.observations)||existing.observations.length>MAX_PER_MONTH)throw Error('TAYFUN_AUTO_INDEX_INVALID');
 return existing;
}
export async function tayfunAutoMonth(storage:Storage,month:string){
 if(!validMonth(month))throw Error('TAYFUN_INPUT_INVALID');
 const index=await monthIndex(storage,month),progress=await storage.get<Progress>(PROGRESS);
 const unique=new Set(index.observations.map(r=>r.url));
 return {month,observations:index.observations,observed_urls:unique.size,observations_count:index.observations.length,
  updated_at:index.updated_at,progress:progress||null,full_site_verified:false,coverage_note:'Kayıtlar gerçek tarama zamanında oluşur; ayın ilk gününe ait olduğu veya bütün sayfaların tarandığı varsayılmaz.',d1_requests:0};
}
export async function tayfunAutoDetail(storage:Storage,secret:string,id:string){
 if(!/^[a-f0-9-]{36}$/.test(id))throw Error('TAYFUN_INPUT_INVALID');
 const raw=await storage.get<string>(RECORD+id);
 if(!raw)return null;
 return decrypt<AutoObservation>(raw,secret);
}
export async function tayfunAutoTick(storage:Storage,secret:string,fetcher:typeof fetch=fetch,now=new Date()){
 const month=now.toISOString().slice(0,7);
 const old=await storage.get<Progress>(PROGRESS)||{version:1,cursor:0,processed:0,last_run:'',last_url:null,last_error:null};
 if(old.version!==1)throw Error('TAYFUN_AUTO_PROGRESS_INVALID');
 const sitemap=await tayfunSitemap(storage,fetcher,now);
 const urls=sitemap.urls.filter(owned);
 if(!urls.length)return {status:'held',reason:'TAYFUN_SITEMAP_EMPTY',month,sitemap_stale:sitemap.stale,processed:old.processed,d1_requests:0,site_writes:0};
 const cursor=old.cursor%urls.length,url=urls[cursor],nextCursor=(cursor+1)%urls.length;
 // Always move ahead, including on temporary network failures, to avoid starvation.
 const progress:Progress={version:1,cursor:nextCursor,processed:old.processed+1,last_run:now.toISOString(),last_url:url,last_error:null};
 const advance=async(code:string|null)=>{progress.last_error=code;await storage.put(PROGRESS,progress);};
 try{
  const robots=await storage.get<{at:string;text:string}>(ROOT+'robots');
  let robotsText=robots?.text||'';
  if(!robots||now.getTime()-Date.parse(robots.at)>86400000){
   const response=await fetcher('https://mavibasim.com/robots.txt',{redirect:'manual',signal:AbortSignal.timeout(3500)});
   if(response.ok)robotsText=await boundedText(response,100_000);
   await storage.put(ROOT+'robots',{at:now.toISOString(),text:robotsText});
  }
  // RFC 9309 matching, including wildcard and longest-match Allow/Disallow rules.
  // If robots is unavailable without a verified cached copy, hold rather than crawling unapproved paths.
  if(!robotsText){await advance('ROBOTS_UNAVAILABLE');return {status:'held',code:'ROBOTS_UNAVAILABLE',month,url,site_writes:0,d1_requests:0};}
  if(robotsParser('https://mavibasim.com/robots.txt',robotsText).isAllowed(url,'MaviBasimSeoBot')===false){
   await advance('ROBOTS_DISALLOW');return {status:'skipped',code:'ROBOTS_DISALLOW',month,url,site_writes:0,d1_requests:0};
  }
  const response=await fetcher(url,{redirect:'manual',signal:AbortSignal.timeout(10000),headers:{Accept:'text/html','User-Agent':'MaviBasimSeoBot'}});
  if(response.status!==200){await advance('HTTP_'+response.status);return {status:'held',code:'HTTP_'+response.status,url,month,site_writes:0,d1_requests:0};}
  if(!/text\/html/i.test(response.headers.get('content-type')||'')){await advance('NON_HTML_RESPONSE');return {status:'skipped',code:'NON_HTML_RESPONSE',url,month,site_writes:0,d1_requests:0};}
  if(Number(response.headers.get('content-length')||0)>MAX_HTML)throw Error('TAYFUN_HTML_TOO_LARGE');
  const html=await boundedText(response,MAX_HTML);
  const seo=await parseHTML(html,url,200,response.headers);
  // Extra head tags that the site's existing crawl parser did not extract.
  const social:Record<string,string>={},twitter:Record<string,string>={},meta:Record<string,string>={},all_meta:Record<string,string>={};
  await new HTMLRewriter().on('meta',{element(e){
   const key=e.getAttribute('property')||e.getAttribute('name')||'',value=e.getAttribute('content')||'';
   if(key&&Object.keys(all_meta).length<120)all_meta[key.slice(0,100)]=value.slice(0,2000);
   if(key.startsWith('og:')&&Object.keys(social).length<40)social[key]=value.slice(0,2000);
   else if(key.startsWith('twitter:')&&Object.keys(twitter).length<40)twitter[key]=value.slice(0,2000);
   else if(['keywords','author','googlebot','theme-color'].includes(key.toLowerCase()))meta[key.toLowerCase()]=value.slice(0,2000);
  }}).transform(new Response(html)).text();
  const details={...seo,open_graph:social,twitter_card:twitter,other_meta:meta,all_meta,
   response_headers:{content_language:response.headers.get('content-language'),last_modified:response.headers.get('last-modified'),etag:response.headers.get('etag'),link:response.headers.get('link')?.slice(0,2000)||null}};
  const hash=await sha(JSON.stringify(details)),urlHash=await idFor(url);
  const before=await storage.get<{id:string;hash:string}>(LATEST+urlHash);
  const monthState=await monthIndex(storage,month);
  // A→B→A is three genuine versions: compare to the latest observed state,
  // not to any earlier hash in the month.
  const latestInMonth=[...monthState.observations].reverse().find(r=>r.url===url);
  if(latestInMonth?.hash===hash){
   await advance(null);return {status:'unchanged',month,url,observed_at:now.toISOString(),stored:false,site_writes:0,d1_requests:0};
  }
  if(monthState.observations.length>=MAX_PER_MONTH){await advance('TAYFUN_MONTH_ARCHIVE_LIMIT');return {status:'held',code:'TAYFUN_MONTH_ARCHIVE_LIMIT',month,site_writes:0,d1_requests:0};}
  const id=crypto.randomUUID(),summary:RecordSummary={id,url,month,observed_at:now.toISOString(),status:200,hash,title:seo.title,changed:!!before&&before.hash!==hash,prior_id:before?.id||null};
  const item:AutoObservation={...summary,seo:details,source:'live-static-html',full_content_saved:false,limitations:[
   'Kaydedilen sayfa özeti, metnin tamamı değildir; gövde SHA-256 hash ile izlenir.',
   'Tarama zamanı SEO yayın zamanı değildir; JavaScript ile sonradan oluşan içerik doğrulanmaz.'
  ]};
  // Encrypted record is immutable; monthly index holds only slim metadata.
  await storage.put(RECORD+id,await encrypt(item,secret));
  await storage.put(MONTH+month,{version:1,observations:[...monthState.observations,summary],updated_at:now.toISOString()});
  await storage.put(LATEST+urlHash,{id,hash});
  await advance(null);
  return {status:'archived',month,url,id,changed:summary.changed,observed_at:summary.observed_at,site_writes:0,d1_requests:0};
 }catch(error){
  const code=error instanceof Error&&/^TAYFUN_[A-Z_]+$/.test(error.message)?error.message:'TAYFUN_AUTO_CRAWL_UNAVAILABLE';
  await advance(code);
  return {status:'held',month,url,code,site_writes:0,d1_requests:0};
 }
}
