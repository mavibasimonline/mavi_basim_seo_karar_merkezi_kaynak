import {it,expect} from 'vitest';
import {cronTime,recordGscCron,gscCronProof} from '../src/independent-cron-proof';
function store(){const values=new Map<string,unknown>();return {values,get:async<T>(key:string)=>values.get(key) as T|undefined,put:async(key:string,value:unknown)=>{values.set(key,value);}} as any;}
it('keeps natural Cron receipts separate from manual collection and records two days',async()=>{
 const s=store(),first=new Date('2026-11-03T23:45:00Z'),next=new Date('2026-11-04T00:00:00Z');
 expect(cronTime({},first)).toBeNull();
 expect(cronTime({source:'cloudflare-cron',scheduled_at:first.toISOString()},first)).toBe(first.toISOString());
 await recordGscCron(s,first.toISOString(),{status:'complete',day:'2026-10-31',scope:'page',rows:5,d1_requests:0},first);
 await recordGscCron(s,next.toISOString(),{status:'partial',day:'2026-11-01',scope:'query',cursor:200,d1_requests:0},next);
 const proof=await gscCronProof(s,next);
 expect(proof.last).toMatchObject({source:'Cloudflare Cron',scheduled_at:next.toISOString(),status:'partial'});
 expect(proof.days).toHaveLength(2);expect(proof.days).toEqual(expect.arrayContaining([expect.objectContaining({day:'2026-11-03',completed:1}),expect.objectContaining({day:'2026-11-04',partial:1})]));
});
it('preserves the original receipt on redelivery and never logs raw failure text',async()=>{
 const s=store(),time=new Date('2026-11-04T00:00:00Z'),at=time.toISOString();
 await recordGscCron(s,at,{status:'held',code:'access_token=fixture-secret',d1_requests:0},time);
 await recordGscCron(s,at,{status:'complete',rows:500,d1_requests:0},time);
 const proof=await gscCronProof(s,time);
 expect(proof.last?.status).toBe('held');expect(proof.days[0]?.attempts).toBe(1);
 expect(JSON.stringify([...s.values])).not.toContain('fixture-secret');
});
it('rejects invalid scheduled slots and nonzero D1 collection claims',async()=>{
 const time=new Date('2026-11-04T00:00:00Z');
 for(const scheduled_at of ['2026-11-04T00:01:00.000Z','2026-11-04T01:00:00.000Z','2026-11-02T00:00:00.000Z'])expect(()=>cronTime({source:'cloudflare-cron',scheduled_at},time)).toThrow('GSC_CRON_TIME_INVALID');
 await expect(recordGscCron(store(),time.toISOString(),{status:'complete',d1_requests:1},time)).rejects.toThrow('GSC_CRON_RESULT_INVALID');
});
it('keeps the most recent natural slot when an older event arrives late',async()=>{
 const s=store(),later='2026-11-04T00:15:00.000Z',earlier='2026-11-04T00:00:00.000Z',now=new Date('2026-11-04T00:16:00Z');
 await recordGscCron(s,later,{status:'complete',rows:8,d1_requests:0},now);
 await recordGscCron(s,earlier,{status:'partial',cursor:200,d1_requests:0},now);
 const proof=await gscCronProof(s,now);
 expect(proof.last?.scheduled_at).toBe(later);expect(proof.days[0]?.last_scheduled_at).toBe(later);expect(proof.days[0]?.attempts).toBe(2);
});

it('keeps daily and historical receipts immutable in the same real scheduled slot',async()=>{
 const s=store(),now=new Date('2026-11-04T00:15:00Z'),slot=now.toISOString();
 await recordGscCron(s,slot,{status:'idle',d1_requests:0},now);
 await recordGscCron(s,slot,{status:'complete',day:'2026-10-01',scope:'page',rows:7,d1_requests:0},now,'history');
 await recordGscCron(s,slot,{status:'held',d1_requests:0},now,'history');
 const proof=await gscCronProof(s,now);
 expect(proof.last).toMatchObject({status:'complete',rows:7,source:'Cloudflare Cron'});
 expect(proof.days[0]).toMatchObject({attempts:2,completed:1,idle:1,held:0});
 expect(s.values.get('gsc:cron:'+slot)).toMatchObject({status:'idle'});
 expect(s.values.get('gsc:history-cron:'+slot)).toMatchObject({status:'complete'});
});
