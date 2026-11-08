// One-off, evidence-only 8 November 2026 SEO inventory for the owned site's sitemap.
// Dates are real observation times. Prior ledger revisions are append-only; no live-site writes.
import {readIndependentContext} from './independent-context';
import {resolvedCatalog} from './independent-catalog';
import {tayfunSitemap} from './tayfun-sitemap';
import {tayfunAutoTick,tayfunAutoMonth,tayfunAutoDetail} from './tayfun-auto';
import {tayfunList,tayfunSave} from './tayfun-ledger';
import {gscPageURL} from './urls';

type Store={get<T=unknown>(key:string):Promise<T|undefined>;put(key:string,value:unknown):Promise<unknown>};
type Captured={url:string;observed_at:string;source_id:string;title:string;ledger_id?:string};
type ErrorRecord={code:string;tries:number;last_attempt?:string};
type Progress={version:1;reference_day:string;last_run:string;pages:Record<string,Captured>;errors:Record<string,ErrorRecord>};
const TARGET='2026-11-08', KEY='tayfun:site-seo:capture:'+TARGET+':v1';
const productPaths=['/adisyon','/afis','/ambalaj','/amerikan-servis','/antetli','/arac-kiralama',
 '/bloknotlar','/brosur','/dosyalar','/el-ilani','/etiket','/gider-makbuzu',
 '/karton-canta','/kartvizit','/kataloglar','/kitap-ayraci','/kutu',
 '/kup-bloknot','/magnet','/oto-paspas','/para-makbuzu','/recete',
 '/sigorta-policeleri','/siparis-fisi','/sozlesme-baski','/tahsilat-makbuzu',
 '/tediye-makbuzu','/yag-karti','/zarf'];
const preferred=new Set(productPaths.map(path=>'https://mavibasim.com'+path));
const localDay=(date:Date)=>{
 const values=new Intl.DateTimeFormat('en-US',{timeZone:'Europe/Istanbul',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(date);
 const parts=Object.fromEntries(values.map(x=>[x.type,x.value]));
 return parts.year+'-'+parts.month+'-'+parts.day;
};
const initial=():Progress=>({version:1,reference_day:TARGET,last_run:'',pages:{},errors:{}});
const fmt=(x:unknown,max:number)=>typeof x==='string'?x.slice(0,max):x===undefined||x===null?'':JSON.stringify(x).slice(0,max);
const validTitle=(x:unknown):x is string=>typeof x==='string'&&x.trim().length>0;
export async function tayfunSiteSeoStatus(storage:Store,now=new Date()){
 const saved=await storage.get<Progress>(KEY)||initial();
 const sitemap=await tayfunSitemap(storage,fetch,now);
 const urls=sitemap.urls;
 const captured=urls.map(url=>saved.pages[url]).filter((v):v is Captured=>!!v);
 const pending=urls.length-captured.length;
 const failures=urls.filter(url=>!saved.pages[url]&&saved.errors[url]?.tries>=3)
  .map(url=>({url,code:saved.errors[url].code}));
 return {reference_day:TARGET,clock_day:localDay(now),last_run:saved.last_run,
  sitemap_source:sitemap.source,stale_sitemap:sitemap.stale,expected_urls:urls.length,
  captured_count:captured.length,product_pages_captured:captured.filter(r=>preferred.has(r.url)).length,
  product_pages_total:urls.filter(url=>preferred.has(url)).length,
  pending_count:pending,failures,items:captured,complete:pending===0&&urls.length>0,
  historical_dates_unchanged:true,live_site_modified:false,storage:'Private encrypted Tayfun SEO archive',
  note:'Yalnız 200 HTML dönen ve robots.txt izinli canlı sayfalar. Tarih gerçek tarama zamanıdır; site yayını tarihi değildir.'};
}
export async function tayfunSiteSeoTick(storage:Store,secret:string,now=new Date(),maxPages=24){
 if(localDay(now)<TARGET)return {status:'outside_reference_day',reference_day:TARGET,actual_day:localDay(now),site_mutations:0};
 const sitemap=await tayfunSitemap(storage,fetch,now);
 if(!sitemap.urls.length)return {status:'held',code:'SITEMAP_UNAVAILABLE',reference_day:TARGET,site_mutations:0};
 const urls=[...sitemap.urls].sort((a,b)=>Number(preferred.has(b))-Number(preferred.has(a))||a.localeCompare(b));
 const saved=await storage.get<Progress>(KEY)||initial();
 if(saved.version!==1||saved.reference_day!==TARGET)throw Error('TAYFUN_SITE_CAPTURE_STATE_INVALID');
 const context=await readIndependentContext(storage);
 const catalog=await resolvedCatalog(storage,secret,context);
 const productSet=new Set([...preferred,...catalog.products.map(p=>p.canonical_url)]);
 const month=now.toISOString().slice(0,7),oldLedger=await tayfunList(storage,secret,month);
 const latest=new Map<string,(typeof oldLedger.entries)[number]>();
 for(const entry of oldLedger.entries)latest.set(entry.url,entry);
 const remaining=urls.filter(u=>{
  if(saved.pages[u])return false;
  const error=saved.errors[u];
  if(!error)return true;
  if(['ROBOTS_DISALLOW','NON_HTML_RESPONSE'].includes(error.code))return false;
  return error.tries<3||now.getTime()-Date.parse(error.last_attempt||saved.last_run||'1970-01-01T00:00:00Z')>=45*60000;
 });
 let attempted=0,recorded=0,held=0;
 const started=Date.now();
 for(const url of remaining){
  if(attempted>=Math.max(1,Math.min(30,maxPages))||Date.now()-started>22000)break;
  attempted++;
  try{
   const at=new Date(),result=await tayfunAutoTick(storage,secret,fetch,at,url);
   if(result.status!=='archived'&&result.status!=='unchanged'){
    const previous=saved.errors[url];
    saved.errors[url]={code:('code' in result&&typeof result.code==='string'?result.code:result.status).slice(0,70),tries:(previous?.tries||0)+1,last_attempt:at.toISOString()};
    held++;await storage.put(KEY,saved);continue;
   }
   const monthData=await tayfunAutoMonth(storage,month);
   const source=[...monthData.observations].reverse().find(row=>row.url===url&&row.status===200);
   if(!source)throw Error('TAYFUN_SITE_SOURCE_NOT_SAVED');
   const detail=await tayfunAutoDetail(storage,secret,source.id);
   if(!detail||detail.url!==url||!validTitle(detail.seo?.title))throw Error('TAYFUN_SITE_SEO_NOT_VERIFIED');
   const original=detail.seo,headings=Array.isArray(original.headings)?original.headings:[];
   const canonical=Array.isArray(original.canonical)?original.canonical[0]:original.canonical;
   let ledgerId:string|undefined;
   if(productSet.has(url)){
    const prior=latest.get(url);
    const existing=prior?.notes?.includes('TAYFUN_SITE_CAPTURE:'+TARGET+':'+url);
    if(existing&&prior)ledgerId=prior.id;
    else {
     const created=await tayfunSave(storage,secret,{
      month,url,source:'user-entry',status:'aktif',supersedes:prior?.id||null,
      title:fmt(original.title,300),description:fmt(original.description,1000),
      h1:headings.filter((h:any)=>h?.level===1&&typeof h.text==='string').map((h:any)=>h.text).join(' / ').slice(0,500),
      canonical:typeof canonical==='string'&&gscPageURL(canonical)===canonical?canonical:'',
      robots:fmt(original.robots,200),headings:fmt(headings,20000),internal_links:fmt(original.links,20000),
      structured_data:fmt(original.structured_data,65536),hreflang:fmt(original.hreflang,2500),
      images:fmt(original.images,2500),open_graph:fmt(original.open_graph,2500),twitter_card:fmt(original.twitter_card,2500),
      x_robots:fmt(original.x_robots,200),viewport:fmt(original.viewport,500),lang:fmt(original.lang,100),
      redirect:fmt(original.redirect,2048),status_code:'200',
      content_excerpt:fmt(original.excerpt,5000),keywords:prior?.keywords||[],
      notes:('TAYFUN_SITE_CAPTURE:'+TARGET+':'+url+' İstek tarihi: 8 Kasım 2026. Gerçek tarama günü: '+localDay(at)+'; '+
       'doğrulama: '+at.toISOString()+'; kaynak: tayfun:auto:'+source.id+'; hash: '+source.hash+
       '; içerik değişimi yalnız hash ile karşılaştırılır. Siteye uygulanmadı.').slice(0,2500)
     },at);
     ledgerId=created.entry.id;latest.set(url,created.entry);
    }
   }
   saved.pages[url]={url,observed_at:at.toISOString(),source_id:source.id,title:detail.seo.title,ledger_id:ledgerId};
   delete saved.errors[url];recorded++;
  }catch(error){
   const code=error instanceof Error&&/^TAYFUN_[A-Z_]+$/.test(error.message)?error.message:'TAYFUN_SITE_CAPTURE_UNAVAILABLE';
   const previous=saved.errors[url];saved.errors[url]={code,tries:(previous?.tries||0)+1,last_attempt:new Date().toISOString()};held++;
  }
  saved.last_run=new Date().toISOString();
  await storage.put(KEY,saved);
  // Respect the live site's origin; never send a burst of parallel crawls.
  await new Promise(resolve=>setTimeout(resolve,150));
 }
 return {status:Object.keys(saved.pages).length===urls.length?'complete':recorded?'recorded':held?'partial':'throttled',reference_day:TARGET,actual_day:localDay(now),
  attempted,recorded,held,captured_count:Object.keys(saved.pages).length,total:urls.length,
  remaining:urls.length-Object.keys(saved.pages).length,last_run:saved.last_run,
  site_mutations:0,d1_requests:0,immutable:true};
}
