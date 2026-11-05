// Deterministic analysis of hash-verified GSC observations. No provider IO or D1.
import {isBrand,variantFamily} from './urls';

export type GscMetricRow={page:string;device:string;country:string;clicks:number;impressions:number;ctr:number;position:number};
export type GscQueryMetricRow=GscMetricRow&{query:string;is_brand?:number};
export type GscEvidenceRef={day:string;scope:'page'|'query';generation:string;captured_at:string;rows:number;page_hashes:string[]};
export type MonthlyGscAnalysisInput={available:boolean;month:string;days_verified:number;expected_days:number;missing_days?:string[];query_days_verified:number;query_missing_days?:string[];query_partial?:boolean;pages?:GscMetricRow[];queries?:GscQueryMetricRow[];evidence?:GscEvidenceRef[]};
export type GscProductMapping={id:string;name:string;pages:string[]};
type Metrics={clicks:number;impressions:number;ctr:number;position:number};
export const COMPARISON_DECISION_RULE='Aynı filtreli tam dönem GSC: iki ayda da en az 100 gösterim; en az %20 ve 30 tıklama kayıp veya önceki ay en az 10 tıklamada en az %30 kayıp. İncele, sayfayı değiştir kararı değildir.';
export function comparisonDecision(current:Pick<Metrics,'clicks'|'impressions'>|null,previous:Pick<Metrics,'clicks'|'impressions'>|null):'Koru'|'İncele'|'Veri bekle'{
 if(!current||!previous||[current.clicks,current.impressions,previous.clicks,previous.impressions].some(n=>!Number.isFinite(n)||n<0))return 'Veri bekle';
 const delta=current.clicks-previous.clicks,rate=previous.clicks?delta/previous.clicks:null;
 const materialDrop=rate!==null&&(rate<=-.2&&delta<=-30||previous.clicks>=10&&rate<=-.3);
 return materialDrop&&Math.min(current.impressions,previous.impressions)>=100?'İncele':'Koru';
}
export type GscComparison={current:Metrics;previous:Metrics;delta:number;rate:number|null;pages:{page:string;current:Metrics|null;previous:Metrics|null}[]};
export function comparisonTrend(delta:number){return delta>0?'Bu dönemde düşüş yok, yükseliş var.':delta===0?'Bu dönemde düşüş yok; tıklama sayısı değişmedi.':'Bu dönemde GSC tıklamalarında düşüş var.';}
type Facet=Metrics&{id:string;label:string};
type Filters={product?:string;page?:string;device?:string;country?:string;query?:string};
const SOURCE='GSC Search Analytics API',LIMIT=150;
const lower=(s:string)=>s.toLocaleLowerCase('tr-TR');
function metrics(rows:GscMetricRow[]):Metrics|null{
 if(!rows.length)return null;
 let clicks=0,impressions=0,weighted=0;
 for(const r of rows){clicks+=r.clicks;impressions+=r.impressions;weighted+=r.position*r.impressions;}
 return {clicks,impressions,ctr:impressions?clicks/impressions:0,position:impressions?weighted/impressions:0};
}
function facets<T extends GscMetricRow>(rows:T[],identity:(row:T)=>string,label:(id:string)=>string=id=>id):Facet[]{
 const grouped=new Map<string,T[]>();
 for(const r of rows){const id=identity(r),list=grouped.get(id)||[];list.push(r);grouped.set(id,list);}
 return [...grouped].map(([id,list])=>({id,label:label(id),...metrics(list)!})).sort((a,b)=>b.clicks-a.clicks||b.impressions-a.impressions||a.id.localeCompare(b.id));
}
function productIndex(products:GscProductMapping[]){
 const index=new Map<string,GscProductMapping>(),ids=new Set<string>();
 for(const p of products){
  if(!p.id||!p.name||!Array.isArray(p.pages)||ids.has(p.id))throw Error('GSC_PRODUCT_MAPPING_INVALID');
  ids.add(p.id);
  for(const page of p.pages){
   if(index.has(page)&&index.get(page)!.id!==p.id)throw Error('GSC_PRODUCT_MAPPING_AMBIGUOUS');
   index.set(page,p);
  }
 }
 return index;
}
const refKey=(r:GscEvidenceRef)=>'gsc:history:'+r.day+':'+r.scope+':'+r.generation;
const coverage=(report:MonthlyGscAnalysisInput)=>({days_verified:report.days_verified,expected_days:report.expected_days,missing_days:report.missing_days||[],query_days_verified:report.query_days_verified,query_missing_days:report.query_missing_days||[],query_partial:true});
const limitations=[
 'GSC sorguları anonimleştirilmiş veya üst satır sınırı nedeniyle eksik olabilir; eksik sorgu sıfır değildir.',
 'Ülke, şehir veya bölge anlamına gelmez. GSC şehir verisi sağlamaz; şehir analizi için doğrulanmış GA4 gerekir.',
 'URL gözlemleri yalnızca açık ürün eşlemesine göre gruplanır; www/http adresleri için canonical eşitliği varsayılmaz.',
 'Dönem farkı nedensellik kanıtı değildir; mevsimsellik, marka ve cihaz dağılımı ayrı incelenmelidir.'
];
export function analyzeVerifiedGsc(report:MonthlyGscAnalysisInput,products:GscProductMapping[]=[]){
 const index=productIndex(products),pageRows=report.pages||[],queryRows=report.queries||[];
 const byPage=facets(pageRows,r=>r.page),byDevice=facets(pageRows,r=>r.device),byCountry=facets(pageRows,r=>r.country);
 const byQuery=facets(queryRows,r=>r.query),mapped=pageRows.filter(r=>index.has(r.page));
 const byProduct=facets(mapped,r=>index.get(r.page)!.id,id=>products.find(p=>p.id===id)!.name);
 const byBrand=facets(queryRows,r=>isBrand(r.query)?'brand':'nonbrand',id=>id==='brand'?'Markalı görünen sorgular':'Markasız görünen sorgular');
 return {available:report.available,month:report.month,source:SOURCE,d1_requests:0,coverage:coverage(report),
  totals:report.available?metrics(pageRows):null,
  pages:byPage.slice(0,LIMIT),devices:byDevice,countries:byCountry,products:byProduct.slice(0,LIMIT),
  queries:byQuery.slice(0,LIMIT),query_scope:'Yalnızca GSC tarafından gösterilen doğrulanmış sorgu satırları; site toplamı değildir.',brands:byBrand,
  facet_counts:{pages:byPage.length,queries:byQuery.length,products:byProduct.length},facet_limit:LIMIT,
  unmapped_pages:[...new Set(pageRows.filter(r=>!index.has(r.page)).map(r=>r.page))].slice(0,LIMIT),
  evidence:report.evidence||[],limitations};
}
function filtered<T extends GscMetricRow>(rows:T[],filters:Filters,index:Map<string,GscProductMapping>):T[]{
 return rows.filter(r=>(!filters.product||index.get(r.page)?.id===filters.product)&&(!filters.page||r.page===filters.page)
  &&(!filters.device||r.device===filters.device)&&(!filters.country||r.country===filters.country)
  &&(!filters.query||('query' in r&&r.query===filters.query)));
}
function requestedFilters(question:string,current:MonthlyGscAnalysisInput,previous:MonthlyGscAnalysisInput|undefined,products:GscProductMapping[]):Filters{
 const q=lower(question),filters:Filters={};
 const product=[...products].sort((a,b)=>b.name.length-a.name.length).find(p=>q.includes(lower(p.name))||new RegExp('(^|[^a-z0-9-])'+p.id.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')+'([^a-z0-9-]|$)','i').test(q));
 if(product)filters.product=product.id;
 if(/mobil|mobile/.test(q))filters.device='MOBILE';
 else if(/masaüstü|desktop/.test(q))filters.device='DESKTOP';
 else if(/tablet/.test(q))filters.device='TABLET';
 const pages=[...new Set([...(current.pages||[]),...(previous?.pages||[])].map(r=>r.page))];
 filters.page=pages.sort((a,b)=>b.length-a.length).find(page=>question.includes(page));
 const countries=[...new Set([...(current.pages||[]),...(previous?.pages||[])].map(r=>r.country))];
 filters.country=countries.find(country=>new RegExp('(^|\\s)'+country+'($|\\s|[?.,])','i').test(q));
 if(/türkiye/.test(q))filters.country='tur';
 const queries=[...new Set([...(current.queries||[]),...(previous?.queries||[])].map(r=>r.query))];
 const observed=queries.sort((a,b)=>b.length-a.length).find(query=>query.length>=3&&q.includes(lower(query)));
 const explicitQuery=/sorgu|anahtar|kelime|[\"“”]/.test(q),sameProduct=product&&observed&&[variantFamily(product.name),variantFamily(product.id)].includes(variantFamily(observed));
 // A product name can also be a query. Preserve the user's selected product
 // or exact page unless the question explicitly selects that query.
 if(explicitQuery||!filters.page&&!sameProduct)filters.query=observed;
 return filters;
}
/** Answers use the exact observed filters and both period references. No causal claims. */
export function answerVerifiedGsc(current:MonthlyGscAnalysisInput,previous:MonthlyGscAnalysisInput|undefined,question:string,products:GscProductMapping[]=[]){
 if(typeof question!=='string'||!question.trim()||question.length>1000)throw Error('INVALID_QUESTION');
 const q=lower(question),index=productIndex(products),filters=requestedFilters(question,current,previous,products);
 const refs=(scope:'page'|'query',both=false)=>[...(current.evidence||[]),...(both?(previous?.evidence||[]):[])].filter(r=>r.scope===scope);
 const respond=(answer:string,decision:'Koru'|'İncele'|'Veri bekle',scope:'page'|'query'='page',both=false)=>{
  const evidence=refs(scope,both);
  return {answer,decision,evidence:evidence.map(refKey),evidence_refs:evidence,filters,source:SOURCE,month:current.month,
   previous_month:both?previous?.month||null:null,coverage:coverage(current),comparison:null as GscComparison|null,d1_requests:0};
 };
 if(/şehir|ilçe|bölge|istanbul|ankara|izmir|bursa|antalya/.test(q))return respond('Kanıt: GSC ülke boyutu sağlar; şehir veya bölge kanıtı yok. Yorum: ülke tıklamaları şehir performansını açıklamaz. SEO kararı: doğrulanmış GA4 organik oturum verisi gelene kadar şehir için değişiklik yapma.','Veri bekle');
 if(/değişiklik geçmiş|ne zaman|yayın|başlık|meta|kanonik|canonical/.test(q))return respond('Kanıt: bu rapor GSC performans kayıtlarını içerir; tarihli CMS yayını veya önceki/sonraki tarama kanıtı içermez. Yorum: düşüş bir içerik değişikliğinin neden olduğunu kanıtlamaz. SEO kararı: değişiklik geçmişi ve taramalar arası zaman aralığı doğrulanmadan neden veya kesin yayın tarihi atfetme.','Veri bekle');
 if(!refs('page').length)return respond('Kanıt: günlük sayfa kaynak referansları yok. Yorum: metrikler tek başına doğrulanmış kaynak kanıtı değildir. SEO kararı: veri bekle.','Veri bekle');
 if(!current.available)return respond('Kanıt: '+current.month+' için günlük sayfa kapsamı '+current.days_verified+'/'+current.expected_days+'. Yorum: eksik günler sıfır trafik değildir; tam ay karşılaştırması yapılamaz. SEO kararı: veri bekle; eksik kapsamdan düşüş çıkarma.','Veri bekle');
 const queryQuestion=!!filters.query||/anahtar|kelime|sorgu|hangi arama/.test(q);
 if(queryQuestion){
  if(!refs('query').length)return respond('Kanıt: günlük sorgu kaynak referansları yok. Yorum: sorgu metni veya tahmini metrik kaynak kanıtının yerini alamaz. SEO kararı: sorgu verisi bekle.','Veri bekle','query');
  const rows=filtered(current.queries||[],filters,index),list=facets(rows,r=>r.query).slice(0,10);
  if(!list.length)return respond('Kanıt: istenen filtrede doğrulanmış görünür sorgu satırı yok. Yorum: bu, sıfır trafik veya arama talebi anlamına gelmez; gizli/eksik sorgular tahmin edilemez. SEO kararı: sorgu verisi bekle.','Veri bekle','query');
  const previousMonth=new Date(current.month+'-01T00:00:00Z');previousMonth.setUTCMonth(previousMonth.getUTCMonth()-1);
  if(filters.query&&current.query_days_verified===current.expected_days&&previous?.available
   &&previous.month===previousMonth.toISOString().slice(0,7)&&previous.query_days_verified===previous.expected_days
   &&previous.evidence?.some(r=>r.scope==='query')){
   const before=metrics(filtered(previous.queries||[],filters,index)),now=metrics(rows)!;
   if(!before)return respond('Kanıt: '+current.month+' döneminde “'+filters.query+'” için '+now.clicks+' görünür tıklama / '+now.impressions+' gösterim; aynı filtrede önceki ayın görünür sorgu satırı yok. Yorum: önceki değer sıfır sayılamaz; fark hesaplanamaz. SEO kararı: sorgu verisi bekle.','Veri bekle','query',true);
   const delta=now.clicks-before.clicks,rate=before.clicks?delta/before.clicks:null;
   return respond('Kanıt: “'+filters.query+'”, '+previous.month+' → '+current.month+', aynı ürün/sayfa/cihaz/ülke filtresindeki görünür sorgu tıklamaları '+before.clicks+' → '+now.clicks+'; fark '+(delta>0?'+':'')+delta+(rate===null?' (önceki değer sıfır olduğundan yüzde hesaplanmaz)':' (%'+(rate*100).toFixed(1)+')')+'. Gösterimler '+before.impressions+' → '+now.impressions+'. Yorum: her iki ayın sorgu kayıtları okunup doğrulandı; anonimleştirme nedeniyle bunlar yalnızca görünür satırlardır, eksik sorgular tahmin edilmez. Bu fark talep kaybını veya değişikliğin neden olduğunu tek başına kanıtlamaz. SEO kararı: sayfa, cihaz ve değişiklik geçmişi kanıtıyla doğrulamadan içerik veya yönlendirme değiştirme.','Veri bekle','query',true);
  }
  const labels=list.map(r=>'“'+r.label+'”: '+r.clicks+' tıklama / '+r.impressions+' gösterim').join('; ');
  return respond('Kanıt: '+current.month+', görünür sorgu günleri '+current.query_days_verified+'/'+current.expected_days+'; '+labels+'. Yorum: bunlar GSC tarafından gösterilen sorgulardır; anonimleştirilmiş sorgular ve eksik günler bu toplama dahil değildir. Varyant kelimeler ayrı tutulur; sorgu toplamı site toplamı değildir. SEO kararı: yalnız bu kısmi sorgu listesiyle içerik veya yönlendirme değişikliği yapma.','Veri bekle','query');
 }
 const currentRows=filtered(current.pages||[],filters,index),now=metrics(currentRows);
 if(!now)return respond('Kanıt: istenen ürün/sayfa/cihaz/ülke filtresinde doğrulanmış satır yok. Yorum: istenen kırılım için sayısal karşılaştırma kurulamaz. SEO kararı: veri bekle; bulunmayan satırı sıfır sayma.','Veri bekle');
 const filterLabel=Object.entries(filters).filter(([,v])=>v).map(([k,v])=>k+'='+v).join(', ')||'site geneli';
 const observed='Kanıt: '+current.month+', '+filterLabel+', '+now.clicks+' tıklama / '+now.impressions+' gösterim, CTR %'+(now.ctr*100).toFixed(2)+', gösterim ağırlıklı konum '+now.position.toFixed(2)+'. ';
 const expectedPrevious=new Date(current.month+'-01T00:00:00Z');expectedPrevious.setUTCMonth(expectedPrevious.getUTCMonth()-1);
 if(!previous?.available||previous.month!==expectedPrevious.toISOString().slice(0,7)||!previous.evidence?.some(r=>r.scope==='page'))return respond(observed+'Yorum: karşılaştırılabilir önceki ayın tamamı doğrulanmadı; düşüş nedeni çıkarılamaz. SEO kararı: veri bekle.','Veri bekle');
 const previousRows=filtered(previous.pages||[],filters,index),before=metrics(previousRows);
 if(!before)return respond(observed+'Yorum: aynı filtrede önceki aya ait doğrulanmış satır yok; sıfır varsayımıyla fark hesaplanamaz. SEO kararı: veri bekle.','Veri bekle');
 const delta=now.clicks-before.clicks,rate=before.clicks?delta/before.clicks:null;
 const decision=comparisonDecision(now,before);
 const comparison:GscComparison={current:now,previous:before,delta,rate,pages:[...new Set([...currentRows,...previousRows].map(r=>r.page))].sort().map(page=>({page,current:metrics(currentRows.filter(r=>r.page===page)),previous:metrics(previousRows.filter(r=>r.page===page))}))};
 const change='Önceki ay '+previous.month+': '+before.clicks+' tıklama / '+before.impressions+' gösterim; tıklama farkı '+(delta>0?'+':'')+delta+(rate===null?' (önceki ay sıfır olduğundan yüzde hesaplanmaz)':' (%'+(rate*100).toFixed(1)+')')+'. ';
 const ctrContext=now.impressions>before.impressions&&now.ctr<before.ctr?'Gösterimler büyürken CTR düşüşü tek başına başarısızlık sayılmaz. ':'';
 return {...respond(observed+change+'Yorum: '+comparisonTrend(delta)+' '+ctrContext+'Aylık fark nedeni kanıtlamaz; marka, cihaz karışımı ve mevsimsellik ayrıca incelenmelidir. SEO kararı: '+(decision==='İncele'?'kayda değer düşüşü incele; değişiklik geçmişiyle doğrulamadan içerik veya yönlendirme değiştirme. İncele, sayfayı değiştir kararı değildir.':delta>=0?'tıklama düşüşü yok; mevcut sayfayı koru, değişiklik yapma.':'küçük veya az örneklemli dalgalanma; mevcut sayfayı koru, değişiklik yapma.'),decision,'page',true),comparison};
}
