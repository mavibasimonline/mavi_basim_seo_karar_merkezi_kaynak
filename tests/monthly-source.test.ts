import {beforeEach,it,expect} from 'vitest';
import {init,env,configured} from './helpers';
import {monthlySource,snapshotWindow} from '../src/monthly-source';
beforeEach(init);
async function ready(){const now=new Date(),day=now.toISOString().slice(0,10);await env.DB.prepare('INSERT INTO d1_quota_state VALUES(?,?,?,?,?,?,?,?)').bind(day,now.toISOString(),new Date(now.getTime()-60000).toISOString(),new Date(now.getTime()+3600000).toISOString(),1000,1000,'open','TEST quota').run();return {...configured(),D1_READ_GUARD_ENABLED:'true'};}
it('source metadata uses a metered read-only budget and records measured D1 reads',async()=>{
 const cfg=await ready(),r=await monthlySource(new Request('https://source/?part=meta'),cfg);expect(r.status).toBe(200);const b=await r.json<any>();expect(b.cost.rows_written).toBe(0);expect(b.cost.statements).toBe(2);expect(b.data.products).toHaveLength(2);expect(b.cost.rows_read).toBeGreaterThan(0);
 const ledger=await env.DB.prepare('SELECT writes FROM d1_quota_ledger').first<{writes:number}>();expect(ledger?.writes).toBe(8);
});
it('automatic source refresh cannot consume the user write headroom',async()=>{
 const cfg=await ready(),day=new Date().toISOString().slice(0,10);await env.DB.prepare('INSERT INTO d1_quota_ledger VALUES(?,?,?,?)').bind(day,0,60000,new Date().toISOString()).run();
 const r=await monthlySource(new Request('https://source/?part=meta',{headers:{'X-Snapshot-Background':'true'}}),cfg);expect(r.status).toBe(429);expect(await r.json()).toMatchObject({held:true,reason:'BACKGROUND_WRITE_HEADROOM'});
});
it('a completed generation with a mismatching real row count is rejected rather than cached',async()=>{
 const cfg=await ready(),month=snapshotWindow().months[0],day=month+'-01';
 await env.DB.prepare("INSERT INTO dataset_coverage VALUES('gsc',?,'page','fixture',1,0,1,?,'TEST')").bind(day,new Date().toISOString()).run();
 const r=await monthlySource(new Request('https://source/?part=page&month='+month),cfg);expect(r.status).toBe(503);expect(await r.json()).toMatchObject({code:'SNAPSHOT_SOURCE_ROWS_UNVERIFIED'});
});

it('collects one fenced metadata header and both monthly fact scopes without redundant count scans',async()=>{
 const cfg=await ready(),r=await monthlySource(new Request('https://source/?part=header'),cfg);expect(r.status).toBe(200);const header=await r.json<any>();expect(header.cost.statements).toBe(1);expect(header.data.meta.products).toHaveLength(2);expect(header.data.connection).toHaveProperty('credential');expect(header.data.mapping.aliases).toBeInstanceOf(Array);
 const month=snapshotWindow().months[0],result=await monthlySource(new Request('https://source/?part=month&month='+month),cfg);expect(result.status).toBe(200);const b=await result.json<any>();expect(b.cost.statements).toBe(2);expect(b.data.page.rows).toBeInstanceOf(Array);expect(b.data.query.rows).toBeInstanceOf(Array);
});
