import {beforeEach,it,expect} from 'vitest';
import {init,env,connected,enqueue,fetcher} from './helpers';
import {enqueueDaily,claimJob,processJob} from '../src/sync';

beforeEach(init);
const FIRST_DAY=new Date('2026-10-26T00:00:00Z');
const NEXT_DAY=new Date('2026-10-27T00:00:00Z');
const THIRD_DAY=new Date('2026-10-28T00:00:00Z');
const FAILED_DAY='2026-08-18';
const savedJob=(id:string)=>env.DB.prepare('SELECT * FROM sync_jobs WHERE id=?').bind(id).first();

it.each([
 ['gsc','page','INVALID_GSC_ROW',1],
 ['gsc','query','INVALID_GSC_ROW_PAGE_WWW',2],
 ['gsc','page','INVALID_GSC_ROW_CTR_RATIO',1],
 ['gsc','query','DUPLICATE_GSC_ROW',1],
 ['gsc','page','GOOGLE_HTTP_429',6],
 ['gsc','query','NETWORK_UNAVAILABLE',6],
 ['ga4','organic','INVALID_GA4_ROW',1],
 ['ads','brosur','GOOGLE_HTTP_403',1],
 ['gsc','page',null,6],
] as [string,string,string|null,number][])('keeps blocked %s/%s %s quarantined across UTC days',async(provider,scope,code,attempts)=>{
 const cfg=await connected();
 await enqueue(provider,scope,FAILED_DAY);
 const id=`${provider}:${FAILED_DAY}:${scope}`;
 await env.DB.prepare("UPDATE sync_jobs SET status='blocked',cursor=200,attempts=?,error_code=?,quality_failed=1,updated_at=? WHERE id=?")
   .bind(attempts,code,FIRST_DAY.toISOString(),id).run();
 const before=await savedJob(id);
 expect(await enqueueDaily(cfg,NEXT_DAY)).toBe(true);
 expect(await savedJob(id)).toEqual(before);
 expect(await enqueueDaily(cfg,THIRD_DAY)).toBe(true);
 expect(await savedJob(id)).toEqual(before);
});

it('daily planning and INSERT OR IGNORE never replace the two incident jobs or their failure evidence',async()=>{
 const cfg=await connected();
 for(const scope of ['page','query'])await enqueue('gsc',scope,FAILED_DAY);
 await env.DB.prepare("UPDATE sync_jobs SET status='blocked',cursor=CASE scope WHEN 'query' THEN 200 ELSE 0 END,attempts=2,error_code='INVALID_GSC_ROW_PAGE_WWW',updated_at=?")
  .bind(FIRST_DAY.toISOString()).run();
 await env.DB.prepare("INSERT INTO sync_runs(id,job_id,started_at,finished_at,status,trigger_source) VALUES('TEST validation run','gsc:2026-08-18:query',?,?,'failed','cron')")
  .bind(FIRST_DAY.toISOString(),FIRST_DAY.toISOString()).run();
 await env.DB.prepare("INSERT INTO sync_errors(run_id,code,retry_at,created_at) VALUES('TEST validation run','INVALID_GSC_ROW_PAGE_WWW',NULL,?)")
  .bind(FIRST_DAY.toISOString()).run();
 const jobs=(await env.DB.prepare("SELECT * FROM sync_jobs WHERE day=? ORDER BY id").bind(FAILED_DAY).all()).results;
 const errors=(await env.DB.prepare('SELECT * FROM sync_errors').all()).results;
 await enqueueDaily(cfg,NEXT_DAY);
 expect((await env.DB.prepare("SELECT * FROM sync_jobs WHERE day=? ORDER BY id").bind(FAILED_DAY).all()).results).toEqual(jobs);
 expect((await env.DB.prepare('SELECT * FROM sync_errors').all()).results).toEqual(errors);
});

it('pending retry retains its backoff deadline, attempts and staging generation through daily planning',async()=>{
 const cfg=await connected();await enqueue('gsc','query',FAILED_DAY);
 const id=`gsc:${FAILED_DAY}:query`;
 await env.DB.prepare("UPDATE sync_jobs SET status='retry',cursor=200,attempts=5,error_code='GOOGLE_HTTP_429',next_attempt_at='2026-10-27T02:00:00.000Z',updated_at=? WHERE id=?")
  .bind(FIRST_DAY.toISOString(),id).run();
 const before=await savedJob(id);
 await enqueueDaily(cfg,NEXT_DAY);
 expect(await savedJob(id)).toEqual(before);
 // No other test jobs may obscure this exact deadline boundary.
 await env.DB.prepare('DELETE FROM sync_jobs WHERE id!=?').bind(id).run();
 expect(await claimJob(cfg,new Date('2026-10-27T01:59:59Z'))).toBeNull();
 const due=await claimJob(cfg,new Date('2026-10-27T02:00:00Z'));
 expect(due).toMatchObject({id,cursor:200,attempts:5,generation:'fixture-generation'});
});

it('the sixth retryable provider failure remains terminal on the next day instead of receiving six new attempts',async()=>{
 const cfg=await connected();await enqueue('gsc','page',FAILED_DAY);
 const id=`gsc:${FAILED_DAY}:page`;
 await env.DB.prepare('UPDATE sync_jobs SET attempts=5 WHERE id=?').bind(id).run();
 const job=(await claimJob(cfg))!;let calls=0;
 await processJob(cfg,job,fetcher(async()=>{calls++;return new Response('',{status:429});}));
 expect(calls).toBe(1);
 const before=await savedJob(id);
 expect(before).toMatchObject({status:'blocked',attempts:6,error_code:'GOOGLE_HTTP_429'});
 await enqueueDaily(cfg,new Date(Date.now()+86400_000));
 expect(await savedJob(id)).toEqual(before);
 expect((await env.DB.prepare('SELECT code,retry_at FROM sync_errors').first())).toMatchObject({code:'GOOGLE_HTTP_429',retry_at:null});
});

it('successful recent datasets retain the existing daily reconciliation behavior',async()=>{
 const cfg=await connected();const day='2026-10-22',id=`gsc:${day}:page`;
 await enqueue('gsc','page',day);
 await env.DB.prepare("UPDATE sync_jobs SET status='done',attempts=0,updated_at=? WHERE id=?").bind(FIRST_DAY.toISOString(),id).run();
 await env.DB.prepare("INSERT INTO dataset_coverage VALUES('gsc',?,'page','fixture-generation',1,0,0,?,'TEST complete empty dataset')")
  .bind(day,FIRST_DAY.toISOString()).run();
 await enqueueDaily(cfg,NEXT_DAY);
 expect(await savedJob(id)).toMatchObject({status:'pending',attempts:0,cursor:0});
});
