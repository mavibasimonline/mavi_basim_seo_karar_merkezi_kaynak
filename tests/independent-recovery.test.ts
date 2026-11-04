import {it,expect} from 'vitest';
import {retryGscHold} from '../src/independent-recovery';
function storage(){const map=new Map<string,unknown>();return {map,get:async<T>(key:string)=>map.get(key) as T|undefined,put:async(key:string,value:unknown)=>{map.set(key,value);}} as any;}
it('retries only the exact observed hold and keeps both old evidence and control history',async()=>{
 const s=storage(),time=new Date('2026-11-04T08:00:00Z'),until=new Date('2026-11-04T20:00:00Z');
 s.map.set('gsc:diagnostic:last',{ok:true,at:time.toISOString(),revision:'daily-proof-v2',rows:1,d1_requests:0});
 s.map.set('gsc:held:2026-11-01:page',{until:until.getTime(),code:'GSC_HTTP_400'});
 s.map.set('gsc:retry',{until:until.getTime()-24*3600000+15*60000});
 s.map.set('gsc:history:previous',{rows:18});
 const request={day:'2026-11-01',scope:'page',code:'GSC_HTTP_400',until:until.toISOString()};
 expect(await retryGscHold(s,request,time)).toMatchObject({released:true,previous_until:until.toISOString(),d1_requests:0});
 expect(s.map.get('gsc:held:2026-11-01:page')).toMatchObject({previous_until:until.getTime(),until:time.getTime(),code:'GSC_HTTP_400'});
 expect(s.map.get('gsc:history:previous')).toEqual({rows:18});
 expect(s.map.get('gsc:retry')).toMatchObject({until:time.getTime(),previous_until:until.getTime()-24*3600000+15*60000});
 await expect(retryGscHold(s,request,time)).rejects.toThrow('GSC_RECOVERY_HOLD_CHANGED');
 expect(await retryGscHold(s,{...request,until:time.toISOString()},time)).toMatchObject({released:false,reason:'already_retried'});
 s.map.set('gsc:held:2026-11-01:page',{until:until.getTime()+86400000,code:'GSC_HTTP_400'});
 expect(await retryGscHold(s,{...request,until:new Date(until.getTime()+86400000).toISOString()},time)).toMatchObject({released:false,reason:'already_retried'});
 expect([...s.map.keys()].filter(k=>k.startsWith('gsc:recovery:'))).toHaveLength(1);
});
it('keeps an unrelated or one-hour source cooldown unchanged during a tested scope retry',async()=>{
 const s=storage(),time=new Date('2026-11-04T08:00:00Z'),until='2026-11-04T20:00:00.000Z',retry={until:Date.parse(until)-24*3600000+3600000};
 s.map.set('gsc:diagnostic:last',{ok:true,at:time.toISOString(),revision:'daily-proof-v2',rows:1,d1_requests:0});
 s.map.set('gsc:held:2026-11-01:query',{until:Date.parse(until),code:'GSC_SYNC_UNAVAILABLE'});s.map.set('gsc:retry',retry);
 await retryGscHold(s,{day:'2026-11-01',scope:'query',code:'GSC_SYNC_UNAVAILABLE',until},time);
 expect(s.map.get('gsc:retry')).toEqual(retry);
});
it('requires real current nonempty diagnostic readback before reopening a generic old failure',async()=>{
 const s=storage(),time=new Date('2026-11-04T08:00:00Z'),until='2026-11-04T20:00:00.000Z',request={day:'2026-11-01',scope:'query',code:'GSC_SYNC_UNAVAILABLE',until};
 s.map.set('gsc:held:2026-11-01:query',{until:Date.parse(until),code:'GSC_SYNC_UNAVAILABLE'});
 await expect(retryGscHold(s,request,time)).rejects.toThrow('GSC_RECOVERY_DIAGNOSTIC_REQUIRED');
 s.map.set('gsc:diagnostic:last',{ok:true,at:'2026-11-04T06:00:00Z',revision:'daily-proof-v2',rows:1,d1_requests:0});
 await expect(retryGscHold(s,request,time)).rejects.toThrow('GSC_RECOVERY_DIAGNOSTIC_REQUIRED');
 s.map.set('gsc:diagnostic:last',{ok:true,at:time.toISOString(),revision:'daily-proof-v2',rows:1,d1_requests:0});
 expect(await retryGscHold(s,request,time)).toMatchObject({released:true,code:'GSC_SYNC_UNAVAILABLE'});
});
it('does not override API quota, server backoff, reconnect, or mismatched holds',async()=>{
 const s=storage(),time=new Date('2026-11-04T08:00:00Z'),until='2026-11-04T20:00:00.000Z';
 for(const code of ['GSC_HTTP_429','GSC_HTTP_503','GSC_OAUTH_RECONNECT_REQUIRED','GSC_STORAGE_DAILY_LIMIT']){
  s.map.set('gsc:held:2026-11-01:page',{code,until:Date.parse(until)});
  await expect(retryGscHold(s,{day:'2026-11-01',scope:'page',code,until},time)).rejects.toThrow('GSC_RECOVERY_INPUT_INVALID');
 }
 await expect(retryGscHold(s,{day:'2026-11-01',scope:'page',code:'GSC_HTTP_400',until},time)).rejects.toThrow('GSC_RECOVERY_HOLD_CHANGED');
 expect([...s.map.keys()].filter(k=>k.startsWith('gsc:recovery:'))).toHaveLength(0);
});

it('reopens only the known baseline native receiver failure after real diagnostic proof',async()=>{
 const s=storage(),time=new Date('2026-11-04T08:00:00Z'),until='2026-11-04T20:00:00.000Z';
 let nativeMessage='';try{await globalThis.fetch.call({},'ftp://fixture.invalid/path');}catch(error){nativeMessage=(error as Error).message;}
 expect(nativeMessage).toContain('Illegal invocation');
 s.map.set('gsc:diagnostic:last',{ok:true,at:time.toISOString(),revision:'daily-proof-v2',rows:1,d1_requests:0});
 const key='gsc:held:2026-11-01:page',request={day:'2026-11-01',scope:'page',code:'GSC_SYNC_UNAVAILABLE',until};
 for(const code of ['unexpected storage failure','GSC_HTTP_429','GSC_OAUTH_RECONNECT_REQUIRED']){
  s.map.set(key,{until:Date.parse(until),code});await expect(retryGscHold(s,request,time)).rejects.toThrow('GSC_RECOVERY_HOLD_CHANGED');
 }
 s.map.set(key,{until:Date.parse(until),code:nativeMessage});
 expect(await retryGscHold(s,request,time)).toMatchObject({released:true,code:'GSC_SYNC_UNAVAILABLE'});
 expect(s.map.get(key).code).toBe(nativeMessage);
 expect(JSON.stringify(s.map.get('gsc:recovery:daily-proof-v2:2026-11-01:page'))).not.toContain(nativeMessage);
});
