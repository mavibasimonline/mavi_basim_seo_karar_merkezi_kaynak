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
