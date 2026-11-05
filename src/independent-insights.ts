// Pure projections of existing verified records. No provider calls, writes or D1.
import {comparisonDecision} from './independent-gsc-analysis';
import type {MonthlyGscAnalysisInput,GscMetricRow} from './independent-gsc-analysis';
import type {ContextProduct} from './independent-context';
export type InsightMonth=MonthlyGscAnalysisInput&{source?:string;timezone?:string;property?:string;data_state?:string};
export type InsightScope={device?:string;country?:string;product?:string;page?:string};
export type Metric={clicks:number;impressions:number;ctr:number;position:number};
const GSC='GSC Search Analytics API',GA4='Google Analytics 4 Data API';
export const CATEGORIES=['Broşürler ve El İlanları','Reklam Ürünleri','Kurumsal Ürünler','Makbuz ve Formlar','Diğer Sayfalar'];
const categoryIds=[['brosur','el-ilani','afis'],['magnet','kitap-ayraci','yag-karti','etiket','amerikan-servis','tepsi-alti','oto-paspas','kutu','ambalaj'],['kartvizit','zarf','antetli-kagit','dosya','katalog','bloknot','kup-bloknot','karton-canta']];
export const fold=(s:string)=>s.toLocaleLowerCase('tr-TR').replaceAll('ı','i').normalize('NFD').replace(/[\u0300-\u036f]/g,'');
export function categoryOf(p:Pick<ContextProduct,'id'|'name'>){
 const id=fold(p.id).replaceAll('_','-'),name=fold(p.name).replaceAll(' ','-');
 for(let i=0;i<categoryIds.length;i++)if(categoryIds[i].some(v=>id===v||name===v))return CATEGORIES[i];
 return /makbuz|adisyon|fis|sozlesme|police|tahsilat|kiralama|gider|bilet|recete|tediye|form/.test(id+' '+name)?CATEGORIES[3]:CATEGORIES[4];
}
export function metric(rows:Pick<GscMetricRow,'clicks'|'impressions'|'position'>[],emptyZero=false):Metric|null{
 if(!rows.length&&!emptyZero)return null;
 if(rows.some(r=>[r.clicks,r.impressions,r.position].some(n=>!Number.isFinite(n)||n<0)))throw Error('INSIGHT_METRIC_INVALID');
 const clicks=rows.reduce((n,r)=>n+r.clicks,0),impressions=rows.reduce((n,r)=>n+r.impressions,0);
 return {clicks,impressions,ctr:impressions?clicks/impressions:0,position:impressions?rows.reduce((n,r)=>n+r.position*r.impressions,0)/impressions:0};
}
const selected=<T extends GscMetricRow>(rows:T[],scope:InsightScope)=>rows.filter(r=>(!scope.device||scope.device==='ALL'||r.device===scope.device)&&(!scope.country||r.country===scope.country)&&(!scope.page||r.page===scope.page));
function groups<T>(rows:T[],key:(r:T)=>string){const result=new Map<string,T[]>();for(const row of rows){const id=key(row),list=result.get(id)||[];list.push(row);result.set(id,list);}return result;}
const pageComplete=(m:InsightMonth|undefined|null)=>!!m&&m.source===GSC&&m.available&&m.days_verified===m.expected_days&&!!m.evidence?.some(r=>r.scope==='page');
const queryComplete=(m:InsightMonth|undefined|null)=>pageComplete(m)&&m!.query_days_verified===m!.expected_days&&!!m!.evidence?.some(r=>r.scope==='query');
const previousMonth=(month:string)=>{const d=new Date(month+'-01T00:00:00Z');d.setUTCMonth(d.getUTCMonth()-1);return d.toISOString().slice(0,7);};
function paired(now:Metric|null,before:Metric|null,complete:boolean){
 const delta=complete&&now&&before?now.clicks-before.clicks:null;
 return {current:now,previous:before,delta,rate:delta!==null&&before!.clicks>0?delta/before!.clicks:null,position_delta:complete&&now&&before?now.position-before.position:null,
  decision:complete?comparisonDecision(now,before):'Veri bekle',comparison_available:complete&&!!now&&!!before};
}
export function opportunityTypes(now:Metric|null){
 if(!now)return [] as string[];const result:string[]=[];
 if(now.impressions>=30&&now.position>10&&now.position<=20)result.push('İlk Sayfa Fırsatı');
 if(now.impressions>=100&&now.position>0&&now.position<=10&&now.ctr<.03)result.push('CTR Fırsatı');
 return result;
}
const cities='adana adiyaman afyonkarahisar agri amasya ankara antalya artvin aydin balikesir bilecik bingol bitlis bolu burdur bursa canakkale cankiri corum denizli diyarbakir edirne elazig erzincan erzurum eskisehir gaziantep giresun gumushane hakkari hatay isparta mersin istanbul izmir kars kastamonu kayseri kirklareli kirsehir kocaeli konya kutahya malatya manisa kahramanmaras mardin mugla mus nevsehir nigde ordu rize sakarya samsun siirt sinop sivas tekirdag tokat trabzon tunceli sanliurfa usak van yozgat zonguldak aksaray bayburt karaman kirikkale batman sirnak bartin ardahan igdir yalova karabuk kilis osmaniye duzce'.split(' ');
const pattern=(values:string[])=>new RegExp('(?:^|[^a-z0-9])(?:'+values.map(v=>v.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')).join('|')+')(?=$|[^a-z0-9])');
const cityPattern=pattern(cities);
export const QUERY_TYPES=['Ürün / Ticari','Yerel / Şehir','Bilgilendirici','Sınıflandırılmamış'];
export function queryType(query:string,products:ContextProduct[],productPattern=pattern(products.map(p=>fold(p.name)))){
 const q=fold(query);
 if(cityPattern.test(q)||/yakinimda|en yakin|yerel matbaa/.test(q))return QUERY_TYPES[1];
 if(/nasil|nedir|ne demek|kac cm|olculeri|boyutlari|hazirlanir|ornekleri/.test(q))return QUERY_TYPES[2];
 if(/baski|matbaa|fiyat|siparis|bastir|basim/.test(q)||products.length>0&&productPattern.test(q))return QUERY_TYPES[0];
 return QUERY_TYPES[3];
}
export function buildInsights(current:InsightMonth,previous:InsightMonth|null|undefined,products:ContextProduct[],scope:InsightScope={},catalogVerified=true){
 const nowRows=selected(current.pages||[],scope),oldRows=selected(previous?.pages||[],scope),valid=pageComplete(current),prior=pageComplete(previous)&&previous!.month===previousMonth(current.month),complete=valid&&prior;
 const nowPages=groups(nowRows,r=>r.page),oldPages=groups(oldRows,r=>r.page);
 const index=new Map<string,ContextProduct[]>();for(const p of products){const list=index.get(p.canonical_url)||[];list.push(p);index.set(p.canonical_url,list);}
 const allPages=[...new Set([...nowPages.keys(),...oldPages.keys()])];
 const pages=allPages.map(url=>{const matches=index.get(url)||[],now=metric(nowPages.get(url)||[]),before=metric(oldPages.get(url)||[]);
  return {id:url,url,label:url,product_id:matches.length===1?matches[0].id:null,category:matches.length===1?categoryOf(matches[0]):CATEGORIES[4],mapping:!catalogVerified?'unknown':matches.length===1?'matched':matches.length?'conflict':'unmapped',...paired(now,before,complete),opportunities:opportunityTypes(now),verified:valid};
 });
 const grouped=products.map(p=>{const unique=index.get(p.canonical_url)?.length===1,now=unique?metric(nowPages.get(p.canonical_url)||[]):null,before=unique?metric(oldPages.get(p.canonical_url)||[]):null;
  return {...p,label:p.name,category:categoryOf(p),urls:[p.canonical_url],...paired(now,before,complete),opportunities:opportunityTypes(now),verified:valid,mapping_conflict:!unique};
 });
 const total=metric(nowRows,true),oldTotal=prior?metric(oldRows,true):null,observed=pages.filter(p=>p.current),matched=observed.filter(p=>p.mapping==='matched'),unmapped=observed.filter(p=>p.mapping==='unmapped'),conflicts=observed.filter(p=>p.mapping==='conflict');
 const qs=selected(current.queries||[],scope),oldQs=selected(previous?.queries||[],scope),queryComparison=queryComplete(current)&&queryComplete(previous)&&prior;
 const nowQueries=groups(qs,r=>r.query),oldQueries=groups(oldQs,r=>r.query),productPattern=pattern(products.map(p=>fold(p.name)));
 const queries=[...nowQueries].map(([query,rows])=>{const now=metric(rows),before=metric(oldQueries.get(query)||[]);return {id:query,query,label:query,type:queryType(query,products,productPattern),...paired(now,before,queryComparison),opportunities:opportunityTypes(now),verified:queryComplete(current)};});
 return {month:current.month,previous_month:previous?.month||null,scope,catalog_verified:catalogVerified,complete:valid,comparison_available:complete,source:GSC,timezone:current.timezone||'America/Los_Angeles',
  products:grouped,pages,unmapped,conflicts,queries,query_comparison_available:queryComparison,observed_totals:total,totals:valid?total:null,previous_totals:oldTotal,
  counters:{pages:observed.length,matched:matched.length,unmapped:unmapped.length,conflicts:conflicts.length,click_coverage:total!.clicks?matched.reduce((n,p)=>n+p.current!.clicks,0)/total!.clicks:null},
  official_property_totals:null,reconciliation_delta:null,limitations:['GSC sayfa toplamı, ayrı doğrulanmış mülk toplamı değildir; resmi site toplamı/mutabakat verisi yoksa fark hesaplanmaz.','Eksik ay/sayfa/sorgu satırı sıfır kabul edilmez. Görünür sorgular anonimleştirme nedeniyle eksik olabilir.','Sorgu türleri metne dayalı sınıflandırmadır; arayanın gerçek konumu veya amacı kanıtlanmaz.','Fırsat etiketleri eşik temelli inceleme adaylarıdır; içerik değişikliği önerisi değildir.'],d1_requests:0};
}
export type InsightIntent='protect-products'|'declining-products'|'protect-queries'|'opportunities'|'unmapped'|'city-growth'|'city-decline';
export function insightIntent(question:string):InsightIntent|null{
 const q=fold(question);
 if(/eslenme|atanmamis|eslesmeyen/.test(q)&&/sayfa|url/.test(q))return 'unmapped';
 if(/sorgu|kelime/.test(q)&&/firsat/.test(q))return 'opportunities';
 if(/kelime|sorgu/.test(q)&&/koru/.test(q)&&/hangi|liste/.test(q))return 'protect-queries';
 if(/urun/.test(q)&&/hangi/.test(q)&&/koru/.test(q))return 'protect-products';
 if(/urun/.test(q)&&/hangi/.test(q)&&/dus|gerile|kayip|oncelik/.test(q))return 'declining-products';
 if(/sehir|bolge/.test(q)&&/hangi/.test(q))return /art|yuksel|buyu/.test(q)?'city-growth':/dus|gerile|kayip/.test(q)?'city-decline':null;
 return null;
}
export function answerInsightQuestion(current:InsightMonth,previous:InsightMonth|undefined|null,products:ContextProduct[],question:string,intent:InsightIntent,scope:InsightScope={}){
 const data=buildInsights(current,previous,products,scope),query=intent==='protect-queries'||intent==='opportunities',refs=[...(current.evidence||[]),...(previous?.evidence||[])].filter(r=>r.scope===(query?'query':'page'));
 let rows:({label:string;current:Metric|null;delta?:number|null;decision?:string;opportunities?:string[]})[]=[],note='',decision='Veri bekle';
 if(intent==='unmapped'){rows=data.unmapped;note='URL’ler doğrulanmış katalogda birebir eşleşmiyor; ürün bağlantısı tahmin edilmedi. Ürün Tanımla yalnız taslak hazırlığıdır.';}
 if(intent==='protect-products'){rows=data.products.filter(p=>p.decision==='Koru'&&p.current&&p.previous);decision=rows.length?'Koru':'Veri bekle';note='Aynı ürün/cihaz kapsamındaki yeterli iki dönem kanıtıyla çalışan sayfaları koruma adayları. Koru, düşüş olmadığı anlamına gelmez.';}
 if(intent==='declining-products'){rows=data.products.filter(p=>p.decision==='İncele');decision=rows.length?'İncele':data.comparison_available?'Koru':'Veri bekle';note='Önemli kayıp aynı GSC karar kuralıyla belirlendi. İncele, sayfayı değiştir demek değildir; kesin neden doğrulanmadı.';}
 if(intent==='protect-queries'){rows=data.queries.filter(p=>p.comparison_available&&p.current&&p.previous&&p.current.clicks>=10&&p.current.impressions>=100&&p.current.clicks>=p.previous.clicks&&p.current.position<=p.previous.position+.5);decision=rows.length?'Koru':'Veri bekle';note='Koruma adayı: en az 10 görünür tıklama/100 gösterim, tıklamalar gerilememiş ve konum 0,5 sıradan fazla kötüleşmemiş. Gizli sorgular tahmin edilmez; varyantlar birleştirilmez.';}
 if(intent==='opportunities'){rows=data.queries.filter(p=>p.opportunities.length&&(!/yerel|sehir/.test(fold(question))||p.type===QUERY_TYPES[1]));decision=rows.length&&data.query_comparison_available?'İncele':'Veri bekle';note='İlk Sayfa Fırsatı: en az 30 gösterim, sıra >10 ve ≤20. CTR Fırsatı: en az 100 gösterim, sıra ≤10, CTR <%3. Bunlar kural temelli adaylardır; yerel sorgu arayanın şehri değildir.';}
 rows.sort((a,b)=>intent==='declining-products'?(a.delta||0)-(b.delta||0):intent==='opportunities'?(b.current?.impressions||0)-(a.current?.impressions||0):(b.current?.clicks||0)-(a.current?.clicks||0));const items=rows.slice(0,8);
 const values=items.map(r=>r.label+': '+r.current?.clicks+' GSC tıklama / '+r.current?.impressions+' gösterim'+(r.delta===null||r.delta===undefined?' (karşılaştırma doğrulanmadı)':' (tıklama farkı '+r.delta+')')+(r.opportunities?.length?' · '+r.opportunities.join(', '):'')).join('; ');
 const available=query?data.query_comparison_available:data.comparison_available;
 return {answer:'Kanıt: '+current.month+' · '+(scope.device||'tüm cihazlar')+' · '+(scope.country||'tüm ülkeler')+(scope.page?' · Tam URL: '+scope.page:'')+'. '+(items.length?values:'Bu kapsamda belirtilen kuralı karşılayan doğrulanmış aday yok; eksik veri sıfır değildir.')+' Yorum: '+note+(!available?' Tam ve karşılaştırılabilir dönem kapsamı eksik; kısmi gözlemler kesin aylık sonuç değildir.':'')+' SEO kararı: '+decision+'. Kanıtlı neden olmadan içerik veya yönlendirme değiştirme.',source:GSC,month:current.month,previous_month:previous?.month||null,decision,filters:scope,intent,items,total_candidates:rows.length,evidence_refs:refs,evidence:refs.map(r=>'gsc:history:'+r.day+':'+r.scope+':'+r.generation),content_change_recommended:false,cause_confirmed:false,d1_requests:0};
}
export function answerCityTrend(current:any,previous:any,question:string,intent:InsightIntent){
 const ref=(r:any)=>r?.evidence?.filter((e:any)=>e.kind==='cities')||[],refs=[...ref(current),...ref(previous)];
 const valid=(r:any)=>r?.source===GA4&&r.channel==='Organic Search'&&r.closed===true&&JSON.stringify(r.hostnames)===JSON.stringify(['mavibasim.com','www.mavibasim.com'])&&r.property&&ref(r).length>0&&!r.thresholded&&!r.other_rows;
 const jointDevice=/mobil|mobile|masaustu|desktop|tablet/.test(fold(question));
 const comparable=!jointDevice&&valid(current)&&valid(previous)&&previous.month===previousMonth(current.month)&&current.property.id===previous.property.id&&current.property.time_zone===previous.property.time_zone;
 const key=(r:any)=>JSON.stringify([r.country,r.region,r.city]);
 const oldCities=new Map<string,any>((previous?.cities||[]).map((p:any)=>[key(p),p]));
 const rows=comparable?(current.cities||[]).filter((r:any)=>r.city&&!/not set|other|unknown/i.test(r.city)).flatMap((r:any)=>{const before=oldCities.get(key(r));return before?[{city:r.city,region:r.region,country:r.country,current_sessions:r.sessions,previous_sessions:before.sessions,delta:r.sessions-before.sessions}]:[];}).filter((r:any)=>intent==='city-growth'?r.delta>0:r.delta<0).sort((a:any,b:any)=>Math.abs(b.delta)-Math.abs(a.delta)):[];
 const items=rows.slice(0,8),month=current?.month||previous?.month||null;
 const material=items.some((r:any)=>r.previous_sessions>=10&&Math.abs(r.delta)>=3&&Math.abs(r.delta)/r.previous_sessions>=.2),decision=items.length?(intent==='city-decline'&&material?'İncele':'Koru'):'Veri bekle';
 return {answer:'Kanıt: GA4 Organic Search · '+(previous?.month||'Önceki dönem doğrulanmadı')+' → '+month+' · tüm cihazlar/ülkeler · '+(current?.property?.time_zone||'Saat dilimi doğrulanmadı')+'. '+(jointDevice?'Bu kaynakta şehir × cihaz ortak kırılımı yok; GSC cihaz filtresi GA4 şehir toplamına uygulanmadı. İstenen kapsam için veri bekle.':comparable?(items.length?items.map((r:any)=>r.city+' / '+r.region+' / '+r.country+': '+r.previous_sessions+' → '+r.current_sessions+' organik oturum; fark '+r.delta).join('; '):'İstenen yönde karşılaştırılabilir şehir adayı yok; eksik satır sıfır sayılmadı.'):'Aynı mülk, saat dilimi, tam dönem ve gizlilik kapsamındaki iki şehir kaydı doğrulanmadı; veri bekle.')+' Yorum: GA4 oturumu GSC tıklaması değildir. Şehir kırılımı arama sorgusunu veya arayanın konumunu kanıtlamaz. Küçük örneklemde aksiyon önerilmez; öncelik eşiği önceki 10 oturum, en az 3 ve %20 farktır. SEO kararı: '+decision+'; neden kanıtlanmadan yerel içerik değişikliği yapma.',source:GA4,month,previous_month:previous?.month||null,decision,intent,items,evidence_refs:refs,evidence:refs.map((r:any)=>'ga4:'+r.property+':'+r.month+':cities:'+r.generation),content_change_recommended:false,cause_confirmed:false,d1_requests:0};
}
