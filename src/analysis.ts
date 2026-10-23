import { Env, nowISO } from './types';
import { insertRows } from './sync';

export const ENGINE_VERSION = '1.0.0';
export type Decision = 'Koru'|'İncele'|'İyileştir'|'Veri bekle';
export interface Metrics { clicks:number; impressions:number; ctr:number|null; position:number|null }
export interface Period { start:string; end:string; days:number; label:string }
export interface Evidence { id:string; source:string; ref:string; fetched_at:string; scope:unknown }
export interface QueryRisk { query:string; clicks:number|null; impressions:number|null; previous_clicks:number|null; is_brand:boolean; protect:boolean; missing_current:boolean }
export interface DecisionInput { current:Metrics; previous:Metrics; complete:boolean; fresh:boolean; periodFinished:boolean; evidence:Evidence[]; protectedQueries:QueryRisk[]; deviceMixChanged:boolean; seasonalityKnown:boolean }
export function metrics(rows:{clicks:number;impressions:number;position:number}[]):Metrics {
  const clicks=rows.reduce((n,r)=>n+r.clicks,0),impressions=rows.reduce((n,r)=>n+r.impressions,0);
  return {clicks,impressions,ctr:impressions?clicks/impressions:null,position:impressions?rows.reduce((n,r)=>n+r.position*r.impressions,0)/impressions:null};
}
export function decide(input:DecisionInput):{decision:Decision;reason:string;confidence:string;risk:string;calculation:unknown} {
  const {current:c,previous:p}=input;
  const clickChange=p.clicks?(c.clicks-p.clicks)/p.clicks:null;
  const impressionChange=p.impressions?(c.impressions-p.impressions)/p.impressions:null;
  const calculation={engine:ENGINE_VERSION,click_delta:c.clicks-p.clicks,click_change:clickChange,impression_delta:c.impressions-p.impressions,impression_change:impressionChange,
    ctr_formula:'sum(clicks) / sum(impressions)',position_formula:'sum(position * impressions) / sum(impressions)',
    thresholds:{min_impressions:100,click_loss:30,click_loss_ratio:0.2,impression_loss:300,impression_loss_ratio:0.3},
    gates:{complete:input.complete,fresh:input.fresh,period_finished:input.periodFinished,evidence_count:input.evidence.length,device_mix_changed:input.deviceMixChanged,seasonality_known:input.seasonalityKnown}};
  const risk=input.protectedQueries.some(q=>q.protect)?'Başarılı sorgular korunmalı. Başlık, URL veya içerik değişimi bu sorgulara zarar verebilir; önce sorgu ve sayfa kanıtını inceleyin.':'Otomatik site değişikliği yapılmaz; neden kanıtlanmamıştır.';
  if(!input.complete||!input.fresh||!input.periodFinished||!input.evidence.length)return {decision:'Veri bekle',reason:'Tamamlanmış dönem, güncel ve doğrulanmış günlük veri veya kaynak kanıtı eksik.',confidence:'yetersiz',risk,calculation};
  if(Math.max(c.impressions,p.impressions)<100)return {decision:'Veri bekle',reason:'Gösterim sayısı güvenli karar için yetersiz; değişiklik yapmayın.',confidence:'düşük',risk,calculation};
  if((p.clicks-c.clicks>=30&&clickChange!==null&&clickChange<=-0.2)||(p.impressions-c.impressions>=300&&impressionChange!==null&&impressionChange<=-0.3))
    return {decision:'İncele',reason:`Anlamlı kayıp var; talep, marka, sorgu kapsamı, cihaz ve kanonik URL ayrımı araştırılmalı.${input.deviceMixChanged?' Cihaz dağılımı değişmiş.':''}${!input.seasonalityKnown?' Mevsimsellik kanıtı eksik.':''} Kesin neden çıkarılamaz.`,confidence:'orta',risk,calculation};
  if(c.impressions>p.impressions&&c.ctr!==null&&p.ctr!==null&&c.ctr<p.ctr)return {decision:'Koru',reason:'Gösterimler artarken CTR düşüşü tek başına başarısızlık kanıtı değildir; mevcut çalışmayı koruyun.',confidence:'orta',risk,calculation};
  return {decision:'Koru',reason:'Müdahaleyi gerektiren büyüklükte doğrulanmış kayıp yok. Küçük dalgalanmalarda değişiklik yapmayın.',confidence:'orta',risk,calculation};
}
export function monthPeriod(month:string,shift=0):Period {
  if(!/^\d{4}-(0[1-9]|1[0-2])$/.test(month))throw new Error('INVALID_MONTH');
  const [y,m]=month.split('-').map(Number);
  const start=new Date(Date.UTC(y,m-1+shift,1)),end=new Date(Date.UTC(y,m+shift,0));
  return {start:start.toISOString().slice(0,10),end:end.toISOString().slice(0,10),days:end.getUTCDate(),label:start.toISOString().slice(0,7)};
}
export function lastCompleteMonth(time=new Date()):string {
  return monthPeriod(time.toISOString().slice(0,7),-1).label;
}
export function dates(period:Period):string[]{
  return Array.from({length:period.days},(_,i)=>`${period.label}-${String(i+1).padStart(2,'0')}`);
}
interface DataRow {date:string;page:string;device:string;country:string;clicks:number;impressions:number;position:number;query?:string;is_brand?:number}
interface Coverage {provider:string;day:string;scope:string;dataset_id:string;complete:number;query_partial:number;row_count:number;fetched_at:string;notes:string}
export interface ProductReport {
  id:string;name:string;url:string|null;url_verified:boolean;group_name:string;
  current:Metrics|null;previous:Metrics|null;decision:Decision;reason:string;confidence:string;risk:string;calculation:unknown;
  devices:{device:string;current:Metrics|null;previous:Metrics|null}[];
  queries:QueryRisk[];brand:{brand:Metrics;non_brand:Metrics;note:string};
  evidence:Evidence[];missing:string[];comparisons:Record<string,unknown>;keyword_sources:number;keyword_rows:number;
}
export interface AnalysisReport {id:string;month:string;created_at:string;engine_version:string;period:Period;previous_period:Period;products:ProductReport[];missing:string[];sources:unknown;collisions:unknown[];region:unknown;limitations:string[]}
function coverageComplete(coverage:Coverage[],period:Period,scope='page',provider='gsc'):boolean {
  return dates(period).every(date=>coverage.some(c=>c.provider===provider&&c.day===date&&c.scope===scope&&c.complete===1));
}
async function activeGsc(db:D1Database,table:string,start:string,end:string,scope:string):Promise<DataRow[]> {
  return (await db.prepare(`SELECT d.* FROM ${table} d JOIN dataset_coverage c ON c.dataset_id=d.dataset_id AND c.day=d.date AND c.provider='gsc' AND c.scope=? AND c.complete=1 WHERE d.date BETWEEN ? AND ? ORDER BY d.date,d.page LIMIT 50001`).bind(scope,start,end).all<DataRow>()).results;
}
export async function analyze(env:Env,month=lastCompleteMonth(),time=new Date()):Promise<AnalysisReport> {
  const current=monthPeriod(month),previous=monthPeriod(month,-1),year=monthPeriod(month,-12);
  const oldest=monthPeriod(month,-12).start;
  const stamp=time.toISOString();
  const [productResult,coverageResult,pageRows,queryRows,counts,credential]=await Promise.all([
    env.DB.prepare('SELECT p.*,g.name AS group_name FROM products p JOIN product_groups g ON g.id=p.group_id ORDER BY g.name,p.name').all<{id:string;name:string;canonical_url:string|null;url_verified_at:string|null;group_name:string}>(),
    env.DB.prepare('SELECT * FROM dataset_coverage WHERE day BETWEEN ? AND ?').bind(oldest,current.end).all<Coverage>(),
    activeGsc(env.DB,'gsc_daily_by_page',oldest,current.end,'page'),activeGsc(env.DB,'gsc_daily_by_query_device',previous.start,current.end,'query'),
    env.DB.prepare('SELECT product_id,count(*) AS sources,sum(row_count) AS rows FROM keyword_sources GROUP BY product_id').all<{product_id:string;sources:number;rows:number}>(),
    env.DB.prepare("SELECT updated_at FROM oauth_credentials WHERE provider='google'").first(),
  ]);
  const coverage=coverageResult.results;
  const currentComplete=coverageComplete(coverage,current),previousComplete=coverageComplete(coverage,previous);
  const queryComplete=coverageComplete(coverage,current,'query')&&coverageComplete(coverage,previous,'query');
  const latestFetched=coverage.filter(c=>c.provider==='gsc'&&c.scope==='page'&&c.day>=current.start&&c.day<=current.end).map(c=>c.fetched_at).sort().at(-1);
  const fresh=!!latestFetched&&time.getTime()-Date.parse(latestFetched)<72*3600_000;
  const finished=Date.parse(current.end+'T23:59:59Z')+3*86400_000<time.getTime();
  const missing:string[]=[];
  if(!credential)missing.push('Google bağlantısı yok; gerçek arama performansı doğrulanmadı.');
  if(!currentComplete)missing.push('Seçilen ayın doğrulanmış GSC sayfa günleri eksik.');
  if(!previousComplete)missing.push('Önceki ayın doğrulanmış GSC sayfa günleri eksik.');
  if(!queryComplete)missing.push('Sorgu/marka kapsamı eksik; eksik sorgular sıfır sayılmadı.');
  if(!fresh)missing.push('Seçilen ayın son veri doğrulaması 72 saatten eski veya yok.');
  if(!finished)missing.push('Dönem veya Google veri kesinleşme bekleme süresi tamamlanmadı.');
  if(pageRows.length>50000||queryRows.length>50000)missing.push('Analiz satır güvenlik sınırı aşıldı; sonuçlar karar için kullanılamaz.');
  const aliases=(await env.DB.prepare('SELECT alias_url,canonical_url FROM page_aliases').all<{alias_url:string;canonical_url:string}>()).results;
  const mappedPages=(await env.DB.prepare('SELECT url,product_id FROM pages WHERE product_id IS NOT NULL').all<{url:string;product_id:string}>()).results;
  const productForPage=(url:string)=>productResult.results.find(p=>p.canonical_url===url)?.id||mappedPages.find(p=>p.url===url)?.product_id||productResult.results.find(p=>p.canonical_url===aliases.find(a=>a.alias_url===url)?.canonical_url)?.id;
  const inPeriod=(row:DataRow,p:Period)=>row.date>=p.start&&row.date<=p.end;
  const products:ProductReport[]=productResult.results.map(product=>{
    const own=pageRows.filter(row=>productForPage(row.page)===product.id);
    const currentRows=own.filter(r=>inPeriod(r,current)),previousRows=own.filter(r=>inPeriod(r,previous));
    const ownQueries=queryRows.filter(r=>productForPage(r.page)===product.id);
    const currentQueries=ownQueries.filter(r=>inPeriod(r,current)),previousQueries=ownQueries.filter(r=>inPeriod(r,previous));
    const queries=[...new Set(ownQueries.map(r=>r.query!))].map(query=>{
      const c=currentQueries.filter(r=>r.query===query),p=previousQueries.filter(r=>r.query===query);
      const cm=metrics(c),pm=metrics(p);
      return {query,clicks:c.length?cm.clicks:null,impressions:c.length?cm.impressions:null,previous_clicks:p.length?pm.clicks:null,is_brand:!!(c[0]||p[0])?.is_brand,
        protect:(c.length>0&&cm.clicks>=10&&cm.impressions>=100&&(!p.length||cm.clicks>=pm.clicks*0.9)),missing_current:!c.length};
    }).sort((a,b)=>(b.clicks||0)-(a.clicks||0)).slice(0,100);
    const deviceValues=['MOBILE','DESKTOP','TABLET'].map(device=>({device,currentRows:currentRows.filter(r=>r.device===device),previousRows:previousRows.filter(r=>r.device===device)}));
    const devices=deviceValues.map(d=>({device:d.device,current:d.currentRows.length?metrics(d.currentRows):null,previous:d.previousRows.length?metrics(d.previousRows):null}));
    const cm=metrics(currentRows),pm=metrics(previousRows);
    const mixChanged=devices.some(d=>Math.abs((cm.impressions?(d.current?.impressions||0)/cm.impressions:0)-(pm.impressions?(d.previous?.impressions||0)/pm.impressions:0))>0.15);
    const evidence:Evidence[]=coverage.filter(c=>c.complete&&c.provider==='gsc'&&c.day>=previous.start&&c.day<=current.end).map(c=>({id:`${c.dataset_id}:${c.scope}`,source:'GSC',ref:c.dataset_id,fetched_at:c.fetched_at,
      scope:{site:env.SITE_ORIGIN,date:c.day,dimensions:c.scope==='query'?['page','query','country','device']:['page','country','device'],search_type:'web',data_state:'final',query_partial:!!c.query_partial,notes:c.notes}}));
    const comparisons:Record<string,unknown>={};
    for(const months of [3,6,12]){
      const periods=Array.from({length:months},(_,i)=>monthPeriod(month,-1-i));
      const complete=periods.every(p=>coverageComplete(coverage,p));
      const values=periods.map(p=>({period:p,...metrics(own.filter(r=>inPeriod(r,p)))}));
      comparisons[`${months}_months`]={complete,periods:values,mean_monthly_clicks:complete?values.reduce((n,v)=>n+v.clicks,0)/months:null,mean_daily_clicks:complete?values.reduce((n,v)=>n+v.clicks,0)/periods.reduce((n,p)=>n+p.days,0):null};
    }
    const yearComplete=coverageComplete(coverage,year);
    comparisons.year_over_year={period:year,complete:yearComplete,metrics:yearComplete?metrics(own.filter(r=>inPeriod(r,year))):null};
    const localMissing=[...missing];
    if(!product.canonical_url)localMissing.push('Ürün sayfa URL eşlemesi doğrulanmadı; URL tahmin edilmedi.');
    if(!currentRows.length||!previousRows.length)localMissing.push('Her iki ayda da ürün sayfa ölçümü yok; yokluk sıfır trafik sayılmadı.');
    const decision=decide({current:cm,previous:pm,complete:!localMissing.length&&currentComplete&&previousComplete&&queryComplete,fresh,periodFinished:finished,evidence,
      protectedQueries:queries,deviceMixChanged:mixChanged,seasonalityKnown:yearComplete});
    const count=counts.results.find(c=>c.product_id===product.id);
    return {id:product.id,name:product.name,url:product.canonical_url,url_verified:!!product.url_verified_at,group_name:product.group_name,current:currentRows.length?cm:null,previous:previousRows.length?pm:null,...decision,
      devices,queries,brand:{brand:metrics(currentQueries.filter(r=>r.is_brand===1)),non_brand:metrics(currentQueries.filter(r=>r.is_brand===0)),note:'GSC görünür sorgu alt kümesi; sayfa toplamlarıyla eşit olması beklenmez.'},
      evidence,missing:localMissing,comparisons,keyword_sources:count?.sources||0,keyword_rows:count?.rows||0};
  });
  const queryPages=new Map<string,Set<string>>();
  for(const row of queryRows.filter(r=>inPeriod(r,current))){const key=row.query!;const set=queryPages.get(key)||new Set<string>();set.add(row.page);queryPages.set(key,set);}
  const collisions=[...queryPages].filter(([,pages])=>pages.size>1).map(([query,pages])=>({query,pages:[...pages],meaning:'Olası sorgu çakışması; tek başına sorun veya yönlendirme gerekçesi değildir.'}));
  const gaCoverage=coverageComplete(coverage,current,'organic','ga4');
  const region=gaCoverage?(await env.DB.prepare("SELECT d.country,d.city,d.device,d.landing_page,sum(d.sessions) AS sessions,sum(d.engaged_sessions) AS engaged_sessions FROM ga4_daily_by_city_device d JOIN dataset_coverage c ON c.dataset_id=d.dataset_id AND c.day=d.date AND c.provider='ga4' AND c.complete=1 WHERE d.date BETWEEN ? AND ? GROUP BY d.country,d.city,d.device,d.landing_page ORDER BY sessions DESC LIMIT 200").bind(current.start,current.end).all()).results:null;
  const report:AnalysisReport={id:crypto.randomUUID(),month,created_at:stamp,engine_version:ENGINE_VERSION,period:current,previous_period:previous,products,missing,
    sources:{csv_files:counts.results.reduce((n,c)=>n+c.sources,0),csv_rows:counts.results.reduce((n,c)=>n+c.rows,0),google_connected:!!credential,gsc_coverage_days:coverage.filter(c=>c.provider==='gsc'&&c.scope==='page'&&c.complete&&c.day>=current.start&&c.day<=current.end).length},
    collisions,region,limitations:['Eksik sorgu sıfır değildir.','Keyword Planner reklam rekabeti SEO zorluğu değildir.','Şehir verisi GA4 organik oturumudur; şehir bazında Google arama sorgusu değildir.','Korelasyon nedensellik değildir.','Dönemler farklı gün sayısı içerebilir; günlük ortalama ve mevsimsellik ayrıca incelenmelidir.','İyileştir kararı otomatik üretilmez; teknik bulgu ve başarıyı koruma denetimi gerekir.']};
  return report;
}
export async function saveAnalysis(env:Env,report:AnalysisReport):Promise<void>{
  const allEvidence=[...new Map(report.products.flatMap(p=>p.evidence).map(e=>[e.id,e])).values()];
  const statements=[env.DB.prepare('INSERT INTO analysis_runs VALUES(?,?,?,?,?,?)').bind(report.id,report.month,ENGINE_VERSION,report.created_at,JSON.stringify({period:report.period,previous:report.previous_period,site:env.SITE_ORIGIN}),JSON.stringify(report)),
    ...insertRows(env.DB,'evidence_refs',allEvidence.map(e=>({id:e.id+':'+report.id,analysis_run_id:report.id,source:e.source,source_ref:e.ref,observed_at:e.fetched_at,scope_json:JSON.stringify(e.scope)}))),
    ...insertRows(env.DB,'recommendations',report.products.map(product=>({id:`${report.id}:${product.id}`,analysis_run_id:report.id,product_id:product.id,decision:product.decision,confidence:product.confidence,risk:product.risk,
      next_measurement:'Sonraki tamamlanmış ayı ve varsa uygulanan değişiklikten 7/28/60/90 gün sonrasını ölçün.',computation_json:JSON.stringify({url:product.url,period:report.period,previous_period:report.previous_period,current:product.current,previous:product.previous,devices:product.devices,calculation:product.calculation,protected_queries:product.queries.filter(q=>q.protect)}),evidence_ids_json:JSON.stringify(product.evidence.map(e=>e.id+':'+report.id))})))];
  await env.DB.batch(statements);
}
