import {GSC_REVIEW_CANDIDATES} from './gsc-review-cohorts';
import {ENGINE_VERSION} from './analysis';

interface Measurement {clicks:number;impressions:number;ctr:number|null;position:number|null}
interface Product {url:string|null;name:string;decision:string;current:Measurement|null;previous:Measurement|null;missing:string[];evidence:unknown[];queries?:{protect:boolean}[]}
interface StoredReport {month:string;created_at:string;engine_version:string;period:{start:string;end:string};previous_period:{start:string;end:string};products:Product[];missing:string[]}
const origin='https://mavibasim.com';
const normal=(s:string|null):string|null=>{if(!s)return null;try{const u=new URL(s);return u.origin===origin?u.origin+u.pathname.replace(/\/$/,''):null;}catch{return null;}};
const isMonth=(s:string)=>/^20\d\d-(0[1-9]|1[0-2])$/.test(s);

/** Use an already saved, validated report only. Never fetch Google or recalculate data here. */
export function reviewPerformance(saved:unknown, selectedMonth:string, now=new Date()){
  const unavailable=(reason:string)=>({available:false,reason});
  if(!isMonth(selectedMonth))return unavailable('Geçersiz rapor ayı.');
  if(!saved||typeof saved!=='object')return unavailable('Kaydedilmiş ve doğrulanmış GSC raporu yok.');
  const r=saved as Partial<StoredReport>;
  if(r.month!==selectedMonth||r.engine_version!==ENGINE_VERSION||!r.created_at||!r.period||!r.previous_period||!Array.isArray(r.products)||!Array.isArray(r.missing))
    return unavailable('Aynı dönem için uygun GSC raporu bulunamadı.');
  const age=now.getTime()-Date.parse(r.created_at);
  if(!Number.isFinite(age)||age<0||age>=72*3600_000)return unavailable('Rapor güncelliği doğrulanamadı.');
  if(r.missing.length)return unavailable('Raporda veri kapsamı veya sağlık kanıtı eksik.');
  const periodEnd=Date.parse(r.period.end+'T23:59:59Z');
  if(!Number.isFinite(periodEnd)||periodEnd+3*86400_000>=now.getTime())return unavailable('Seçili ay kesinleşmedi.');
  if(!r.period.start.startsWith(selectedMonth)||r.previous_period.end>=r.period.start)
    return unavailable('GSC dönemleri karşılaştırmaya uygun değil.');
  const rows=GSC_REVIEW_CANDIDATES.map(candidate=>{
    const product=r.products!.find(p=>normal(p.url)===origin+candidate.path);
    if(candidate.group==='city-content')return {path:candidate.path,available:false,reason:'Şehir URL için doğrulanmış ayrı sayfa raporu henüz yok.'};
    if(!product||!Array.isArray(product.missing)||product.missing.length||!product.current||!product.previous||!Array.isArray(product.evidence)||!product.evidence.length)
      return {path:candidate.path,available:false,reason:'Bu URL için iki dönemlik doğrulanmış performans bulunamadı.'};
    if(!['Koru','İncele'].includes(product.decision))
      return {path:candidate.path,available:false,reason:'Kaynak SEO kararı veya kanıtı yeterli değil.'};
    return {path:candidate.path,available:true,decision:product.decision,
      current:product.current,previous:product.previous,protected_queries:product.queries?.filter(q=>q.protect).length||0};
  });
  return {available:true,month:selectedMonth,source:'saved-validated-analysis',report_created_at:r.created_at,period:r.period,previous_period:r.previous_period,rows};
}
