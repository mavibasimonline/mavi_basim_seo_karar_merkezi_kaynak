// Exact, evidence-limited next-action diagnosis for a named product.
// No search, site mutation, guessed query zeros, D1 usage, or inferred causality.
import type {MonthlyGscAnalysisInput,GscQueryMetricRow} from './independent-gsc-analysis';
import type {IndependentContext,ContextProduct} from './independent-context';

type Daily={day:string;verified:boolean;observed:boolean;metrics:{clicks:number;impressions:number;ctr:number|null;position:number|null}|null;
 evidence?:{day:string;scope:'page'|'query';generation:string;captured_at:string;rows:number;page_hashes:string[]}};
type DailySeries={month:string;scope:string;filters:{page?:string;query?:string;device?:string};days_verified:number;expected_days:number;series:Daily[];d1_requests:number};
type Reader=(month:string,filter:{query:string;page:string;device:string})=>Promise<DailySeries>;
type Answer={answer:string;decision:string;month:string;previous_month?:string|null;comparison?:{current:{clicks:number;impressions:number;ctr:number;position:number};previous:{clicks:number;impressions:number;ctr:number;position:number};delta:number;rate:number|null;pages:any[]}|null;filters?:{device?:string;country?:string;page?:string};evaluation?:{changes?:any[];cause_confirmed?:boolean;content_change_recommended?:boolean};evidence_refs?:any[];evidence?:string[];[key:string]:any};
const percent=(a:number,b:number)=>b>0?((a-b)/b*100).toFixed(1)+'%':'hesaplanamaz';
const signed=(n:number)=>n>0?'+'+n:String(n);
const getRows=(m:MonthlyGscAnalysisInput|undefined,page:string,device?:string,country?:string)=>m?.queries?.filter(r=>r.page===page&&(!device||device==='ALL'||r.device===device)&&(!country||r.country===country))||[];
function grouped(rows:GscQueryMetricRow[]){
 const out=new Map<string,{clicks:number;impressions:number}>();
 for(const row of rows){
  const a=out.get(row.query)||{clicks:0,impressions:0};a.clicks+=row.clicks;a.impressions+=row.impressions;out.set(row.query,a);
 }
 return out;
}
function timeline(result:DailySeries,month:string,query:string,page:string,device:string){
 if(result.month!==month||result.scope!=='query'||result.filters?.query!==query||result.filters?.page!==page||
  result.filters?.device!==device||result.d1_requests!==0||!Array.isArray(result.series)||
  result.days_verified!==result.expected_days||result.series.length!==result.expected_days||
  result.series.some(d=>!d.verified||!/^20\d\d-\d\d-\d\d$/.test(d.day)))return null;
 const seen=result.series.filter(d=>d.observed&&d.metrics);
 return {month,verified_days:result.days_verified,expected_days:result.expected_days,visible_days:seen.length,
  first_visible_day:seen[0]?.day||null,last_visible_day:seen.at(-1)?.day||null,
  observed_clicks:seen.reduce((n,d)=>n+d.metrics!.clicks,0),observed_impressions:seen.reduce((n,d)=>n+d.metrics!.impressions,0),
  // Underlying query rows can be withheld by Google. No zero traffic inference.
  daily_absence_is_zero:false,
  evidence:seen.filter((d,i)=>i===0||i===seen.length-1).map(d=>d.evidence).filter(Boolean)};
}
export async function appendProductActionDiagnostic(
 input:Answer,current:MonthlyGscAnalysisInput,previous:MonthlyGscAnalysisInput|undefined,
 product:ContextProduct,context:IndependentContext,reader:Reader
){
 const comparison=input.comparison;
 if(input.decision!=='İncele'||!comparison||comparison.delta>=0||!previous||!current.available||
  current.days_verified!==current.expected_days||previous.days_verified!==previous.expected_days||
  current.month!==input.month||previous.month!==input.previous_month)return input;
 const device=input.filters?.device||'ALL',country=input.filters?.country,allowedUrls=new Set(product.urls||[product.canonical_url]);
 const page=input.filters?.page||product.canonical_url;
 if(!allowedUrls.has(page))return input;
 const prev=comparison.previous,now=comparison.current,changes=context.changes.filter(e=>e.url===page);
 const rankLoss=prev.impressions>=100&&now.impressions>=100&&now.position>prev.position+0.5;
 const impressionLoss=prev.impressions>0&&now.impressions<prev.impressions;
 const ctrLoss=prev.impressions>0&&now.impressions>0&&now.ctr<prev.ctr;
 const mechanism=rankLoss&&impressionLoss?'Sıralama ile gösterim birlikte kötüleşmiş':
  impressionLoss?'Gösterim azalmış':ctrLoss?'CTR düşmüş':'Tıklama azalmış; diğer metrikler tek bir mekanizmayı desteklemiyor';
 const queryComparable=current.query_days_verified===current.expected_days&&previous.query_days_verified===previous.expected_days&&
  current.evidence?.some(e=>e.scope==='query')&&previous.evidence?.some(e=>e.scope==='query');
 const a=grouped(getRows(current,page,device,country)),b=grouped(getRows(previous,page,device,country));
 const losses=queryComparable?[...a].flatMap(([query,metrics])=>{
  const before=b.get(query);
  return before&&metrics.clicks<before.clicks?[{query,previous:before,current:metrics,delta:metrics.clicks-before.clicks}]:[];
 }).sort((x,y)=>x.delta-y.delta||x.query.localeCompare(y.query,'tr')):[];
 const top=losses[0]||null;
 const daily:Array<ReturnType<typeof timeline>>=[];
 let dailyReason:string|null=null;
 if(top&&!country){
  try{
   const [oldDays,newDays]=await Promise.all([
    reader(previous.month,{query:top.query,page,device}),
    reader(current.month,{query:top.query,page,device})
   ]);
   const old=timeline(oldDays,previous.month,top.query,page,device),recent=timeline(newDays,current.month,top.query,page,device);
   if(old&&recent)daily.push(old,recent);
   else dailyReason='Günlük sorgu kapsamı veya kayıtların bütünlüğü doğrulanamadı.';
  }catch{dailyReason='Günlük sorgu arşivi bu istekte okunamadı; aylık kanıtlar korunuyor.';}
 }else if(country)dailyReason='Günlük sorgu arşivi ülke filtresi desteklemiyor; farklı ülke kapsamları karıştırılmadı.';
 else dailyReason='İki tam dönemde de görünen doğrulanmış kayıp sorgu bulunmadı; gizli sorgular kayıp varsayılmadı.';
 const latest=[...context.snapshots].filter(s=>s.url===page).sort((a,b)=>b.observed_at.localeCompare(a.observed_at))[0];
 const technical=latest&&Number.isInteger(latest.status)&&latest.status>=400&&latest.status<=599
  ?'Son doğrulanmış taramada '+page+' HTTP '+latest.status+' dönmüş ('+latest.observed_at+'). Önce erişim ve yanıt kodu sorununu doğrula; sayfa metnini yeniden yazma.'
  :latest?.status===200
   ?'Son kayıtlı taramada URL HTTP 200 döndü ('+latest.observed_at+'); bu tek başına mobil indekslemeyi veya Google sıralamasını kanıtlamaz.'
   :'Güncel HTTP durumunu gösteren güvenilir tarama kanıtı yok.';
 const monthEnd=current.month+'-'+new Date(Date.UTC(+current.month.slice(0,4),+current.month.slice(5),0)).getUTCDate();
 const overlap=changes.filter(e=>e.observed_from.slice(0,10)<=monthEnd&&e.observed_to.slice(0,10)>=(previous.month+'-01'));
 const SEOChange=overlap.length?overlap.map(e=>{
  const after=e.observed_from.slice(0,10)>monthEnd?' (seçilen aydan sonra)':'';
  return e.changed_fields.join(', ')+' · '+e.observed_from.slice(0,10)+' – '+e.observed_to.slice(0,10)+after;
 }).slice(0,3).join('; '):'İki ayla örtüşen doğrulanmış değişiklik kaydı bulunmuyor; bu değişiklik hiç olmadı demek değildir.';
 const primary=top?'Öncelikli görünür sorgu "'+top.query+'": '+top.previous.clicks+' → '+top.current.clicks+' tıklama ('+signed(top.delta)+'), gösterim '+top.previous.impressions+' → '+top.current.impressions+'.'
  :'Tek tek sorgu kaybı iki ayda da gözlenemedi; sorgu adı veya kayıp sayısı tahmin edilmedi.';
 const dailyText=daily.length===2?daily.map(t=>t!.month+': '+t!.verified_days+'/'+t!.expected_days+' gün doğrulandı; "'+top!.query+'" sorgusu '+t!.visible_days+' günde gözlendi, ilk '+(t!.first_visible_day||'yok')+', son '+(t!.last_visible_day||'yok')+'.').join(' ')
  :dailyReason||'Günlük sorgu doğrulaması bu dönem için eksik.';
 const step1='1) Sorun nerede? '+page+' · '+device+' kapsamındaki GSC gösterimi '+prev.impressions+' → '+now.impressions+' ('+percent(now.impressions,prev.impressions)+'), ortalama sıra '+prev.position.toFixed(2)+' → '+now.position.toFixed(2)+', CTR %'+(prev.ctr*100).toFixed(2)+' → %'+(now.ctr*100).toFixed(2)+'. '+mechanism+'.';
 const step2='2) Hangi kelime ve ne zaman? '+primary+' '+dailyText+' Günlük satırın görünmemesi sıfır arama veya kesin sıralama kaybı değildir.';
 const step3='3) SEO değişikliğine bakıldı mı? '+SEOChange+'. '+technical+' Değişiklik zamanı ile düşüş eşzamanlılığı neden kanıtlamaz.';
 const decision=latest&&latest.status>=400&&latest.status<=599?
  'SONUÇ: Teknik erişim hatası öncelikli inceleme. HTTP '+latest.status+' güncel olarak da doğrulanırsa yalnız erişim sorununa yönelik düzeltme öner; canlı siteye otomatik müdahale etme.':
  'SONUÇ: '+page+' içeriğini, H1 başlığını, fiyat listesini ve canonical adresini şu anda değiştirme. '+(top?'İzleme önceliğini "'+top.query+'" sorgusuna ver. ':'')+'Bir sonraki kapanmış ayda aynı URL/cihaz/sorgu kapsamını otomatik karşılaştır; tekrarlayan kayıp ve sayfayla ilgili doğrulanmış teknik veya içerik problemi bulunursa yalnız o probleme hedefli değişiklik öner.';
 const diagnostic={source:'GSC Search Analytics API + doğrulanmış tarama arşivi',month:current.month,previous_month:previous.month,device,page,
  mechanism,top_visible_query:top,daily_query_coverage:daily,unavailable_daily_reason:dailyReason,
  technical_crawl:latest?{status:latest.status,observed_at:latest.observed_at}:null,
  overlapping_changes:overlap.map(e=>({id:e.id,changed_fields:e.changed_fields,observed_from:e.observed_from,observed_to:e.observed_to,publication_proven:!!e.publication_evidence})),
  steps:[step1,step2,step3],final_decision:decision,cause_confirmed:false,content_change_recommended:false,d1_requests:0};
 const refs=daily.flatMap(m=>m?.evidence||[]).filter(Boolean),keys=refs.map((r:any)=>'gsc:history:'+r.day+':query:'+r.generation);
 return {...input,answer:input.answer+'\n\nSONUCA GÖTÜREN OTOMATİK İNCELEME\n'+step1+'\n'+step2+'\n'+step3+'\n'+decision,
  diagnostic,evidence_refs:[...(input.evidence_refs||[]),...refs],evidence:[...(input.evidence||[]),...keys],
  content_change_recommended:false,cause_confirmed:false,d1_requests:0};
}
