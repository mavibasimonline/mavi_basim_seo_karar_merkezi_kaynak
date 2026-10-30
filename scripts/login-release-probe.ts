// Temporary private acceptance; no credential or cookie is returned to the runner.
import worker from '../.local/login-release-source/src/index';
import type {Env} from '../src/types';
interface Probe extends Env { RELEASE_PROBE_KEY:string; LIVE_APP:Fetcher }
const ORIGIN='https://mavi-basim-seo-prod.mavibasimonline.workers.dev';
function measuredDatabase(db:D1Database,trace:{auth:number;guard:number;reads:number;known:boolean}){
 const raw=new WeakMap<object,{statement:D1PreparedStatement;sql:string}>();
 function record(sql:string,result:any){const m=result.meta;if(!Number.isSafeInteger(m?.rows_written)||!Number.isSafeInteger(m?.rows_read)){trace.known=false;return;}trace[sql.includes('auth_attempts')?'auth':'guard']+=m.rows_written;trace.reads+=m.rows_read;}
 function wrap(sql:string,s:D1PreparedStatement):any{
  const p={bind(...values:unknown[]){return wrap(sql,s.bind(...values));},async all(){const r=await s.all();record(sql,r);return r;},async run(){const r=await s.run();record(sql,r);return r;},async first(column?:string){const r=await s.all();record(sql,r);return column?r.results[0]?.[column]??null:r.results[0]??null;}};
  raw.set(p,{statement:s,sql});return p;
 }
 return {prepare(sql:string){return wrap(sql,db.prepare(sql));},async batch(statements:D1PreparedStatement[]){const items=statements.map(s=>raw.get(s));if(items.some(v=>!v))throw Error('PROBE_UNWRAPPED_STATEMENT');const result=await db.batch(items.map(v=>v!.statement));result.forEach((r,i)=>record(items[i]!.sql,r));return result;}} as unknown as D1Database;
}
export default {async fetch(request:Request,env:Probe){
 if(request.headers.get('Authorization')!=='Bearer '+env.RELEASE_PROBE_KEY)return new Response(null,{status:404});
 const mode=new URL(request.url).pathname;
 if(mode==='/health')return Response.json({ready:true,admin_configured:!!env.ADMIN_TOKEN});
 const sessionRequest=()=>new Request(ORIGIN+'/api/session',{method:'POST',headers:{Origin:ORIGIN,'Content-Type':'application/json',...(request.headers.get('CF-Connecting-IP')?{'CF-Connecting-IP':request.headers.get('CF-Connecting-IP')!}:{})},body:JSON.stringify({token:env.ADMIN_TOKEN})});
 if(mode==='/measure'){
  const day=new Date().toISOString().slice(0,10),before=await env.DB.prepare('SELECT writes FROM d1_quota_ledger WHERE day=?').bind(day).first<{writes:number}>();
  const trace={auth:0,guard:0,reads:0,known:true};
  const r=await worker.fetch(sessionRequest(),{...env,DB:measuredDatabase(env.DB,trace)});
  const after=await env.DB.prepare('SELECT writes FROM d1_quota_ledger WHERE day=?').bind(day).first<{writes:number}>();
  const body=await r.json<any>(),physical=trace.auth+trace.guard;
  return Response.json({status:r.status,code:body.code||null,reason:body.reason||null,cookie_issued:!!r.headers.get('Set-Cookie'),auth_rows_written:trace.auth,bookkeeping_rows_written:trace.guard,physical_rows_written:physical,physical_rows_read:trace.reads,ledger_charge:(after?.writes||0)-(before?.writes||0),metadata_known:trace.known});
 }
 if(mode==='/accept'){
  const request=sessionRequest(),login=await env.LIVE_APP.fetch(request);
  const body=await login.json<any>(),cookie=login.headers.get('Set-Cookie')?.split(';')[0];
  const checks:any[]=[{path:'/api/session',status:login.status,code:body.code||null,reason:body.reason||null}];
  if(login.status!==200||!cookie)return Response.json({checks,passed:false});
  for(const path of ['/api/status','/api/performance?month=2026-09']){
   const r=await env.LIVE_APP.fetch(ORIGIN+path,{headers:{Cookie:cookie,'User-Agent':'MaviBasimReleaseCheck/1.0','Accept':'application/json'}});const b=await r.json<any>();
   checks.push({path,status:r.status,code:b.code||null,reason:b.reason||null});if(r.status!==200)break;
  }
  return Response.json({checks,passed:checks.length===3&&checks.every(c=>c.status===200)});
 }
 return new Response(null,{status:404});
}};
