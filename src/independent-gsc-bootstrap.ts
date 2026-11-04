// One bounded initial history plan. Every row still comes directly from GSC;
// only job-control keys are isolated from the operational daily queue.
import {recoveryCode} from './independent-recovery';
import {IndependentGscCollector,GscStorage,DailyProof,GSC_BOOTSTRAP_STORAGE_LIMIT} from './independent-gsc';
type Scope='page'|'query';
type Target={day:string;scope:Scope};
type Plan={version:1;created_at:string;months:string[];targets:Target[];index:number};
const PLAN='gsc:bootstrap:plan:v1',PREFIX='gsc:bootstrap:control:',LAST='gsc:bootstrap:last';
function need(ok:unknown):asserts ok{if(!ok)throw Error('GSC_BOOTSTRAP_PLAN_INVALID');}
function targets(months:string[]){return months.flatMap(month=>Array.from({length:new Date(Date.UTC(Number(month.slice(0,4)),Number(month.slice(5,7)),0)).getUTCDate()},(_,i)=>month+'-'+String(i+1).padStart(2,'0')).flatMap(day=>(['page','query'] as Scope[]).map(scope=>({day,scope}))));}
function newPlan(time:Date):Plan{
 const latest=new Date(time.getTime()-3*86400000);latest.setUTCDate(1);latest.setUTCHours(0,0,0,0);latest.setUTCMonth(latest.getUTCMonth()-1);
 const prior=new Date(latest);prior.setUTCMonth(prior.getUTCMonth()-1);
 const months=[latest.toISOString().slice(0,7),prior.toISOString().slice(0,7)];
 return {version:1,created_at:time.toISOString(),months,targets:targets(months),index:0};
}
async function planOf(storage:GscStorage,time:Date){
 const plan=await storage.get<Plan>(PLAN);
 if(!plan){const initial=newPlan(time);await storage.put(PLAN,initial);return initial;}
 need(plan.version===1&&Array.isArray(plan.months)&&plan.months.length===2&&plan.months.every(m=>/^20\d\d-(0[1-9]|1[0-2])$/.test(m))&&Number.isFinite(Date.parse(plan.created_at)));
 need(JSON.stringify(plan.months)===JSON.stringify(newPlan(new Date(plan.created_at)).months)&&Date.parse(plan.created_at)<=time.getTime()+300000);
 need(JSON.stringify(plan.targets)===JSON.stringify(targets(plan.months))&&Number.isSafeInteger(plan.index)&&plan.index>=0&&plan.index<=plan.targets.length&&plan.targets.length<=124);
 return plan;
}
function scoped(storage:GscStorage,target:Target):GscStorage{
 const prefix=PREFIX+target.day+':'+target.scope+':';
 const key=(value:string)=>/^gsc:(daily:|history:|part:|seen:|storage-budget:v1$)/.test(value)?value:prefix+value;
 return {get:async<T>(name:string)=>storage.get<T>(key(name)),put:async(name:string,value:unknown)=>storage.put(key(name),value),...(storage.sql?{sql:storage.sql}:{})} as GscStorage;
}
function saved(p:DailyProof|undefined,t:Target){return !!p&&p.day===t.day&&p.scope===t.scope&&p.source==='GSC Search Analytics API'&&p.d1_requests===0&&Number.isSafeInteger(p.rows)&&p.rows>=0&&typeof p.query_partial==='boolean'&&Array.isArray(p.page_proofs)&&p.pages===p.page_proofs.length&&p.pages>0&&(t.scope==='query'||!p.query_partial);}
export async function gscBootstrapStatus(storage:GscStorage){
 const plan=await storage.get<Plan>(PLAN),budget=await storage.get<{bootstrap_reserved_bytes?:number}>('gsc:storage-budget:v1');
 return {initialized:!!plan,months:plan?.months||[],completed_scopes:plan?.index||0,total_scopes:plan?.targets.length||0,plan_complete:!!plan&&plan.index===plan.targets.length,
  next:plan?.targets[plan.index]||null,last_attempt:await storage.get(LAST)||null,
  storage_reserved_bytes:budget?.bootstrap_reserved_bytes||0,storage_limit_bytes:GSC_BOOTSTRAP_STORAGE_LIMIT,
  source:'GSC Search Analytics API',d1_requests:0,query_partial:true,manual_csv_required:false};
}
export async function runGscBootstrapTick(storage:GscStorage,secret:string,token:(force:boolean)=>Promise<string>,fetcher:typeof fetch=fetch,time=new Date()){
 const plan=await planOf(storage,time);
 const globalRetry=await storage.get<{until:number}>('gsc:retry');
 if(globalRetry&&globalRetry.until>time.getTime())return {status:'held',code:'GSC_RETRY_BACKOFF',d1_requests:0};
 // Scope pointers are only skipped; verified historical generations are never
 // replaced by this initial plan. A final month readback verifies all chunks.
 while(plan.index<plan.targets.length&&saved(await storage.get<DailyProof>('gsc:daily:'+plan.targets[plan.index].day+':'+plan.targets[plan.index].scope),plan.targets[plan.index]))plan.index++;
 await storage.put(PLAN,plan);
 if(plan.index===plan.targets.length)return {status:'idle',plan_complete:true,d1_requests:0};
 const target=plan.targets[plan.index],lag=(Date.parse(time.toISOString().slice(0,10))-Date.parse(target.day))/86400000;
 need(lag>=3&&lag<=400);
 const held=await storage.get<{until:number;code:string}>('gsc:held:'+target.day+':'+target.scope);
 if(held&&held.until>time.getTime()){
  if(!['GSC_SYNC_UNAVAILABLE','GSC_HTTP_400','GSC_AGGREGATION_INVALID','GSC_ROW_REJECTED','GSC_DUPLICATE_ROW'].includes(recoveryCode(held.code) as string))return {status:'held',day:target.day,scope:target.scope,code:held.code,d1_requests:0};
  const proof=await storage.get<{at:string;ok:boolean;readback_verified:boolean;revision:string;rows?:number;cursor?:number}>('gsc:diagnostic:last');
  if(!proof||!proof.ok||!proof.readback_verified||proof.revision!=='daily-proof-v2'||!(proof.rows||proof.cursor)||!Number.isFinite(Date.parse(proof.at))||time.getTime()-Date.parse(proof.at)<0||time.getTime()-Date.parse(proof.at)>30*60000)return {status:'held',day:target.day,scope:target.scope,code:'GSC_BOOTSTRAP_DIAGNOSTIC_REQUIRED',d1_requests:0};
 }
 const job=scoped(storage,target);
 if(!await job.get('gsc:active'))await job.put('gsc:active',{...target,generation:crypto.randomUUID(),cursor:0,pages:[],started_at:time.toISOString(),attempts:0,incomplete:false});
 const result=await new IndependentGscCollector(job,secret,token,fetcher,'bootstrap').tick(time);
 if(result.status==='complete'){
  if(saved(await storage.get<DailyProof>('gsc:daily:'+target.day+':'+target.scope),target)){plan.index++;await storage.put(PLAN,plan);}
  else{await job.put('gsc:retry',{until:time.getTime()+6*3600000});await storage.put(LAST,{at:time.toISOString(),...target,status:'held',code:'GSC_BOOTSTRAP_SOURCE_INCOMPLETE'});return {status:'held',...target,code:'GSC_BOOTSTRAP_SOURCE_INCOMPLETE',d1_requests:0};}
 }
 // Source rate/OAuth backoffs apply to both daily and historical collection.
 if(result.status==='held'&&typeof result.code==='string'&&(/^(GSC_HTTP_429|GSC_HTTP_5\d\d)$/.test(result.code)||result.code==='GSC_OAUTH_RECONNECT_REQUIRED')){
  const retry=await job.get<{until:number}>('gsc:retry'),failure=await job.get('gsc:last-failure');
  if(retry)await storage.put('gsc:retry',retry);if(failure)await storage.put('gsc:last-failure',failure);
  if(result.code==='GSC_OAUTH_RECONNECT_REQUIRED')await storage.put('gsc:oauth-reconnect',{at:time.toISOString()});
 }
 await storage.put(LAST,{at:time.toISOString(),...result});
 return {...result,completed_scopes:plan.index,total_scopes:plan.targets.length,plan_complete:plan.index===plan.targets.length};
}
