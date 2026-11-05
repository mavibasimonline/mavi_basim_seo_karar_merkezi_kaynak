// Extends the existing collector with a resumable plan; immutable proofs stay shared.
import {IndependentGscCollector,collectedGscProof} from './independent-gsc';
import {readVerifiedGscDay} from './independent-gsc-report';
import type {GscStorage,DailyProof} from './independent-gsc';
const MONTHS=['2026-06','2026-07','2026-08'],KEY='gsc:catchup:v1';
const targets=MONTHS.flatMap(month=>Array.from({length:new Date(Date.UTC(Number(month.slice(0,4)),Number(month.slice(5)),0)).getUTCDate()},(_,i)=>month+'-'+String(i+1).padStart(2,'0')).flatMap(day=>['page','query'].map(scope=>({day,scope:scope as 'page'|'query'}))));
type Plan={index:number;created_at:string;last?:unknown};
export async function catchupStatus(storage:GscStorage){const p=await storage.get<Plan>(KEY);return {months:MONTHS,completed_scopes:p?.index||0,total_scopes:targets.length,complete:p?.index===targets.length,next:targets[p?.index||0]||null,last:p?.last||null,d1_requests:0};}
export async function catchupTick(storage:GscStorage,secret:string,token:(force:boolean)=>Promise<string>,time=new Date()){
 const p=await storage.get<Plan>(KEY)||{index:0,created_at:time.toISOString()};
 if(!Number.isSafeInteger(p.index)||p.index<0||p.index>targets.length)throw Error('GSC_CATCHUP_PLAN_INVALID');
 const backoff=await storage.get<{until:number}>('gsc:retry');if(backoff&&backoff.until>Date.now())return {status:'held',code:'GSC_RETRY_BACKOFF',d1_requests:0};
 while(p.index<targets.length){const target=targets[p.index],saved=await storage.get<DailyProof>('gsc:daily:'+target.day+':'+target.scope);
  if(!saved)break;
  const proof=await readVerifiedGscDay(storage,secret,target.day,target.scope,time,{maxChunkReads:256,maxRows:50000});
  if(!proof.verified||target.scope==='page'&&!collectedGscProof(saved,target.day,target.scope,time))break;p.index++;
 }
 await storage.put(KEY,p);if(p.index===targets.length)return {status:'idle',plan_complete:true,d1_requests:0};
 const target=targets[p.index],prefix='gsc:catchup:control:'+target.day+':'+target.scope+':';
 const map=(k:string)=>/^gsc:(daily:|history:|part:|seen:|storage-budget:v1$)/.test(k)?k:prefix+k;
 const job={get:async<T>(k:string)=>storage.get<T>(map(k)),put:async(k:string,v:unknown)=>storage.put(map(k),v),...(storage.sql?{sql:storage.sql}:{})} as GscStorage;
 const retry=await job.get<{until:number}>('gsc:retry');if(retry&&retry.until>Date.now())return {status:'held',code:'GSC_CATCHUP_BACKOFF',day:target.day,scope:target.scope,d1_requests:0};
 if(!await job.get('gsc:active'))await job.put('gsc:active',{...target,generation:crypto.randomUUID(),cursor:0,pages:[],started_at:time.toISOString(),attempts:0,incomplete:false});
 const active=await storage.get<{day:string;scope:string}>('gsc:active');
 const result=active?.day===target.day&&active.scope===target.scope?await new IndependentGscCollector(storage,secret,token).tick(time):await new IndependentGscCollector(job,secret,token,fetch,'bootstrap',1000).tick(time);
 if(result.status==='complete'){const proof=await readVerifiedGscDay(storage,secret,target.day,target.scope,time,{maxChunkReads:256,maxRows:50000});if(proof.verified)p.index++;else return {status:'held',code:'GSC_CATCHUP_SOURCE_INCOMPLETE',day:target.day,scope:target.scope,d1_requests:0};}
 if(result.status==='held'&&typeof result.code==='string'&&/^(GSC_HTTP_429|GSC_HTTP_5\d\d|GSC_OAUTH_RECONNECT_REQUIRED)$/.test(result.code)){const hold=await job.get('gsc:retry');if(hold)await storage.put('gsc:retry',hold);}
 p.last={...result,at:time.toISOString()};await storage.put(KEY,p);return {...result,completed_scopes:p.index,total_scopes:targets.length,plan_complete:p.index===targets.length};
}
