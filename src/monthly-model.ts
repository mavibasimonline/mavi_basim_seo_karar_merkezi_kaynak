import {AnalysisEvidence,AnalysisReport,monthPeriod,dates,metrics,analyzeEvidence,AnalysisOptions} from './analysis';
import {validateEvidence} from './validation';
import {hash} from './types';
export interface MonthlyBundle {format:'verified-monthly-source-v1';site:string;captured_at:string;window:{months:string[];start:string;end:string};evidence:AnalysisEvidence;contexts:{id:string;context:unknown}[];flags:{automation_enabled:boolean;catchup_enabled:boolean;crawl_enabled:boolean};revision:string;cost:{rows_read:number;statements:number;physical_rows_read?:number;physical_rows_written?:number}}
function stable(value:any):string{if(Array.isArray(value))return '['+value.map(stable).join(',')+']';if(value&&typeof value==='object')return '{'+Object.entries(value).sort(([a],[b])=>a.localeCompare(b,'en')).map(([k,v])=>JSON.stringify(k)+':'+stable(v)).join(',')+'}';return JSON.stringify(value);}
export async function metadataRevision(meta:any,mapping:any,connection:any){
 return hash(stable({window:meta.window,products:meta.products.map((p:any)=>({...p,url_verified_at:!!p.url_verified_at})),coverage:meta.coverage,mapping,connected:!!connection.credential,health:connection.health.map((h:any)=>({provider:h.provider,status:h.status,code:h.code}))}));
}
export async function loadMonthlyBundle(fetchPart:(part:string,month?:string)=>Promise<any>,initial?:any):Promise<MonthlyBundle>{
 let reads=0,statements=0,physicalReads=0,physicalWrites=0,physicalKnown=true;
 const get=async(part:string,month?:string)=>{const reply=part==='header'&&initial?(initial):await fetchPart(part,month);if(part==='header')initial=undefined;if(!reply||reply.held||!reply.data||!Number.isSafeInteger(reply.cost?.rows_read)||reply.cost.rows_written!==0)throw Error(reply?.reason||reply?.code||'SNAPSHOT_SOURCE_UNAVAILABLE');reads+=reply.cost.rows_read;statements+=reply.cost.statements;if(Number.isSafeInteger(reply.cost.physical_rows_read)&&Number.isSafeInteger(reply.cost.physical_rows_written)){physicalReads+=reply.cost.physical_rows_read;physicalWrites+=reply.cost.physical_rows_written;}else physicalKnown=false;return reply.data;};
 const {meta,mapping,connection}=await get('header');
 const revision=await metadataRevision(meta,mapping,connection),pages:any[]=[],queries:any[]=[];
 const months=[...new Set(meta.coverage.map((c:any)=>c.day.slice(0,7)))].sort() as string[];
 for(const month of months){
  for(const scope of ['page','query'])if(meta.coverage.filter((c:any)=>c.scope===scope&&c.day.startsWith(month)).reduce((n:number,c:any)=>n+c.row_count,0)>20000)throw Error('SNAPSHOT_INPUT_SCOPE_LIMIT');
  const monthly=await get('month',month);
  for(const scope of ['page','query']){
  const expected=meta.coverage.filter((c:any)=>c.scope===scope&&c.day.startsWith(month));if(!expected.length)continue;
  const part=monthly[scope],sums=new Map<string,number>();
  for(const row of part.rows){if(row.invalid_rows!==0||!Number.isSafeInteger(row.source_rows)||row.source_rows<1)throw Error('SNAPSHOT_ROW_PROOF_REQUIRED');const key=row.date+':'+row.dataset_id;sums.set(key,(sums.get(key)||0)+row.source_rows);}
  for(const c of expected)if((sums.get(c.day+':'+c.dataset_id)||0)!==c.row_count)throw Error('SNAPSHOT_GENERATION_COUNT_MISMATCH');
  if(part.rows.some((r:any)=>!expected.some((c:any)=>c.day===r.date&&c.dataset_id===r.dataset_id)))throw Error('SNAPSHOT_GENERATION_SCOPE_MISMATCH');
  (scope==='page'?pages:queries).push(...part.rows);
 }
 }
 const {meta:fence,mapping:mappingFence,connection:connectionFence}=await get('header');if(revision!==await metadataRevision(fence,mappingFence,connectionFence))throw Error('SNAPSHOT_SOURCE_CHANGED');
 return {format:'verified-monthly-source-v1',site:meta.site,captured_at:fence.captured_at,window:meta.window,evidence:{products:meta.products,coverage:meta.coverage,pages,queries,counts:meta.products.map((p:any)=>({product_id:p.id,sources:p.keyword_sources,rows:p.keyword_rows})),credential:connection.credential,health:connection.health,aliases:mapping.aliases,mappedPages:mapping.mappedPages,region:null},contexts:connection.contexts.filter((r:any)=>r.context),flags:{automation_enabled:connection.automation_enabled,catchup_enabled:connection.catchup_enabled,crawl_enabled:connection.crawl_enabled},revision,cost:{rows_read:reads,statements,...physicalKnown?{physical_rows_read:physicalReads,physical_rows_written:physicalWrites}:{}}};
}
export function assertBundle(bundle:MonthlyBundle){
 if(bundle?.format!=='verified-monthly-source-v1'||bundle.site!=='https://mavibasim.com'||!/^[a-f0-9]{64}$/.test(bundle.revision)||!Number.isFinite(Date.parse(bundle.captured_at))||!Array.isArray(bundle.evidence?.products)||!Array.isArray(bundle.evidence.coverage)||!Array.isArray(bundle.evidence.pages)||!Array.isArray(bundle.evidence.queries))throw Error('SNAPSHOT_BUNDLE_INVALID');
 for(const scope of ['page','query']){
  const rows=scope==='page'?bundle.evidence.pages:bundle.evidence.queries,sums=new Map<string,number>();
  for(const r of rows as any[]){if(r.invalid_rows!==0||!Number.isSafeInteger(r.source_rows)||r.source_rows<1||![r.clicks,r.impressions,r.position].every(Number.isFinite)||r.clicks<0||r.impressions<r.clicks||!Number.isSafeInteger(r.clicks)||!Number.isSafeInteger(r.impressions))throw Error('SNAPSHOT_METRICS_INVALID');const key=r.date+':'+r.dataset_id;sums.set(key,(sums.get(key)||0)+r.source_rows);}
  const expected=bundle.evidence.coverage.filter(c=>c.provider==='gsc'&&c.scope===scope&&c.complete===1);
  for(const c of expected)if((sums.get(c.day+':'+c.dataset_id)||0)!==c.row_count)throw Error('SNAPSHOT_COVERAGE_INVALID');
  if((rows as any[]).some(r=>!expected.some(c=>c.day===r.date&&c.dataset_id===r.dataset_id)))throw Error('SNAPSHOT_FACT_SCOPE_INVALID');
 }
}
export function snapshotReport(bundle:MonthlyBundle,month:string,options:AnalysisOptions={}){
 const report=analyzeEvidence(bundle.evidence,bundle.site,month,new Date(bundle.captured_at),options);
 const errors=validateEvidence(report,bundle.evidence);if(errors.length)throw Error('SNAPSHOT_ANALYSIS_VALIDATION_FAILED');
 const start=report.previous_period.start,end=report.period.end;
 const fetched=bundle.evidence.coverage.filter(c=>c.day>=start&&c.day<=end).map(c=>c.fetched_at).sort().at(-1)||null;
 return {...report,snapshot:{verified:true,revision:bundle.revision,validated_at:bundle.captured_at,source_updated_at:fetched,historical:true,d1_requests:0,read_only:true}};
}
export function snapshotPerformance(bundle:MonthlyBundle,report:AnalysisReport){
 const input=bundle.evidence,device=report.filters?.device||null;
 const covered=(day:string)=>input.coverage.find(c=>c.scope==='page'&&c.complete===1&&c.day===day);
 const fact=(day:string)=>input.pages.filter(r=>r.date===day&&(!device||r.device===device));
 const series=dates(report.period).map(day=>{const c=covered(day),rows=fact(day);return {day,verified:!!c,metrics:c&&rows.length?metrics(rows):null,fetched_at:c?.fetched_at||null,dataset_id:c?.dataset_id||null};});
 const currentRows=input.pages.filter(r=>r.date>=report.period.start&&r.date<=report.period.end&&(!device||r.device===device)),previousRows=input.pages.filter(r=>r.date>=report.previous_period.start&&r.date<=report.previous_period.end&&(!device||r.device===device));
 const current=currentRows.length?metrics(currentRows):null,previous=previousRows.length?metrics(previousRows):null;
 const currentDays=dates(report.period).filter(day=>covered(day)).length,previousDays=dates(report.previous_period).filter(day=>covered(day)).length,observed=series.filter(d=>d.metrics).length;
 const fetched=series.map(s=>s.fetched_at).filter(Boolean).sort().at(-1)||null,health=input.health.find(h=>h.provider==='gsc');
 const recent=(stamp:string|null|undefined)=>!!stamp&&Date.parse(bundle.captured_at)-Date.parse(stamp)>=0&&Date.parse(bundle.captured_at)-Date.parse(stamp)<72*3600000;
 const fresh=!!input.credential&&health?.status==='ok'&&recent(health.checked_at)&&recent(fetched);
 const previousObserved=dates(report.previous_period).filter(day=>fact(day).length>0).length,finished=Date.parse(report.period.end+'T23:59:59Z')+3*86400000<Date.parse(bundle.captured_at);
 const resolved=(page:string)=>input.products.find(p=>p.canonical_url===page)?.id||input.mappedPages.find(p=>p.url===page)?.product_id||input.products.find(p=>p.canonical_url===input.aliases.find(a=>a.alias_url===page)?.canonical_url)?.id;
 const rangeMonths=Math.round((Date.parse(monthPeriod(report.period.end.slice(0,7)).start)-Date.parse(monthPeriod(report.period.start.slice(0,7)).start))/2592000000)+1;
 return {range_months:[1,3,6,12].includes(rangeMonths)?rangeMonths:1,products:report.products.map(p=>({id:p.id,current:p.current,previous:p.previous,observed_days:new Set(currentRows.filter(r=>resolved(r.page)===p.id).map(r=>r.date)).size,previous_observed_days:new Set(previousRows.filter(r=>resolved(r.page)===p.id).map(r=>r.date)).size,last_fetched_at:fetched})),source:'Google Search Console',scope:'page/country/device',timezone:'America/Los_Angeles',measured_at:report.created_at,last_fetched_at:fetched,google_connected:!!input.credential,fresh,health,period:report.period,previous_period:report.previous_period,device,catalog:input.products.map(p=>({...p,url:p.canonical_url,keyword_sources:input.counts.find(c=>c.product_id===p.id)?.sources||0,keyword_rows:input.counts.find(c=>c.product_id===p.id)?.rows||0})),archive:{csv_files:input.counts.reduce((n,c)=>n+c.sources,0),csv_rows:input.counts.reduce((n,c)=>n+c.rows,0)},coverage:{verified_days:currentDays,observed_days:observed,expected_days:report.period.days,complete:currentDays===report.period.days,measurement_complete:observed===report.period.days,previous_verified_days:previousDays,previous_expected_days:report.previous_period.days,previous_complete:previousDays===report.previous_period.days,invalid_days:[]},current,previous,comparison_available:!!current&&!!previous&&currentDays===report.period.days&&previousDays===report.previous_period.days&&observed===report.period.days&&previousObserved===report.previous_period.days&&finished&&fresh,series,notes:['Doğrulanmış arşiv ölçümleri gösterilir; eksik gün sıfır değildir.'],snapshot:(report as any).snapshot};
}
