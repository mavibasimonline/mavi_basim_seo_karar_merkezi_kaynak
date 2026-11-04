// Private, revision-scoped real collector probe. It never edits the operational
// queue, held scopes or verified daily/history pointers and never accesses D1.
import {IndependentGscCollector,GscStorage,GscPhase} from './independent-gsc';
import {decrypt} from './security';
export const GSC_DIAGNOSTIC_REVISION='daily-proof-v2';
const PREFIX='gsc:diagnostic:'+GSC_DIAGNOSTIC_REVISION+':',LAST='gsc:diagnostic:last';
const phases=new Set<GscPhase>(['authorization','provider','response','validation','storage','publication']);
type Failure={at?:string;code?:string;phase?:GscPhase;validation_reason?:string;day?:string;scope?:'page'|'query';cursor?:number};
export type GscDiagnostic={at:string;revision:typeof GSC_DIAGNOSTIC_REVISION;status:string;ok:boolean;readback_verified:boolean;day?:string;scope?:'page'|'query';rows?:number;cursor?:number;code?:string;phase?:GscPhase;last_failure:Failure|null;d1_requests:0};
const code=(value:unknown)=>typeof value==='string'&&/^GSC_[A-Z0-9_]{1,80}$/.test(value)?value:undefined;
const count=(value:unknown):value is number=>Number.isSafeInteger(value)&&Number(value)>=0&&Number(value)<=50000;
function failure(value:unknown):Failure|null{
 if(!value||typeof value!=='object')return null;
 const raw=value as Record<string,unknown>,safe:Failure={};
 if(typeof raw.at==='string'&&Number.isFinite(Date.parse(raw.at)))safe.at=new Date(raw.at).toISOString();
 if(code(raw.code))safe.code=code(raw.code);
 if(phases.has(raw.phase as GscPhase))safe.phase=raw.phase as GscPhase;
 if(typeof raw.day==='string'&&/^20\d\d-\d\d-\d\d$/.test(raw.day))safe.day=raw.day;
 if(raw.scope==='page'||raw.scope==='query')safe.scope=raw.scope;
 if(count(raw.cursor))safe.cursor=raw.cursor;
 if(typeof raw.validation_reason==='string'&&/^(DATE|PAGE_PROPERTY_SCOPE|PAGE_ORIGIN|COUNTRY|DEVICE|METRIC_NUMBER|COUNTS|METRIC_RANGE|CTR_RATIO|QUERY)$/.test(raw.validation_reason))safe.validation_reason=raw.validation_reason;
 return safe;
}
function namespace(storage:GscStorage):GscStorage{
 const keyFor=(key:string)=>key==='gsc:storage-budget:v1'?key:PREFIX+key;
 return {get:async<T>(key:string)=>storage.get<T>(keyFor(key)),put:async(key:string,value:unknown)=>storage.put(keyFor(key),value),...(storage.sql?{sql:storage.sql}:{})} as GscStorage;
}
async function readback(storage:GscStorage,secret:string,result:{status:string;day?:string;scope?:string}){
 if(!result.day||(result.scope!=='page'&&result.scope!=='query'))return false;
 const proof=await storage.get<any>(result.status==='complete'?'gsc:daily:'+result.day+':'+result.scope:'gsc:active');
 const parts=result.status==='complete'?proof?.page_proofs:proof?.pages,p=Array.isArray(parts)?parts.at(-1):null;
 if(!proof||proof.day!==result.day||proof.scope!==result.scope||typeof proof.generation!=='string'||!/^([a-zA-Z0-9_-]{1,80})$/.test(proof.generation)||!p
  ||!Number.isSafeInteger(p.index)||p.index<0||p.index>=250||!Number.isSafeInteger(p.bytes)||p.bytes<2||p.bytes>460000||!Number.isSafeInteger(p.count)||p.count<0||p.count>200
  ||!Number.isSafeInteger(p.chunks)||p.chunks!==Math.ceil(p.bytes/36000)||p.chunks<1||p.chunks>20||typeof p.sha256!=='string'||!/^[a-f0-9]{64}$/.test(p.sha256))return false;
 const bytes=new Uint8Array(p.bytes);let offset=0;
 for(let i=0;i<p.chunks;i++){
  const sealed=await storage.get<string>('gsc:part:'+proof.day+':'+proof.scope+':'+proof.generation+':'+p.index+':'+i);
  if(typeof sealed!=='string'||sealed.length>66000)return false;
  const part=await decrypt<{chunk:string}>(sealed,secret);
  if(typeof part?.chunk!=='string'||part.chunk.length>48000)return false;
  const data=Uint8Array.from(atob(part.chunk),c=>c.charCodeAt(0));
  if(data.length!==Math.min(36000,bytes.length-offset))return false;bytes.set(data,offset);offset+=data.length;
 }
 const digest=[...new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))].map(n=>n.toString(16).padStart(2,'0')).join('');
 if(offset!==p.bytes||digest!==p.sha256)return false;
 const rows=JSON.parse(new TextDecoder('utf-8',{fatal:true,ignoreBOM:false}).decode(bytes));
 return Array.isArray(rows)&&rows.length===p.count;
}
export async function runGscDiagnostic(storage:GscStorage,keySecret:string,token:(force:boolean)=>Promise<string>,fetcher:typeof fetch=fetch,time=new Date()):Promise<GscDiagnostic&{cached?:boolean}>{
 const saved=await storage.get<GscDiagnostic>(LAST),age=saved?time.getTime()-Date.parse(saved.at):Infinity;
 if(saved&&saved.revision===GSC_DIAGNOSTIC_REVISION&&typeof saved.ok==='boolean'&&['complete','partial','held','idle'].includes(saved.status)
  &&Number.isFinite(age)&&age>=0&&age<(saved.ok?30*60000:5*60000))return {...saved,cached:true};
 const scoped=namespace(storage);let raw:{status:string;day?:string;scope?:string;rows?:number;cursor?:number;code?:string},caught:Failure|null=null;
 // An explicitly observed account/source quota backoff remains authoritative.
 // Unknown legacy holds alone must not hide the upgraded collector's failure.
 const [globalRetry,globalFailure]=await Promise.all([storage.get<{until:number}>('gsc:retry'),storage.get<{code?:string}>('gsc:last-failure')]);
 if(globalRetry&&globalRetry.until>time.getTime()&&globalFailure?.code&&(/^(GSC_HTTP_429|GSC_HTTP_5\d\d)$/.test(globalFailure.code)||['GSC_STORAGE_DAILY_LIMIT','GSC_STORAGE_TOTAL_LIMIT','GSC_STORAGE_OBJECT_LIMIT','GSC_OAUTH_RECONNECT_REQUIRED'].includes(globalFailure.code)))raw={status:'held',code:globalFailure.code};
 else try{raw=await new IndependentGscCollector(scoped,keySecret,token,fetcher).tick(time);}
 catch{raw={status:'held',code:'GSC_STORAGE_UNAVAILABLE'};caught={at:time.toISOString(),phase:'storage',code:'GSC_STORAGE_UNAVAILABLE'};}
 let verified=false;
 if(raw.status==='complete'||raw.status==='partial')try{verified=await readback(scoped,keySecret,raw);}catch{/* No provider payload or native exception leaves this boundary. */}
 const lastFailure=caught||failure(await scoped.get('gsc:last-failure'));
 const result:GscDiagnostic={at:time.toISOString(),revision:GSC_DIAGNOSTIC_REVISION,status:raw.status,ok:verified,readback_verified:verified,last_failure:lastFailure,d1_requests:0};
 if(typeof raw.day==='string'&&/^20\d\d-\d\d-\d\d$/.test(raw.day))result.day=raw.day;
 if(raw.scope==='page'||raw.scope==='query')result.scope=raw.scope;
 if(count(raw.rows))result.rows=raw.rows;if(count(raw.cursor))result.cursor=raw.cursor;
 if(code(raw.code))result.code=code(raw.code);
 if(lastFailure?.phase)result.phase=lastFailure.phase;
 if((raw.status==='complete'||raw.status==='partial')&&!verified){result.ok=false;result.status='held';result.code='GSC_DIAGNOSTIC_READBACK_REJECTED';result.phase='storage';}
 await storage.put(LAST,result);
 return result;
}
