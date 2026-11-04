import {beforeEach,afterEach,it,expect,vi} from 'vitest';
import {env} from 'cloudflare:workers';
import {reset,runInDurableObject} from 'cloudflare:test';
import type {IndependentDriveEnv} from '../../src/drive-independent';
import {encrypt} from '../../src/security';
import main from '../../src/index';

const cfg=env as IndependentDriveEnv;
const stub=()=>cfg.DRIVE_ARCHIVE_STORE.get(cfg.DRIVE_ARCHIVE_STORE.idFromName('mavi-basim-sheets-drive-v2'));
const hash=async(raw:string)=>[...new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(raw)))].map(v=>v.toString(16).padStart(2,'0')).join('');
function closedMonth(){const at=new Date(Date.now()-7*86400000);at.setUTCDate(1);at.setUTCMonth(at.getUTCMonth()-1);return at.toISOString().slice(0,7);}
async function proof(scope:'page'|'query'){
 const day=closedMonth()+'-01',generation=crypto.randomUUID(),captured_at=new Date().toISOString();
 const row={date:day,page:'https://mavibasim.com/brosur',country:'tur',device:'DESKTOP',clicks:1,impressions:10,ctr:0.1,position:4,...(scope==='query'?{query:'broşür baskı',is_brand:0}:{})};
 const raw=JSON.stringify([row]),bytes=new TextEncoder().encode(raw),sealed=await encrypt({chunk:btoa(String.fromCharCode(...bytes))},cfg.ARCHIVE_ENCRYPTION_KEY!);
 const manifest={day,scope,generation,captured_at,rows:1,pages:1,query_partial:scope==='query',source:'GSC Search Analytics API',d1_requests:0,page_proofs:[{index:0,count:1,bytes:bytes.length,chunks:1,sha256:await hash(raw)}]};
 const chunkKey='gsc:part:'+day+':'+scope+':'+generation+':0:0';
 await runInDurableObject(stub(),async(_instance,state)=>{
  await state.storage.put(chunkKey,sealed);await state.storage.put('gsc:daily:'+day+':'+scope,manifest);
  await state.storage.put('gsc:history:'+day+':'+scope+':'+generation,manifest);
 });
 return {day,manifest,chunkKey};
}
beforeEach(async()=>{await reset();});
afterEach(()=>vi.restoreAllMocks());

it('reads stored GSC status, months, analyses and questions while the independent Sheets source is unavailable',async()=>{
 expect('DB' in cfg).toBe(false);
 await proof('page');await proof('query');
 const fetcher=vi.spyOn(globalThis,'fetch').mockRejectedValue(Error('TEST Sheets unavailable'));
 for(const path of ['/api/independent/gsc-status','/api/independent/gsc-month?month='+closedMonth(),'/api/independent/gsc-analysis?month='+closedMonth()]){
  const response=await stub().fetch('https://archive.private'+path);
  expect(response.status).toBe(200);
  const body=await response.json<any>();expect(body.d1_requests).toBe(0);
  if(path.includes('gsc-month'))expect(body).toMatchObject({days_verified:1,query_days_verified:1,available:false,total_clicks:null,observed_clicks:1});
 }
 for(const path of ['/api/independent/gsc-questions','/api/independent/questions']){
  const response=await stub().fetch('https://archive.private'+path,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({question:'Broşür mobilde hangi sorgularda görünüyor?',month:closedMonth()})});
  expect(response.status).toBe(200);expect(await response.json()).toMatchObject({d1_requests:0,decision:'Veri bekle'});
 }
 expect(fetcher).not.toHaveBeenCalled();
 await runInDurableObject(stub(),async(_instance,state)=>expect(await state.storage.get('independent:snapshot:v2')).toBeUndefined());
});

it('the private daily proof endpoint reads and validates encrypted chunks and never returns query rows',async()=>{
 const saved=await proof('query');
 const fetcher=vi.spyOn(globalThis,'fetch').mockRejectedValue(Error('TEST network unavailable'));
 const url='https://archive.private/api/internal/gsc-proof?day='+saved.day+'&scope=query';
 const response=await stub().fetch(url),body=await response.json<any>();
 expect(response.status).toBe(200);expect(body).toMatchObject({available:true,verified:true,day:saved.day,scope:'query',rows:1,pages:1,d1_requests:0});
 expect(JSON.stringify(body)).not.toMatch(/broşür baskı|mavibasim\.com|access_token/);
 await runInDurableObject(stub(),async(_instance,state)=>state.storage.put(saved.chunkKey,'TEST damaged encrypted chunk'));
 const damaged=await stub().fetch(url);expect(damaged.status).toBeGreaterThanOrEqual(400);
 expect(await damaged.json()).not.toMatchObject({verified:true});
 expect(fetcher).not.toHaveBeenCalled();
});

it('quota and OAuth holds cannot be reopened through the private recovery route and no D1 binding exists',async()=>{
 expect('DB' in cfg).toBe(false);
 const day=new Date(Date.now()-3*86400000).toISOString().slice(0,10),until=new Date(Date.now()+3600000).toISOString();
 const fetcher=vi.spyOn(globalThis,'fetch').mockRejectedValue(Error('TEST no external access'));
 for(const code of ['GSC_HTTP_429','GSC_HTTP_503','GSC_OAUTH_RECONNECT_REQUIRED','GSC_STORAGE_DAILY_LIMIT']){
  await runInDurableObject(stub(),async(_instance,state)=>state.storage.put('gsc:held:'+day+':page',{until:Date.parse(until),code}));
  const response=await stub().fetch('https://archive.private/api/internal/gsc-retry',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({day,scope:'page',until,code})});
  expect(response.status).toBeGreaterThanOrEqual(400);
  await runInDurableObject(stub(),async(_instance,state)=>expect(await state.storage.get('gsc:held:'+day+':page')).toEqual({until:Date.parse(until),code}));
 }
 await runInDurableObject(stub(),async(_instance,state)=>expect((await state.storage.list({prefix:'gsc:recovery:'})).size).toBe(0));
 expect(fetcher).not.toHaveBeenCalled();
});

it('redelivery of a Cron slot returns its immutable receipt without another Google call',async()=>{
 const imported=await stub().fetch('https://archive.private/api/internal/gsc-import',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({scope:'https://www.googleapis.com/auth/webmasters.readonly',refresh_token:'fixture-existing-google-refresh-token-for-gsc'})});
 expect(imported.status).toBe(200);
 const day=new Date(Date.now()-3*86400000).toISOString().slice(0,10),slot=new Date();slot.setUTCMinutes(Math.floor(slot.getUTCMinutes()/15)*15,0,0);
 const fetcher=vi.spyOn(globalThis,'fetch').mockImplementation(async()=>Response.json({responseAggregationType:'byPage',rows:[{keys:[day,'https://mavibasim.com/brosur','tur','DESKTOP'],clicks:1,impressions:10,ctr:0.1,position:4}]}));
 const request=()=>stub().fetch('https://archive.private/api/internal/gsc-tick',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({source:'cloudflare-cron',scheduled_at:slot.toISOString()})});
 const first=await request();expect(first.status).toBe(200);expect(await first.json()).toMatchObject({status:'complete',rows:1,d1_requests:0});
 const duplicate=await request();expect(duplicate.status).toBe(200);
 expect(await duplicate.json()).toMatchObject({source:'Cloudflare Cron',scheduled_at:slot.toISOString(),status:'complete',rows:1,d1_requests:0});
 expect(fetcher).toHaveBeenCalledTimes(1);
 const coverage=await stub().fetch('https://archive.private/api/internal/gsc-coverage');
 expect(await coverage.json()).toMatchObject({cron:{last:{source:'Cloudflare Cron',scheduled_at:slot.toISOString()},days:[{attempts:1,completed:1}]}});
});

it('public application paths never expose or forward private GSC endpoints without an authenticated session',async()=>{
 const archive={fetch:vi.fn(async()=>Response.json({TEST:'must not be reached'}))};
 const bindings={ADMIN_TOKEN:'TEST owner secret',DRIVE_ARCHIVE_SERVICE:archive,DB:{prepare(){throw Error('TEST unexpected D1 access');}}} as any;
 for(const [path,method] of [['/api/internal/gsc-bootstrap-status','GET'],['/api/internal/gsc-bootstrap-tick','POST'],['/api/internal/evidence-context?details=1','GET'],['/api/internal/gsc-status','GET'],['/api/internal/gsc-proof?day=2026-10-01&scope=page','GET'],['/api/internal/gsc-retry','POST'],['/api/independent/gsc-status','GET'],['/api/independent/gsc-questions','POST']]){
  const response=await main.fetch(new Request('https://app.example'+path,{method}),bindings);
  expect(response.status).toBe(401);
 }
 expect(archive.fetch).not.toHaveBeenCalled();
});

it('routes a verified product question to complete real GSC evidence before contacting Sheets',async()=>{
 const {buildIndependentContext,saveIndependentContext}=await import('../../src/independent-context');
 const month=closedMonth(),prior=new Date(month+'-01T00:00:00Z');prior.setUTCMonth(prior.getUTCMonth()-1);
 const months=[month,prior.toISOString().slice(0,7)],captured_at=new Date().toISOString(),page='https://mavibasim.com/verified-brochure';
 await runInDurableObject(stub(),async(_instance,state)=>{
  const context=await buildIndependentContext({captured_at,products:[{id:'brosur',name:'Broşür',canonical_url:page,url_verified_at:captured_at}],snapshots:[],changes:[]});
  await saveIndependentContext(state.storage,context);
  for(const m of months){
   const count=new Date(Number(m.slice(0,4)),Number(m.slice(5)),0).getDate();
   for(let n=1;n<=count;n++){
    const day=m+'-'+String(n).padStart(2,'0'),generation=crypto.randomUUID();
    const raw=JSON.stringify([{date:day,page,country:'tur',device:'DESKTOP',clicks:1,impressions:10,ctr:.1,position:4}]),bytes=new TextEncoder().encode(raw);
    await state.storage.put('gsc:part:'+day+':page:'+generation+':0:0',await encrypt({chunk:btoa(String.fromCharCode(...bytes))},cfg.ARCHIVE_ENCRYPTION_KEY!));
    await state.storage.put('gsc:daily:'+day+':page',{day,scope:'page',generation,captured_at,rows:1,pages:1,query_partial:false,source:'GSC Search Analytics API',d1_requests:0,page_proofs:[{index:0,count:1,bytes:bytes.length,chunks:1,sha256:await hash(raw)}]});
   }
  }
 });
 const network=vi.spyOn(globalThis,'fetch').mockRejectedValue(Error('TEST Sheets must not be read'));
 const response=await stub().fetch('https://archive.private/api/independent/questions',{method:'POST',body:JSON.stringify({question:'Broşür nasıl gidiyor?',month})});
 const result=await response.json<any>();expect(response.status).toBe(200);expect(result.d1_requests).toBe(0);expect(result.mapping_evidence.source_hash).toMatch(/^[a-f0-9]{64}$/);
 expect(new Set(result.evidence_refs.map((r:any)=>r.day.slice(0,7)))).toEqual(new Set(months));expect(network).not.toHaveBeenCalled();
});
