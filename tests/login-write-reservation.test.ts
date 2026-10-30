import {beforeEach,it,expect} from 'vitest';
import {init,env,configured} from './helpers';
import worker from '../src/index';
import {withReadBudget} from '../src/d1-read-budget';
import type {Env} from '../src/types';
beforeEach(init);
async function ready(remaining=786){
 const now=new Date(),day=now.toISOString().slice(0,10),cfg=configured({D1_READ_GUARD_ENABLED:'true'});
 await env.DB.prepare('INSERT INTO d1_quota_state VALUES(?,?,?,?,?,?,?,?)').bind(day,now.toISOString(),new Date(now.getTime()-60000).toISOString(),new Date(now.getTime()+3600000).toISOString(),143242,22580,'open','TEST verified quota').run();
 await env.DB.prepare('INSERT INTO d1_quota_ledger VALUES(?,?,?,?)').bind(day,775866,85000-22580-remaining,now.toISOString()).run();
 return {cfg,day,initial:85000-22580-remaining};
}
const login=(cfg:Env,token=env.ADMIN_TOKEN!)=>worker.fetch(new Request('https://app.example/api/session',{method:'POST',headers:{Origin:'https://app.example','Content-Type':'application/json'},body:JSON.stringify({token})}),cfg);
async function writes(day:string){return Number((await env.DB.prepare('SELECT writes FROM d1_quota_ledger WHERE day=?').bind(day).first<{writes:number}>())!.writes);}
it('786 remaining permits the real signed login, status and measured performance independently; heavy analysis keeps its original gate',async()=>{
 const {cfg,day,initial}=await ready();
 const signed=await login(cfg);expect(signed.status).toBe(200);
 expect(signed.headers.get('Set-Cookie')).toContain('HttpOnly; Secure; SameSite=Strict');
 const loginCharge=await writes(day)-initial;expect(loginCharge).toBeGreaterThanOrEqual(16);expect(loginCharge).toBeLessThanOrEqual(64);
 const cookie=signed.headers.get('Set-Cookie')!.split(';')[0];
 const get=(path:string)=>worker.fetch(new Request('https://app.example'+path,{headers:{Cookie:cookie}}),cfg);
 expect((await get('/api/status')).status).toBe(200);
 expect((await get('/api/performance?month=2026-09')).status).toBe(200);
 expect(await writes(day)-initial).toBeLessThan(786);
 const blocked=await get('/api/report?month=2026-09');expect(blocked.status).toBe(429);expect(await blocked.json()).toMatchObject({reason:'ACCOUNT_WRITE_RESERVATION_LIMIT'});
 expect((await get('/api/status')).status).toBe(200);
});
it('insufficient real capacity stops before changing login attempts or source data',async()=>{
 const {cfg,day,initial}=await ready(63);const response=await login(cfg);
 expect(response.status).toBe(429);expect(await response.json()).toMatchObject({reason:'ACCOUNT_WRITE_RESERVATION_LIMIT'});
 expect(await writes(day)).toBe(initial);expect(await env.DB.prepare('SELECT count(*) n FROM auth_attempts').first('n')).toBe(0);
});
it('wrong-token throttling still blocks the correct token after five failed attempts',async()=>{
 const {cfg}=await ready();for(let i=0;i<5;i++)expect((await login(cfg,'TEST invalid')).status).toBe(401);
 const response=await login(cfg);expect(response.status).toBe(429);expect(await response.json()).toEqual({error:'Çok fazla deneme. 15 dakika sonra tekrar deneyin.'});
});
it.each(['/api/status','/api/session','/api/performance'])('small %s budgets cannot run arbitrary writes',async path=>{
 const {cfg}=await ready();await expect(withReadBudget(cfg,path,safe=>safe.DB.prepare("DELETE FROM products WHERE id='brosur'").run())).rejects.toMatchObject({reason:'INTERACTIVE_SQL_SCOPE'});
 expect(await env.DB.prepare("SELECT count(*) n FROM products WHERE id='brosur'").first('n')).toBe(1);
});
it('narrow profiles retain their entire reservation for unknown measured cost',async()=>{
 const {cfg,day,initial}=await ready();
 const original=cfg.DB;cfg.DB=new Proxy(original,{get(target,key){if(key==='prepare')return (sql:string)=>sql==='SELECT fixture_missing'?{all:async()=>({results:[],meta:{rows_written:0}})}:target.prepare(sql);const value=Reflect.get(target,key,target);return typeof value==='function'?value.bind(target):value;}});
 await withReadBudget(cfg,'/api/status',safe=>safe.DB.prepare('SELECT fixture_missing').all());
 expect(await writes(day)-initial).toBe(128);
});
it('statement caps prevent growing bookkeeping beyond the audited small margin',async()=>{
 const {cfg}=await ready();await expect(withReadBudget(cfg,'/api/status',async safe=>{for(let i=0;i<13;i++)await safe.DB.prepare('SELECT 1').all();})).rejects.toMatchObject({reason:'INTERACTIVE_SQL_SCOPE'});
});
