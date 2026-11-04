// Account-only remote-dev diagnostic. No D1 binding, credentials or raw source rows in output.
interface ProbeEnv { ARCHIVE:Fetcher; PROBE_KEY:string }
const day=(v:unknown)=>typeof v==='string'&&/^20\d\d-\d\d-\d\d$/.test(v)?v:undefined;
const at=(v:unknown)=>typeof v==='string'&&v.length<=40&&Number.isFinite(Date.parse(v))?v:undefined;
const count=(v:unknown)=>Number.isSafeInteger(v)&&Number(v)>=0?Number(v):undefined;
const scope=(v:unknown)=>v==='page'||v==='query'?v:undefined;
const code=(v:unknown)=>typeof v==='string'&&/^GSC_[A-Z0-9_]{1,100}$/.test(v)?v:undefined;
const reason=(v:unknown)=>typeof v==='string'&&/^(DATE|PAGE_PROPERTY_SCOPE|PAGE_ORIGIN|COUNTRY|DEVICE|METRIC_NUMBER|COUNTS|METRIC_RANGE|CTR_RATIO|QUERY)$/.test(v)?v:undefined;
const phase=(v:unknown)=>typeof v==='string'&&/^(authorization|provider|response|validation|storage|publication)$/.test(v)?v:undefined;
function event(raw:any){
 if(!raw)return null;
 if(!at(raw.at)||!['held','idle','partial','complete'].includes(raw.status))throw Error('GSC_AUDIT_EVENT_INVALID');
 return {at:raw.at,status:raw.status,day:day(raw.day),scope:scope(raw.scope),code:code(raw.code),rows:count(raw.rows),cursor:count(raw.cursor),validation_reason:reason(raw.validation_reason),phase:phase(raw.phase),
  generation:typeof raw.generation==='string'&&/^[a-zA-Z0-9_-]{1,80}$/.test(raw.generation)?raw.generation:undefined};
}
function metadata(raw:any){
 const result:Record<string,unknown>={};
 for(const k of ['tick_count','backfill_index'])if(raw[k]!==undefined){if(count(raw[k])===undefined)throw Error('GSC_AUDIT_COUNTER_INVALID');result[k]=raw[k];}
 if(raw.retry_until!==undefined){if(raw.retry_until!==null&&!at(raw.retry_until))throw Error('GSC_AUDIT_TIMESTAMP_INVALID');result.retry_until=raw.retry_until;}
 for(const k of ['last_failure','last_complete'])if(raw[k]!==undefined)result[k]=event(raw[k]);
 if(raw.held!==undefined){
  if(!Array.isArray(raw.held)||raw.held.length>20)throw Error('GSC_AUDIT_HELD_INVALID');
  result.held=raw.held.map((r:any)=>{
   if(!day(r?.day)||!scope(r?.scope)||!at(r?.until)||!code(r?.code)||typeof r?.active!=='boolean')throw Error('GSC_AUDIT_HELD_INVALID');
   return {day:r.day,scope:r.scope,until:r.until,code:r.code,active:r.active};
  });
 }
 for(const k of ['incomplete_coverage','invalid_manifests'])if(raw[k]!==undefined){
  if(!Array.isArray(raw[k])||raw[k].length>14)throw Error('GSC_AUDIT_COVERAGE_INVALID');
  result[k]=raw[k].map((r:any)=>{if(!day(r?.day)||!scope(r?.scope))throw Error('GSC_AUDIT_COVERAGE_INVALID');return {day:r.day,scope:r.scope};});
 }
 if(raw.storage_budget!==undefined){
  const b=raw.storage_budget;if(!b||b.account_usage_measured!==false||b.prior_usage_included!==false)throw Error('GSC_AUDIT_BUDGET_INVALID');
  const names=['reserved_bytes','daily_reserved_bytes','total_limit_bytes','daily_limit_bytes','object_limit_bytes'];
  if(names.some(k=>count(b[k])===undefined)||b.object_database_bytes!==null&&count(b.object_database_bytes)===undefined||b.measured_since!==null&&!at(b.measured_since))throw Error('GSC_AUDIT_BUDGET_INVALID');
  result.storage_budget={measured_since:b.measured_since,...Object.fromEntries(names.map(k=>[k,b[k]])),object_database_bytes:b.object_database_bytes,account_usage_measured:false,prior_usage_included:false};
 }
 if(raw.cron!==undefined){
  const c=raw.cron;if(!c||!Array.isArray(c.days)||c.days.length>2)throw Error('GSC_AUDIT_CRON_INVALID');
  let last=null;
  if(c.last){
   const r=c.last;if(r.source!=='Cloudflare Cron'||!at(r.scheduled_at)||!at(r.finished_at)||!['complete','partial','held','idle'].includes(r.status)||r.d1_requests!==0)throw Error('GSC_AUDIT_CRON_INVALID');
   last={source:'Cloudflare Cron',scheduled_at:r.scheduled_at,finished_at:r.finished_at,status:r.status,day:day(r.day),scope:scope(r.scope),rows:count(r.rows),cursor:count(r.cursor),code:code(r.code),d1_requests:0};
  }
  const days=c.days.map((r:any)=>{
   const names=['attempts','completed','partial','held','idle'];
   if(!day(r?.day)||!at(r?.last_scheduled_at)||names.some(k=>count(r[k])===undefined))throw Error('GSC_AUDIT_CRON_INVALID');
   return {day:r.day,...Object.fromEntries(names.map(k=>[k,r[k]])),last_scheduled_at:r.last_scheduled_at};
  });
  // A fixed explanation replaces any unexpected source text.
  result.cron={last,days,scope:'Only receipts recorded after this runtime upgrade; absent earlier receipts are not failed jobs.'};
 }
 return result;
}
export function safeCoverage(raw:any){
 if(!raw||raw.d1_requests!==0||typeof raw.connected!=='boolean'||!Array.isArray(raw.coverage)||raw.coverage.length>14)throw Error('GSC_AUDIT_COVERAGE_INVALID');
 const coverage=raw.coverage.map((r:any)=>{
  if(!day(r?.day)||!scope(r?.scope)||count(r?.rows)===undefined||!at(r?.captured_at)||typeof r.query_partial!=='boolean')throw Error('GSC_AUDIT_COVERAGE_INVALID');
  return {day:r.day,scope:r.scope,rows:r.rows,captured_at:r.captured_at,query_partial:r.query_partial};
 });
 const last_attempt=event(raw.last_attempt);
 const pending=raw.pending&&day(raw.pending.day)&&scope(raw.pending.scope)&&count(raw.pending.cursor)!==undefined?
  {day:raw.pending.day,scope:raw.pending.scope,cursor:raw.pending.cursor}:null;
 return {connected:raw.connected,reauthorization_required:raw.reauthorization_required===true,coverage,
  covered_scopes:coverage.length,expected_scopes:14,last_attempt,pending,...metadata(raw),d1_requests:0};
}
export default {async fetch(request:Request,env:ProbeEnv){
 if(!env.PROBE_KEY||request.headers.get('Authorization')!=='Bearer '+env.PROBE_KEY)return Response.json({ok:false},{status:401});
 if(request.method!=='GET')return Response.json({ok:false},{status:405});
 const url=new URL(request.url);
 if([...url.searchParams.keys()].some(k=>k!=='ticks'))return Response.json({ok:false},{status:400});
 const ticks=Number(url.searchParams.get('ticks')||0);
 if(!Number.isInteger(ticks)||ticks<0||ticks>4)return Response.json({ok:false},{status:400});
 try{
  const read=async()=>{
   const response=await env.ARCHIVE.fetch('https://archive.private/api/internal/gsc-coverage');
   if(!response.ok)throw Error('GSC_AUDIT_PRIVATE_STATUS_UNAVAILABLE');
   return safeCoverage(await response.json());
  };
  const before=await read(),attempts=[];
  for(let n=0;n<ticks;n++){
   const response=await env.ARCHIVE.fetch('https://archive.private/api/internal/gsc-tick',{method:'POST'});
   if(!response.ok)throw Error('GSC_AUDIT_TICK_UNAVAILABLE');
   const r=await response.json<any>();
   if(r.d1_requests!==0||!['partial','complete','idle','held'].includes(r.status))throw Error('GSC_AUDIT_TICK_INVALID');
   attempts.push({status:r.status,day:day(r.day),scope:scope(r.scope),rows:count(r.rows),cursor:count(r.cursor),code:code(r.code),d1_requests:0});
   if(r.status==='held'||r.status==='idle')break;
  }
  const after=await read();
  // This endpoint is optional on older production versions. Absence is explicit.
  let readback:{available:boolean;verified?:boolean;day?:string;scope?:string;rows?:number;pages?:number;d1_requests:0}={available:false,d1_requests:0};
  const latest=after.coverage.at(-1);
  if(latest){
   const response=await env.ARCHIVE.fetch('https://archive.private/api/internal/gsc-proof?day='+latest.day+'&scope='+latest.scope);
   if(response.ok){
    const r=await response.json<any>();
    if(r.available===true&&r.verified===true&&r.day===latest.day&&r.scope===latest.scope&&r.d1_requests===0&&count(r.rows)!==undefined&&count(r.pages)!==undefined)
     readback={available:true,verified:true,day:r.day,scope:r.scope,rows:r.rows,pages:r.pages,d1_requests:0};
   }else await response.body?.cancel();
  }
  return Response.json({ok:true,observed_at:new Date().toISOString(),manual_ticks:attempts.length,before,attempts,after,readback,d1_requests:0});
 }catch(error){
  const safe=error instanceof Error?code(error.message):undefined;
  return Response.json({ok:false,code:safe||'GSC_AUDIT_UNAVAILABLE'},{status:503});
 }
}};
