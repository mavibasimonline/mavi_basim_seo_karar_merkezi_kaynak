// Loopback-only release probe. All owner credentials stay inside Cloudflare.
import type {Env} from '../src/types';
interface Probe extends Env{RELEASE_PROBE_KEY:string;REPORTS:Fetcher;LIVE_APP:Fetcher}
const ORIGIN='https://mavi-basim-seo-prod.mavibasimonline.workers.dev';
export default {async fetch(request:Request,env:Probe){
 if(request.headers.get('Authorization')!=='Bearer '+env.RELEASE_PROBE_KEY)return new Response(null,{status:404});
 const path=new URL(request.url).pathname;
 if(path==='/health')return Response.json({ok:true,admin_configured:!!env.ADMIN_TOKEN});
 if(path==='/warm'){
  const response=await env.REPORTS.fetch('https://monthly-store.internal/refresh-now',{method:'POST'});return response;
 }
 if(path==='/blocked-refresh')return env.REPORTS.fetch('https://monthly-store.internal/refresh-now',{method:'POST',headers:{'X-Snapshot-Background':'true'}});
 if(path==='/activate')return env.REPORTS.fetch('https://monthly-store.internal/activate',{method:'POST'});
 if(path==='/cache-health')return env.REPORTS.fetch('https://monthly-store.internal/health');
 if(path==='/accept'){
  const checks:any[]=[];let julyId:string|null=null;
  for(const month of ['2026-07','2026-08','2026-09']){
   const r=await env.LIVE_APP.fetch(ORIGIN+'/api/report?month='+month,{headers:{Authorization:'Bearer '+env.ADMIN_TOKEN}});const b=await r.json<any>();
   checks.push({path:'/api/report',month,status:r.status,verified:b.snapshot?.verified===true,d1_requests:b.snapshot?.d1_requests??null,source_updated_at:b.snapshot?.source_updated_at||null,gsc_days:b.sources?.gsc_coverage_days??null,products:b.products?.length??null,missing:b.missing?.length??null});if(month==='2026-07')julyId=b.id||null;
  }
  for(const path of ['/api/status','/api/performance?month=2026-09']){
   const r=await env.LIVE_APP.fetch(ORIGIN+path,{headers:{Authorization:'Bearer '+env.ADMIN_TOKEN}});const b=await r.json<any>();checks.push({path,status:r.status,d1_requests:b.snapshot?.d1_requests??null});
  }
  let previous:string|undefined;
  for(const question of ['Broşür Ağustos 2026 performansı nedir?','Peki mobilde?']){
   const r=await env.LIVE_APP.fetch(ORIGIN+'/api/questions',{method:'POST',headers:{Authorization:'Bearer '+env.ADMIN_TOKEN,Origin:ORIGIN,'Content-Type':'application/json'},body:JSON.stringify({question,month:'2026-08',...(previous?{previous_question_id:previous}:{})})});const b=await r.json<any>();previous=b.question_id;
   checks.push({path:'/api/questions',status:r.status,has_context:!!b.context?.product_id,has_measured_metrics:!!b.current&&!!b.previous,has_evidence:Array.isArray(b.evidence)&&b.evidence.length>0,d1_requests:b.snapshot?.d1_requests??null,device:b.context?.device||null});
  }
  const none=await env.LIVE_APP.fetch(ORIGIN+'/api/report?month=2020-01',{headers:{Authorization:'Bearer '+env.ADMIN_TOKEN}});const empty=await none.json<any>();
  const unsupported={status:none.status,code:empty.code||null};
  const passed=checks.every(c=>c.status===200&&c.d1_requests===0)&&checks.slice(0,3).every(c=>c.verified&&c.source_updated_at&&c.gsc_days>=30)&&checks.slice(-2).every(c=>c.has_context&&c.has_measured_metrics&&c.has_evidence)&&none.status===503;
  return Response.json({passed,checks,unsupported,july_id:julyId});
 }
 return new Response(null,{status:404});
}};
