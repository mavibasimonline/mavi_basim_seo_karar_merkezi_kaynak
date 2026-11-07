// Read-only, evidence-first monitoring of archived Tayfun AI SEO plans.
// No site writes, no changes to historical revisions, no causation claims.
import {readIndependentContext} from './independent-context';
import {resolvedCatalog} from './independent-catalog';
import {tayfunList,type TayfunEntry} from './tayfun-ledger';
type Store={get<T=unknown>(key:string):Promise<T|undefined>;put(key:string,value:unknown):Promise<unknown>};
type Row={page:string;device:string;clicks:number;impressions:number;position:number;query?:string};
type Month={month:string;available:boolean;days_verified:number;expected_days:number;query_days_verified?:number;pages:Row[];queries:Row[];evidence?:{day:string;scope:string}[]};
const previous=(month:string)=>{const d=new Date(month+'-01T12:00:00Z');d.setUTCMonth(d.getUTCMonth()-1);return d.toISOString().slice(0,7);};
const months=(end:string)=>{const result:string[]=[];for(let m='2026-01';m<=end&&result.length<36;){result.push(m);const d=new Date(m+'-01T12:00:00Z');d.setUTCMonth(d.getUTCMonth()+1);m=d.toISOString().slice(0,7);}return result;};
const aggregate=(rows:Row[],urls:Set<string>,device:string)=>{const chosen=rows.filter(r=>urls.has(r.page)&&(device==='ALL'||r.device===device));if(!chosen.length)return {clicks:0,impressions:0,position:null as number|null,observed:false};
 const clicks=chosen.reduce((n,r)=>n+r.clicks,0),impressions=chosen.reduce((n,r)=>n+r.impressions,0);
 return {clicks,impressions,position:impressions?chosen.reduce((n,r)=>n+r.position*r.impressions,0)/impressions:null,observed:true};};
type Metric={clicks:number|null;impressions:number|null;ctr:number|null;position:number|null};
const emptyMetric=():Metric=>({clicks:null,impressions:null,ctr:null,position:null});
const metric=(rows:Row[]):Metric=>{
 if(!rows.length)return emptyMetric();
 const clicks=rows.reduce((n,r)=>n+r.clicks,0),impressions=rows.reduce((n,r)=>n+r.impressions,0);
 return {clicks,impressions,ctr:impressions?clicks/impressions:null,
  position:impressions?rows.reduce((n,r)=>n+r.position*r.impressions,0)/impressions:null};
};
const normalized=(q:string)=>q.toLocaleLowerCase('tr-TR').trim();
const filtered=(rows:Row[],urls:Set<string>,device:string)=>rows.filter(r=>urls.has(r.page)&&(device==='ALL'||r.device===device));
const queryMetrics=(rows:Row[],urls:Set<string>,device:string)=>{
 const groups=new Map<string,Row[]>();
 for(const r of filtered(rows,urls,device))if(r.query){
  const k=normalized(r.query),list=groups.get(k)||[];list.push(r);groups.set(k,list);
 }
 return new Map([...groups].map(([key,records])=>[key,metric(records)]));
};
const scope=(month:Month)=>({month:month?.month||null,
 page_days_verified:month?.days_verified||0,query_days_verified:month?.query_days_verified??0,
 expected_days:month?.expected_days||0,
 page_complete:!!month?.available&&month.days_verified===month.expected_days&&month.expected_days>0,
 // Even a full set of GSC query days does not disclose anonymized Google searches.
 query_scope:'GSC görünür sorgular; anonimleştirilen sorgular ve eksik günler sıfır sayılamaz.'});
const allTracked=(versions:TayfunEntry[],observed:Map<string,Metric>[])=>{
 const names=new Map<string,string>();
 for(const version of versions)for(const q of version.keywords||[]){
  const key=normalized(q);if(key&&!names.has(key))names.set(key,q);
 }
 for(const m of observed)for(const key of m.keys())if(key&&!names.has(key))names.set(key,key);
 return [...names.entries()].slice(0,500);
};
const decisionsFor=(versions:TayfunEntry[])=>{
 const result=new Map<string,{action:string;reason:string}>();
 for(const version of versions)for(const decision of version.keyword_decisions||[])
  result.set(normalized(decision.query),{action:decision.action,reason:decision.reason});
 return result;
};
export function evaluateSeoMonitor(product:{id:string;name:string;category?:string;canonical_url:string;urls?:string[]},history:TayfunEntry[],current:Month,prior:Month,device='ALL'){
 const all=history.filter(x=>x.url===product.canonical_url).sort((a,b)=>a.created_at.localeCompare(b.created_at));
 const versions=all.filter(x=>x.source==='ai-review'),latest=versions.at(-1)||null;
 const newest=all.at(-1)||null,urls=new Set(product.urls?.length?product.urls:[product.canonical_url]);
 const currentScope=scope(current),priorScope=scope(prior),completeCurrent=currentScope.page_complete,completePrior=priorScope.page_complete;
 const priorObserved=metric(filtered(prior?.pages||[],urls,device)),currentObserved=metric(filtered(current?.pages||[],urls,device));
 const oldQueries=queryMetrics(prior?.queries||[],urls,device),newQueries=queryMetrics(current?.queries||[],urls,device);
 const decisions=decisionsFor(all);
 const keywords=allTracked(all,[oldQueries,newQueries]).map(([key,query])=>{
  const a=oldQueries.get(key)||emptyMetric(),b=newQueries.get(key)||emptyMetric();
  const decision=decisions.get(key);
  return {query,previous_clicks:a.clicks,current_clicks:b.clicks,
   previous_impressions:a.impressions,current_impressions:b.impressions,
   previous_ctr:a.ctr,current_ctr:b.ctr,previous_position:a.position,current_position:b.position,
   change:a.clicks!==null&&b.clicks!==null?b.clicks-a.clicks:null,
   decision:decision?.action||'izle',decision_reason:decision?.reason||'Henüz tarihli karar kaydı yok.',
   status:a.clicks===null||b.clicks===null?'Eksik görünür sorgu · sıfır değil':
    !completeCurrent||!completePrior?'Kısmi ay · karşılaştırma bekliyor':
    b.clicks>a.clicks?'Yükseldi':b.clicks<a.clicks?'Düştü':'Sabit'};
 });
 const base={product_id:product.id,name:product.name,category:product.category||'',url:product.canonical_url,
  revisions:versions.length,archive_count:all.length,latest_revision_id:latest?.id||null,
  latest_saved_at:latest?.created_at||null,first_saved_at:versions[0]?.created_at||null,
  latest_seo:newest?{version_id:newest.id,recorded_at:newest.created_at,month:newest.month,source:newest.source,
   title:newest.title,description:newest.description,h1:newest.h1,canonical:newest.canonical,robots:newest.robots,
   headings:newest.headings,notes:newest.notes}:null,
  tracked_keywords:keywords.map(k=>k.query),selected_month:current?.month,previous_month:prior?.month,
  coverage:{selected:currentScope.page_days_verified,selected_expected:currentScope.expected_days,
   previous:priorScope.page_days_verified,previous_expected:priorScope.expected_days},
  scopes:{selected:currentScope,previous:priorScope},
  observed_previous:priorObserved,observed_current:currentObserved,keywords,
  note:'GSC tıklaması müşteri/sipariş değildir. Google sorguları anonimleştirilebilir. SEO sürümü yayına alınmış değişiklik kanıtı değildir; GSC değişimleri nedensellik kanıtı değildir.'};
 const waiting=(reason:string)=>({...base,status:'bekle',label:'İzleme bekliyor',reason,
  previous_clicks:null,current_clicks:null,click_delta:null,change_percent:null});
 if(!latest)return waiting('Yapay zekâ SEO taslağı henüz kaydedilmedi; doğrulanmış sorgu gözlemleri varsa aşağıda gösterilir.');
 if(!completeCurrent||!completePrior)return waiting('Görünür GSC değerleri aşağıdadır. Kısmi ay aylık düşüş/yükseliş kararı değildir.');
 if(latest.created_at>=current.month+'-01')return waiting('Kayıt, seçili ay başlamadan önce yapılmadı. GSC değerleri gözlemdir; SEO sonrası etki kararı sonraki tam dönemi bekler.');
 if(priorObserved.clicks===null||currentObserved.clicks===null)return waiting('Ürün URL’sinin iki ayda da doğrulanmış sayfa satırları bulunmuyor; eksik satır sıfır sayılamaz.');
 const before=aggregate(prior.pages||[],urls,device),after=aggregate(current.pages||[],urls,device);
 const difference=after.clicks-before.clicks,ratio=before.clicks?100*difference/before.clicks:null;
 const significantDrop=before.clicks>=10&&((difference<=-30&&ratio!==null&&ratio<=-20)||(ratio!==null&&ratio<=-30))&&Math.min(before.impressions,after.impressions)>=100;
 const significantRise=(before.clicks>=10&&ratio!==null&&ratio>=30&&difference>=5||difference>=15&&ratio!==null&&ratio>=20)&&Math.min(before.impressions,after.impressions)>=100;
 return {...base,status:significantDrop?'dusuyor':significantRise?'yukseliyor':'izle',
  label:significantDrop?'Önemli düşüş · incele':significantRise?'Anlamlı yükseliş · koru':'Küçük değişim · izle',
  reason:'İki tam GSC sayfa ayı karşılaştırılabilir; taslağın canlıya uygulandığı ve etkisi yine kanıtlanmış değildir.',
  previous_clicks:before.clicks,current_clicks:after.clicks,click_delta:difference,change_percent:ratio};
}
export async function tayfunKeywordTrends(storage:Store,secret:string,productId:string,month:string,device:string,span:number,query:string,
 gsc:(period:string)=>Promise<Month>,time=new Date()){
 if(!/^20\d\d-(0[1-9]|1[0-2])$/.test(month)||month<'2026-01'||month>time.toISOString().slice(0,7)
  ||!['ALL','MOBILE','DESKTOP','TABLET'].includes(device)||![3,6,12].includes(span)
  ||typeof productId!=='string'||productId.length>100||typeof query!=='string'||query.length>120)
  throw Error('TAYFUN_TRENDS_INVALID_SCOPE');
 const ctx=await readIndependentContext(storage),catalog=await resolvedCatalog(storage,secret,ctx);
 const product=catalog.products.find(p=>p.id===productId);
 if(!product)throw Error('TAYFUN_TRENDS_UNKNOWN_PRODUCT');
 const all=await Promise.all(months(month).map(m=>tayfunList(storage,secret,m)));
 const versions=all.flatMap(l=>l.entries).filter(v=>v.url===product.canonical_url).sort((a,b)=>a.created_at.localeCompare(b.created_at));
 const tracked=new Set(versions.flatMap(v=>v.keywords.map(normalized)));
 // Only one saved, product-specific keyword can be queried. Never expose raw site-wide GSC lists.
 if(!tracked.has(normalized(query)))throw Error('TAYFUN_TRENDS_UNTRACKED_QUERY');
 const selected=months(month).slice(-span),urls=new Set(product.urls?.length?product.urls:[product.canonical_url]),rows=[];
 for(const period of selected){
  try{
   const report=await gsc(period),queryRows=filtered(report.queries||[],urls,device)
    .filter(r=>!!r.query&&normalized(r.query)===normalized(query));
   const last=versions.filter(v=>v.created_at.slice(0,7)<=period).at(-1)||null;
   rows.push({month:period,coverage:scope(report),query:metric(queryRows),
    page:metric(filtered(report.pages||[],urls,device)),
    seo:{version_id:last?.id||null,recorded_at:last?.created_at||null,source:last?.source||null,
     title:last?.title||null,h1:last?.h1||null,description:last?.description||null}});
  }catch(error){
   rows.push({month:period,coverage:{month:period,page_days_verified:0,query_days_verified:0,expected_days:0,page_complete:false,query_scope:'Kaynak okunamadı'},
    query:emptyMetric(),page:emptyMetric(),
    seo:{version_id:null,recorded_at:null,source:null,title:null,h1:null,description:null},
    error:error instanceof Error?error.message:'GSC aylık arşivi okunamadı'});
  }
 }
 return {product_id:productId,url:product.canonical_url,device,query,span,month,
  months:rows,read_only:true,site_mutations:0,d1_requests:0,
  caveat:'Aylık satırlar mevcut doğrulanmış günlük GSC arşivinden okunur. Eksik veya anonim sorgu sıfır sayılamaz. SEO kaydı yayın kanıtı değildir. Müşteri/sipariş için doğrulanmış dönüşüm verisi gerekir.'};
}
export async function tayfunMonitor(storage:Store,secret:string,month:string,device:string,gsc:(period:string)=>Promise<Month>,time=new Date()){
 if(!/^20\d\d-(0[1-9]|1[0-2])$/.test(month)||month<'2026-01'||month>time.toISOString().slice(0,7))throw Error('TAYFUN_MONITOR_INVALID_MONTH');
 if(!['ALL','MOBILE','DESKTOP','TABLET'].includes(device))throw Error('TAYFUN_MONITOR_INVALID_DEVICE');
 const ctx=await readIndependentContext(storage),catalog=await resolvedCatalog(storage,secret,ctx);
 const periods=months(month);
 const ledgers=await Promise.all(periods.map(p=>tayfunList(storage,secret,p)));
 const records=ledgers.flatMap(l=>l.entries);
 const [current,prior]=await Promise.all([gsc(month),gsc(previous(month))]);
 const products=catalog.products.map(p=>evaluateSeoMonitor({id:p.id,name:p.name,category:(p as any).category,canonical_url:p.canonical_url,urls:p.urls},records,current,prior,device));
 return {month,previous_month:previous(month),device,read_only:true,site_mutations:0,d1_requests:0,
  warning_count:products.filter(p=>p.status==='dusuyor').length,rising_count:products.filter(p=>p.status==='yukseliyor').length,
  waiting_count:products.filter(p=>p.status==='bekle').length,products,
  limitation:'GSC değişimleri kaydedilmiş SEO taslağının siteye uygulandığını veya yükselişe/düşüşe neden olduğunu kanıtlamaz. Eksik ay/sorgu sıfır değildir.'};
}
