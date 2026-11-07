// Read encrypted daily evidence independently from Sheets. Missing days and hidden
// queries are never manufactured as zeros or treated as complete query coverage.
import {decrypt} from './security';
import {gscRowIssue,GscRow} from './providers';
import {DailyProof,GscStorage} from './independent-gsc';
import {isBrand} from './urls';
const MAX_CHUNK_READS=1024,MAX_ROWS=250000,CHUNK_BYTES=36000;
const sha=async(raw:string)=>[...new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(raw)))].map(n=>n.toString(16).padStart(2,'0')).join('');
function fail(ok:unknown,code:string):asserts ok{if(!ok)throw Error(code);}
const integer=(n:unknown,min:number,max:number):n is number=>Number.isSafeInteger(n)&&Number(n)>=min&&Number(n)<=max;
const dayKey=(day:string,scope:string)=>'gsc:daily:'+day+':'+scope;
type Scope='page'|'query';
type Budget={chunk_reads:number;rows:number;max_chunk_reads:number;max_rows:number};
export type GscEvidenceRef={day:string;scope:Scope;generation:string;captured_at:string;rows:number;page_hashes:string[]};
export type GscMetric={page:string;device:string;country:string;clicks:number;impressions:number;ctr:number;position:number};
export type GscQueryMetric=GscMetric&{query:string;is_brand:number};
export type GscReadOptions={maxChunkReads?:number;maxRows?:number};
function validateManifest(proof:DailyProof,day:string,scope:Scope,time:Date){
 fail(proof&&typeof proof==='object'&&proof.source==='GSC Search Analytics API'&&proof.d1_requests===0,'GSC_MONTH_SOURCE_INVALID');
 fail(proof.day===day&&proof.scope===scope&&typeof proof.generation==='string'&&/^[a-zA-Z0-9_-]{1,80}$/.test(proof.generation),'GSC_MONTH_SCOPE_INVALID');
 fail(typeof proof.captured_at==='string'&&/^20\d\d-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{3})?Z$/.test(proof.captured_at)
  &&Number.isFinite(Date.parse(proof.captured_at))&&Date.parse(proof.captured_at)>=Date.parse(day+'T00:00:00Z')
  &&Date.parse(proof.captured_at)<=time.getTime()+300000,'GSC_MONTH_CAPTURE_INVALID');
 fail(typeof proof.query_partial==='boolean'&&(scope!=='query'||proof.query_partial),'GSC_MONTH_SCOPE_INVALID');
 fail(integer(proof.rows,0,50000)&&integer(proof.pages,1,250)&&Array.isArray(proof.page_proofs)&&proof.pages===proof.page_proofs.length,'GSC_MONTH_MANIFEST_INVALID');
 let count=0,index=0;
 for(const part of proof.page_proofs){
  fail(part&&part.index===index++,'GSC_MONTH_PAGE_INDEX_INVALID');
  fail(integer(part.count,0,200)&&integer(part.chunks,1,20)&&integer(part.bytes,2,460000)&&part.chunks===Math.ceil(part.bytes/CHUNK_BYTES),'GSC_MONTH_CHUNK_INVALID');
  fail(typeof part.sha256==='string'&&/^[a-f0-9]{64}$/.test(part.sha256),'GSC_MONTH_HASH_INVALID');
  fail(index===proof.pages||part.count===200,'GSC_MONTH_PAGINATION_INVALID');count+=part.count;
 }
 fail(count===proof.rows,'GSC_MONTH_ROW_COUNT_INVALID');
}
async function readProof(storage:GscStorage,secret:string,proof:DailyProof,budget:Budget){
 const result:GscRow[]=[],seen=new Set<string>();
 for(const part of proof.page_proofs){
  const arrays:Uint8Array[]=[];let size=0;
  for(let i=0;i<part.chunks;i++){
   budget.chunk_reads++;
   const sealed=await storage.get<string>('gsc:part:'+proof.day+':'+proof.scope+':'+proof.generation+':'+part.index+':'+i);
   fail(typeof sealed==='string'&&sealed.length<=66000,'GSC_MONTH_CHUNK_MISSING');
   const record=await decrypt<{chunk:string}>(sealed!,secret);
   fail(record&&typeof record.chunk==='string'&&record.chunk.length<=48000,'GSC_MONTH_CHUNK_INVALID');
   const data=Uint8Array.from(atob(record.chunk),c=>c.charCodeAt(0));
   fail(data.length>0&&data.length<=CHUNK_BYTES,'GSC_MONTH_CHUNK_INVALID');
   size+=data.length;fail(size<=460000,'GSC_MONTH_BYTES_LIMIT');arrays.push(data);
  }
  const complete=new Uint8Array(size);let n=0;for(const a of arrays){complete.set(a,n);n+=a.length;}
  const raw=new TextDecoder('utf-8',{fatal:true,ignoreBOM:false}).decode(complete);
  fail(size===part.bytes&&await sha(raw)===part.sha256,'GSC_MONTH_HASH_MISMATCH');
  const rows=JSON.parse(raw) as GscRow[];
  fail(Array.isArray(rows)&&rows.length===part.count,'GSC_MONTH_COUNT_MISMATCH');
  for(const row of rows){
   fail(row&&typeof row==='object'&&typeof row.page==='string'&&typeof row.country==='string'&&typeof row.device==='string','GSC_MONTH_ROW_INVALID');
   fail(proof.scope==='query'?typeof row.query==='string':row.query===undefined,'GSC_MONTH_ROW_SCOPE_INVALID');
   fail(!gscRowIssue(row,proof.day),'GSC_MONTH_ROW_INVALID');
   fail(Number.isSafeInteger(row.clicks)&&Number.isSafeInteger(row.impressions),'GSC_MONTH_ROW_INVALID');
   fail(Number.isFinite(row.position*row.impressions),'GSC_MONTH_METRIC_OVERFLOW');
   if(proof.scope==='query')fail(row.is_brand===Number(isBrand(row.query!)),'GSC_MONTH_BRAND_INVALID');
   const identity=JSON.stringify([row.date,row.page,row.country.toLowerCase(),row.device,row.query]);
   fail(!seen.has(identity),'GSC_MONTH_DUPLICATE_ROW');seen.add(identity);
  }
  result.push(...rows);
 }
 fail(result.length===proof.rows,'GSC_MONTH_ROW_COUNT_INVALID');budget.rows+=result.length;
 return result;
}
function canRead(proof:DailyProof,budget:Budget){
 return budget.chunk_reads+proof.page_proofs.reduce((n,p)=>n+p.chunks,0)<=budget.max_chunk_reads&&budget.rows+proof.rows<=budget.max_rows;
}
type Aggregate={page:string;device:string;country:string;query?:string;is_brand?:number;clicks:number;impressions:number;weighted_position:number};
function add(group:Map<string,Aggregate>,rows:GscRow[],query:boolean){
 for(const r of rows){
  const country=r.country.toLowerCase(),k=JSON.stringify([r.page,country,r.device,query?r.query:undefined]);
  const old=group.get(k)||{page:r.page,device:r.device,country,...(query?{query:r.query,is_brand:r.is_brand}:{}),clicks:0,impressions:0,weighted_position:0};
  old.clicks+=r.clicks;old.impressions+=r.impressions;old.weighted_position+=r.position*r.impressions;
  fail(Number.isSafeInteger(old.clicks)&&Number.isSafeInteger(old.impressions)&&Number.isFinite(old.weighted_position),'GSC_MONTH_METRIC_OVERFLOW');
  group.set(k,old);
 }
}
function metrics(group:Map<string,Aggregate>){
 return [...group.values()].map(({weighted_position,...p})=>({...p,ctr:p.impressions?p.clicks/p.impressions:0,
  position:p.impressions?weighted_position/p.impressions:0})).sort((a,b)=>b.clicks-a.clicks||b.impressions-a.impressions||a.page.localeCompare(b.page));
}
/** Private reader for one immutable daily generation; callers choose whether to
 * return rows. A manifest alone never establishes verified daily coverage. */
export async function readVerifiedGscDay(storage:GscStorage,secret:string,day:string,scope:Scope,time=new Date(),options:GscReadOptions={}){
 fail(/^20\d\d-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/.test(day)&&new Date(day+'T00:00:00Z').toISOString().slice(0,10)===day,'INVALID_DAY');
 fail(scope==='page'||scope==='query','INVALID_SCOPE');
 const cutoff=new Date(time.getTime()-3*86400000).toISOString().slice(0,10),oldest=new Date(time.getTime()-400*86400000).toISOString().slice(0,10);
 fail(day<=cutoff&&day>=oldest,'GSC_DAY_OUT_OF_RANGE');
 const proof=await storage.get<DailyProof>(dayKey(day,scope));
 if(!proof)return {verified:false as const,day,scope,code:'GSC_DAY_MISSING',d1_requests:0};
 validateManifest(proof,day,scope,time);
 if(scope==='page'&&proof.query_partial)return {verified:false as const,day,scope,code:'GSC_DAY_SOURCE_INCOMPLETE',d1_requests:0};
 const budget:Budget={chunk_reads:0,rows:0,max_chunk_reads:options.maxChunkReads??MAX_CHUNK_READS,max_rows:options.maxRows??MAX_ROWS};
 fail(integer(budget.max_chunk_reads,1,MAX_CHUNK_READS)&&integer(budget.max_rows,1,MAX_ROWS),'GSC_MONTH_BUDGET_INVALID');
 if(!canRead(proof,budget))return {verified:false as const,day,scope,code:'GSC_DAY_READ_BUDGET',d1_requests:0};
 const rows=await readProof(storage,secret,proof,budget);
 return {verified:true as const,day,scope,rows_count:rows.length,query_partial:proof.query_partial,rows,
  evidence:{day,scope,generation:proof.generation,captured_at:proof.captured_at,rows:proof.rows,page_hashes:proof.page_proofs.map(p=>p.sha256)},
  chunk_reads:budget.chunk_reads,d1_requests:0};
}
/** Bounded, read-only detail of existing final generations. No collection or writes. */
export async function verifiedGscSeries(storage:GscStorage,secret:string,month:string,filters:{query?:string;page?:string;device?:string},time=new Date()){
 fail(/^20\d\d-(0[1-9]|1[0-2])$/.test(month),'INVALID_MONTH');
 const end=new Date(Date.UTC(Number(month.slice(0,4)),Number(month.slice(5)),0));
 fail(end.getTime()<time.getTime()-3*86400000&&end.getTime()>time.getTime()-401*86400000,'GSC_MONTH_NOT_CLOSED');
 fail((!filters.query||filters.query.length<=512)&&(!filters.page||filters.page.length<=2048)
  &&(!filters.device||['ALL','MOBILE','DESKTOP','TABLET'].includes(filters.device)),'GSC_SERIES_SCOPE_INVALID');
 const scope:Scope=filters.query?'query':'page',budget:Budget={chunk_reads:0,rows:0,max_chunk_reads:256,max_rows:20000};
 const series:{day:string;verified:boolean;observed:boolean;metrics:{clicks:number;impressions:number;ctr:number|null;position:number|null}|null;evidence?:GscEvidenceRef}[]=[];
 for(let i=1;i<=end.getUTCDate();i++){
  const day=month+'-'+String(i).padStart(2,'0'),proof=await storage.get<DailyProof>(dayKey(day,scope));
  if(!proof){series.push({day,verified:false,observed:false,metrics:null});continue;}
  validateManifest(proof,day,scope,time);
  if(!canRead(proof,budget)||scope==='page'&&proof.query_partial){series.push({day,verified:false,observed:false,metrics:null});continue;}
  const rows=(await readProof(storage,secret,proof,budget)).filter(r=>(!filters.query||r.query===filters.query)&&(!filters.page||r.page===filters.page)&&(!filters.device||filters.device==='ALL'||r.device===filters.device));
  const clicks=rows.reduce((n,r)=>n+r.clicks,0),impressions=rows.reduce((n,r)=>n+r.impressions,0);
  series.push({day,verified:true,observed:rows.length>0,metrics:rows.length?{clicks,impressions,ctr:impressions?clicks/impressions:null,position:impressions?rows.reduce((n,r)=>n+r.position*r.impressions,0)/impressions:null}:null,
   evidence:{day,scope,generation:proof.generation,captured_at:proof.captured_at,rows:proof.rows,page_hashes:proof.page_proofs.map(p=>p.sha256)}});
 }
 return {source:'GSC Search Analytics API',month,scope,filters,timezone:'America/Los_Angeles',data_state:'final',series,
  days_verified:series.filter(r=>r.verified).length,expected_days:end.getUTCDate(),read_budget:budget,d1_requests:0,
  message:'Yalnız gözlenen satırlar gösterilir. Eksik/anonim sorgu sıfır değildir. Sıfır gösterimde CTR ve konum üretilmez.'};
}
export async function verifiedGscMonth(storage:GscStorage,secret:string,month:string,time=new Date(),options:GscReadOptions={}){
 fail(/^20\d\d-(0[1-9]|1[0-2])$/.test(month),'INVALID_MONTH');
 const end=new Date(Date.UTC(Number(month.slice(0,4)),Number(month.slice(5,7)),0));
 // Current month may be inspected as partial evidence; never treat future or unfinalized days as complete.
 const sourceParts=new Intl.DateTimeFormat('en-US',{timeZone:'Europe/Istanbul',year:'numeric',month:'2-digit'}).formatToParts(time);
 const sourceMonth=sourceParts.find(p=>p.type==='year')!.value+'-'+sourceParts.find(p=>p.type==='month')!.value;
 fail(month<=sourceMonth&&end.getTime()>time.getTime()-401*86400000,'GSC_MONTH_NOT_CLOSED');
 const budget:Budget={chunk_reads:0,rows:0,max_chunk_reads:options.maxChunkReads??MAX_CHUNK_READS,max_rows:options.maxRows??MAX_ROWS};
 fail(integer(budget.max_chunk_reads,1,MAX_CHUNK_READS)&&integer(budget.max_rows,1,MAX_ROWS),'GSC_MONTH_BUDGET_INVALID');
 const dates=Array.from({length:end.getUTCDate()},(_,i)=>month+'-'+String(i+1).padStart(2,'0'));
 const missing:string[]=[],queryMissing:string[]=[],budgetDays:string[]=[],evidence:GscEvidenceRef[]=[];
 const pageGroup=new Map<string,Aggregate>(),queryGroup=new Map<string,Aggregate>();
 const daily:{day:string;verified:true;fetched_at:string;devices:{device:string;clicks:number;impressions:number;ctr:number;position:number}[]}[]=[];
 let days=0,queryDays=0;
 // Page totals take priority. Query volume cannot consume the page read budget.
 for(const scope of ['page','query'] as Scope[])for(const day of dates){
  const p=await storage.get<DailyProof>(dayKey(day,scope)),missingList=scope==='page'?missing:queryMissing;
  if(!p){missingList.push(day);continue;}
  validateManifest(p,day,scope,time);
  if(scope==='page'&&p.query_partial){missingList.push(day);continue;}
  if(!canRead(p,budget)){missingList.push(day);budgetDays.push(day+':'+scope);continue;}
  const rows=await readProof(storage,secret,p,budget);
  add(scope==='page'?pageGroup:queryGroup,rows,scope==='query');
  if(scope==='page'){
   const devices=[...new Set(rows.map(r=>r.device))].map(device=>{
    const selected=rows.filter(r=>r.device===device),clicks=selected.reduce((n,r)=>n+r.clicks,0),impressions=selected.reduce((n,r)=>n+r.impressions,0);
    return {device,clicks,impressions,ctr:impressions?clicks/impressions:0,position:impressions?selected.reduce((n,r)=>n+r.position*r.impressions,0)/impressions:0};
   });
   daily.push({day,verified:true,fetched_at:p.captured_at,devices});
  }
  if(scope==='page')days++;else queryDays++;
  evidence.push({day,scope,generation:p.generation,captured_at:p.captured_at,rows:p.rows,page_hashes:p.page_proofs.map(x=>x.sha256)});
 }
 const pages=metrics(pageGroup) as GscMetric[],queries=metrics(queryGroup) as GscQueryMetric[];
 const observedClicks=pages.reduce((n,p)=>n+p.clicks,0),observedImpressions=pages.reduce((n,p)=>n+p.impressions,0);
 fail(Number.isSafeInteger(observedClicks)&&Number.isSafeInteger(observedImpressions),'GSC_MONTH_METRIC_OVERFLOW');
 const complete=missing.length===0;
 return {available:complete,month,period_state:complete?'tam':'kısmi',days_verified:days,expected_days:dates.length,missing_days:missing,
  query_days_verified:queryDays,query_missing_days:queryMissing,query_partial:true as const,
  source:'GSC Search Analytics API',property:'sc-domain:mavibasim.com',search_type:'web',data_state:'final',timezone:'America/Los_Angeles',
  scope:'verified daily page-country-device and observed query rows; anonymized queries are incomplete',d1_requests:0,
  pages,queries,daily,evidence,read_budget:{chunk_reads:budget.chunk_reads,max_chunk_reads:budget.max_chunk_reads,rows:budget.rows,max_rows:budget.max_rows,budget_limited:budgetDays.length>0,unread:budgetDays},
  // Partial observations remain inspectable but are never labeled monthly totals.
  observed_clicks:observedClicks,observed_impressions:observedImpressions,
  total_clicks:complete?observedClicks:null,total_impressions:complete?observedImpressions:null,
  message:complete?'Günlük sayfa kanıtları doğrulandı; sorgu satırları anonimleştirme nedeniyle eksik olabilir.':'Eksik günlük GSC kaynakları sıfır değildir; aylık sonuç kanıtlanmadı.'};
}
