import {it,expect,vi} from 'vitest';
import {runGscDiagnostic} from '../src/independent-gsc-diagnostic';
const secret='AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=',time=new Date('2026-11-04T08:00:00Z');
function storage(){const map=new Map<string,unknown>();return {map,get:async<T>(key:string)=>map.get(key) as T|undefined,put:async(key:string,value:unknown)=>{map.set(key,structuredClone(value));}} as any;}
it('proves actual encrypted readback without changing the operational queue or exposing rows',async()=>{
 const s=storage(),held={code:'GSC_SYNC_UNAVAILABLE',until:time.getTime()+3600000};s.map.set('gsc:held:2026-11-01:page',held);s.map.set('gsc:active',{fixture:'original queue'});
 const fetcher=vi.fn(async()=>Response.json({responseAggregationType:'byPage',rows:[{keys:['2026-11-01','https://mavibasim.com/brosur','tur','DESKTOP'],clicks:1,impressions:10,ctr:.1,position:3}]}));
 const result=await runGscDiagnostic(s,secret,async()=> 'fixture-secret-token',fetcher as typeof fetch,time);
 expect(result).toMatchObject({ok:true,readback_verified:true,status:'complete',rows:1,d1_requests:0});
 expect(s.map.get('gsc:held:2026-11-01:page')).toEqual(held);expect(s.map.get('gsc:active')).toEqual({fixture:'original queue'});
 expect(s.map.has('gsc:daily:2026-11-01:page')).toBe(false);expect(s.map.has('gsc:storage-budget:v1')).toBe(true);
 expect(JSON.stringify(result)).not.toMatch(/fixture-secret-token|mavibasim.com/);
 expect(await runGscDiagnostic(s,secret,async()=> 'unused',fetcher as typeof fetch,time)).toMatchObject({cached:true});expect(fetcher).toHaveBeenCalledTimes(1);
});
it('keeps native failures private and identifies the phase; source quota remains authoritative',async()=>{
 const s=storage(),fetcher=vi.fn();
 const result=await runGscDiagnostic(s,secret,async()=>{throw Error('raw-token-and-provider-secret');},fetcher,time);
 expect(result).toMatchObject({ok:false,phase:'authorization',code:'GSC_TOKEN_UNAVAILABLE'});expect(JSON.stringify(result)).not.toContain('raw-token');expect(fetcher).not.toHaveBeenCalled();
 const q=storage();q.map.set('gsc:retry',{until:time.getTime()+3600000});q.map.set('gsc:last-failure',{code:'GSC_HTTP_429'});
 expect(await runGscDiagnostic(q,secret,async()=> 'unused',fetcher,time)).toMatchObject({ok:false,code:'GSC_HTTP_429'});expect(fetcher).not.toHaveBeenCalled();
});
