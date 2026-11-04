// Ephemeral account-only preview. No credentials, D1 binding or source rows.
interface HistoryEnv {ARCHIVE:Fetcher;PROBE_KEY:string}
const integer=(v:unknown,max=100000000)=>Number.isSafeInteger(v)&&Number(v)>=0&&Number(v)<=max;
const month=(v:unknown)=>typeof v==='string'&&/^20\d\d-(0[1-9]|1[0-2])$/.test(v);
const event=(v:any)=>{
 if(!v||!['partial','complete','held','idle'].includes(v.status)||v.d1_requests!==0)throw Error('GSC_HISTORY_EVENT_INVALID');
 const result:Record<string,unknown>={status:v.status,d1_requests:0};
 for(const k of ['rows','cursor','completed_scopes','total_scopes'])if(v[k]!==undefined){if(!integer(v[k]))throw Error('GSC_HISTORY_EVENT_INVALID');result[k]=v[k];}
 if(v.day!==undefined){if(typeof v.day!=='string'||!/^20\d\d-\d\d-\d\d$/.test(v.day))throw Error('GSC_HISTORY_EVENT_INVALID');result.day=v.day;}
 if(v.scope!==undefined){if(!['page','query'].includes(v.scope))throw Error('GSC_HISTORY_EVENT_INVALID');result.scope=v.scope;}
 if(v.code!==undefined){if(typeof v.code!=='string'||!/^GSC_[A-Z0-9_]{1,100}$/.test(v.code))throw Error('GSC_HISTORY_EVENT_INVALID');result.code=v.code;}
 return result;
};
export default {async fetch(request:Request,env:HistoryEnv){
 if(!env.PROBE_KEY||request.headers.get('Authorization')!=='Bearer '+env.PROBE_KEY)return Response.json({ok:false,code:'GSC_HISTORY_UNAUTHORIZED'},{status:401});
 try{
  const url=new URL(request.url),mode=url.searchParams.get('mode');
  if(request.method!=='POST'||!['status','tick','month','context'].includes(mode||'')||[...url.searchParams.keys()].some(k=>!['mode','month'].includes(k)))throw Error('GSC_HISTORY_REQUEST_INVALID');
  const read=async(path:string,init?:RequestInit)=>{const r=await env.ARCHIVE.fetch('https://archive.private/api/internal/'+path,init);if(!r.ok)throw Error('GSC_HISTORY_PRIVATE_UNAVAILABLE');return r.json<any>();};
  if(mode==='month'){
   const m=url.searchParams.get('month');if(!month(m))throw Error('GSC_HISTORY_REQUEST_INVALID');
   const r=await read('gsc-month?month='+m);
   if(r.month!==m||r.source!=='GSC Search Analytics API'||r.d1_requests!==0||typeof r.available!=='boolean'||!integer(r.days_verified,31)||!integer(r.expected_days,31)||!integer(r.query_days_verified,31)||!Array.isArray(r.evidence)||r.query_partial!==true)throw Error('GSC_HISTORY_MONTH_INVALID');
   return Response.json({ok:true,mode,month:m,available:r.available,days_verified:r.days_verified,expected_days:r.expected_days,query_days_verified:r.query_days_verified,
    evidence_refs:r.evidence.length,content_rows:r.read_budget.rows,chunk_reads:r.read_budget.chunk_reads,budget_limited:r.read_budget.budget_limited,query_partial:true,source:r.source,d1_requests:0});
  }
  if(mode==='context'){
   const r=await read('evidence-context?details=1');
   if(typeof r.available!=='boolean'||r.d1_requests!==0||r.source_hash!==null&&r.source_hash!==undefined&&!/^[a-f0-9]{64}$/.test(r.source_hash))throw Error('GSC_HISTORY_CONTEXT_INVALID');
   const counts:Record<string,number>={};for(const k of ['products','snapshots','changes'])if(r[k]!==undefined){if(!integer(r[k],200))throw Error('GSC_HISTORY_CONTEXT_INVALID');counts[k]=r[k];}
   return Response.json({ok:true,mode,available:r.available,source_hash:r.source_hash??null,captured_at:r.captured_at??null,...counts,d1_requests:0});
  }
  const tick=mode==='tick'?event(await read('gsc-bootstrap-tick',{method:'POST'})):null;
  const r=await read('gsc-bootstrap-status');
  if(typeof r.initialized!=='boolean'||!Array.isArray(r.months)||r.months.length>2||!r.months.every(month)||!integer(r.completed_scopes,124)||!integer(r.total_scopes,124)||r.completed_scopes>r.total_scopes||typeof r.plan_complete!=='boolean'||!integer(r.storage_reserved_bytes)||r.storage_limit_bytes!==16777216||r.d1_requests!==0||r.manual_csv_required!==false)throw Error('GSC_HISTORY_STATUS_INVALID');
  return Response.json({ok:true,mode,months:r.months,completed_scopes:r.completed_scopes,total_scopes:r.total_scopes,plan_complete:r.plan_complete,
   storage_reserved_bytes:r.storage_reserved_bytes,storage_limit_bytes:r.storage_limit_bytes,tick,d1_requests:0,manual_csv_required:false});
 }catch(error){const message=error instanceof Error?error.message:'';return Response.json({ok:false,code:/^GSC_HISTORY_[A-Z0-9_]{1,100}$/.test(message)?message:'GSC_HISTORY_UNAVAILABLE'},{status:503});}
}};
