// Account-only remote-dev diagnostic. No D1 binding, credentials or raw source rows in output.
interface ProbeEnv { ARCHIVE:Fetcher; PROBE_KEY:string }
const day=(v:unknown)=>typeof v==='string'&&/^20\d\d-\d\d-\d\d$/.test(v)?v:undefined;
const at=(v:unknown)=>typeof v==='string'&&v.length<=40&&Number.isFinite(Date.parse(v))?v:undefined;
const count=(v:unknown)=>Number.isSafeInteger(v)&&Number(v)>=0?Number(v):undefined;
const scope=(v:unknown)=>v==='page'||v==='query'?v:undefined;
const code=(v:unknown)=>typeof v==='string'&&/^GSC_[A-Z0-9_]{1,100}$/.test(v)?v:undefined;
export function safeCoverage(raw:any){
 if(!raw||raw.d1_requests!==0||typeof raw.connected!=='boolean'||!Array.isArray(raw.coverage)||raw.coverage.length>14)throw Error('GSC_AUDIT_COVERAGE_INVALID');
 const coverage=raw.coverage.map((r:any)=>{
  if(!day(r?.day)||!scope(r?.scope)||count(r?.rows)===undefined||!at(r?.captured_at)||typeof r.query_partial!=='boolean')throw Error('GSC_AUDIT_COVERAGE_INVALID');
  return {day:r.day,scope:r.scope,rows:r.rows,captured_at:r.captured_at,query_partial:r.query_partial};
 });
 const last=raw.last_attempt;
 const last_attempt=last&&at(last.at)&&['held','idle','partial','complete'].includes(last.status)?
  {at:last.at,status:last.status,day:day(last.day),scope:scope(last.scope),code:code(last.code)}:null;
 const pending=raw.pending&&day(raw.pending.day)&&scope(raw.pending.scope)&&count(raw.pending.cursor)!==undefined?
  {day:raw.pending.day,scope:raw.pending.scope,cursor:raw.pending.cursor}:null;
 return {connected:raw.connected,reauthorization_required:raw.reauthorization_required===true,coverage,
  covered_scopes:coverage.length,expected_scopes:14,last_attempt,pending,d1_requests:0};
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
