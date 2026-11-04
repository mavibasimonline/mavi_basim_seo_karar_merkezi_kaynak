// Account-only remote-preview control. No D1 binding, credentials or source rows.
import {safeCoverage} from './gsc_runtime_probe';

interface ProbeEnv { ARCHIVE:Fetcher; PROBE_KEY:string }
type Mode='status'|'recover'|'collect'|'readback'|'diagnostic';
type Coverage=ReturnType<typeof safeCoverage>;
// The private retry endpoint also enforces a fresh successful persisted diagnostic.
const RETESTABLE=new Set(['GSC_HTTP_400','GSC_AGGREGATION_INVALID','GSC_ROW_REJECTED','GSC_DUPLICATE_ROW','GSC_SYNC_UNAVAILABLE']);
const count=(v:unknown):v is number=>typeof v==='number'&&Number.isSafeInteger(v)&&v>=0;
const scope=(v:unknown)=>v==='page'||v==='query';
const day=(v:unknown):v is string=>typeof v==='string'&&/^20\d\d-\d\d-\d\d$/.test(v)&&Number.isFinite(Date.parse(v))&&new Date(v).toISOString().slice(0,10)===v;
const at=(v:unknown):v is string=>typeof v==='string'&&v.length<=40&&Number.isFinite(Date.parse(v));
const isoAt=(v:unknown):v is string=>typeof v==='string'&&/^20\d\d-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,3})?Z$/.test(v)&&Number.isFinite(Date.parse(v))&&new Date(v).toISOString().slice(0,19)===v.slice(0,19);
const code=(v:unknown):v is string=>typeof v==='string'&&/^GSC_[A-Z0-9_]{1,100}$/.test(v);
const object=(v:unknown):v is Record<string,unknown>=>v!==null&&typeof v==='object'&&!Array.isArray(v);
class ProbeError extends Error { constructor(readonly code:string,readonly status=503){super(code);} }
function fail(code:string,status=503):never {throw new ProbeError(code,status);}

async function input(request:Request,mode:Mode){
 if(request.method==='GET')return {};
 const declared=request.headers.get('Content-Length');
 if(declared!==null&&(!/^\d+$/.test(declared)||Number(declared)>4096))fail('GSC_PIPELINE_BODY_INVALID',400);
 const reader=request.body?.getReader();let length=0;const chunks:Uint8Array[]=[];
 if(reader)for(;;){const {done,value}=await reader.read();if(done)break;length+=value.byteLength;
  if(length>4096){await reader.cancel();fail('GSC_PIPELINE_BODY_INVALID',400);}chunks.push(value);
 }
 const bytes=new Uint8Array(length);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.byteLength;}
 let value:unknown={};
 try{if(length)value=JSON.parse(new TextDecoder('utf-8',{fatal:true,ignoreBOM:false}).decode(bytes));}catch{fail('GSC_PIPELINE_BODY_INVALID',400);}
 if(!object(value))fail('GSC_PIPELINE_BODY_INVALID',400);
 const keys=Object.keys(value);
 if(mode==='collect'){
  if(keys.length!==1||keys[0]!=='ticks'||!count(value.ticks)||value.ticks<1||value.ticks>4)fail('GSC_PIPELINE_TICKS_INVALID',400);
 }else if(mode==='readback'){
  if(keys.length!==1||keys[0]!=='index'||!count(value.index)||value.index>13)fail('GSC_PIPELINE_BODY_INVALID',400);
 }else if(keys.length)fail('GSC_PIPELINE_BODY_INVALID',400);
 return value;
}

export default {async fetch(request:Request,env:ProbeEnv){
 let mode:Mode|null=null,status:Coverage|null=null;
 const respond=(ok:boolean,meta:Record<string,unknown>={},http=200)=>Response.json({ok,mode,observed_at:new Date().toISOString(),status,...meta,d1_requests:0},{status:http});
 // Authentication precedes URL, method, and body handling on every request.
 if(!env.PROBE_KEY||request.headers.get('Authorization')!=='Bearer '+env.PROBE_KEY)return respond(false,{code:'GSC_PIPELINE_UNAUTHORIZED'},401);
 try{
  const url=new URL(request.url),values=url.searchParams.getAll('mode');
  if([...url.searchParams.keys()].some(k=>k!=='mode')||values.length>1)fail('GSC_PIPELINE_MODE_INVALID',400);
  const selected=values[0]??'status';
  if(!['status','recover','collect','readback','diagnostic'].includes(selected))fail('GSC_PIPELINE_MODE_INVALID',400);
  mode=selected as Mode;
  if(request.method!=='POST'&&!(request.method==='GET'&&mode==='status'))fail('GSC_PIPELINE_METHOD_INVALID',405);
  const body=await input(request,mode);
  const read=async():Promise<Coverage>=>{
   const response=await env.ARCHIVE.fetch('https://archive.private/api/internal/gsc-coverage');
   if(!response.ok){await response.body?.cancel();fail('GSC_PIPELINE_STATUS_UNAVAILABLE');}
   try{return safeCoverage(await response.json());}catch{fail('GSC_PIPELINE_STATUS_INVALID');}
  };
  status=await read();
  if(mode==='status')return respond(true);
  if(mode==='diagnostic'){
   const response=await env.ARCHIVE.fetch('https://archive.private/api/internal/gsc-diagnostic',{method:'POST'});
   if(!response.ok){await response.body?.cancel();fail('GSC_PIPELINE_DIAGNOSTIC_UNAVAILABLE');}
   let r:any;try{r=await response.json();}catch{fail('GSC_PIPELINE_DIAGNOSTIC_INVALID');}
   if(!object(r)||r.revision!=='daily-proof-v2'||!isoAt(r.at)||r.d1_requests!==0||typeof r.ok!=='boolean'||!['partial','complete','held','idle'].includes(r.status as string)||r.day!==undefined&&!day(r.day)||r.scope!==undefined&&!scope(r.scope)||r.rows!==undefined&&!count(r.rows)||r.cursor!==undefined&&!count(r.cursor)||r.code!==undefined&&!code(r.code))fail('GSC_PIPELINE_DIAGNOSTIC_INVALID');
   let last_failure;
   if(r.last_failure!==undefined){
    try{last_failure=safeCoverage({connected:false,coverage:[],last_attempt:r.last_failure,pending:null,d1_requests:0}).last_attempt;}
    catch{fail('GSC_PIPELINE_DIAGNOSTIC_INVALID');}
   }
   const diagnostic={at:r.at,revision:r.revision,status:r.status,ok:r.ok,day:r.day,scope:r.scope,rows:r.rows,cursor:r.cursor,code:r.code,last_failure,d1_requests:0};
   status=await read();return respond(true,{diagnostic});
  }
  if(mode==='recover'){
   const now=Date.now(),today=Date.parse(new Date(now).toISOString().slice(0,10));
   const held=(status as Coverage&{held?:Array<{day:string;scope:string;code:string;until:string;active:boolean}>}).held??[];
   // Validate all candidates before the first mutation; never clear OAuth/429 holds.
   const candidates=held.filter(h=>h.active&&RETESTABLE.has(h.code)&&day(h.day)&&(today-Date.parse(h.day))/86400000>=3&&(today-Date.parse(h.day))/86400000<=9);
   if(candidates.length>16||new Set(candidates.map(h=>h.day+':'+h.scope)).size!==candidates.length||candidates.some(h=>!at(h.until)||Date.parse(h.until)<=now))fail('GSC_PIPELINE_RECOVERY_SOURCE_INVALID');
   const recoveries=[];
   for(const h of candidates.slice(0,1)){
    const exact={day:h.day,scope:h.scope,code:h.code,until:h.until};
    const response=await env.ARCHIVE.fetch('https://archive.private/api/internal/gsc-retry',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(exact)});
    if(!response.ok){
     let failure:any;try{failure=await response.json();}catch{}
     fail(object(failure)&&typeof failure.code==='string'&&/^GSC_RECOVERY_[A-Z0-9_]+$/.test(failure.code)?failure.code:'GSC_PIPELINE_RECOVERY_UNAVAILABLE');
    }
    let r:any;try{r=await response.json();}catch{fail('GSC_PIPELINE_RECOVERY_INVALID');}
    if(!object(r)||r.d1_requests!==0||typeof r.released!=='boolean')fail('GSC_PIPELINE_RECOVERY_INVALID');
    if(r.released){
     if(r.day!==h.day||r.scope!==h.scope||r.code!==h.code||r.previous_until!==h.until||!at(r.released_at)||r.reason!=='tested_collector_upgrade')fail('GSC_PIPELINE_RECOVERY_INVALID');
     recoveries.push({...exact,released:true});
    }else{
     if(r.reason!=='already_retried')fail('GSC_PIPELINE_RECOVERY_INVALID');
     recoveries.push({...exact,released:false,reason:'already_retried'});
    }
   }
   status=await read();
   return respond(true,{recovery_candidates:recoveries.length,released_scopes:recoveries.filter(r=>r.released).length,recoveries});
  }
  if(mode==='collect'){
   const attempts=[];
   for(let n=0;n<(body.ticks as number);n++){
    // No Cron source or scheduled_at: these are explicitly manual diagnostic ticks.
    const response=await env.ARCHIVE.fetch('https://archive.private/api/internal/gsc-tick',{method:'POST'});
    if(!response.ok){await response.body?.cancel();fail('GSC_PIPELINE_TICK_UNAVAILABLE');}
    let r:any;try{r=await response.json();}catch{fail('GSC_PIPELINE_TICK_INVALID');}
    if(!object(r)||r.d1_requests!==0||!['partial','complete','held','idle'].includes(r.status as string)||r.day!==undefined&&!day(r.day)||r.scope!==undefined&&!scope(r.scope)||r.rows!==undefined&&!count(r.rows)||r.cursor!==undefined&&!count(r.cursor)||r.code!==undefined&&!code(r.code))fail('GSC_PIPELINE_TICK_INVALID');
    attempts.push({status:r.status,day:r.day,scope:r.scope,rows:r.rows,cursor:r.cursor,code:r.code,d1_requests:0});
    if(r.status==='held'||r.status==='idle')break;
   }
   status=await read();return respond(true,{manual_ticks:attempts.length,attempts});
  }
  const readbacks=[];
  const seen=new Set<string>();
  const selectedProof=status.coverage[body.index as number];
  if(!selectedProof)fail('GSC_PIPELINE_PROOF_SOURCE_INVALID');
  for(const item of [selectedProof]){
   if(!day(item.day)||seen.has(item.day+':'+item.scope))fail('GSC_PIPELINE_PROOF_SOURCE_INVALID');seen.add(item.day+':'+item.scope);
   const response=await env.ARCHIVE.fetch('https://archive.private/api/internal/gsc-proof?day='+item.day+'&scope='+item.scope);
   if(!response.ok){await response.body?.cancel();fail('GSC_PIPELINE_PROOF_UNAVAILABLE');}
   let r:any;try{r=await response.json();}catch{fail('GSC_PIPELINE_PROOF_INVALID');}
   if(!object(r)||r.available!==true||r.verified!==true||r.day!==item.day||r.scope!==item.scope||r.d1_requests!==0||!count(r.rows)||r.rows!==item.rows||!count(r.pages)||r.rows>0&&r.pages===0)fail('GSC_PIPELINE_PROOF_INVALID');
   readbacks.push({available:true,verified:true,day:r.day,scope:r.scope,rows:r.rows,pages:r.pages,d1_requests:0});
  }
  return respond(true,{readbacks,content_verified_scopes:readbacks.length,nonempty_content_scopes:readbacks.filter(r=>r.rows>0).length});
 }catch(error){
  return respond(false,{code:error instanceof ProbeError?error.code:'GSC_PIPELINE_UNAVAILABLE'},error instanceof ProbeError?error.status:503);
 }
}};
