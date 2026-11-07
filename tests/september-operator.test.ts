import {beforeEach,expect,it} from 'vitest';
import {createOperator} from '../scripts/september-refresh-operator';
import {env,init} from './helpers';
import {Env} from '../src/types';
beforeEach(init);
const cfg=()=>({...env,SITE_ORIGIN:'https://mavibasim.com',D1_READ_GUARD_ENABLED:'true'});
function request(path='/refresh',host='127.0.0.1',token=env.ADMIN_TOKEN,method='POST'){
 return new Request('http://'+host+path,{method,headers:{Authorization:'Bearer '+token}});
}
const period={start:'2026-09-01',end:'2026-09-30'};
const report={period,filters:{device:null},missing:['Previous month incomplete'],products:[{decision:'Veri bekle'}]};
it('permits only the fixed two September routes and refuses repeat attempts',async()=>{
 const paths:string[]=[];const op=createOperator(async r=>{paths.push(new URL(r.url).pathname+new URL(r.url).search);return Response.json(paths.length===1?report:{period,device:null});});
 expect((await op.fetch(request(),cfg())).status).toBe(200);
 expect(paths).toEqual(['/api/report?month=2026-09&device=ALL&rangeMonths=1','/api/performance?month=2026-09&device=ALL&rangeMonths=1']);
 expect((await op.fetch(request(),cfg())).status).toBe(409);expect(paths).toHaveLength(2);
});
it('blocks public origins, missing auth, alternate parameters and missing guard before any invocation',async()=>{
 let calls=0;const op=createOperator(async()=>{calls++;return Response.json({});});
 for(const [req,config,status] of [
  [request('/refresh','example.com'),cfg(),403],
  [request('/refresh','localhost','wrong'),cfg(),401],
  [request('/refresh?month=2026-10'),cfg(),404],
  [request(),{...cfg(),D1_READ_GUARD_ENABLED:'false'},409],
  [request(),{...cfg(),SITE_ORIGIN:'https://elsewhere.example'},409],
 ] as const)expect((await op.fetch(req,config)).status).toBe(status);
 expect(calls).toBe(0);
});
it('an actual expired or absent D1 lease prevents all report and KPI writes',async()=>{
 const op=createOperator();const response=await op.fetch(request(),cfg());
 expect(response.status).toBe(409);expect(await response.json()).toMatchObject({error:'APPLICATION_REPORT_REJECTED',report_attempts:1,kpi_attempts:0,http_status:429});
 for(const table of ['analysis_runs','api_read_cache','recommendations','d1_quota_ledger'])expect(await env.DB.prepare('SELECT count(*) n FROM '+table).first()).toMatchObject({n:0});
});
it('never tries KPI or repeats a report after an application failure',async()=>{
 let calls=0;const op=createOperator(async()=>{calls++;return Response.json({error:'guard'}, {status:429});});
 expect((await op.fetch(request(),cfg())).status).toBe(409);
 expect((await op.fetch(request(),cfg())).status).toBe(409);expect(calls).toBe(1);
});
it('rejects a wrong report period or unsafe decision before requesting KPI',async()=>{
 for(const value of [{...report,period:{...period,start:'2026-08-01'}},{...report,products:[{decision:'İyileştir'}]}]){
  let calls=0;const op=createOperator(async()=>{calls++;return Response.json(value);});
  expect((await op.fetch(request(),cfg())).status).toBe(409);expect(calls).toBe(1);
 }
});
