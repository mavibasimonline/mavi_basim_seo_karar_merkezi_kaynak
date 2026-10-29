/** Loopback-only CI importer. It never handles production owner/OAuth secrets. */
import {boundedText} from './google';
import {withReadBudget,D1BudgetError} from './d1-read-budget';
import {Env} from './types';
import {equalSecret} from './security';
import {importEvidence,KIND} from './sheets-recovery';

interface PilotEnv extends Env {RECOVERY_KEY:string}
export default {async fetch(request:Request,env:PilotEnv){
 if(!env.RECOVERY_KEY||!await equalSecret(request.headers.get('Authorization')||'','Bearer '+env.RECOVERY_KEY))return new Response(null,{status:404});
 const url=new URL(request.url);
 if(request.method==='GET'&&url.pathname==='/health')return Response.json({ready:true});
 try{
  if(request.method==='GET'&&url.pathname==='/keys'){
   const after=url.searchParams.get('after')||'';
   if(after&&!/^[a-f0-9]{64}$/.test(after))throw Error('RECOVERY_KEY_REJECTED');
   return Response.json(await withReadBudget(env,'cron',async safe=>(await safe.DB.prepare("SELECT source_key FROM insight_runs WHERE kind=? AND source_key>? ORDER BY source_key LIMIT 500").bind(KIND,after).all()).results));
  }
  if(request.method==='POST'&&url.pathname==='/apply')return Response.json(await importEvidence(env,JSON.parse(await boundedText(new Response(request.body),1_000_000))));
  return new Response(null,{status:404});
 }catch(error){
  if(error instanceof D1BudgetError)return Response.json({held:true,code:error.code,reason:error.reason,inserted:0,daily_jobs_completed:0},{status:429});
  const code=error instanceof Error&&/^RECOVERY_[A-Z_]+$/.test(error.message)?error.message:'RECOVERY_FAILED_NO_RETRY';
  return Response.json({code},{status:503});
 }
}};
