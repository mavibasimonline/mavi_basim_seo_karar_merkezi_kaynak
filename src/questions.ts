import {calendarMonth} from './periods';
import {AnalysisReport,ProductReport,Period,Metrics,monthPeriod,lastCompleteMonth} from './analysis';
import {Env,nowISO} from './types';
import {variantFamily} from './urls';

export type QuestionIntent='performance'|'rising'|'query_ctr'|'protect'|'opportunity'|'mobile_loss'|'outcomes'|'ranking'|'insufficient'|'priorities'|'region'|'unsupported';
export interface QuestionContext {product_id:string|null;device:string|null;selected_month:string;month:string;window:number|null;intent:QuestionIntent}
export interface QuestionPlan {intent:QuestionIntent;context:QuestionContext;period?:Period;previous?:Period}
interface NamedProduct {id:string;name:string}
export function parseQuestion(question:string,products:NamedProduct[],selected=lastCompleteMonth(),previous?:QuestionContext,time=new Date()):QuestionPlan {
  if(!question.trim()||question.length>1000)throw new Error('INVALID_QUESTION');
  monthPeriod(selected);
  const q=variantFamily(question),match=[...products].sort((a,b)=>b.name.length-a.name.length).find(p=>new RegExp(`(?:^|[^a-z0-9])${variantFamily(p.name)}(?:[^a-z0-9]|$)`).test(q)||new RegExp(`(?:^|[^a-z0-9])${p.id.replaceAll('-',' ')}(?:[^a-z0-9]|$)`).test(q));
  const all=/hangi (urun|sayfa|kelime)|urunler|sayfalar|oncelik/.test(q)&&!match;
  const reuse=previous?.selected_month===selected;
  const product_id=match?.id||(!all&&reuse?previous?.product_id:null)||null;
  const device=/mobil/.test(q)?'MOBILE':/masaustu|desktop/.test(q)?'DESKTOP':/tum cihaz/.test(q)?null:!all&&reuse?previous?.device||null:null;
  let month=selected,window:number|null=null;
  const explicit=q.match(/\b(20\d{2})-(0[1-9]|1[0-2])\b/);
  const months=['ocak','subat','mart','nisan','mayis','haziran','temmuz','agustos','eylul','ekim','kasim','aralik'];
  const named=q.match(new RegExp(`\\b(${months.join('|')})\\s+(20\\d{2})\\b`));
  const recent=q.match(/son\s+(28|30)\s+gun/);
  if(explicit)month=explicit[0];
  else if(named)month=`${named[2]}-${String(months.indexOf(named[1])+1).padStart(2,'0')}`;
  else if(/bu ay/.test(q))month=time.toISOString().slice(0,7);
  else if(/gecen ayi|onceki ayi/.test(q))month=monthPeriod(reuse?previous!.month:selected,-1).label;
  else if(recent)window=Number(recent[1]);
  else if(reuse&&!all){month=previous!.month;window=previous!.window;}
  if(month<'2020-01'||month>calendarMonth(time))throw new Error('INVALID_MONTH');
  let intent:QuestionIntent=match||product_id?'performance':'unsupported';
  if(/istanbul|sehir|bolge/.test(q))intent='region';
  else if(/degisiklik|degisiklikler|ise yaradi|etki/.test(q))intent='outcomes';
  else if(/veri.*yetersiz|verisi.*eksik|veri.*eksik/.test(q))intent='insufficient';
  else if(/oncelik|hangi uc/.test(q))intent='priorities';
  else if(/dokunma|koru|basarili/.test(q))intent='protect';
  else if(/ikinci sayfa|birinci sayfa|ilk sayfa|konum.*yaklas/.test(q))intent='ranking';
  else if(/gosterim.*tiklama|gosterim.*ctr/.test(q))intent='query_ctr';
  else if(/firsat/.test(q))intent='opportunity';
  else if(/mobil.*(dus|geri|kayip)/.test(q)&&!product_id)intent='mobile_loss';
  else if(/yuksel|artan urun/.test(q))intent='rising';
  const context:QuestionContext={product_id,device,selected_month:selected,month,window,intent};
  if(!window)return {intent,context};
  // Use fully finalized days and say explicitly that the latest three days are excluded.
  const end=new Date(Date.UTC(time.getUTCFullYear(),time.getUTCMonth(),time.getUTCDate()-4));
  const day=(offset:number)=>new Date(end.getTime()+offset*86400_000).toISOString().slice(0,10);
  return {intent,context,period:{start:day(1-window),end:day(0),days:window,label:`Son ${window} kesinleşmiş gün`},previous:{start:day(1-2*window),end:day(-window),days:window,label:`Önceki ${window} gün`}};
}
export async function prepareQuestion(env:Env,question:string,selected?:string,previousId?:string,time=new Date()):Promise<QuestionPlan>{
  let previous:QuestionContext|undefined;
  if(previousId){
    if(!/^[0-9a-f-]{36}$/i.test(previousId))throw new Error('INVALID_QUESTION_CONTEXT');
    const row=await env.DB.prepare('SELECT answer_json FROM user_questions WHERE id=?').bind(previousId).first<{answer_json:string}>();
    if(!row)throw new Error('INVALID_QUESTION_CONTEXT');
    previous=JSON.parse(row.answer_json).context;
  }
  const products=(await env.DB.prepare('SELECT id,name FROM products ORDER BY name').all<NamedProduct>()).results;
  return parseQuestion(question,products,selected||previous?.selected_month||lastCompleteMonth(time),previous,time);
}
const change=(c:Metrics|null,p:Metrics|null)=>c&&p?{clicks:c.clicks-p.clicks,impressions:c.impressions-p.impressions,ctr:c.ctr!==null&&p.ctr!==null?c.ctr-p.ctr:null,position:c.position!==null&&p.position!==null?c.position-p.position:null}:null;
export function queryCandidates(products:ProductReport[],kind:'ctr'|'ranking'){
  return products.filter(p=>p.decision!=='Veri bekle').flatMap(p=>p.queries.filter(q=>{
    const c=q.current,old=q.previous;if(!c||!old)return false;
    return kind==='ctr'?c.impressions>=100&&c.impressions>old.impressions&&c.clicks===0:!!c.position&&!!old.position&&c.impressions>=100&&old.impressions>=100&&old.position>10&&c.position>=8&&c.position<=12&&c.position<old.position;
  }).map(q=>({product_id:p.id,name:p.name,url:p.url,query:q.query,current:q.current,previous:q.previous,change:change(q.current||null,q.previous||null),protect:q.protect,is_brand:q.is_brand,evidence:p.evidence,risk:p.risk})));
}
export async function answerQuestion(env:Env,report:AnalysisReport,question:string,plan?:QuestionPlan):Promise<unknown>{
  plan=plan||parseQuestion(question,report.products,report.month,undefined,new Date(report.created_at));
  const {intent,context}=plan,normalized=variantFamily(question);
  const product=report.products.find(p=>p.id===context.product_id);
  const products=product?[product]:report.products;
  const measured=products.filter(p=>p.decision!=='Veri bekle'&&p.current&&p.previous);
  const row=(p:ProductReport)=>({product_id:p.id,name:p.name,url:p.url,current:p.current,previous:p.previous,change:change(p.current,p.previous),decision:p.decision,reason:p.reason,risk:p.risk,queries:p.queries,evidence:p.evidence,missing:p.missing});
  let answer:Record<string,unknown>={source:'GSC',confidence:'yetersiz',missing:product?.missing||report.missing};
  if(intent==='region'){
    const region=report.region as {product_id:string|null;city:string;device:string}[]|null;
    const rows=region?.filter(r=>(!product||r.product_id===product.id)&&(!/istanbul/.test(normalized)||variantFamily(r.city)==='istanbul')&&(!context.device||r.device.toUpperCase()===context.device))??null;
    answer={...answer,text:rows?.length?'GA4 Organic Search şehir ve cihaz oturumları gösteriliyor. Şehir bazında GSC sorgusu veya tıklaması çıkarılamaz.':'Tamamlanmış, güncel ve doğrulanmış GA4 şehir verisi yok. Organik sorgu sonucu çıkarılamaz.',source:'GA4',rows,confidence:rows?.length?'gözlemsel':'yetersiz'};
  }else if(intent==='outcomes'){
    const results=await env.DB.prepare(`SELECT a.id,a.applied_at,a.recorded_at,a.old_json,a.new_json,p.name,p.canonical_url AS url,w.days,w.status,w.measured_at,w.result_json FROM applied_changes a JOIN recommendations r ON r.id=a.recommendation_id JOIN products p ON p.id=r.product_id JOIN outcome_windows w ON w.applied_change_id=a.id WHERE (? IS NULL OR r.product_id=?) ORDER BY a.applied_at DESC,w.days LIMIT 40`).bind(context.product_id,context.product_id).all();
    const history=await env.DB.prepare('SELECT url,observed_from,observed_to,published_at,diff_json FROM seo_change_events WHERE (? IS NULL OR url=?) ORDER BY observed_to DESC LIMIT 10').bind(product?.url||null,product?.url||null).all();
    answer={...answer,text:'Nedensellik doğrulanamadı. Tamamlanan önce/sonra ölçümleri gözlemseldir; bekleyen pencereler başarı olarak gösterilmez.',source:'GSC + SEO değişiklik hafızası',outcomes:results.results,history:history.results,confidence:'gözlemsel'};
  }else if(intent==='insufficient'){
    answer={...answer,text:'Bu ürünlerde kanıt eksik; SEO değişikliği yapmadan belirtilen verileri tamamlayın.',products:products.filter(p=>p.decision==='Veri bekle').map(row)};
  }else if(intent==='protect'){
    const protectedProducts=products.filter(p=>p.queries.some(q=>q.protect)||p.decision==='Koru');
    answer={...answer,text:protectedProducts.length?'Başarılı sorguları ve mevcut çalışmayı koruyun. Başlık, içerik veya URL değişiminde zarar riski var.':'Başarılı kelime listesi için doğrulanmış Google verisi yeterli değil; mevcut çalışmalara müdahale etmeyin.',products:protectedProducts.map(p=>({...row(p),queries:p.queries.filter(q=>q.protect)})),confidence:protectedProducts.length?'gözlemsel':'yetersiz'};
  }else if(intent==='query_ctr'||intent==='ranking'||intent==='opportunity'){
    const candidates=queryCandidates(measured,intent==='ranking'?'ranking':'ctr');
    answer={...answer,text:candidates.length?(intent==='ranking'?'Görünür sorguların ağırlıklı ortalama konumu ilk sayfa sınırına yaklaşıyor; kesin tekil sıra değildir.':'Görünür sorgularda inceleme fırsatı var. Ticari niyet doğrulanmadı; önce sorgu-sayfa uyumunu ve korunan kelimeleri inceleyin.'):'Bu dönem için yeterli kanıtla doğrulanmış fırsat yok; fırsat veya neden uydurulmadı.',items:candidates,confidence:candidates.length?'gözlemsel':'yetersiz'};
  }else if(intent==='rising'){
    const rising=measured.filter(p=>p.current!.clicks/report.period.days>p.previous!.clicks/report.previous_period.days);
    answer={...answer,text:rising.length?'Günlük ortalama tıklaması artan ürünler aşağıda; artış tek başına bir SEO değişikliğinin başarısını kanıtlamaz.':'Doğrulanmış dönemlerde yükseliş gösteren ürün bulunmadı; eksik veri yükseliş veya düşüş sayılmaz.',products:rising.map(row),calculation:'current.clicks / current.days > previous.clicks / previous.days',confidence:rising.length?'gözlemsel':'yetersiz'};
  }else if(intent==='mobile_loss'){
    const losses=measured.filter(p=>p.devices.some(d=>d.device==='MOBILE'&&d.decision==='İncele'));
    answer={...answer,text:losses.length?'Mobil kayıp araştırılmalı; masaüstüyle karıştırılmadı.':'Doğrulanmış önemli mobil kayıp bulunmadı. Veri eksikse sonuç çıkarılmadı.',products:losses.map(p=>({...row(p),devices:p.devices.filter(d=>d.device==='MOBILE')})),device:'MOBILE',confidence:losses.length?'gözlemsel':'yetersiz'};
  }else if(intent==='priorities'){
    const priorities=measured.filter(p=>p.decision==='İncele'||p.decision==='İyileştir').sort((a,b)=>(b.previous!.clicks-b.current!.clicks)-(a.previous!.clicks-a.current!.clicks)).slice(0,3);
    answer={...answer,text:priorities.length?'Öncelik doğrulanmış tıklama kaybına göre; başarılı kelimeleri koruyarak kanıtı inceleyin.':'Kanıtla desteklenen üç öncelik üretilemedi. Eksik veride değişiklik önermiyorum.',products:priorities.map(row),calculation:'İncele ürünleri: previous.clicks - current.clicks azalan; en fazla 3',confidence:priorities.length?'orta':'yetersiz'};
  }else if(product){
    const slice=context.device?product.devices.find(d=>d.device===context.device):product;
    answer={...answer,text:(slice?.reason||product.reason)+' Düşüşün kesin nedenini mevcut gözlemsel verilerle kanıtlayamam.',product:product.name,url:product.url,decision:slice?.decision||product.decision,current:slice?.current??null,previous:slice?.previous??null,change:change(slice?.current||null,slice?.previous||null),risk:product.risk,calculation:slice?.calculation||product.calculation,evidence:product.evidence,queries:product.queries,confidence:product.confidence};
  }else{
    answer={...answer,text:'Bu soru için doğrulanmış ürün veya desteklenen analiz bağlamı bulunamadı. Ürün, dönem, mobil/masaüstü, fırsat veya koruma bilgisini belirtin.',source:'sistem'};
  }
  const explanations=['Mevsimsellik, talep, sorgu ve cihaz bileşimi olası etkenlerdir; bu veriler kesin nedeni kanıtlamaz.'];
  const question_id=crypto.randomUUID();
  answer={...answer,question_id,intent,context,device:context.device||'tüm cihazlar',period:report.period,comparison_period:report.previous_period,measured_at:report.created_at,analysis_id:report.id,sections:{what:answer.text,evidence:'URL, kaynak veri kümesi ve dönem ölçümleri yanıt ayrıntısındadır.',explanations,action:answer.confidence==='yetersiz'?'Eksik verileri tamamlayın; mevcut çalışmayı değiştirmeyin.':'Kanıtları inceleyin ve başarılı kelimeleri koruyun; canlı siteye otomatik işlem uygulanmaz.',confidence:answer.confidence},limitations:['Korelasyon nedensellik değildir.','Eksik sorgu sıfır değildir.','Keyword Planner varyant hacimleri toplanmaz; reklam rekabeti SEO zorluğu değildir.',...(context.window?['Son üç gün Google kesinleşme gecikmesi nedeniyle dışarıda; gösterilen pencere kesinleşmiş günlerdir.']:[])]};
  await env.DB.prepare('INSERT INTO user_questions VALUES(?,?,?,?,?)').bind(question_id,nowISO(),question,report.id,JSON.stringify(answer)).run();
  return answer;
}
