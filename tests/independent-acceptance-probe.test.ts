import {describe,it,expect,vi} from 'vitest';
import probe from '../scripts/independent-acceptance-probe';
const key='fixture-probe-key',hash='a'.repeat(64);
const request=()=>new Request('https://probe.private/',{headers:{Authorization:'Bearer '+key}});
const report=()=>({available:true,month:'2026-09',products:[{title:'Broşür'}],query_count:2,d1_requests:0,stale:false,source_hash:hash,captured_at:new Date().toISOString()});
describe('private real data release probe',()=>{
 it('never calls the service for an unauthorized request',async()=>{
  const fetch=vi.fn();expect((await probe.fetch(new Request('https://probe.private/'),{ARCHIVE:{fetch} as any,PROBE_KEY:key})).status).toBe(401);expect(fetch).not.toHaveBeenCalled();
 });
 it.each(['stale','future','old','d1','empty'])('rejects %s report proof',async(mode)=>{
  const r=report();if(mode==='stale')r.stale=true;if(mode==='future')r.captured_at=new Date(Date.now()+60000).toISOString();if(mode==='old')r.captured_at='2000-01-01T00:00:00Z';if(mode==='d1')r.d1_requests=1;if(mode==='empty')r.products=[];
  const response=await probe.fetch(request(),{ARCHIVE:{fetch:async()=>Response.json(r)} as any,PROBE_KEY:key});expect(response.status).toBe(503);
 });
 it.each(['hash','evidence','stale','readback'])('rejects inconsistent %s answer/readback',async(mode)=>{
  const r=report();let calls=0;
  const fetch=async()=>{calls++;if(calls===1)return Response.json(r);if(calls===2)return Response.json({answer:'Kanıt sınırlı',evidence:mode==='evidence'?[]:['source'],d1_requests:0,stale:mode==='stale',source_hash:mode==='hash'?'b'.repeat(64):hash});return Response.json({...r,source_hash:mode==='readback'?'b'.repeat(64):hash});};
  expect((await probe.fetch(request(),{ARCHIVE:{fetch} as any,PROBE_KEY:key})).status).toBe(503);
 });
 it('requires a matching persisted report and a nonempty evidenced answer',async()=>{
  const r=report();let calls=0;
  const fetch=async()=>{calls++;if(calls===2)return Response.json({answer:'Önceki ay yok.',evidence:['source'],d1_requests:0,stale:false,source_hash:hash});if(calls===4)return Response.json({connected:false,d1_requests:0});return Response.json(r);};
  const response=await probe.fetch(request(),{ARCHIVE:{fetch} as any,PROBE_KEY:key});expect(response.status).toBe(200);expect((await response.json<any>()).ok).toBe(true);expect(calls).toBe(4);
 });
});
