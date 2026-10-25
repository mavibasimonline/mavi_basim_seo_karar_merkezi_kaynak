import {calendarMonth} from './periods';
import {Env,hash,nowISO} from './types';
import {analyze,saveAnalysis,AnalysisReport,dates} from './analysis';
import {validateAnalysis} from './validation';
import {saveInsight} from './insights';
import manifest from './source-manifest.json';
export type Reliability='Doğrulandı'|'Kısmen doğrulandı'|'Veri yetersiz'|'Senkronizasyon hatası'|'Kaynaklar arasında açıklanması gereken fark';
export interface Issue {source:string;code:string;record:string;field:string;expected:unknown;actual:unknown}
export interface SourceRecord {product_id:string;path:string;sha256:string;row_count:number;exported_at:string;actual_rows?:number;source_folder?:string;imported_at?:string}
export function archiveIssues(rows:SourceRecord[],expected:SourceRecord[]=manifest):Issue[]{
 const issues:Issue[]=[],seen=new Set<string>(),byPath=new Map(expected.map(e=>[e.path,e]));
 for(const row of rows){
  const original=byPath.get(row.path);
  if(seen.has(row.path))issues.push({source:'Keyword Planner',code:'DUPLICATE_SOURCE_PATH',record:row.path,field:'path',expected:'tek kaynak',actual:'birden çok sürüm; aktif seçim incelenmeli'});seen.add(row.path);
  if(!original){issues.push({source:'Keyword Planner',code:'UNKNOWN_SOURCE',record:row.path,field:'path',expected:'sürüm kontrollü manifest',actual:row.path});continue;}
  for(const field of ['product_id','sha256','row_count','exported_at'] as const)if(row[field]!==original[field])issues.push({source:'Keyword Planner',code:'SOURCE_MISMATCH',record:row.path,field,expected:original[field],actual:row[field]});
  if(row.actual_rows!==undefined&&row.actual_rows!==row.row_count)issues.push({source:'Keyword Planner',code:'ROW_COUNT_MISMATCH',record:row.path,field:'actual_rows',expected:row.row_count,actual:row.actual_rows});
  if(row.source_folder!==undefined&&row.path.split('/').slice(0,-1).join('/')!==row.source_folder)issues.push({source:'Keyword Planner',code:'PRODUCT_FOLDER_MISMATCH',record:row.path,field:'source_folder',expected:row.path.split('/').slice(0,-1).join('/'),actual:row.source_folder});
 }
 for(const original of expected)if(!seen.has(original.path))issues.push({source:'Keyword Planner',code:'SOURCE_MISSING',record:original.path,field:'path',expected:'mevcut kaynak',actual:null});
 return issues;
}
export function reliability(input:{connected:boolean;missing:boolean;failed:boolean;errors:boolean;partial:boolean;queryDifference:boolean}):Reliability{
 if(input.failed)return 'Senkronizasyon hatası';if(input.errors)return 'Kısmen doğrulandı';if(!input.connected||input.missing)return 'Veri yetersiz';if(input.partial)return 'Kısmen doğrulandı';if(input.queryDifference)return 'Kaynaklar arasında açıklanması gereken fark';return 'Doğrulandı';
}
export async function dataIntegrity(env:Env,month:string,time=new Date(),options:import('./analysis').AnalysisOptions={},preparedReport?:AnalysisReport){
 if(month<'2020-01'||month>calendarMonth(time))throw new Error('INVALID_MONTH');
 const report=preparedReport||await analyze(env,month,time,options);
 const cacheKey=preparedReport?'validated-report:'+report.id:null;
 if(cacheKey){const cached=await env.DB.prepare("SELECT result_json FROM insight_runs WHERE kind='data-integrity' AND source_key=?").bind(cacheKey).first<{result_json:string}>();if(cached)return JSON.parse(cached.result_json) as typeof snapshot;}
 if(report.missing.some(m=>m.includes('Analiz satır güvenlik sınırı')))throw new Error('AUDIT_ROW_LIMIT');
 const errors=await validateAnalysis(env,report);
 const [sources,coverage,health,crawls,jobs]=await Promise.all([
  env.DB.prepare('SELECT s.*,p.source_folder,(SELECT count(*) FROM keyword_metric_observations o WHERE o.source_id=s.id) actual_rows FROM keyword_sources s JOIN products p ON p.id=s.product_id ORDER BY s.path,s.exported_at').all<SourceRecord>(),
  env.DB.prepare('SELECT * FROM dataset_coverage WHERE day BETWEEN ? AND ? ORDER BY provider,scope,day').bind(report.previous_period.start,report.period.end).all<{provider:string;scope:string;day:string;complete:number;row_count:number;fetched_at:string}>(),
  env.DB.prepare('SELECT * FROM health_checks ORDER BY day DESC,checked_at DESC LIMIT 30').all<{provider:string;status:string;code:string|null;checked_at:string}>(),
  env.DB.prepare('SELECT count(*) records,MAX(CASE WHEN status_code=200 AND error_code IS NULL THEN finished_at END) last_success,MIN(started_at) earliest,MAX(started_at) latest,SUM(CASE WHEN error_code IS NOT NULL THEN 1 ELSE 0 END) failed FROM crawls').first(),
  env.DB.prepare('SELECT provider,status,count(*) records FROM sync_jobs GROUP BY provider,status').all(),
 ]);
 const issues=archiveIssues(sources.results);
 const sourceStates=[];
 for(const [provider,scope,table] of [['gsc','page','gsc_daily_by_page'],['gsc','query','gsc_daily_by_query_device'],['ga4','organic','ga4_daily_by_city_device']]){
  const c=coverage.results.filter(c=>c.provider===provider&&c.scope===scope),days=[...dates(report.previous_period),...dates(report.period)],missing=days.filter(day=>!c.some(r=>r.day===day&&r.complete===1));
  const tooLarge=c.reduce((n,r)=>n+r.row_count,0)>50000;
  const counts=tooLarge?{results:[] as {day:string;dataset_id:string;expected:number;actual:number}[]}:await env.DB.prepare(`SELECT c.day,c.dataset_id,c.row_count expected,count(d.date) actual FROM dataset_coverage c INDEXED BY coverage_active LEFT JOIN ${table} d ON d.dataset_id=c.dataset_id AND d.date=c.day WHERE c.provider=? AND c.scope=? AND c.complete=1 AND c.day BETWEEN ? AND ? GROUP BY c.day,c.dataset_id,c.row_count`).bind(provider,scope,report.previous_period.start,report.period.end).all<{day:string;dataset_id:string;expected:number;actual:number}>();
  for(const r of counts.results)if(r.expected!==r.actual)issues.push({source:provider,code:'DATASET_ROW_COUNT_MISMATCH',record:r.dataset_id,field:r.day,expected:r.expected,actual:r.actual});
  if(tooLarge)issues.push({source:provider,code:'BOUNDED_AUDIT_PENDING',record:scope,field:'rows',expected:'en fazla 50000 satır; dataset bazlı sync-audit kayıtlarıyla denetlenmeli',actual:c.reduce((n,r)=>n+r.row_count,0)});
  if(!tooLarge){
   const identity=provider==='ga4'?'d.date,d.landing_page,d.country,d.city,d.device':scope==='query'?'d.date,d.page,d.query,d.country,d.device':'d.date,d.page,d.country,d.device';
   const repeated=await env.DB.prepare(`SELECT d.dataset_id,count(*) actual FROM dataset_coverage c INDEXED BY coverage_active CROSS JOIN ${table} d ON c.dataset_id=d.dataset_id AND c.day=d.date AND c.provider=? AND c.scope=? AND c.complete=1 WHERE d.date BETWEEN ? AND ? GROUP BY ${identity} HAVING count(*)>1 LIMIT 21`).bind(provider,scope,report.previous_period.start,report.period.end).all<{dataset_id:string;actual:number}>();
   for(const r of repeated.results)issues.push({source:provider,code:'DUPLICATE_ACTIVE_RECORD',record:r.dataset_id,field:scope,expected:1,actual:r.actual});
   const predicate=provider==='ga4'?'d.sessions<0 OR d.engaged_sessions>d.sessions OR d.sessions<>CAST(d.sessions AS INTEGER) OR d.engaged_sessions<>CAST(d.engaged_sessions AS INTEGER)':"d.clicks<0 OR d.impressions<d.clicks OR d.clicks<>CAST(d.clicks AS INTEGER) OR d.impressions<>CAST(d.impressions AS INTEGER) OR (d.impressions>0 AND ABS(d.ctr-d.clicks*1.0/d.impressions)>0.000001)";
   const actual=provider==='ga4'?"json_object('sessions',d.sessions,'engaged_sessions',d.engaged_sessions)":"json_object('clicks',d.clicks,'impressions',d.impressions,'ctr',d.ctr)";
   const expected=provider==='ga4'?"json_object('integer_sessions',1,'engaged_sessions_max',d.sessions)":"json_object('ctr',CASE WHEN d.impressions>0 THEN d.clicks*1.0/d.impressions ELSE 0 END,'integer_clicks',1,'integer_impressions',1)";
   const malformed=await env.DB.prepare(`SELECT d.dataset_id,d.date,${actual} actual,${expected} expected FROM dataset_coverage c INDEXED BY coverage_active CROSS JOIN ${table} d ON c.dataset_id=d.dataset_id AND c.day=d.date AND c.provider=? AND c.scope=? AND c.complete=1 WHERE d.date BETWEEN ? AND ? AND (${predicate}) LIMIT 21`).bind(provider,scope,report.previous_period.start,report.period.end).all<{dataset_id:string;date:string;actual:string;expected:string}>();
   for(const r of malformed.results)issues.push({source:provider,code:'INVALID_SOURCE_METRICS',record:r.dataset_id,field:r.date,expected:JSON.parse(r.expected),actual:JSON.parse(r.actual)});
  }
  const h=health.results.find(h=>h.provider===provider);
  const latest=c.filter(c=>c.complete).map(c=>c.fetched_at).sort().at(-1)||null;
  const fresh=(stamp:string|null|undefined)=>!!stamp&&time.getTime()-Date.parse(stamp)>=0&&time.getTime()-Date.parse(stamp)<72*3600_000;
  sourceStates.push({source:provider,scope,last_success:latest,period:report.period,records:tooLarge?null:counts.results.reduce((n,r)=>n+r.actual,0),missing_days:missing,duplicate_policy:'Aktif dataset + tarih/boyut benzersiz anahtar; arşiv sürümleri toplam dışıdır.',health:h||null,status:reliability({connected:!!(report.sources as any).google_connected&&(provider!=='ga4'||!!env.GA4_PROPERTY_ID),missing:!!missing.length||!fresh(latest)||!fresh(h?.checked_at),failed:h?.status==='failed',errors:issues.some(i=>i.source===provider),partial:h?.status==='partial'||tooLarge,queryDifference:false})});
 }
 const productStates=report.products.map(p=>{const visible=p.queries.reduce((n,q)=>n+(q.clicks||0),0),different=!!p.current&&p.queries.length>0&&visible!==p.current.clicks;return {product_id:p.id,name:p.name,url:p.url,state:reliability({connected:!!(report.sources as any).google_connected,missing:!!p.missing.length,failed:health.results.find(h=>h.provider==='gsc')?.status==='failed',errors:errors.some(e=>e.startsWith(p.id+':')),partial:false,queryDifference:different}),missing:p.missing,current:p.current,previous:p.previous,evidence:p.evidence,visible_query_clicks:p.queries.length?visible:null,page_clicks:p.current?.clicks??null,query_difference_explanation:different?'Görünür sorgu alt kümesi; anonimleştirme, API sınırı, gecikme ve filtreler fark yaratabilir. Tek başına veri bozulması değildir.':null};});
 const snapshot={id:crypto.randomUUID(),version:'1.0.0',measured_at:time.toISOString(),period:report.period,comparison_period:report.previous_period,source_states:sourceStates,archive:{source:'Keyword Planner',last_success:sources.results.map(s=>s.imported_at||'').sort().at(-1)||null,export_range:{start:sources.results.map(s=>s.exported_at).sort().at(0)||null,end:sources.results.map(s=>s.exported_at).sort().at(-1)||null},files:sources.results.length,records:sources.results.reduce((n,r)=>n+r.row_count,0),status:issues.some(i=>i.source==='Keyword Planner')?'Kısmen doğrulandı':'Doğrulandı',note:'Sunucu DB metadata ve derlenmiş kaynak manifestini karşılaştırır. Gerçek 521 dosya baytı/SHA-256 ayrıca CI Python testlerinde doğrulanır; Workers dosya sistemini taramaz.'},crawl:{source:'Site taraması',...crawls,note:'Tarama başarısızlığı sayfa silinmesi değildir; Google dizin durumu değildir.'},products:productStates,issues:issues.map(i=>({...i,checked_at:time.toISOString()})),metric_errors:errors,jobs:jobs.results,limitations:['GSC tıklaması GA4 organik oturumu değildir; eşitlik kontrolü uygulanmaz.','Keyword Planner hacimleri ve varyantlar toplanmaz; reklam rekabeti SEO zorluğu değildir.','Doğrulandı ölçüm/hesap kapsamıdır; kesin SEO nedeni veya tam sorgu listesi değildir.']};
 for(const provider of ['gsc','ga4'])if((provider==='gsc'&&errors.length)||issues.some(i=>i.source===provider&&i.code!=='BOUNDED_AUDIT_PENDING'))await env.DB.prepare("INSERT INTO health_checks VALUES(?,?,?,'failed','DATA_AUDIT_FAILED') ON CONFLICT(provider,day) DO UPDATE SET checked_at=excluded.checked_at,status=excluded.status,code=excluded.code").bind(provider,time.toISOString().slice(0,10),time.toISOString()).run();
 const trustworthy=!errors.length&&!issues.some(i=>i.source==='gsc');
 if(trustworthy&&!preparedReport)await saveAnalysis(env,report);
 return saveInsight(env,'data-integrity',cacheKey||await hash(JSON.stringify(snapshot)),snapshot,trustworthy?report.id:null);
}
