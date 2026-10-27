import {beforeEach,expect,it} from 'vitest';
import {init,env,enqueue} from './helpers';
import {claimJob} from '../src/sync';

beforeEach(init);
it('all 62 July jobs remain eligible and history selection moves to July after newer months finish',async()=>{
 for(let day=1;day<=31;day++)for(const scope of ['page','query'])await enqueue('gsc',scope,'2026-07-'+String(day).padStart(2,'0'));
 await enqueue('gsc','query','2026-08-01');
 await enqueue('gsc','query','2026-10-22');
 const time=new Date('2026-10-27T15:15:00Z');
 expect((await claimJob(env,time,'history'))?.day).toBe('2026-08-01');
 await env.DB.prepare("UPDATE sync_jobs SET status='done' WHERE day='2026-08-01'").run();
 expect((await claimJob(env,time,'history'))).toMatchObject({day:'2026-07-31',scope:'page'});
 expect(await env.DB.prepare("SELECT count(*) n FROM sync_jobs WHERE day BETWEEN '2026-07-01' AND '2026-07-31'").first('n')).toBe(62);
 expect((await claimJob(env,time,'recent'))?.day).toBe('2026-10-22');
});
