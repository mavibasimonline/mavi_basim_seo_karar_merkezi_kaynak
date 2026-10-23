import {beforeEach,it,expect} from 'vitest';
import {init,env} from './helpers';
import worker,{tick} from '../src/index';
import {monthPeriod} from '../src/analysis';

beforeEach(init);
const request=(path:string,method='GET',body?:unknown,extra:Record<string,string>={})=>new Request('https://app.example'+path,{method,headers:{Authorization:`Bearer ${env.ADMIN_TOKEN}`,...extra},...(body===undefined?{}:{body:JSON.stringify(body)})});
it('protects all data endpoints and exposes only minimal public health',async()=>{
  for(const path of ['/api/report','/api/status','/api/history','/api/inventory','/api/keywords?product=brosur','/api/outcomes','/api/export'])expect((await worker.fetch(new Request('https://app.example'+path),env)).status).toBe(401);
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
  const status=await worker.fetch(request('/api/status'),env);expect(await status.json()).toMatchObject({google_connected:false,ads_configured:false});
  expect((await worker.fetch(request('/api/oauth/google/start','POST',{}),env)).status).toBe(503);
  for(const path of ['/api/history?url=https://mavibasim.com/brosur','/api/inventory','/api/keywords?product=brosur']){
    const response=await worker.fetch(request(path),env);expect(response.status).toBe(200);expect(await response.json()).toMatchObject({rows:[]});
  }
});
it('runs scheduled self-checks without inventing a Google connection',async()=>{
  await tick(env);const check=await env.DB.prepare('SELECT status,code FROM health_checks').first();expect(check).toMatchObject({status:'blocked',code:'GOOGLE_NOT_CONNECTED'});
});
it('invalidates report cache immediately after a failed GSC health check',async()=>{
  const first=await worker.fetch(request('/api/report'),env);const a=await first.json() as {id:string};
  const stamp=new Date(Date.now()+1000).toISOString();await env.DB.prepare("INSERT INTO health_checks VALUES('gsc',?,?,'failed','GOOGLE_HTTP_403')").bind(stamp.slice(0,10),stamp).run();
  const second=await worker.fetch(request('/api/report'),env);const b=await second.json() as {id:string;missing:string[]};expect(b.id).not.toBe(a.id);expect(b.missing.join()).toContain('GOOGLE_HTTP_403');
});
