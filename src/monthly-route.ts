import {Env,json} from './types';
export function monthlyService(env:unknown){return (env as {MONTHLY_ANALYSES?:Fetcher}).MONTHLY_ANALYSES;}
export async function monthlyRoute(request:Request,env:Env):Promise<Response|null>{
 const service=monthlyService(env);if(!service)return null;
 const url=new URL(request.url),path=url.pathname,target=({'/api/report':'/report','/api/performance':'/performance','/api/status':'/status','/api/questions':'/questions','/api/export':'/export'} as Record<string,string>)[path];
 if(!target||request.method!==(path==='/api/questions'?'POST':'GET'))return null;
 const response=await service.fetch(new Request('https://monthly-store.internal'+target+url.search,{method:request.method,headers:{'Content-Type':'application/json'},body:request.method==='POST'?request.body:undefined,redirect:'manual'}));
 if(!response.ok){const headers=new Headers(response.headers);headers.set('Cache-Control','no-store');return new Response(response.body,{status:response.status,headers});}
 const body=await response.json<any>();
 if(path==='/api/status')body.deployment={runtime_revision:'gsc-catchup-v1',read_guard_revision:'d1-account-reads-v1',gsc_validation_revision:'owned-url-variants-v2',version_id:env.CF_VERSION_METADATA?.id||null,commit:env.CF_VERSION_METADATA?.tag||null};
 const result=json(body);if(path==='/api/export'){result.headers.set('Content-Disposition',`attachment; filename="mavi-seo-${String(body.month).replace(/[^0-9-]/g,'_')}.json"`);}return result;
}
