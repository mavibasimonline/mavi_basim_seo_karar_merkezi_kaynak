import {Env,hash} from './types';
import {saveInsight} from './insights';
import {analyze,saveAnalysis,Period,Metrics} from './analysis';
import {validateAnalysis} from './validation';
interface Change {id:string;url:string;observed_from:string;observed_to:string;published_at:string|null;publication_evidence:string|null;diff_json:string;previous_snapshot_id:string;next_snapshot_id:string}
export function calendarDay(day:string){if(!/^\d{4}-\d{2}-\d{2}$/.test(day)||!Number.isFinite(Date.parse(day))||new Date(day).toISOString().slice(0,10)!==day)throw new Error('INVALID_CHANGE_DAY');return day;}
export function impactPeriods(event:Pick<Change,'observed_from'|'observed_to'|'published_at'|'publication_evidence'>){
 let actual:string|null=null;
 try{const proof=JSON.parse(event.publication_evidence||'null');if(proof?.verified===true&&['cms_log','deploy_log'].includes(proof.source)&&typeof proof.ref==='string'&&proof.ref&&event.published_at)actual=new Date(event.published_at).toISOString();}catch{/* No verified CMS/deploy adapter: use detection bounds. */}
 const first=actual||event.observed_from,last=actual||event.observed_to;
 if(!Number.isFinite(Date.parse(first))||!Number.isFinite(Date.parse(last))||Date.parse(first)>Date.parse(last))throw new Error('INVALID_CHANGE_DAY');
 const date=(value:string,offset:number)=>new Date(Date.parse(value.slice(0,10)+'T00:00:00Z')+offset*86400_000).toISOString().slice(0,10);
 return {before:{start:date(first,-28),end:date(first,-1),days:28,label:'Değişiklikten önce 28 gün'} as Period,after:{start:date(last,1),end:date(last,28),days:28,label:'Değişiklikten sonra 28 gün'} as Period,publication_verified:!!actual,actual_publication_at:actual,excluded_interval:{from:first,to:last}};
}
export function impactAssessment(current:Metrics|null,previous:Metrics|null,missing:string[],concurrent=0){
 const complete=!missing.length&&!!current&&!!previous;
 const change=complete?{clicks:current!.clicks-previous!.clicks,impressions:current!.impressions-previous!.impressions,ctr:current!.ctr!==null&&previous!.ctr!==null?current!.ctr-previous!.ctr:null,position:current!.position!==null&&previous!.position!==null?current!.position-previous!.position:null,click_ratio:previous!.clicks?(current!.clicks-previous!.clicks)/previous!.clicks:null}:null;
 const loss=!!change&&change.clicks<=-30&&change.click_ratio!==null&&change.click_ratio<=-0.2;
 return {status:complete?'Gözlemsel karşılaştırma':'Veri bekle',change,causality:'Nedensellik doğrulanamadı',confidence:complete?'gözlemsel':'yetersiz',rollback:{suggestion:complete&&loss?'Önemli kayıp gözlendi; eski/yeni içerik ve korunan sorgularla manuel geri alma incelemesi yapın.':'Otomatik veya kanıtsız geri alma önerilmez.',sufficient_causal_evidence:false,manual_review_required:true},concurrent_changes:concurrent,limitations:['Mevsimsellik, talep, Google güncellemeleri ve diğer değişiklikler elenmedi.',...(concurrent?['Aynı gözlem aralığındaki değişikliklerin etkileri ayrı ayrı kanıtlanamaz.']:[])]};
}
export async function changeCalendar(env:Env,day:string,after=''){
 calendarDay(day);
 return (await env.DB.prepare(`SELECT e.*,p.id AS product_id,p.name FROM seo_change_events e LEFT JOIN products p ON p.canonical_url=e.url WHERE substr(e.observed_to,1,10)=? AND e.id>? ORDER BY e.id LIMIT 50`).bind(day,after).all()).results;
}
export async function changeImpact(env:Env,id:string,time=new Date()){
 if(!/^[a-f0-9-]{36}$/i.test(id))throw new Error('INVALID_CHANGE_ID');
 const event=await env.DB.prepare('SELECT * FROM seo_change_events WHERE id=?').bind(id).first<Change>();
 if(!event)throw new Error('CHANGE_NOT_FOUND');
 const ranges=impactPeriods(event);
 const [datasets,health,mapping,credential]=await Promise.all([
   env.DB.prepare('SELECT * FROM dataset_coverage WHERE provider=\'gsc\' AND ((day BETWEEN ? AND ?) OR (day BETWEEN ? AND ?)) ORDER BY day,scope').bind(ranges.before.start,ranges.before.end,ranges.after.start,ranges.after.end).all<{fetched_at:string}>(),
   env.DB.prepare("SELECT * FROM health_checks WHERE provider='gsc' ORDER BY day DESC LIMIT 1").first<{checked_at:string}>(),
   env.DB.prepare('SELECT id,canonical_url,url_verified_at FROM products WHERE canonical_url=?').bind(event.url).first(),
   env.DB.prepare("SELECT updated_at FROM oauth_credentials WHERE provider='google'").first(),
 ]);
 const recent=(stamp:string)=>time.getTime()-Date.parse(stamp)>=0&&time.getTime()-Date.parse(stamp)<72*3600_000;
 const key=await hash(JSON.stringify(['1.0.0',event,datasets.results,health,mapping,credential,datasets.results.map(d=>recent(d.fetched_at)),health&&recent(health.checked_at),time.getTime()>Date.parse(ranges.after.end+'T23:59:59Z')+3*86400_000]));
 const saved=await env.DB.prepare("SELECT result_json FROM insight_runs WHERE kind='change-impact' AND source_key=?").bind(key).first<{result_json:string}>();
 if(saved)return JSON.parse(saved.result_json) as Awaited<ReturnType<typeof computeChangeImpact>>;
 return computeChangeImpact(env,event,ranges,key,time);
}
async function computeChangeImpact(env:Env,event:Change,ranges:ReturnType<typeof impactPeriods>,key:string,time:Date){
 const id=event.id;
 const report=await analyze(env,ranges.after.end.slice(0,7),time,{current:ranges.after,previous:ranges.before});
 if((await validateAnalysis(env,report)).length)throw new Error('ANALYSIS_VALIDATION_FAILED');await saveAnalysis(env,report);
 const product=report.products.find(p=>p.url===event.url);
 const snapshots=await env.DB.prepare('SELECT id,snapshot_json FROM seo_snapshots WHERE id IN (?,?)').bind(event.previous_snapshot_id,event.next_snapshot_id).all<{id:string;snapshot_json:string}>();
 const contentComparable=snapshots.results.length===2&&snapshots.results.every(s=>JSON.parse(s.snapshot_json).status===200);
 const concurrent=await env.DB.prepare('SELECT count(*) n FROM seo_change_events WHERE url=? AND id<>? AND observed_to>=? AND observed_from<=?').bind(event.url,id,event.observed_from,event.observed_to).first<{n:number}>();
 const missing=[...(product?.missing||report.missing),...(!product?['Değişen URL için doğrulanmış ürün eşlemesi yok.']:[]),...(!contentComparable?['İki başarılı HTML snapshot yok; hata/redirect içerik silinmesi sayılmaz.']:[])];
 const controls=missing.length?[]:(await env.DB.prepare(`SELECT CASE WHEN d.date>=? THEN 'after' ELSE 'before' END period,SUM(d.clicks) clicks,SUM(d.impressions) impressions,SUM(d.clicks)*1.0/NULLIF(SUM(d.impressions),0) ctr,SUM(d.position*d.impressions)*1.0/NULLIF(SUM(d.impressions),0) position FROM gsc_daily_by_page d JOIN dataset_coverage c ON c.dataset_id=d.dataset_id AND c.day=d.date AND c.provider='gsc' AND c.scope='page' AND c.complete=1 WHERE d.page<>? AND ((d.date BETWEEN ? AND ?) OR (d.date BETWEEN ? AND ?)) GROUP BY period`).bind(ranges.after.start,event.url,ranges.before.start,ranges.before.end,ranges.after.start,ranges.after.end).all()).results;
 const result={id:crypto.randomUUID(),version:'1.0.0',event,analysis_id:report.id,measured_at:time.toISOString(),ranges,source:'GSC + SEO tarama hafızası',...impactAssessment(product?.current||null,product?.previous||null,missing,concurrent?.n||0),url:event.url,product_id:product?.id||null,current:product?.current||null,previous:product?.previous||null,devices:product?.devices||[],queries:product?.queries||[],protected_before:(product?.queries||[]).filter(q=>(q.previous?.clicks||0)>=10&&(q.previous?.impressions||0)>=100),evidence:product?.evidence||[],missing,controls,old_new:JSON.parse(event.diff_json),content_limit:'Statik HTML snapshot; içerik hash ve ilk 2000 karakter özeti, tam CMS revizyonu değildir.'};
 return saveInsight(env,'change-impact',key,result,report.id);
}
