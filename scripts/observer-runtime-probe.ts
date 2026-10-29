// Temporary CI/edge diagnostic. Production observation is intercepted BEFORE
// its upsert; the only D1 operation permitted here is one primary-key SELECT.
import {observeQuota,CHECKPOINT_SQL,ObserverEnv} from '../src/quota-observer';
interface ProbeEnv extends ObserverEnv {PROBE_KEY:string}
export default {async fetch(request:Request,env:ProbeEnv){
 if(request.headers.get('Authorization')!=='Bearer '+env.PROBE_KEY)return new Response(null,{status:404});
 const trace:Record<string,unknown>={read_only:true,checkpoint_write_executed:false};
 const fetcher:typeof fetch=async(input,init)=>{
  const url=String(input),stage=url==='https://mavi-basim-seo-prod.mavibasimonline.workers.dev/api/health'?'health':url==='https://api.cloudflare.com/client/v4/graphql'?'analytics':null;
  if(!stage)throw Error('PROBE_UNEXPECTED_DESTINATION');
  trace.last_stage=stage;
  try{
   const response=await fetch(input,init);
   trace[stage+'_http_status']=response.status;
   if(!response.ok){
    const reader=response.clone().body?.getReader();let bytes=0,text='';
    if(reader)try{for(;;){const part=await reader.read();if(part.done)break;bytes+=part.value.byteLength;if(bytes>4096)break;text+=new TextDecoder().decode(part.value);}}finally{await reader.cancel().catch(()=>{});}
    trace[stage+'_cloudflare_error']=text.match(/\b(1010|1042|1019|1102|1027)\b/)?.[1]??null;
   }
   return response;
  }catch(error){
   const message=error instanceof Error?error.message:'';
   trace[stage+'_exception_kind']=error instanceof TypeError?'TypeError':error instanceof DOMException?error.name:'Error';
   let safe=message;
   for(const secret of [env.CF_QUOTA_ANALYTICS_TOKEN,env.PROBE_KEY,env.CLOUDFLARE_ACCOUNT_ID])if(secret)safe=safe.split(secret).join('[REDACTED]');
   trace[stage+'_exception_detail']=safe.replace(/(?:Bearer\s+\S+|(?:cfat_|ghp_|github_pat_)[A-Za-z0-9_]+)/g,'[REDACTED]').slice(0,180);
   trace[stage+'_cross_script_error']=/1042|same zone|cross.script/i.test(message);
   throw error;
  }
 };
 const db={prepare(sql:string){
  if(sql!==CHECKPOINT_SQL)throw Error('PROBE_UNEXPECTED_SQL');
  trace.last_stage='checkpoint';trace.checkpoint_reached=true;
  return {bind(...values:unknown[]){return {async run(){
   const day=values[0];if(typeof day!=='string'||!/^20\d\d-\d\d-\d\d$/.test(day))throw Error('PROBE_INVALID_DAY');
   const r=await env.DB.prepare('SELECT day FROM d1_quota_state WHERE day=?').bind(day).all();
   trace.d1_read_success=r.success===true;trace.d1_rows_read=r.meta?.rows_read;
   trace.d1_rows_written=r.meta?.rows_written;
   throw Error('PROBE_READ_ONLY_STOP');
  }}}};
 }} as unknown as D1Database;
 const result=await observeQuota({...env,DB:db},fetcher);
 return Response.json({trace,result});
}};
