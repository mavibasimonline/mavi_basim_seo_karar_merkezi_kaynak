import {beforeEach,it,expect} from 'vitest';
import {env} from 'cloudflare:workers';
import {reset,runInDurableObject} from 'cloudflare:test';
import type {MonthlyStoreEnv,MonthlySnapshotStore} from '../../src/monthly-store';
import type {MonthlyBundle} from '../../src/monthly-model';
import {monthPeriod,dates} from '../../src/analysis';
const cfg=env as MonthlyStoreEnv,stub=()=>cfg.MONTHLY_STORE.get(cfg.MONTHLY_STORE.idFromName('verified-monthly-seo-v1'));
beforeEach(async()=>{await reset();});
function bundle():MonthlyBundle{
 const captured_at=new Date().toISOString(),coverage:any[]=[],pages:any[]=[],queries:any[]=[];
 for(const month of ['2026-06','2026-07','2026-08','2026-09'])for(const day of dates(monthPeriod(month)))for(const scope of ['page','query']){
  const dataset_id=scope+day,clicks=month==='2026-06'?1:month==='2026-07'?2:month==='2026-08'?3:4;
  coverage.push({provider:'gsc',day,scope,dataset_id,complete:1,query_partial:Number(scope==='query'),row_count:1,fetched_at:captured_at,notes:'SYNTHETIC TEST ONLY'});
  const row={dataset_id,date:day,page:'https://mavibasim.com/brosur',device:'MOBILE',country:'ALL',clicks,impressions:100,position:3,source_rows:1,invalid_rows:0};
  (scope==='page'?pages:queries).push(scope==='query'?{...row,query:'broşür baskı',is_brand:0}:row);
 }
 return {format:'verified-monthly-source-v1',site:'https://mavibasim.com',captured_at,window:{months:['2026-07','2026-08','2026-09'],start:'2026-06-01',end:'2026-09-30'},revision:'a'.repeat(64),contexts:[],flags:{automation_enabled:true,catchup_enabled:true,crawl_enabled:false},cost:{rows_read:244,statements:4},evidence:{products:[{id:'brosur',name:'Broşür',canonical_url:'https://mavibasim.com/brosur',url_verified_at:captured_at,group_name:'Basım',keyword_sources:1,keyword_rows:3}],coverage,pages,queries,counts:[{product_id:'brosur',sources:1,rows:3}],credential:{present:1},health:[{provider:'gsc',status:'ok',code:null,checked_at:captured_at}],aliases:[],mappedPages:[]}};
}
async function seed(b=bundle()){return stub().fetch('https://store.internal/seed',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(b)});}
it('serves independently validated July/August/September reports, measured performance and persisted questions with no D1 binding',async()=>{
 expect('DB' in cfg).toBe(false);expect((await seed()).status).toBe(200);
 for(const month of ['2026-07','2026-08','2026-09']){
  const r=await stub().fetch('https://store.internal/report?month='+month);expect(r.status).toBe(200);const report=await r.json<any>();expect(report.snapshot.d1_requests).toBe(0);expect(report.products[0].queries[0].protect).toBe(true);expect(report.snapshot.source_updated_at).toBeTruthy();
 }
 const first=await (await stub().fetch('https://store.internal/questions',{method:'POST',body:JSON.stringify({question:'Broşür Ağustos 2026 performansı nedir?',month:'2026-08'})})).json<any>();
 expect(first.current.clicks).toBe(93);expect(first.previous.clicks).toBe(62);expect(first.snapshot.d1_requests).toBe(0);
 const follow=await (await stub().fetch('https://store.internal/questions',{method:'POST',body:JSON.stringify({question:'Peki mobilde?',month:'2026-08',previous_question_id:first.question_id})})).json<any>();expect(follow.context.product_id).toBe('brosur');expect(follow.context.device).toBe('MOBILE');expect(follow.current.clicks).toBe(93);
});
it('retains the preceding verified cache and its timestamps when automatic refresh is budget-blocked',async()=>{
 expect((await seed()).status).toBe(200);
 const before=await (await stub().fetch('https://store.internal/report?month=2026-08')).json<any>();
 await runInDurableObject(stub(),async(instance,state)=>{await (instance as MonthlySnapshotStore).alarm();await state.storage.deleteAlarm();expect(await state.storage.get('last_error')).toMatchObject({code:'LOCAL_READ_LIMIT'});});
 const after=await (await stub().fetch('https://store.internal/report?month=2026-08')).json<any>();expect(after.id).toBe(before.id);expect(after.snapshot.validated_at).toBe(before.snapshot.validated_at);expect(after.snapshot.refresh_pending).toBe(true);
});
it('failed row-generation validation never replaces valid monthly evidence',async()=>{
 expect((await seed()).status).toBe(200);const b=bundle();b.evidence.coverage[0].row_count=2;
 expect((await seed(b)).status).toBe(503);expect((await stub().fetch('https://store.internal/report?month=2026-07')).status).toBe(200);
});
it('a missing month, missing context and missing evidence never become invented traffic or SEO answers',async()=>{
 expect((await seed()).status).toBe(200);expect((await stub().fetch('https://store.internal/report?month=2026-01')).status).toBe(503);
 const r=await stub().fetch('https://store.internal/questions',{method:'POST',body:JSON.stringify({question:'Broşür neden düştü?',month:'2026-08',previous_question_id:'11111111-1111-4111-8111-111111111111'})});expect(r.status).toBe(400);
 const b=bundle();b.evidence.coverage=b.evidence.coverage.filter(c=>!c.day.startsWith('2026-07'));b.evidence.pages=b.evidence.pages.filter(r=>!r.date.startsWith('2026-07'));b.evidence.queries=b.evidence.queries.filter(r=>!r.date.startsWith('2026-07'));
 expect((await seed(b)).status).toBe(200);const missing=await (await stub().fetch('https://store.internal/report?month=2026-07')).json<any>();expect(missing.products[0].current).toBeNull();expect(missing.products[0].decision).toBe('Veri bekle');
});
