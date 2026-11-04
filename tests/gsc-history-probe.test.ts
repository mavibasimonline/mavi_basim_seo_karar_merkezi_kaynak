import {it,expect,vi} from 'vitest';
import probe from '../scripts/gsc_history_probe';
const key='fixture-history-private',privateText='NEVER_EXPORT_QUERY_OR_TOKEN';
const request=(mode:string,auth=true)=>new Request('https://preview.private/?mode='+mode,{method:'POST',headers:auth?{Authorization:'Bearer '+key}:{}});
const status={initialized:true,months:['2026-10','2026-09'],completed_scopes:1,total_scopes:122,plan_complete:false,storage_reserved_bytes:1000,storage_limit_bytes:16777216,d1_requests:0,manual_csv_required:false,raw:privateText};
it('authenticates before service calls and rejects unknown query controls',async()=>{
 const fetch=vi.fn();const env={ARCHIVE:{fetch} as any,PROBE_KEY:key};
 for(const mode of ['tick','status','month','context'])expect((await probe.fetch(request(mode,false),env)).status).toBe(401);
 expect((await probe.fetch(request('delete'),env)).status).toBe(503);expect(fetch).not.toHaveBeenCalled();
});
it('makes only one history tick per request and exports no raw source fields',async()=>{
 const fetch=vi.fn(async(url:string)=>Response.json(url.endsWith('gsc-bootstrap-tick')?{status:'complete',day:'2026-10-01',scope:'page',rows:2,d1_requests:0,raw:privateText}:status));
 const response=await probe.fetch(request('tick'),{ARCHIVE:{fetch} as any,PROBE_KEY:key});
 const result=await response.json<any>();expect(result).toMatchObject({ok:true,completed_scopes:1,tick:{status:'complete',rows:2},d1_requests:0});
 expect(fetch).toHaveBeenCalledTimes(2);expect(JSON.stringify(result)).not.toContain(privateText);
});
it('returns a closed-month content proof without query, page or traffic payloads',async()=>{
 const fetch=vi.fn(async()=>Response.json({month:'2026-10',source:'GSC Search Analytics API',d1_requests:0,available:true,days_verified:31,expected_days:31,query_days_verified:31,evidence:Array(62).fill({}),query_partial:true,read_budget:{rows:7000,chunk_reads:90,budget_limited:false},queries:[privateText],pages:[privateText],total_clicks:999}));
 const r=await (await probe.fetch(request('month&month=2026-10'),{ARCHIVE:{fetch} as any,PROBE_KEY:key})).json<any>();
 expect(r).toMatchObject({ok:true,evidence_refs:62,content_rows:7000,query_partial:true});expect(JSON.stringify(r)).not.toContain(privateText);expect(r.total_clicks).toBeUndefined();
});
it('reads context proof without D1 or warmup calls and never echoes private errors',async()=>{
 const ARCHIVE={fetch:async()=>Response.json({available:true,d1_requests:0,source_hash:'a'.repeat(64),captured_at:'2026-11-04T14:00:00Z',products:3,snapshots:6,changes:2,raw:privateText})} as any;
 const env={ARCHIVE,PROBE_KEY:key};
 const r=await (await probe.fetch(request('context'),env)).json<any>();expect(r).toMatchObject({ok:true,products:3});expect(JSON.stringify(r)).not.toContain(privateText);
 const failed=await (await probe.fetch(request('tick'),{...env,ARCHIVE:{fetch:async()=>{throw Error(privateText);}} as any})).text();
 expect(failed).not.toContain(privateText);
});
it('verifies live-shaped analysis and questions without exporting source text or writing collection ticks',async()=>{
 const fetch=vi.fn(async(url:string,init?:RequestInit)=>{
  if(url.includes('gsc-analysis'))return Response.json({available:true,source:'GSC Search Analytics API',d1_requests:0,evidence:[{}],devices:[{}],countries:[{}],products:[{label:'Broşür'}],queries:[{label:privateText}],facet_counts:{pages:2,queries:3,products:1},mapping_evidence:{}});
  const q=JSON.parse(String(init?.body)).question;
  return Response.json({source:q.includes('geçmişi')?'Doğrulanmış SEO tarama/değişiklik arşivi':'GSC Search Analytics API',decision:'Veri bekle',answer:q.includes('şehir')?'GA4 verisi bekle':privateText,evidence_refs:[{day:'2026-10-01'},{day:'2026-09-01'}],d1_requests:0});
 });
 const r=await (await probe.fetch(request('analysis&month=2026-10'),{ARCHIVE:{fetch} as any,PROBE_KEY:key})).json<any>();
 expect(r).toMatchObject({ok:true,facet_counts:{pages:2,queries:3,products:1},mapping_available:true,questions:{query:{periods:['2026-09','2026-10']},city:{requires_ga4:true}}});
 expect(JSON.stringify(r)).not.toContain(privateText);expect(fetch.mock.calls.every(([url])=>!url.includes('tick'))).toBe(true);
});
it('warms metadata only through the private metered source and reports no source mutations',async()=>{
 const source=vi.fn(async(url:string)=>Response.json(url.includes('evidence-context-status')?{supported:true,source_read_query_limit:3,read_budget_enforced:true}:{status:'updated',source_read_query_limit:3,source_data_mutations:0,read_budget_enforced:true,raw:privateText}));
 const archive=vi.fn();
 const r=await (await probe.fetch(request('warm_context'),{ARCHIVE:{fetch:archive} as any,SOURCE:{fetch:source} as any,PROBE_KEY:key})).json<any>();
 expect(r).toEqual({ok:true,mode:'warm_context',status:'updated',source_read_query_limit:3,source_data_mutations:0,read_budget_enforced:true});expect(archive).not.toHaveBeenCalled();expect(JSON.stringify(r)).not.toContain(privateText);
});

it('waits for new named source code using a read-only capability request before warming',async()=>{
 const source=vi.fn(async()=>new Response(null,{status:503}));
 const response=await probe.fetch(request('warm_context'),{ARCHIVE:{} as any,SOURCE:{fetch:source} as any,PROBE_KEY:key});
 expect(await response.json()).toMatchObject({ok:false,code:'GSC_HISTORY_SOURCE_VERSION_PENDING'});
 expect(source).toHaveBeenCalledTimes(1);expect(source.mock.calls[0]).toHaveLength(1);
});
