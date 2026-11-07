// Create a dated, immutable Tayfun tracking revision only from an existing verified SEO snapshot.
// The user's reference date is a label, never a claim about when the page was published or crawled.
import {historyDetail,listHistory} from './seo-history';
import {tayfunAutoDetail,tayfunAutoMonth,tayfunAutoTick} from './tayfun-auto';
import {tayfunList,tayfunSave} from './tayfun-ledger';
import {gscPageURL} from './urls';
type Storage={get<T=unknown>(key:string):Promise<T|undefined>;put(key:string,value:unknown):Promise<unknown>;list<T=unknown>(options:{prefix?:string;start?:string;startAfter?:string;limit?:number;reverse?:boolean;end?:string}):Promise<Map<string,T>>};
const assert:(v:unknown)=>asserts v=(v)=>{if(!v)throw Error('TAYFUN_VERIFIED_BASELINE_INVALID');};
const str=(v:unknown,max:number)=>typeof v==='string'?v.slice(0,max):'';
const json=(v:unknown,max:number)=>v===undefined||v===null?'':JSON.stringify(v).slice(0,max);
export async function tayfunSaveVerifiedSnapshot(storage:Storage,secret:string,input:unknown,now=new Date()){
 assert(input&&typeof input==='object'&&!Array.isArray(input));
 const data=input as Record<string,unknown>;
 const url=data.url,id=data.snapshot_id,reference=data.reference_date;
 assert(typeof url==='string'&&url.length<=2048&&gscPageURL(url)===url);
 assert(typeof id==='string'&&/^[A-Za-z0-9_-]{1,100}$/.test(id));
 assert(typeof reference==='string'&&/^20\d\d-(0[1-9]|1[0-2])-([0-2]\d|3[01])$/.test(reference)&&!Number.isNaN(Date.parse(reference))&&new Date(reference).toISOString().slice(0,10)===reference);
 assert(reference<=now.toISOString().slice(0,10));
 const snapshot=await historyDetail(storage,secret,'snapshot',id);
 assert(snapshot&&snapshot.url===url&&typeof snapshot.observed_at==='string'&&Date.parse(snapshot.observed_at)<=now.getTime()+300000);
 const fields=snapshot.fields as Record<string,unknown>;
 assert(fields&&typeof fields==='object'&&fields.status===200&&typeof fields.title==='string'&&fields.title.trim().length>0);
 const period=now.toISOString().slice(0,7);
 const ledger=await tayfunList(storage,secret,period);
 const evidence='seo_snapshots:'+id;
 const existing=ledger.entries.find(e=>e.url===url&&e.notes.includes(evidence));
 if(existing)return {ok:true,already_saved:true,entry:existing,source:'seo_snapshots',site_mutations:0,d1_requests:0};
 const existingRevisions=ledger.entries.filter(e=>e.url===url).sort((a,b)=>a.created_at.localeCompare(b.created_at));
 const latest=existingRevisions.at(-1);
 const headings=Array.isArray(fields.headings)?fields.headings.filter((h:any)=>h&&typeof h.text==='string'&&Number.isInteger(h.level)):[];
 const h1=headings.filter((h:any)=>h.level===1).map((h:any)=>h.text).join(' / ').slice(0,500);
 const canonical=Array.isArray(fields.canonical)?fields.canonical.find((c:unknown)=>typeof c==='string'&&gscPageURL(c)===c):fields.canonical;
 const notes='Kanıtlı SEO taramasından takip sürümü. Kullanıcı referans tarihi: '+reference+
  ' (yayın/tarama tarihi değildir). Gerçek gözlem: '+snapshot.observed_at+
  '. Kaynak: '+evidence+'. İçerik hash: '+snapshot.content_hash+
  '. Bu sürüm canlı siteyi değiştirmez.';
 const result=await tayfunSave(storage,secret,{
  month:period,url,source:'user-entry',status:'aktif',supersedes:latest?.id||null,
  title:str(fields.title,300),description:str(fields.description,1000),h1,
  canonical:typeof canonical==='string'&&gscPageURL(canonical)===canonical?canonical:'',
  robots:json(fields.robots,200),headings:json(headings,2500),internal_links:json(fields.links,2500),
  structured_data:json(fields.structured_data,5000),notes:notes.slice(0,2500),
  keywords:latest?.keywords||[],hreflang:json(fields.hreflang,2500),images:json(fields.images,2500),
  open_graph:json(fields.open_graph,2500),twitter_card:json(fields.twitter_card,2500),
  x_robots:str(fields.x_robots,200),viewport:str(fields.viewport,500),lang:str(fields.lang,100),
  redirect:str(fields.redirect,2048),status_code:String(fields.status),content_excerpt:str(fields.excerpt,5000)
 },now);
 return {...result,reference_date:reference,snapshot_observed_at:snapshot.observed_at,snapshot_id:id,
  source:'seo_snapshots',publication_verified:false,site_mutations:0,d1_requests:0};
}

/** Explicitly approved 22 October 2026 reference, recorded at the true observation time.
 * Only these three pages are eligible. Called from existing private service cron.
 * Re-running this operation cannot replace an existing manual revision. */
const BASELINE_URLS=['https://mavibasim.com/brosur','https://mavibasim.com/el-ilani','https://mavibasim.com/afis'] as const;
const BASELINE_REFERENCE='2026-10-22';
export async function tayfunApplyApprovedBaseline(storage:Storage,secret:string,now=new Date()){
 const period=now.toISOString().slice(0,7),existing=await tayfunList(storage,secret,period);
 const automatic=await tayfunAutoMonth(storage,period);
 const result:{url:string;status:string;observed_at?:string;source?:string}[]=[];
 for(const url of BASELINE_URLS){
  const marker='tayfun:approved-baseline:2026-10-22:'+url;
  if(await storage.get(marker)){result.push({url,status:'already_saved'});continue;}
  if(existing.entries.some(e=>e.url===url)){
   result.push({url,status:'already_saved'});continue;
  }
  try{
   const snapshots=await listHistory(storage,secret,{kind:'snapshot',url,to:now.toISOString().slice(0,10)});
   const newest=snapshots.items?.[0];
   if(newest?.id){
    const detail=await historyDetail(storage,secret,'snapshot',newest.id);
    if(detail?.fields?.status===200&&typeof detail.fields.title==='string'&&detail.fields.title.trim()){
     const saved=await tayfunSaveVerifiedSnapshot(storage,secret,{url,snapshot_id:newest.id,reference_date:BASELINE_REFERENCE},now);
     await storage.put(marker,{entry_id:saved.entry.id,observed_at:detail.observed_at,source:'seo_snapshots'});
     result.push({url,status:saved.already_saved?'already_saved':'saved',observed_at:detail.observed_at,source:'seo_snapshots'});
     continue;
    }
   }
   // Independent HTML crawl observations are equally real dated evidence; never infer an October crawl.
   let candidates=(automatic.observations||[]).filter(r=>r.url===url&&r.status===200).sort((a,b)=>b.observed_at.localeCompare(a.observed_at));
   // No archived observation yet: crawl only this approved page, honoring the sitemap and robots.txt.
   // Never generate a revision when the live fetch fails or returns non-HTML.
   if(!candidates.length){
    const crawl=await tayfunAutoTick(storage,secret,fetch,now,url);
    if(crawl.status==='archived'||crawl.status==='unchanged'){
     const refreshed=await tayfunAutoMonth(storage,period);
     candidates=(refreshed.observations||[]).filter(r=>r.url===url&&r.status===200).sort((a,b)=>b.observed_at.localeCompare(a.observed_at));
    }
   }
   const candidate=candidates[0];
   if(!candidate){result.push({url,status:'awaiting_verified_crawl'});continue;}
   const item=await tayfunAutoDetail(storage,secret,candidate.id);
   if(!item||item.url!==url||item.status!==200||!item.seo||typeof item.seo.title!=='string'||!item.seo.title.trim()){
    result.push({url,status:'awaiting_verified_crawl'});continue;
   }
   const fields=item.seo;
   const headings=Array.isArray(fields.headings)?fields.headings.filter((h:any)=>h&&Number.isInteger(h.level)&&typeof h.text==='string'):[];
   const canonical=Array.isArray(fields.canonical)?fields.canonical.find((c:unknown)=>typeof c==='string'&&gscPageURL(c)===c):fields.canonical;
   const prior=(await tayfunList(storage,secret,period)).entries.filter(e=>e.url===url).at(-1);
   if(prior){result.push({url,status:'already_saved'});continue;}
   const evidence='tayfun:auto:'+item.id;
   const saved=await tayfunSave(storage,secret,{
    month:period,url,source:'user-entry',status:'aktif',supersedes:null,
    title:str(fields.title,300),description:str(fields.description,1000),
    h1:headings.filter((h:any)=>h.level===1).map((h:any)=>h.text).join(' / ').slice(0,500),
    canonical:typeof canonical==='string'&&gscPageURL(canonical)===canonical?canonical:'',
    robots:json(fields.robots,200),headings:json(headings,2500),internal_links:json(fields.links,2500),
    structured_data:json(fields.structured_data,5000),keywords:[],
    notes:('Gerçek otomatik taramadan takip sürümü. Kullanıcı referansı: '+BASELINE_REFERENCE+
     ' (yayın/tarama tarihi değildir). Gerçek gözlem: '+item.observed_at+'. Kaynak: '+evidence+
     '. Hash: '+item.hash+'. Siteye uygulanmadı.').slice(0,2500),
    hreflang:json(fields.hreflang,2500),images:json(fields.images,2500),
    open_graph:json(fields.open_graph,2500),twitter_card:json(fields.twitter_card,2500),
    status_code:String(item.status),content_excerpt:str(fields.excerpt,5000)
   },now);
   if(saved.ok)await storage.put(marker,{entry_id:saved.entry.id,observed_at:item.observed_at,source:'live-static-html'});
   result.push({url,status:saved.ok?'saved':'held',observed_at:item.observed_at,source:'live-static-html'});
  }catch(error){
   // Per-page failures are retained as pending, never translated into a fake empty SEO version.
   result.push({url,status:'held'}); 
  }
 }
 return {ok:result.every(x=>x.status==='saved'||x.status==='already_saved'),reference_date:BASELINE_REFERENCE,
  attempted_at:now.toISOString(),items:result,live_site_mutations:0,previous_records_unchanged:true,d1_requests:0};
}
