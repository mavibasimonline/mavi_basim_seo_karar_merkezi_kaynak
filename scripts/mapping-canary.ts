// Authorized loopback-only acceptance of the deployed crawler code on real D1.
// No report, Google or deployment route is mounted here.
import {Env,json} from '../src/types';
import {crawlOne} from '../src/crawler';
import {withReadBudget} from '../src/d1-read-budget';
export function createCanary(crawl:typeof crawlOne=crawlOne,wait:(ms:number)=>Promise<void>=ms=>new Promise(resolve=>setTimeout(resolve,ms))){
 let used=false;
 return {async fetch(request:Request,env:Env){
  const url=new URL(request.url);
  if(!['127.0.0.1','localhost'].includes(url.hostname))return json({error:'LOCAL_ONLY'},403);
  if(url.pathname==='/health')return json({ok:true});
  if(!env.ADMIN_TOKEN||request.headers.get('Authorization')!=='Bearer '+env.ADMIN_TOKEN)return json({error:'UNAUTHORIZED'},401);
  if(request.method!=='POST'||url.pathname!=='/run'||url.search)return json({error:'NOT_FOUND'},404);
  if(used||env.D1_READ_GUARD_ENABLED!=='true')return json({error:'CANARY_GUARD_REQUIRED'},409);
  used=true;
  return withReadBudget(env,'cron',async safe=>{
   const mapping=()=>safe.DB.prepare('SELECT id,canonical_url,url_verified_at FROM products ORDER BY id').all<{id:string;canonical_url:string|null;url_verified_at:string|null}>();
   const report=()=>safe.DB.prepare("SELECT id,created_at FROM analysis_runs WHERE month='2026-09' AND engine_version='1.2.2' AND json_extract(filters_json,'$.device') IS NULL ORDER BY created_at DESC LIMIT 1").first();
   const latest=()=>safe.DB.prepare('SELECT id,url,status_code,error_code,finished_at FROM crawls ORDER BY started_at DESC LIMIT 1').first<{id:string;url:string;status_code:number;error_code:string|null;finished_at:string|null}>();
   const before=await mapping(),oldReport=await report(),oldCrawl=await latest();
   if(!before.results.length||before.results.some(p=>!p.canonical_url||!p.url_verified_at))return json({error:'VERIFIED_PRODUCTS_REQUIRED'},409);
   await crawl(safe);
   let observed=await latest();
   // A robots refresh deliberately defers the first page request. Respect both
   // queue backoff and shared robots timing; never retry real crawl failures.
   if(observed&&observed.id!==oldCrawl?.id&&observed.error_code==='CRAWL_DELAY'&&observed.status_code===null){
    const unchanged=JSON.stringify(before.results)===JSON.stringify((await mapping()).results)&&JSON.stringify(oldReport)===JSON.stringify(await report());
    const timing=await safe.DB.prepare('SELECT q.next_crawl_at,p.next_request_at FROM crawl_queue q CROSS JOIN crawl_policies p WHERE q.url=? AND p.origin=?').bind(observed.url,'https://mavibasim.com').first<{next_crawl_at:string;next_request_at:string}>();
    const stamps=timing?[Date.parse(timing.next_crawl_at),Date.parse(timing.next_request_at)]:[];
    const delay=stamps.length===2&&stamps.every(Number.isFinite)?Math.max(0,...stamps.map(t=>t-Date.now()))+100:Infinity;
    if(unchanged&&delay<=30_000){await wait(delay);await crawl(safe);}
   }
   const after=await mapping(),newReport=await report(),newCrawl=await latest();
   const checks={real_existing_product_recrawled:!!newCrawl&&newCrawl.id!==oldCrawl?.id&&before.results.some(p=>p.canonical_url===newCrawl.url)&&newCrawl.status_code===200&&!newCrawl.error_code&&!!newCrawl.finished_at,
    existing_mapping_evidence_unchanged:JSON.stringify(before.results)===JSON.stringify(after.results),
    september_report_unchanged:!!oldReport&&JSON.stringify(oldReport)===JSON.stringify(newReport),d1_guard_used:true,google_sync_triggered:false};
   return json({verified:checks.real_existing_product_recrawled&&checks.existing_mapping_evidence_unchanged&&checks.september_report_unchanged,checks,crawl_error:newCrawl?.error_code&&/^[A-Z0-9_]{1,80}$/.test(newCrawl.error_code)?newCrawl.error_code:null});
  });
 }};
}
export default createCanary();
