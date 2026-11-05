// Evidence-led, read-only ranking for "which three products should I prioritize?".
// "Koru" products are explicitly preservation work, never fabricated declines.
import {buildProductDecisionLedger} from './product-decision-ledger';
import {buildInsights} from './independent-insights';
import type {InsightMonth,InsightScope} from './independent-insights';
import type {ContextProduct,ContextChange} from './independent-context';
import type {Ga4View} from './independent-product-answer';

export function answerTopProductPriorities(current:InsightMonth,previous:InsightMonth|null|undefined,ga4Current:Ga4View|null|undefined,ga4Previous:Ga4View|null|undefined,products:ContextProduct[],changes:ContextChange[]=[],scope:InsightScope={}){
 const report=buildInsights(current,previous,products,scope);
 const ledger=buildProductDecisionLedger(current,previous,ga4Current,ga4Previous,products,changes,scope);
 const productInfo=new Map(report.products.map(p=>[p.id,p]));
 const verified=ledger.filter(p=>p.comparison_available&&p.gsc.current&&p.gsc.previous);
 const candidates=verified.map(p=>{
  const insight=productInfo.get(p.id);
  const opportunities=insight?.opportunities||[];
  // A meaningful decline takes precedence; a minor decline is monitor-only.
  // High-visibility opportunities come next, followed by protecting known winners.
  const tier=p.priority==='Öncelikli incele'?0:p.priority==='İncele'?1:
   (p.gsc.delta!==null&&p.gsc.delta<0)?2:opportunities.length?3:4;
  const task=tier<=1?'Önemli düşüşü incele':tier===2?'Küçük düşüşü izle; sayfayı değiştirme':tier===3?'GSC görünürlük/CTR fırsatını incele':'Başarılı performansı koru';
  return {...p,tier,task,opportunities};
 }).sort((a,b)=>a.tier-b.tier||(a.tier<=2?(a.gsc.delta??0)-(b.gsc.delta??0):(b.gsc.current?.impressions??0)-(a.gsc.current?.impressions??0))||a.name.localeCompare(b.name,'tr'));
 const selected=candidates.slice(0,3);
 const lines=selected.map((p,i)=>{
  const now=p.gsc.current!,old=p.gsc.previous!;
  const difference=now.clicks-old.clicks;
  const detail=p.tier<=2?'GSC '+old.clicks+' → '+now.clicks+' tıklama (fark '+(difference>0?'+':'')+difference+'), '+old.impressions+' → '+now.impressions+' gösterim':
   'GSC '+now.clicks+' tıklama, '+now.impressions+' gösterim; önceki ay '+old.clicks+' tıklama';
  const queryLoss=p.queries.losses[0]?.query,protectedQuery=p.queries.protected[0]?.query;
  return (i+1)+'. '+p.name+' — '+p.task+'. '+detail+'. '+
   (p.tier===3?'Fırsat: '+p.opportunities.join(', ')+'. ':'')+
   (queryLoss?'Görünür kayıp sorgusu: '+queryLoss+'. ':'')+
   (protectedQuery?'Korunacak görünür sorgu: '+protectedQuery+'. ':'')+
   (p.ga4.cross_source_decline?'Ana sayfada GSC tıklaması ve GA4 organik oturumu ayrı ayrı düşüyor. ':'')+
   (p.seo_changes.overlapping.length?'Dönemle örtüşen '+p.seo_changes.overlapping.length+' tarama değişikliği bulunuyor, kesin neden değil. ':'');
 });
 const insufficient=selected.length<3?' Kanıtlı karşılaştırmaya uygun yalnız '+selected.length+' ürün var; kalan '+(3-selected.length)+' sıraya veri uydurulmadı.':'';
 const pageRefs=[...(current.evidence||[]),...(previous?.evidence||[])].filter(e=>e.scope==='page');
 const queryRefs=selected.some(p=>p.queries.comparable)?[...(current.evidence||[]),...(previous?.evidence||[])].filter(e=>e.scope==='query'):[];
 const ga4Refs=selected.flatMap(p=>p.evidence.ga4_pages);
 const refs=[...pageRefs,...queryRefs,...ga4Refs];
 return {answer:'Kanıt: '+(previous?.month||'önceki ay doğrulanmadı')+' → '+current.month+' · '+(scope.device||'tüm cihazlar')+' · '+(scope.country||'tüm ülkeler')+
  '. '+(lines.length?lines.join('\n'):'Aynı kapsamda iki tam ayı doğrulanan ürün yok; üç ürün seçilemez.')+
  insufficient+' Yorum: Önemli düşüş, küçük dalgalanma, GSC fırsatı ve korunacak performans ayrı sınıflandırılır. GSC anonimleştirilmiş sorgular tahmin edilmez. GA4 oturumları GSC tıklaması değildir. Tarama tarihi kesin yayın veya düşüş nedeni değildir.'+
  ' SEO kararı: '+(selected.some(p=>p.tier<=1)?'İncele':'Koru')+'. Kanıtlanmış neden olmadan canlı sitede içerik, başlık veya yönlendirme değiştirme.',
  source:'GSC Search Analytics API',supporting_sources:ga4Refs.length?['Google Analytics 4 Data API']:[],month:current.month,previous_month:previous?.month||null,
  decision:!selected.length?'Veri bekle':selected.some(p=>p.tier<=1)?'İncele':'Koru',
  intent:'top-product-priorities',requested_count:3,total_candidates:candidates.length,items:selected.map(p=>({
   product_id:p.id,name:p.name,priority:p.priority,task:p.task,opportunities:p.opportunities,
   gsc:p.gsc,query_losses:p.queries.losses,protected_queries:p.queries.protected,
   ga4:p.ga4,seo_changes:p.seo_changes,content_change_recommended:false,cause_confirmed:false
  })),filters:scope,evidence_refs:refs,evidence:refs.map((r:any)=>r.scope==='page'||r.scope==='query'?'gsc:history:'+r.day+':'+r.scope+':'+r.generation:'ga4:'+r.property+':'+r.month+':'+r.kind+':'+r.generation),
  content_change_recommended:false,cause_confirmed:false,d1_requests:0};
}
