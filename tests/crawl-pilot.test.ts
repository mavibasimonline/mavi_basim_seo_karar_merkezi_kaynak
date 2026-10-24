import {beforeEach,it,expect} from 'vitest';
import {init,env} from './helpers';
import pilot from '../src/crawl-pilot';
beforeEach(init);
it('operator entry rejects all public hosts even with the correct local key',async()=>{const r=await pilot.fetch(new Request('https://app.example/run',{method:'POST',headers:{Authorization:'Bearer TEST-PILOT'}}),{...env,CRAWL_ENABLED:'true',PILOT_RUN_KEY:'TEST-PILOT'});expect(r.status).toBe(403);});
it('loopback operator calls still require their ephemeral key',async()=>{expect((await pilot.fetch(new Request('http://127.0.0.1:8792/run',{method:'POST'}),{...env,CRAWL_ENABLED:'true',PILOT_RUN_KEY:'TEST-PILOT'})).status).toBe(401);});
it('a disabled crawl cannot write a snapshot through the local entry',async()=>{expect((await pilot.fetch(new Request('http://127.0.0.1:8792/run',{method:'POST',headers:{Authorization:'Bearer TEST-PILOT'}}),{...env,CRAWL_ENABLED:'false',PILOT_RUN_KEY:'TEST-PILOT'})).status).toBe(409);expect((await env.DB.prepare('SELECT count(*) n FROM crawls').first<{n:number}>())!.n).toBe(0);});
