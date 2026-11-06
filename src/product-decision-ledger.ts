// Read-only monthly decision register for every verified product URL group.
// No network, D1, writes or content changes; source scopes stay separate.
import {buildInsights,metric} from './independent-insights';
import type {InsightMonth,InsightScope,Metric} from './independent-insights';
import type {ContextProduct,ContextChange} from './independent-context';
import type {Ga4View} from './independent-product-answer';
import {productGa4} from './independent-product-answer';

type GscQuery={page:string;query:string;device:string;country:string;clicks:number;impressions:number;position:number};
type QuerySignal={query:string;current:Metric;previous:Metric;delta:number;rate:number|null;position_delta:number|null};
const prior=(month:string)=>{const d=new Date(month+'-01T00:00:00Z');d.setUTCMonth(d.getUTCMonth()-1);return d.toISOString().slice(0,7);};
const last=(month:string)=>new Date(Date.UTC(Number(month.slice(0,4)),Number(month.slice(5)),0)).toISOString().slice(0,10);
const rank={'Öncelikli incele':0,'İncele':1,'Koru':2,'Veri bekle':3} as const;
const match=(r:{page:string;device:string;country:string},urls:Set<string>,scope:InsightScope)=>urls.has(r.page)&&(!scope.device||scope.device==='ALL'||r.device===scope.device)&&(!scope.country||r.country===scope.country);
function grouped<T extends GscQuery>(rows:T[]){
 const by=new Map<string,T[]>();for(const row of rows){const array=by.get(row.query)||[];array.push(row);by.set(row.query,array);}return by;
}
function querySignals(now:GscQuery[],old:GscQuery[],complete:boolean){
 if(!complete)return {losses:[] as QuerySignal[],protected:[] as QuerySignal[],unpaired:0};
 const current=grouped(now),previous=grouped(old),paired:QuerySignal[]=[];
 for(const [query,rows] of current){
  const before=previous.get(query);if(!before)continue;const a=metric(rows),b=metric(before);if(!a||!b)continue;
  paired.push({query,current:a,previous:b,delta:a.clicks-b.clicks,rate:b.clicks>0?(a.clicks-b.clicks)/b.clicks:null,position_delta:a.impressions>0&&b.impressions>0?a.position-b.position:null});
 }
 return {
  losses:paired.filter(q=>q.delta<0).sort((a,b)=>a.delta-b.delta||a.query.localeCompare(b.query)).slice(0,8),
  // Preserve both established traffic-bearing queries and smaller stable/improving
  // queries. "Protected" is not a claim that their ranking improved.
  protected:paired.filter(q=>(q.current.clicks>=5&&q.current.impressions>=50)||(q.current.clicks>=1&&q.delta>=0))
   .sort((a,b)=>b.current.clicks-a.current.clicks||b.delta-a.delta||a.query.localeCompare(b.query)).slice(0,8),
  unpaired:new Set([...current.keys(),...previous.keys()]).size-paired.length
 };
}
export function buildProductDecisionLedger(
 current:InsightMonth,previous:InsightMonth|null|undefined,
 ga4Current:Ga4View|null|undefined,ga4Previous:Ga4View|null|undefined,
 products:ContextProduct[],changes:ContextChange[]=[],scope:InsightScope={},catalogVerified=true
){
 const data=buildInsights(current,previous,products,scope,catalogVerified);
 const queryComplete=data.query_comparison_available;
 const allUrls=new Map<string,number>();
 for(const p of products)for(const url of new Set(p.urls||[p.canonical_url]))allUrls.set(url,(allUrls.get(url)||0)+1);
 const globalPageRefs=[...(current.evidence||[]),...(previous?.evidence||[])].filter(ref=>ref.scope==='page');
 const globalQueryRefs=queryComplete?[...(current.evidence||[]),...(previous?.evidence||[])].filter(ref=>ref.scope==='query'):[];
 const ga4Allowed=(!scope.device||scope.device==='ALL')&&!scope.country&&!scope.page;
 const output=data.products.map(p=>{
  const urls=[...new Set(p.urls||[p.canonical_url])],urlSet=new Set(urls),mappingValid=catalogVerified&&!p.mapping_conflict&&urls.every(u=>allUrls.get(u)===1);
  const pageRows=data.pages.filter(r=>urlSet.has(r.url)),main=pageRows.find(r=>r.url===p.canonical_url);
  const droppingPages=data.comparison_available?pageRows.filter(r=>r.current&&r.previous&&r.delta!==null&&r.delta<0)
   .sort((a,b)=>a.delta!-b.delta!||a.url.localeCompare(b.url)).slice(0,8):[];
  const nowQ=(current.queries||[]).filter(r=>match(r,urlSet,scope));
  const oldQ=(previous?.queries||[]).filter(r=>match(r,urlSet,scope));
  const signals=querySignals(nowQ,oldQ,queryComplete&&mappingValid);
  const devices=[...new Set([...(current.pages||[]),...(previous?.pages||[])].filter(r=>urlSet.has(r.page)&&(!scope.country||r.country===scope.country)).map(r=>r.device))].sort().filter(d=>!scope.device||scope.device==='ALL'||d===scope.device).map(device=>{
   const n=metric((current.pages||[]).filter(r=>match(r,urlSet,{...scope,device})));
   const b=data.comparison_available?metric((previous?.pages||[]).filter(r=>match(r,urlSet,{...scope,device}))):null;
   return {device,current:n,previous:b,delta:n&&b?n.clicks-b.clicks:null,comparable:!!n&&!!b&&data.comparison_available};
  });
  const from=(data.previous_month||prior(data.month))+'-01',to=data.month+'-'+last(data.month).slice(-2);
  const events=changes.filter(e=>urlSet.has(e.url)).sort((a,b)=>b.observed_to.localeCompare(a.observed_to));
  // A crawl interval crossing the final day of the month cannot establish that
  // the change occurred during the compared month. Keep it in the full timeline,
  // but do not imply it is an October-period edit.
  const overlapping=events.filter(e=>e.observed_from.slice(0,10)<=to&&e.observed_to.slice(0,10)>=from&&e.observed_to.slice(0,10)<=to);
  const boundaryUnknown=events.filter(e=>e.observed_from.slice(0,10)<=to&&e.observed_to.slice(0,10)>to);
  // GA4 is canonical-path-only, all-device/all-country, and never a query or group total.
  const ga4=productGa4(ga4Current,ga4Previous,p,current.month,'');
  const ga4Usable=ga4Allowed&&ga4.comparable&&!ga4.thresholded&&!ga4.other_rows&&
   ga4Current?.month===current.month&&ga4Previous?.month===prior(current.month)&&
   ga4Current?.closed===true&&ga4Previous?.closed===true;
  const bothDown=!!(ga4Usable&&main?.current&&main.previous&&main.current.clicks<main.previous.clicks&&ga4.delta!==null&&ga4.delta<0);
  const comparable=data.comparison_available&&p.comparison_available&&mappingValid;
  const priority=(!comparable?'Veri bekle':p.decision==='İncele'?(bothDown?'Öncelikli incele':'İncele'):'Koru') as keyof typeof rank;
  const signalsText:string[]=[];
  if(comparable&&p.current&&p.previous){
   if(p.delta!==null&&p.delta<0)signalsText.push('GSC grup tıklaması '+p.previous.clicks+' → '+p.current.clicks+' ('+p.delta+').');
   if(p.current.impressions<p.previous.impressions)signalsText.push('GSC gösterimi '+p.previous.impressions+' → '+p.current.impressions+'.');
   if(p.previous.impressions>=100&&p.current.impressions>=100&&p.current.ctr<p.previous.ctr)signalsText.push('CTR %'+(p.previous.ctr*100).toFixed(2)+' → %'+(p.current.ctr*100).toFixed(2)+'.');
   if(p.previous.impressions>=100&&p.current.impressions>=100&&p.current.position>p.previous.position+.5)signalsText.push('Gösterim ağırlıklı ortalama sıra '+p.previous.position.toFixed(1)+' → '+p.current.position.toFixed(1)+' (büyük sıra kötüdür).');
   if(p.delta!==null&&p.delta>=0)signalsText.push('GSC grup tıklamaları gerilemedi ('+p.previous.clicks+' → '+p.current.clicks+').');
  }
  if(bothDown)signalsText.push('Ana URL için GA4 Organic Search '+ga4.previous_sessions+' → '+ga4.current_sessions+' oturum; GSC tıklamasıyla eşit değildir.');
  if(!comparable)signalsText.push(!catalogVerified?'Doğrulanmış ürün eşlemesi bekleniyor.':!mappingValid?'URL eşleme çakışması var.':'Aynı URL için iki tam ve eşleşen dönem kaydı bulunmuyor.');
  if(overlapping.length)signalsText.push('Karşılaştırma dönemi içinde sonlanan '+overlapping.length+' SEO tarama değişikliği aralığı gözlendi; yayın veya neden kanıtı değildir.');
  if(boundaryUnknown.length)signalsText.push(boundaryUnknown.length+' tarama değişikliği aralığı dönem sınırını aşıyor; değişikliğin Ekim ayında gerçekleştiği doğrulanamaz.');
  const meaningfulDecline=priority==='İncele'||priority==='Öncelikli incele';
  const mainMetric=p.current||null,oldMetric=p.previous||null;
  const percentage=mainMetric&&oldMetric&&oldMetric.clicks>0
   ?((mainMetric.clicks-oldMetric.clicks)/oldMetric.clicks*100).toFixed(1)+'%':'hesaplanamaz';
  const rankWorse=!!(mainMetric&&oldMetric&&mainMetric.impressions>=100&&oldMetric.impressions>=100&&mainMetric.position>oldMetric.position+.5);
  const ctrWorse=!!(mainMetric&&oldMetric&&mainMetric.impressions>=100&&oldMetric.impressions>=100&&mainMetric.ctr<oldMetric.ctr);
  const impressionsWorse=!!(mainMetric&&oldMetric&&mainMetric.impressions<oldMetric.impressions);
  const causes:string[]=[];
  if(rankWorse)causes.push('Ortalama konum '+oldMetric!.position.toFixed(2)+' → '+mainMetric!.position.toFixed(2)+' kötüleşti; sorgu ve cihaz bazında doğrulanmalı, tek başına kesin neden değildir.');
  if(impressionsWorse)causes.push('Gösterimler '+oldMetric!.impressions+' → '+mainMetric!.impressions+' geriledi; arama talebi veya görünürlük ayrımı bu veriyle kesinleşmez.');
  if(ctrWorse)causes.push('CTR %'+(oldMetric!.ctr*100).toFixed(2)+' → %'+(mainMetric!.ctr*100).toFixed(2)+' düştü; sıralama ve sorgu karışımı da etkili olabilir.');
  if(meaningfulDecline&&!causes.length)causes.push('Tıklama kaybı doğrulandı, ancak konum/gösterim/CTR tek başına açıklayıcı bir mekanizma göstermiyor.');
  const topLoss=signals.losses[0]||null;
  const winner=signals.protected[0]||null;
  const worstUrl=droppingPages[0]||null;
  const deviceLoss=devices.filter(d=>d.comparable&&d.delta!==null&&d.delta<0).sort((a,b)=>a.delta!-b.delta!)[0]||null;
  const target=worstUrl?.url||p.canonical_url;
  const evidenceSummary=comparable&&mainMetric&&oldMetric
   ?'GSC '+previous!.month+' → '+current.month+': '+oldMetric.clicks+' → '+mainMetric.clicks+' tıklama ('+(p.delta!>0?'+':'')+p.delta+', '+percentage+'); gösterim '+oldMetric.impressions+' → '+mainMetric.impressions+'; CTR %'+(oldMetric.ctr*100).toFixed(2)+' → %'+(mainMetric.ctr*100).toFixed(2)+'; ortalama sıra '+oldMetric.position.toFixed(2)+' → '+mainMetric.position.toFixed(2)+'.'
   :'İki tam ve aynı kapsamlı GSC dönemi veya tekil URL eşlemesi doğrulanmadı; eksik veri sıfır sayılamaz.';
  const investigation=meaningfulDecline
   ?'Öncelik '+target+' URL’si. '+(topLoss?'İki ayda da görülen en büyük kayıp sorgu: "'+topLoss.query+'" ('+topLoss.previous.clicks+' → '+topLoss.current.clicks+' tıklama). ':'İki ayda birlikte görünen kayıp sorgu doğrulanmadı; sorgu tahmin etme. ')+(deviceLoss?'En büyük karşılaştırılabilir cihaz kaybı '+deviceLoss.device+' ('+deviceLoss.previous!.clicks+' → '+deviceLoss.current!.clicks+'). ':'Cihaz bazında kanıtlı kayıp saptanmadı. ')+(overlapping.length?'Dönem içinde sonlanan '+overlapping.length+' tarama değişikliği kaydı var; yayın tarihi veya sebep kanıtı değil. ':'Dönemle örtüşen kayıtlı SEO değişikliği yok; değişiklik yapılmadığı kanıtlanmaz. ')
   :'Bu ürün için yüksek öncelikli düşüş soruşturması açma. '+(winner?'Korunacak görünür sorgu: "'+winner.query+'". ':'Yeni veya görünmeyen sorguları kayıp kabul etme. ');
  const conclusion=!comparable
   ?'KARAR: Şimdi SEO içeriğini değiştirme. Eksik karşılaştırma dönemi veya URL eşlemesi doğrulanınca aynı kapsamda yeniden değerlendir.'
   :meaningfulDecline
    ?'KARAR: '+target+' sayfasının başlık, H1, fiyat, metin ve canonical alanlarını mevcut kanıtla değiştirme. '+(winner?'Trafik sağlayan "'+winner.query+'" sorgusunu koru; bu sorgunun da düşmüş olabileceğini dikkate al. ':'Mevcut trafik sağlayan ve istikrarlı sorguları koru. ')+(overlapping.length?'Dönem içinde sonlanan taramaların önce/sonra içeriğini ve yayın kanıtını karşılaştır. ':'Dönem içinde sonlanan doğrulanmış bir SEO değişiklik aralığı bulunmuyor. ')+(boundaryUnknown.length?'Dönem sınırını aşan taramaları kesin Ekim değişikliği olarak yorumlama. ':'')+'Bir sonraki kapanmış ayda aynı URL, cihaz ve görünür sorgunun kaybı sürerse yalnız doğrulanmış teknik/içerik sorununa yönelik sınırlı düzeltme planla.'
    :'KARAR: Mevcut sayfa içeriğini koru; küçük dalgalanma için müdahale etme. Bir sonraki kapanmış ayda aynı GSC kapsamını karşılaştır.';
  const action='TESPİT VE KANIT: '+evidenceSummary+' NEDEN ANALİZİ: '+(causes.length?causes.join(' '):'Önemli düşüş eşiği aşılmadı; kesin neden çıkarılmaz.')+' HEDEF VE İNCELEME: '+investigation+' '+conclusion;
  const diagnosis={target_url:meaningfulDecline?target:null,top_loss_query:topLoss?.query||null,most_affected_device:deviceLoss?.device||null,
   observed_mechanisms:causes,summary:evidenceSummary,investigation,decision:conclusion,confidence:!comparable?'veri_yetersiz':meaningfulDecline?'gozlemsel_kanit':'koruma_karari',
   cause_confirmed:false,content_change_recommended:false};
  return {
   id:p.id,name:p.name,canonical_url:p.canonical_url,urls,month:current.month,previous_month:previous?.month||null,
   priority,rank:rank[priority],comparison_available:comparable,decision:comparable?p.decision:'Veri bekle',
   gsc:{current:comparable?p.current:null,previous:comparable?p.previous:null,delta:comparable?p.delta:null,main_url:main?.url||p.canonical_url,main_current:main?.current||null,main_previous:main?.previous||null,dropping_pages:droppingPages},
   queries:{comparable:queryComplete&&mappingValid,losses:signals.losses,protected:signals.protected,unpaired_visible_queries:signals.unpaired,anonymous_queries_excluded:true},
   devices,ga4:{scope_comparable:ga4Usable,canonical_path:ga4.path,current_sessions:ga4Usable?ga4.current_sessions:null,previous_sessions:ga4Usable?ga4.previous_sessions:null,delta:ga4Usable?ga4.delta:null,cross_source_decline:bothDown,query_support:false},
   seo_changes:{matching_events:events.length,overlapping:overlapping.slice(0,8).map(e=>({id:e.id,url:e.url,changed_fields:e.changed_fields,observed_from:e.observed_from,observed_to:e.observed_to,published_at:e.publication_evidence?e.published_at:null,publication_proven:!!e.publication_evidence})),boundary_uncertain:boundaryUnknown.slice(0,8).map(e=>({id:e.id,url:e.url,changed_fields:e.changed_fields,observed_from:e.observed_from,observed_to:e.observed_to})),coverage_limit:'Tarama arşivi son olaylarla sınırlı olabilir; ay sonunu aşan taramalar değişiklik tarihi sayılmaz.'},
   signals:signalsText,action,diagnosis,content_change_recommended:false,cause_confirmed:false,
   evidence:{gsc_pages:globalPageRefs,gsc_queries:globalQueryRefs,ga4_pages:ga4Usable?ga4.evidence.filter(e=>e.kind==='pages'):[]},
   limitations:['URL grubu ve ana URL farklı kapsamlardır.','GSC görünür sorgular eksik ve anonimleştirilmiş olabilir; tek ayda görünmeyen satır sıfır değildir.','GA4 yalnız kanıtlı ana açılış sayfası ve tüm cihazlar kapsamındadır; GSC tıklaması ile karşılaştırılarak nedensellik çıkarılmaz.','Tarihli tarama aralığı kesin yayın tarihi veya sıralama etkisi değildir.'],
   d1_requests:0
  };
 });
 return output.sort((a,b)=>a.rank-b.rank||(a.gsc.delta??0)-(b.gsc.delta??0)||a.name.localeCompare(b.name,'tr'));
}
