import {beforeEach,expect,it} from 'vitest';
import {init,env} from './helpers';
import {createCanary} from '../scripts/mapping-canary';
beforeEach(init);
const request=()=>new Request('http://127.0.0.1/run',{method:'POST',headers:{Authorization:'Bearer '+env.ADMIN_TOKEN}});
it('missing quota prevents a real canary crawl and any report or mapping write',async()=>{
 let calls=0;const canary=createCanary(async()=>{calls++;});
 await expect(canary.fetch(request(),{...env,D1_READ_GUARD_ENABLED:'true'})).rejects.toThrow('D1_READ_BUDGET_WAIT');
 expect(calls).toBe(0);expect(await env.DB.prepare('SELECT count(*) n FROM crawls').first()).toMatchObject({n:0});
 expect(await env.DB.prepare('SELECT count(*) n FROM analysis_runs').first()).toMatchObject({n:0});
});
it('a guarded operator can run at most once and never accepts a public origin',async()=>{
 let calls=0;const canary=createCanary(async()=>{calls++;});
 const cfg={...env,D1_READ_GUARD_ENABLED:'true'};
 expect((await canary.fetch(new Request('https://example.com/run',{method:'POST'}),cfg)).status).toBe(403);
 await expect(canary.fetch(request(),cfg)).rejects.toThrow('D1_READ_BUDGET_WAIT');
 expect((await canary.fetch(request(),cfg)).status).toBe(409);expect(calls).toBe(0);
});
async function fixture(){
 const now=new Date(),day=now.toISOString().slice(0,10);
 await env.DB.prepare('INSERT INTO d1_quota_state VALUES(?,?,?,?,?,?,?,?)').bind(day,now.toISOString(),now.toISOString(),new Date(now.getTime()+75*60000).toISOString(),1000,1000,'open','TEST').run();
 await env.DB.prepare('UPDATE products SET url_verified_at=?').bind(now.toISOString()).run();
 await env.DB.prepare("INSERT INTO analysis_runs VALUES('fixture','2026-09','1.2.2',?,'{}','{}')").bind(now.toISOString()).run();
 await env.DB.prepare("INSERT INTO crawl_queue(url,kind,next_crawl_at) VALUES('https://mavibasim.com/brosur','page',?)").bind(new Date(now.getTime()+1000).toISOString()).run();
 await env.DB.prepare("INSERT INTO crawl_policies VALUES('https://mavibasim.com','User-agent: *',?,?)").bind(now.toISOString(),new Date(now.getTime()+1000).toISOString()).run();
}
async function crawlRecord(id:string,error:string|null){
 await env.DB.prepare('INSERT INTO crawls(id,url,started_at,finished_at,status_code,error_code) VALUES(?,?,?,?,?,?)').bind(id,'https://mavibasim.com/brosur',new Date(Date.now()+(id==='second'?100:0)).toISOString(),new Date().toISOString(),error?null:200,error).run();
}
it('robots pacing waits once for queue and shared policy without changing either deadline',async()=>{
 await fixture();let calls=0,waits=0;
 const canary=createCanary(async()=>{await crawlRecord(++calls===1?'first':'second',calls===1?'CRAWL_DELAY':null);},async ms=>{waits++;expect(ms).toBeGreaterThan(0);expect(ms).toBeLessThanOrEqual(30000);});
 const response=await canary.fetch(request(),{...env,D1_READ_GUARD_ENABLED:'true'});
 expect(await response.json()).toMatchObject({verified:true,crawl_error:null});expect(calls).toBe(2);expect(waits).toBe(1);
 expect((await canary.fetch(request(),{...env,D1_READ_GUARD_ENABLED:'true'})).status).toBe(409);
});
it.each(['ROBOTS_DISALLOWED','CRAWL_NETWORK_OR_PARSE_ERROR','CRAWL_DELAY'])('does not retry real failure or repeated delay: %s',async error=>{
 await fixture();let calls=0,waits=0;
 const canary=createCanary(async()=>{await crawlRecord(++calls===1?'first':'second',error);},async()=>{waits++;});
 expect(await (await canary.fetch(request(),{...env,D1_READ_GUARD_ENABLED:'true'})).json()).toMatchObject({verified:false,crawl_error:error});
 expect(calls).toBe(error==='CRAWL_DELAY'?2:1);expect(waits).toBe(error==='CRAWL_DELAY'?1:0);
});
it('long crawl delays stop without waiting or altering the policy',async()=>{
 await fixture();await env.DB.prepare('UPDATE crawl_policies SET next_request_at=?').bind(new Date(Date.now()+60000).toISOString()).run();let calls=0;
 const canary=createCanary(async()=>{calls++;await crawlRecord('first','CRAWL_DELAY');},async()=>{throw Error('MUST_NOT_WAIT');});
 expect(await (await canary.fetch(request(),{...env,D1_READ_GUARD_ENABLED:'true'})).json()).toMatchObject({verified:false});expect(calls).toBe(1);
});
it('a mapping change during delay fails and cannot trigger a second crawl',async()=>{
 await fixture();let calls=0;
 const canary=createCanary(async()=>{calls++;await crawlRecord('first','CRAWL_DELAY');await env.DB.prepare("UPDATE products SET url_verified_at='TEST changed evidence' WHERE id='brosur'").run();},async()=>{throw Error('MUST_NOT_WAIT');});
 expect(await (await canary.fetch(request(),{...env,D1_READ_GUARD_ENABLED:'true'})).json()).toMatchObject({verified:false,checks:{existing_mapping_evidence_unchanged:false}});expect(calls).toBe(1);
});
