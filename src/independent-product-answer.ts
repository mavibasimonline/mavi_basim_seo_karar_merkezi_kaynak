// Read-only synthesis of verified, already stored evidence. No collection, writes or D1.
import {variantFamily} from './urls';
import {answerVerifiedGsc} from './independent-gsc-analysis';
import type {IndependentContext,ContextProduct,ContextChange} from './independent-context';
type GscAnswer=ReturnType<typeof answerVerifiedGsc>;
type Ga4Page={page:string;active_users:number;sessions:number;engaged_sessions:number};
type Ga4Ref={source:string;property:string;month:string;kind:string;from:string;to:string;timezone:string;generation:string;captured_at:string;rows:number;hashes:string[]};
export type Ga4View={month:string;source:string;channel?:string;hostnames?:string[];closed?:boolean;from?:string|null;to?:string|null;property?:{id:string;time_zone:string}|null;pages?:Ga4Page[];evidence?:Ga4Ref[];thresholded?:boolean;other_rows?:boolean};
const GA4='Google Analytics 4 Data API';
const word=(question:string,value:string)=>new RegExp('(?:^|[^a-z0-9])'+variantFamily(value).replace(/[.*+?^${}()|[\]\\]/g,'\\$&')+'(?:[^a-z0-9]|$)').test(variantFamily(question));
export function questionProduct(context:IndependentContext|null,question:string){
 const urls:string[]=Array.from(question.match(/https?:\/\/[^\s<>"')]+/g)||[]);
 return [...context?.products||[]].sort((a,b)=>b.name.length-a.name.length).find(p=>urls.length?urls.includes(p.canonical_url):word(question,p.name)||word(question,p.id.replaceAll('-',' ')))||null;
}
function monthEnd(month:string){return new Date(Date.UTC(Number(month.slice(0,4)),Number(month.slice(5)),0)).toISOString().slice(0,10);}
function pageScope(view:Ga4View|null|undefined,month:string){
 return view?.month===month&&view.source===GA4&&view.channel==='Organic Search'&&JSON.stringify(view.hostnames)===JSON.stringify(['mavibasim.com','www.mavibasim.com'])&&view.closed===true&&view.from===month+'-01'&&view.to===monthEnd(month)&&!!view.property&&!!view.evidence?.some(r=>r.kind==='pages'&&r.property===view.property!.id&&r.month===month&&r.from===view.from&&r.to===view.to&&r.hashes.length>0);
}
export function productGa4(current:Ga4View|null|undefined,previous:Ga4View|null|undefined,product:ContextProduct,month:string,question:string){
 const prior=new Date(month+'-01T00:00:00Z');prior.setUTCMonth(prior.getUTCMonth()-1);const previousMonth=prior.toISOString().slice(0,7);
 const canonical=new URL(product.canonical_url),path=canonical.pathname;
 const unsupported=/sorgu|anahtar|kelime/.test(variantFamily(question));
 const refs=(!unsupported&&pageScope(current,month)?current!.evidence!.filter(r=>r.kind==='pages'):[]);
 const now=!unsupported&&!canonical.search&&!canonical.hash&&pageScope(current,month)?current!.pages?.find(r=>r.page===path):undefined;
 const old=now&&pageScope(previous,previousMonth)&&previous!.property!.id===current!.property!.id&&previous!.property!.time_zone===current!.property!.time_zone?previous!.pages?.find(r=>r.page===path):undefined;
 const evidence=old?[...refs,...previous!.evidence!.filter(r=>r.kind==='pages')]:refs;
 return {available:!!now,comparable:!!now&&!!old,unsupported_query:unsupported,path,source:GA4,month,previous_month:previousMonth,
  current_sessions:now?.sessions??null,previous_sessions:old?.sessions??null,delta:now&&old?now.sessions-old.sessions:null,
  active_users:now?.active_users??null,engaged_sessions:now?.engaged_sessions??null,time_zone:current?.property?.time_zone||null,
  thresholded:!!current?.thresholded||!!previous?.thresholded,other_rows:!!current?.other_rows||!!previous?.other_rows,evidence};
}
function ga4Text(g:ReturnType<typeof productGa4>){
 if(g.unsupported_query)return 'GA4 anahtar kelime veya GSC sorgu kanıtı sağlamaz; bu seçimle sorgu düşüşü açıklanamaz.';
 if(!g.available)return 'GA4 için bu ürünün doğrulanmış tam dönem açılış sayfası satırı yok; uygun veri eksikliği sıfır oturum değildir. Şehir toplamı ürün kanıtının yerine kullanılmadı.';
 return 'GA4 Organic Search, '+g.path+' ('+g.time_zone+', mavibasim.com ve www.mavibasim.com; tüm cihazlar/ülkeler): '+(g.comparable?g.previous_month+' → '+g.month+', '+g.previous_sessions+' → '+g.current_sessions+' oturum; fark '+g.delta:g.month+', '+g.current_sessions+' oturum; aynı kapsamda önceki ayın satırı doğrulanmadı, sıfır sayılmadı')+'.'+(g.thresholded?' Gizlilik eşiği mevcut.':'')+(g.other_rows?' Google bazı satırları (other) altında birleştirmiş.':'');
}
export function answerGa4Product(current:Ga4View|null|undefined,previous:Ga4View|null|undefined,product:ContextProduct,month:string,question:string){
 const ga4=productGa4(current,previous,product,month,question);
 return {answer:'Kanıt: '+ga4Text(ga4)+' Yorum: GA4 oturumu GSC tıklaması değildir; yalnız GA4 seçiliyken arama görünürlüğü veya düşüş nedeni kesinleştirilemez. SEO kararı: uygun GSC ve değişiklik kanıtıyla değerlendirmeden müdahale etme.',decision:'Veri bekle',source:GA4,month,previous_month:ga4.previous_month,product_id:product.id,url:product.canonical_url,requires_ga4:!ga4.available,
  evidence_refs:ga4.evidence,evidence:ga4.evidence.map(r=>'ga4:'+r.property+':'+r.month+':'+r.kind+':'+r.generation),evaluation:{ga4,cause_confirmed:false},d1_requests:0};
}
function eventRef(context:IndependentContext,event:ContextChange){return {source_hash:context.source_hash,event_id:event.id,url:event.url,before:event.before,after:event.after,changed_fields:event.changed_fields,observed_interval:{from:event.observed_from,to:event.observed_to},published_at:event.publication_evidence?event.published_at:null,publication_evidence:event.publication_evidence};}
export function answerProductEvidence(gsc:GscAnswer,ga4Current:Ga4View|null|undefined,ga4Previous:Ga4View|null|undefined,context:IndependentContext,product:ContextProduct,question:string){
 const ga4=productGa4(ga4Current,ga4Previous,product,gsc.month,question),comparison=gsc.comparison;
 const start=(gsc.previous_month||gsc.month)+'-01',end=monthEnd(gsc.month);
 const all=context.changes.filter(e=>e.url===product.canonical_url).sort((a,b)=>b.observed_to.localeCompare(a.observed_to));
 const overlapping=all.filter(e=>e.observed_to.slice(0,10)>=start&&e.observed_from.slice(0,10)<=end);
 const events=(overlapping.length?overlapping:all).slice(0,5),changes=events.map(e=>eventRef(context,e));
 const gscText=comparison?product.name+' GSC ürünü, '+gsc.previous_month+' → '+gsc.month+': '+comparison.previous.clicks+' → '+comparison.current.clicks+' tıklama; fark '+comparison.delta+' (%'+(comparison.rate===null?'hesaplanamaz':(comparison.rate*100).toFixed(1))+'). Gösterim '+comparison.previous.impressions+' → '+comparison.current.impressions+'; CTR %'+(comparison.previous.ctr*100).toFixed(2)+' → %'+(comparison.current.ctr*100).toFixed(2)+'; ağırlıklı konum '+comparison.previous.position.toFixed(2)+' → '+comparison.current.position.toFixed(2)+'. GSC kapsamı: '+(gsc.filters.device||'tüm cihazlar')+', '+(gsc.filters.country||'tüm ülkeler')+'. '+comparison.pages.slice(0,5).map(p=>'Sayfa '+p.page+': '+(p.previous&&p.current?p.previous.clicks+' → '+p.current.clicks+' tıklama':'aynı sayfanın iki ayı birlikte doğrulanmadı; eksik satır sıfır değil')).join('; '):'Bu ürünün karşılaştırılabilir tam GSC dönem/filtre kanıtı eksik; düşüş hesaplanmadı.';
 const changeText=!events.length?'Bu sınırlı değişiklik arşivinde ürün için tarihli kayıt yok; bu, değişiklik yapılmadığını kanıtlamaz.':events.map(e=>(e.publication_evidence?'Kanıtlı yayın '+e.published_at:'Kesin yayın zamanı bilinmiyor; tarama aralığı '+e.observed_from+' — '+e.observed_to)+'; alanlar '+e.changed_fields.join(', ')).join('; ')+(!overlapping.length?' Bu kayıtlar karşılaştırma dönemi dışında; Eylül–Ekim farkını açıklayan zaman kanıtı değildir.':'');
 const interpretation=(comparison&&comparison.delta<0?'GSC tıklamalarında azalma doğrulandı. ':'')+'GA4 organik açılış oturumları ayrı ölçümdür; tıklama ile eşitlenmez. Ay uzunluğu, marka, cihaz/ülke karışımı ve mevsimsellik tek başına neden olarak seçilemez. Tarih çakışması nedensellik kanıtı değildir; düşüşün nedeni kesinleştirilemedi.';
 const decisionText=gsc.decision==='İncele'?'GSC tıklama kaybı en az %20 ve 30 tıklama, iki dönemde en az 100 gösterim eşiğini karşılıyor; incele. Nedeni doğrulamadan içerik veya yönlendirme değiştirme.':gsc.decision==='Koru'?'Aynı GSC kuralında güçlü düşüş eşiği karşılanmıyor; mevcut içeriği koru. Bu karar düşüş olmadığı veya nedeninin bilindiği anlamına gelmez.':'Eksik kapsam/baseline tamamlanana kadar veri bekle; SEO müdahalesi önerilmez.';
 const refs=[...gsc.evidence_refs,...ga4.evidence,...changes],keys=[...gsc.evidence,...ga4.evidence.map(r=>'ga4:'+r.property+':'+r.month+':'+r.kind+':'+r.generation),...changes.map(e=>e.source_hash+':'+e.event_id)];
 return {...gsc,answer:'Kanıt: '+gscText+'\n'+ga4Text(ga4)+'\nSEO değişiklikleri: '+changeText+'\nYorum: '+interpretation+'\nSEO kararı: '+decisionText,product_id:product.id,url:product.canonical_url,
  primary_source:gsc.source,supporting_sources:[...(ga4.evidence.length?[GA4]:[]),...(changes.length?['Doğrulanmış SEO tarama/değişiklik arşivi']:[])],
  evidence_refs:refs,evidence:keys,mapping_evidence:{source_hash:context.source_hash,captured_at:context.captured_at},evaluation:{gsc:comparison,ga4,changes,changes_overlap_period:overlapping.length>0,cause_confirmed:false,decision_basis:'Aynı filtreli, tam dönem GSC tıklamaları; -%20, -30 tıklama ve iki ayda en az 100 gösterim'},d1_requests:0};
}
