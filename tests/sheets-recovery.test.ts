import {beforeEach,it,expect} from 'vitest';
import {init,env,enqueue} from './helpers';
import {hash} from '../src/types';
import pilot from '../src/sheets-recovery-pilot';
import {importEvidence,SHEETS_SOURCE} from '../src/sheets-recovery';
beforeEach(init);
async function record(day='2026-07-01'){
 const content={source:SHEETS_SOURCE,section:'GSC_GUNLUK',family:'site_daily_total',identity:day,start:day,end:day,payload:{clicks:1,impressions:10,manual_note:'TEST preserve unknown fields'}};
 const content_json=JSON.stringify(content);
 return {...content,content_json,source_key:await hash(content_json),provenance:{snapshot_sha256:'a'.repeat(64),retrieved_at:'2026-10-29T19:17:00Z'},daily_page_query_coverage:false as const,source_filters_verified:false as const};
}
it('appends once, retains original provenance and does not complete the pending July job',async()=>{
 await enqueue('gsc','page','2026-07-01');
 const before=await env.DB.prepare('SELECT * FROM sync_jobs').all();
 const r=await record();
 expect(await importEvidence(env,[r])).toMatchObject({inserted:1,daily_jobs_completed:0});
 expect(await importEvidence(env,[{...r,provenance:{...r.provenance,snapshot_sha256:'b'.repeat(64)}}])).toMatchObject({inserted:0,already_present:1});
 expect((await env.DB.prepare('SELECT * FROM sync_jobs').all()).results).toEqual(before.results);
 expect(await env.DB.prepare('SELECT count(*) n FROM dataset_coverage').first('n')).toBe(0);
 const saved=JSON.parse((await env.DB.prepare('SELECT result_json FROM insight_runs').first<{result_json:string}>())!.result_json);
 expect(saved.provenance.snapshot_sha256).toBe('a'.repeat(64));
 expect(saved.payload.manual_note).toBe('TEST preserve unknown fields');
});
it('keeps existing user history byte-identical and imports evidence separately',async()=>{
 await env.DB.prepare("INSERT INTO insight_runs(id,kind,source_key,created_at,result_json) VALUES('TEST legacy','TEST user-history','TEST key','TEST timestamp',?)").bind(JSON.stringify({manualDecisions:['TEST keep'],workRecords:[{note:'TEST user work'}]})).run();
 const original=await env.DB.prepare("SELECT * FROM insight_runs WHERE id='TEST legacy'").first();
 await importEvidence(env,[await record()]);
 expect(await env.DB.prepare("SELECT * FROM insight_runs WHERE id='TEST legacy'").first()).toEqual(original);
});
it('background headroom holds the importer without deleting or resetting anything',async()=>{
 const now=new Date(),day=now.toISOString().slice(0,10);
 await env.DB.prepare('INSERT INTO d1_quota_state VALUES(?,?,?,?,?,?,?,?)').bind(day,now.toISOString(),now.toISOString(),new Date(now.getTime()+3600000).toISOString(),1000,1000,'open','TEST source quota').run();
 await env.DB.prepare('INSERT INTO d1_quota_ledger VALUES(?,?,?,?)').bind(day,1518537,28144,now.toISOString()).run();
 const original=await env.DB.prepare('SELECT * FROM d1_quota_ledger').first();
 await expect(importEvidence({...env,D1_READ_GUARD_ENABLED:'true'},[await record()],now)).rejects.toMatchObject({reason:'BACKGROUND_READ_HEADROOM'});
 expect(await env.DB.prepare('SELECT * FROM d1_quota_ledger').first()).toEqual(original);
 expect(await env.DB.prepare('SELECT count(*) n FROM insight_runs').first('n')).toBe(0);
});
it('records real D1 cost and shared sync writes when fresh quota permits an import',async()=>{
 const now=new Date(),day=now.toISOString().slice(0,10);
 await env.DB.prepare('INSERT INTO d1_quota_state VALUES(?,?,?,?,?,?,?,?)').bind(day,now.toISOString(),now.toISOString(),new Date(now.getTime()+3600000).toISOString(),1000,1000,'open','TEST source quota').run();
 const cfg={...env,D1_READ_GUARD_ENABLED:'true',CATCHUP_ENABLED:'true',SYNC_DAILY_WRITE_LIMIT:'60000'};
 expect(await importEvidence(cfg,[await record(),await record('2026-07-02')],now)).toMatchObject({inserted:2,daily_jobs_completed:0});
 const ledger=await env.DB.prepare('SELECT reads,writes FROM d1_quota_ledger WHERE day=?').bind(day).first<{reads:number;writes:number}>();
 expect(ledger!.reads).toBeGreaterThan(0);expect(ledger!.reads).toBeLessThan(1000000);
 expect(ledger!.writes).toBeGreaterThan(0);expect(ledger!.writes).toBeLessThan(60000);
 expect(Number(await env.DB.prepare("SELECT code FROM health_checks WHERE provider='sync-budget'").first('code'))).toBeGreaterThan(0);
 expect(await env.DB.prepare('SELECT count(*) n FROM d1_query_costs').first('n')).toBeGreaterThan(0);
 expect(await env.DB.prepare('SELECT count(*) n FROM dataset_coverage').first('n')).toBe(0);
});
it('a spent shared sync write budget holds ingestion without raising it',async()=>{
 const now=new Date();await env.DB.prepare("INSERT INTO health_checks VALUES('sync-budget',?,?,'ok','60000')").bind(now.toISOString().slice(0,10),now.toISOString()).run();
 expect(await importEvidence({...env,CATCHUP_ENABLED:'true',SYNC_DAILY_WRITE_LIMIT:'60000'},[await record()],now)).toMatchObject({inserted:0,held:'SYNC_WRITE_BUDGET'});
 expect(await env.DB.prepare("SELECT code FROM health_checks WHERE provider='sync-budget'").first('code')).toBe('60000');
});
it('rejects altered source, hash and fake detailed-coverage flags before any insert',async()=>{
 const r=await record();
 for(const changed of [{source:'TEST wrong sheet'},{content_json:'TEST corrupted'},{daily_page_query_coverage:true}]){
  await expect(importEvidence(env,[{...r,...changed} as typeof r])).rejects.toThrow();
 }
 expect(await env.DB.prepare('SELECT count(*) n FROM insight_runs').first('n')).toBe(0);
});
it('has no unauthenticated endpoint or arbitrary SQL endpoint',async()=>{
 const cfg={...env,RECOVERY_KEY:'TEST loopback key'};
 expect((await pilot.fetch(new Request('http://127.0.0.1/keys'),cfg)).status).toBe(404);
 expect((await pilot.fetch(new Request('http://127.0.0.1/sql',{method:'POST',headers:{Authorization:'Bearer TEST loopback key'},body:'DELETE FROM sync_jobs'}),cfg)).status).toBe(404);
});
