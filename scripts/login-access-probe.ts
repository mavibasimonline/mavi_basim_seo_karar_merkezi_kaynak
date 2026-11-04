// Ephemeral account-only acceptance. Inherit the existing secret inside Workers;
// never return credentials, cookies, source rows or a reusable authenticated URL.
interface AccessProbe {ADMIN_TOKEN?:string;PROBE_KEY:string;LIVE_APP:Fetcher}
const ORIGIN='https://mavi-basim-seo-prod.mavibasimonline.workers.dev';
export default {async fetch(request:Request,env:AccessProbe){
 if(!env.PROBE_KEY||request.headers.get('Authorization')!=='Bearer '+env.PROBE_KEY)return new Response(null,{status:404});
 const path=new URL(request.url).pathname;
 if(path==='/health')return Response.json({ready:true,admin_configured:!!env.ADMIN_TOKEN});
 if(path!=='/accept'||request.method!=='POST')return new Response(null,{status:404});
 try{
  if(!env.ADMIN_TOKEN)throw Error('LOGIN_ACCESS_SECRET_UNAVAILABLE');
  const login=await env.LIVE_APP.fetch(new Request(ORIGIN+'/api/session',{method:'POST',headers:{Origin:ORIGIN,'Content-Type':'application/json',...(request.headers.get('CF-Connecting-IP')?{'CF-Connecting-IP':request.headers.get('CF-Connecting-IP')!}:{})},body:JSON.stringify({token:env.ADMIN_TOKEN})}));
  const header=login.headers.get('Set-Cookie')||'',cookie=header.split(';')[0];
  if(login.status!==200||!header.includes('HttpOnly; Secure; SameSite=Strict')||!cookie.startsWith('mavi_session='))throw Error('LOGIN_ACCESS_SESSION_FAILED');
  await login.body?.cancel();
  const access=await env.LIVE_APP.fetch(ORIGIN+'/api/session',{headers:{Cookie:cookie}}),session=await access.json<any>();
  if(access.status!==200||session.ok!==true||session.landing!=='/independent-seo.html')throw Error('LOGIN_ACCESS_DESTINATION_INVALID');
  const status=await env.LIVE_APP.fetch(ORIGIN+'/api/independent/gsc-status',{headers:{Cookie:cookie}}),gsc=await status.json<any>();
  if(status.status!==200||gsc.d1_requests!==0||!Array.isArray(gsc.coverage))throw Error('LOGIN_ACCESS_GSC_UNAVAILABLE');
  const report=await env.LIVE_APP.fetch(ORIGIN+'/api/independent/gsc-analysis?month=2026-10',{headers:{Cookie:cookie}}),analysis=await report.json<any>();
  if(report.status!==200||analysis.available!==true||analysis.source!=='GSC Search Analytics API'||analysis.d1_requests!==0)throw Error('LOGIN_ACCESS_ANALYSIS_UNAVAILABLE');
  const logout=await env.LIVE_APP.fetch(ORIGIN+'/api/session/logout',{method:'POST',headers:{Cookie:cookie,Origin:ORIGIN},redirect:'manual'});
  if(logout.status!==303||logout.headers.get('Location')!=='/'||!logout.headers.get('Set-Cookie')?.includes('Max-Age=0'))throw Error('LOGIN_ACCESS_LOGOUT_FAILED');
  const denied=await env.LIVE_APP.fetch(ORIGIN+'/api/session');await denied.body?.cancel();
  if(denied.status!==401)throw Error('LOGIN_ACCESS_UNAUTHENTICATED_ACCESS');
  return Response.json({passed:true,secure_cookie:true,session_verified:true,landing:'/independent-seo.html',gsc_readable:true,analysis_readable:true,logout_verified:true,unauthenticated_status:401,legacy_data_requests:0,d1_requests:0});
 }catch(error){const code=error instanceof Error&&/^LOGIN_ACCESS_[A-Z0-9_]+$/.test(error.message)?error.message:'LOGIN_ACCESS_UNAVAILABLE';return Response.json({passed:false,code},{status:503});}
}};
