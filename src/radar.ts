import {AnalysisReport,ProductReport,validMetrics} from './analysis';
import {Env,hash} from './types';
import {saveInsight} from './insights';
import {isBrand,variantFamily} from './urls';
export const RADAR_VERSION='1.0.0';
export function commercialIntent(query:string):'commercial'|'informational'|'unknown'{
 const q=variantFamily(query);
 if(/\b(ucretsiz|ornek|ornekleri|nedir|nasil|sablon|pdf)\b/.test(q))return 'informational';
 return /\b(baski|baskisi|fiyat|fiyatlari|siparis|adet|toptan)\b/.test(q)?'commercial':'unknown';
}
export function wilson(clicks:number,impressions:number):[number,number]|null{
 if(!Number.isSafeInteger(clicks)||!Number.isSafeInteger(impressions)||clicks<0||impressions<=0||clicks>impressions)return null;
 const z=1.96,p=clicks/impressions,d=1+z*z/impressions,c=(p+z*z/(2*impressions))/d,h=z*Math.sqrt(p*(1-p)/impressions+z*z/(4*impressions*impressions))/d;
 return [Math.max(0,c-h),Math.min(1,c+h)];
}
export interface MarketObservation {product_id:string;keyword:string;avg_monthly_searches:number|null;path:string;exported_at:string;period_label:string;sha256:string;row_number:number;advertiser_competition:string|null}
export function prioritize(p:ProductReport,periodDays:number,previousDays:number,recentChange=false){
 const c=p.current,old=p.previous,components:{name:string;points:number;calculation:string;evidence:unknown}[]=[],flags:string[]=[];
 const ready=p.decision!=='Veri bekle'&&!p.missing.length&&!!c&&!!old&&validMetrics(c)&&validMetrics(old)&&!!p.evidence.length&&p.url_verified;
 const add=(name:string,points:number,calculation:string,evidence:unknown)=>components.push({name,points,calculation,evidence});
 if(!ready)return {product_id:p.id,name:p.name,url:p.url,status:'Veri yetersiz',score:null,components,flags,confidence:'yetersiz',risk:p.risk,queries:p.queries.filter(q=>q.protect),missing:p.missing,evidence:p.evidence,current:c,previous:old,rising:false,declining:false};
 const reliable=Math.min(c!.impressions,old!.impressions)>=500;
 const commercial=p.queries.filter(q=>!q.is_brand&&!isBrand(q.query)&&commercialIntent(q.query)==='commercial');
 if(commercial.some(q=>q.current&&q.previous&&q.previous.impressions-q.current.impressions>=300&&q.current.impressions<=q.previous.impressions*0.7))flags.push('Ticari sorguda görünürlük kaybı; talep ve kapsamı inceleyin, neden doğrulanmadı.');
 add('Veri yeterliliği',reliable?10:0,'İki dönemin her birinde en az 500 gösterim; kapsam ve sağlık kapıları geçmeli',{current:c!.impressions,previous:old!.impressions});
 add('Ticari arama niyeti',commercial.length?15:0,'Görünür, markasız sorguda ticari ifade; bilgi/ücretsiz niyeti önce elenir',commercial.map(q=>q.query));
 const near=commercial.filter(q=>q.current?.position!==null&&q.current?.position!==undefined&&q.current.position>=8&&q.current.position<=20&&q.current.impressions>=100);
 add('Sıralama potansiyeli',reliable&&near.length?20:0,'Ticari görünür sorgu: ağırlıklı konum 8–20, en az 100 sorgu gösterimi',near.map(q=>({query:q.query,metrics:q.current})));
 const a=wilson(c!.clicks,c!.impressions),b=wilson(old!.clicks,old!.impressions),low=!!a&&!!b&&a[1]<b[0];
 add('Düşük CTR incelemesi',reliable&&low?20:0,'Betimleyici %95 Wilson aralıkları ayrışıyor; bu nedensellik veya bağımsız SEO örneklemi varsayımı değildir',{current:a,previous:b});
 if(c!.impressions>old!.impressions&&c!.ctr!==null&&old!.ctr!==null&&c!.ctr<old!.ctr)flags.push('Gösterim artışı ve CTR düşüşü tek başına başarısızlık değildir.');
 const clickRatio=old!.clicks?((c!.clicks/periodDays)/(old!.clicks/previousDays))-1:null;
 const rising=reliable&&clickRatio!==null&&clickRatio>=0.2&&c!.clicks-old!.clicks>=30;
 const declining=p.decision==='İncele'&&c!.clicks/periodDays<old!.clicks/previousDays;
 add('Son dönem eğilimi',rising?15:0,'Günlük ortalama tıklama en az %20 artıyor ve ham fark en az 30',{current_days:periodDays,previous_days:previousDays,click_ratio:clickRatio});
 const mobile=p.devices.find(d=>d.device==='MOBILE'),desktop=p.devices.find(d=>d.device==='DESKTOP');
 const mobileGap=!!mobile?.current&&!!desktop?.current&&Math.min(mobile.current.impressions,desktop.current.impressions)>=500&&mobile.current.position!==null&&desktop.current.position!==null&&mobile.current.position-desktop.current.position>=3;
 if(mobileGap)flags.push('Mobil ortalama konum masaüstünden belirgin geride; sorgu ve cihaz bileşimi araştırılmalı.');
 add('SEO geçmişi belirsizliği',recentChange?-10:0,'Son 28 günde tespit edilen değişiklik varsa belirsizlik indirimi; yayın zamanı veya etki nedeni değildir',{recent_change:recentChange});
 if(!reliable)flags.push('Hacim düşük; sıralama ve CTR puanı verilmedi.');
 const score=Math.max(0,components.reduce((n,x)=>n+x.points,0));
 return {product_id:p.id,name:p.name,url:p.url,status:score>=25&&commercial.length&&reliable&&(near.length||low||rising)?'İnceleme fırsatı':'İzle',score,components,flags,confidence:reliable?'gözlemsel':'düşük',risk:p.risk,queries:p.queries.filter(q=>q.protect),missing:p.missing,evidence:p.evidence,current:c,previous:old,rising,declining};
}
export function buildRadar(report:AnalysisReport,market:MarketObservation[]=[],recentURLs:string[]=[]){
 const products=report.products.map(p=>({...prioritize(p,report.period.days,report.previous_period.days,!!p.url&&recentURLs.includes(p.url)),market_demand:market.filter(m=>m.product_id===p.id),market_note:'Keyword Planner yaklaşık talebidir; her kelimenin son gözlemi ayrı, hacimler toplanmaz. Reklam rekabeti organik SEO zorluğu değildir.'}));
 const sorted=[...products].sort((a,b)=>(b.score??-1)-(a.score??-1)||a.product_id.localeCompare(b.product_id));
 return {version:RADAR_VERSION,analysis_id:report.id,period:report.period,comparison_period:report.previous_period,measured_at:report.created_at,source:'GSC',products,opportunities:sorted.filter(p=>p.status==='İnceleme fırsatı').slice(0,5),attention:products.filter(p=>report.products.find(x=>x.id===p.product_id)?.decision==='İncele').slice(0,5),rising:products.filter(p=>p.rising),declining:products.filter(p=>p.declining),insufficient:products.filter(p=>p.status==='Veri yetersiz'),collisions:report.collisions,limitations:['Puan iş getirisi veya kesin SEO başarı olasılığı değildir.','GSC görünür sorgu alt kümesi; kanibalizasyon veya neden kesinleştirilmez.','Başarılı kelimeler korunur; canlı siteye otomatik değişiklik yapılmaz.']};
}
export async function radar(env:Env,report:AnalysisReport){
 const [market,history]=await Promise.all([
 env.DB.prepare(`SELECT * FROM (SELECT k.product_id,k.keyword,o.avg_monthly_searches,s.path,s.exported_at,s.period_label,s.sha256,o.row_number,o.advertiser_competition,ROW_NUMBER() OVER(PARTITION BY k.product_id ORDER BY o.avg_monthly_searches DESC,k.id) n FROM keyword_catalog k JOIN keyword_metric_observations o ON o.keyword_id=k.id JOIN keyword_sources s ON s.id=o.source_id WHERE (s.exported_at,s.id,o.row_number)=(SELECT s2.exported_at,s2.id,o2.row_number FROM keyword_metric_observations o2 JOIN keyword_sources s2 ON s2.id=o2.source_id WHERE o2.keyword_id=k.id ORDER BY s2.exported_at DESC,s2.id DESC,o2.row_number DESC LIMIT 1)) WHERE n<=5 ORDER BY product_id,n`).all<MarketObservation>(),
 env.DB.prepare('SELECT url,MAX(observed_to) latest FROM seo_change_events WHERE observed_to>=? AND observed_to<=? GROUP BY url').bind(new Date(Date.parse(report.created_at)-28*86400_000).toISOString(),report.created_at).all<{url:string;latest:string}>()
 ]);
 const key=await hash(JSON.stringify([RADAR_VERSION,report.id,market.results,history.results]));
 const existing=await env.DB.prepare("SELECT id,result_json FROM insight_runs WHERE kind='radar' AND source_key=?").bind(key).first<{id:string;result_json:string}>();
 if(existing)return JSON.parse(existing.result_json);
 const result={id:crypto.randomUUID(),...buildRadar(report,market.results,history.results.map(r=>r.url))};
 return saveInsight(env,'radar',key,result,report.id);
}
