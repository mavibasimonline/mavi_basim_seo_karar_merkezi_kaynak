// Loopback-only operator. Uses the existing application routes and real D1 guard.
// Never included in the production entry point or deployed.
import application from '../src/index';
import {Env,json} from '../src/types';

type Invoke=(request:Request,env:Env)=>Promise<Response>;
export function createOperator(invoke:Invoke=(request,env)=>application.fetch(request,env)){
  let used=false;
  return {async fetch(request:Request,env:Env){
    const url=new URL(request.url);
    if(!['127.0.0.1','localhost'].includes(url.hostname))return json({error:'LOCAL_ONLY'},403);
    if(url.pathname==='/health'&&request.method==='GET')return json({ok:true});
    if(!env.ADMIN_TOKEN||request.headers.get('Authorization')!=='Bearer '+env.ADMIN_TOKEN)return json({error:'UNAUTHORIZED'},401);
    if(url.pathname!=='/refresh'||request.method!=='POST'||url.search)return json({error:'NOT_FOUND'},404);
    if(env.D1_READ_GUARD_ENABLED!=='true'||env.SITE_ORIGIN!=='https://mavibasim.com')return json({error:'GUARD_REQUIRED'},409);
    if(used)return json({error:'ALREADY_ATTEMPTED'},409);
    used=true;
    const payload:Record<string,unknown>={report_attempts:0,kpi_attempts:0};
    for(const [kind,path] of [['report','/api/report'],['kpi','/api/performance']] as const){
      payload[kind+'_attempts']=1;
      const response=await invoke(new Request('http://127.0.0.1'+path+'?month=2026-09&device=ALL&rangeMonths=1',{
        headers:{Authorization:'Bearer '+env.ADMIN_TOKEN}}),env);
      if(response.status!==200)return json({...payload,error:'APPLICATION_'+kind.toUpperCase()+'_REJECTED',http_status:response.status},409);
      const result=await response.json() as {period?:{start:string;end:string};filters?:{device:unknown};device?:unknown;missing?:string[];products?:{decision:string}[]};
      if(result.period?.start!=='2026-09-01'||result.period?.end!=='2026-09-30')return json({...payload,error:'WRONG_PERIOD'},409);
      if(kind==='report'&&(!Array.isArray(result.missing)||result.filters?.device!==null||
        (result.missing.length>0&&!result.products?.every(p=>p.decision==='Veri bekle'))))return json({...payload,error:'REPORT_EVIDENCE_GATE'},409);
      if(kind==='kpi'&&result.device!==null)return json({...payload,error:'WRONG_DEVICE'},409);
      payload[kind]=result;
    }
    return json(payload);
  }};
}
export default createOperator();
