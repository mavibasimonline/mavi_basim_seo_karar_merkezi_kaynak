import {beforeEach,it,expect,vi} from 'vitest';
import {init,env,connected} from './helpers';
import worker,{tick} from '../src/index';
import {monthPeriod} from '../src/analysis';
import type {Env} from '../src/types';

beforeEach(init);
const request=(path:string,method='GET',body?:unknown,extra:Record<string,string>={})=>new Request('https://app.example'+path,{method,headers:{Authorization:`Bearer ${env.ADMIN_TOKEN}`,...extra},...(body===undefined?{}:{body:JSON.stringify(body)})});
it('protects all data endpoints and exposes only minimal public health',async()=>{
  for(const path of ['/api/report','/api/competitors','/api/competitor-targets','/api/data-integrity','/api/audit-history','/api/change-calendar','/api/change-impact','/api/radar','/api/status','/api/history','/api/inventory','/api/keywords?product=brosur','/api/outcomes','/api/export'])expect((await worker.fetch(new Request('https://app.example'+path),env)).status).toBe(401);
  const health=await worker.fetch(new Request('https://app.example/api/health'),env);expect(health.status).toBe(200);expect(await health.text()).not.toContain('TOKEN');
});
it('serves a validated report and export without synthetic live data',async()=>{
  const month=monthPeriod(new Date().toISOString().slice(0,7),-1).label;
  const response=await worker.fetch(request('/api/report?month='+month),env);expect(response.status).toBe(200);
  const data=await response.json() as {id:string;products:{decision:string;current:unknown}[]};expect(data.products.every(p=>p.decision==='Veri bekle'&&p.current===null)).toBe(true);
  const saved=await env.DB.prepare('SELECT id FROM analysis_runs').first();expect(saved).toMatchObject({id:data.id});
  const exported=await worker.fetch(request('/api/export?month='+month),env);expect(exported.headers.get('Content-Disposition')).toContain(month);
  expect(exported.headers.get('Content-Security-Policy')).toContain("default-src 'self'");
});
it('rejects invalid periods, malformed body and cross-site state changes',async()=>{
  expect((await worker.fetch(request('/api/report?month=2026-99'),env)).status).toBe(400);
  expect((await worker.fetch(request('/api/questions','POST',{question:'Broşür neden düştü?'},{Origin:'https://evil.example'}),env)).status).toBe(403);
  expect((await worker.fetch(request('/api/questions','POST',{question:'x'.repeat(17000)}),env)).status).toBe(413);
});
it('returns honest connection status and bounded empty inventory/history',async()=>{
  const status=await worker.fetch(request('/api/status'),env);expect(await status.json()).toMatchObject({google_connected:false,ads_configured:false,ga4_configured:false,automation_enabled:false});
  expect((await worker.fetch(request('/api/oauth/google/start','POST',{}),env)).status).toBe(503);
  for(const path of ['/api/history?url=https://mavibasim.com/brosur','/api/inventory','/api/keywords?product=brosur']){
    const response=await worker.fetch(request(path),env);expect(response.status).toBe(200);expect(await response.json()).toMatchObject({rows:[]});
  }
});
it('runs scheduled self-checks without inventing a Google connection',async()=>{
  await tick({...env,AUTOMATION_ENABLED:'true'});const check=await env.DB.prepare('SELECT status,code FROM health_checks').first();expect(check).toMatchObject({status:'blocked',code:'GOOGLE_NOT_CONNECTED'});
});
it('keeps every scheduled task inert without explicit acceptance opt-in',async()=>{
  const prepare=vi.fn(()=>{throw new Error('AUTOMATION_TOUCHED_DATABASE');});
  const network=vi.fn(()=>{throw new Error('AUTOMATION_TOUCHED_NETWORK');}) as unknown as typeof fetch;
  for(const value of [undefined,'false','TRUE','1','']){
    const held={...env,DB:{prepare} as unknown as D1Database,AUTOMATION_ENABLED:value} as Env;
    await tick(held,network,new Date('2026-10-24T00:45:00Z'));
    const pending:Promise<unknown>[]=[];
    await worker.scheduled({} as ScheduledController,held,{waitUntil:(task:Promise<unknown>)=>{pending.push(task);}} as ExecutionContext);
    await Promise.all(pending);
  }
  expect(prepare).not.toHaveBeenCalled();expect(network).not.toHaveBeenCalled();
});
it('reports GA4 configuration separately from a successful Google connection',async()=>{
  const response=await worker.fetch(request('/api/status'),{...env,GA4_PROPERTY_ID:'123456789'});
  expect(await response.json()).toMatchObject({ga4_configured:true,google_connected:false,automation_enabled:false});
});
it('invalidates report cache immediately after a failed GSC health check',async()=>{
  const first=await worker.fetch(request('/api/report'),env);const a=await first.json() as {id:string};
  const stamp=new Date(Date.now()+1000).toISOString();await env.DB.prepare("INSERT INTO health_checks VALUES('gsc',?,?,'failed','GOOGLE_HTTP_403')").bind(stamp.slice(0,10),stamp).run();
  const second=await worker.fetch(request('/api/report'),env);const b=await second.json() as {id:string;missing:string[]};expect(b.id).not.toBe(a.id);expect(b.missing.join()).toContain('GOOGLE_HTTP_403');
});
it('invalidates a cached Google connection immediately when its authorization record is removed',async()=>{
  await connected();const first=await worker.fetch(request('/api/report'),env);expect((await first.json() as any).sources.google_connected).toBe(true);
  await env.DB.prepare('DELETE FROM oauth_credentials').run();const second=await worker.fetch(request('/api/report'),env);expect((await second.json() as any).sources.google_connected).toBe(false);
});
