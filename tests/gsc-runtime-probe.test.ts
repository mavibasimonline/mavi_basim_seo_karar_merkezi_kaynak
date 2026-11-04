import {describe,it,expect,vi} from 'vitest';
import probe from '../scripts/gsc_runtime_probe';
const key='fixture-probe-key';
const status=()=>({connected:true,reauthorization_required:false,coverage:[],last_attempt:{at:'2026-11-03T23:45:00Z',status:'held',code:'GSC_HTTP_400'},pending:null,d1_requests:0});
const req=(suffix='',auth=true)=>new Request('https://probe.private/'+suffix,{headers:auth?{Authorization:'Bearer '+key}:{}});
describe('private GSC runtime metadata probe',()=>{
 it('makes no service call without authentication or for invalid tick parameters',async()=>{
  const fetch=vi.fn(),env={ARCHIVE:{fetch} as any,PROBE_KEY:key};
  expect((await probe.fetch(req('',false),env)).status).toBe(401);
  expect((await probe.fetch(req('?ticks=5'),env)).status).toBe(400);
  expect((await probe.fetch(req('?secret=x'),env)).status).toBe(400);
  expect(fetch).not.toHaveBeenCalled();
 });
 it('reads two snapshots without collecting and drops untrusted private fields',async()=>{
  const fetch=vi.fn(async()=>Response.json({...status(),refresh_token:'private',last_attempt:{...status().last_attempt,body:'private'}}));
  const response=await probe.fetch(req(),{ARCHIVE:{fetch} as any,PROBE_KEY:key});
  expect(response.status).toBe(200);const result=await response.json<any>();
  expect(result.manual_ticks).toBe(0);expect(result.after.covered_scopes).toBe(0);
  expect(result.after.last_attempt.code).toBe('GSC_HTTP_400');expect(JSON.stringify(result)).not.toContain('private');
  expect(fetch).toHaveBeenCalledTimes(2);
 });
 it('stops a bounded diagnostic collection on held and distinguishes it from Cron',async()=>{
  const fetch=vi.fn(async(url:string)=>Response.json(url.endsWith('gsc-tick')?{status:'held',code:'GSC_RETRY_BACKOFF',d1_requests:0}:status()));
  const response=await probe.fetch(req('?ticks=4'),{ARCHIVE:{fetch} as any,PROBE_KEY:key});
  const result=await response.json<any>();expect(result.manual_ticks).toBe(1);expect(result.attempts).toHaveLength(1);
  expect(result.attempts[0].code).toBe('GSC_RETRY_BACKOFF');expect(fetch).toHaveBeenCalledTimes(3);
 });
 it('never returns provider response bodies or untrusted exceptions',async()=>{
  const fetch=async()=>{throw Error('access_token=private')};
  const response=await probe.fetch(req(),{ARCHIVE:{fetch} as any,PROBE_KEY:key});
  expect(response.status).toBe(503);expect(await response.json()).toEqual({ok:false,code:'GSC_AUDIT_UNAVAILABLE'});
 });
});
