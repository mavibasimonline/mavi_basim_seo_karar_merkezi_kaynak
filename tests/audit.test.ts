import {beforeEach,it,expect} from 'vitest';
import {init,env,connected,enqueue,fetcher} from './helpers';
import {auditSeed,AUDIT_TIME} from './audit-fixtures';
import {analyze,decide,DecisionInput,Decision,saveAnalysis} from '../src/analysis';
import {validateAnalysis} from '../src/validation';
import {claimJob,processJob,insertRows} from '../src/sync';
import {answerQuestion} from '../src/questions';
import {recordAppliedChange,measureOneOutcome} from '../src/outcomes';
import worker from '../src/index';

beforeEach(init);
const evidence=[{id:'audit',source:'GSC',ref:'test-fixture',fetched_at:AUDIT_TIME.toISOString(),scope:{}}];
function base(clicks=100,previous=100,impressions=1000,priorImpressions=1000):DecisionInput{return {current:{clicks,impressions,ctr:clicks/impressions,position:3},previous:{clicks:previous,impressions:priorImpressions,ctr:previous/priorImpressions,position:3},complete:true,fresh:true,periodFinished:true,evidence,protectedQueries:[],deviceMixChanged:false,seasonalityKnown:false};}
const cases:[string,DecisionInput,Decision][]=[
  ['S01: 2→1 tıklama krize dönüşmez',base(1,2),'Koru'],
  ['S02: 200→100 tıklama araştırılır',base(100,200),'İncele'],
  ['S03: 1000→500 gösterim araştırılır',base(10,10,500,1000),'İncele'],
  ['S04: %5 küçük tıklama düşüşü korunur',base(95,100),'Koru'],
  ['S05: 29 tıklama kaybı eşik altındadır',base(71,100),'Koru'],
  ['S06: 30 tıklama ve %20 kayıp eşiktedir',base(120,150),'İncele'],
  ['S07: çok büyük bazda %10 kayıp tek başına öneri olmaz',base(900,1000,10000,10000),'Koru'],
  ['S08: gösterim artışı ve CTR düşüşü başarısızlık değildir',base(120,100,2000,1000),'Koru'],
  ['S09: gösterim artarken gerçek tıklama kaybı gizlenmez',base(50,100,2000,1000),'İncele'],
  ['S10: iki dönemde az gösterim karar üretmez',base(1,2,40,50),'Veri bekle'],
  ['S11: tamamlanmamış dönem bekler',{...base(),periodFinished:false},'Veri bekle'],
  ['S12: gecikmiş veri bekler',{...base(),fresh:false},'Veri bekle'],
  ['S13: eksik günlük kayıt bekler',{...base(),complete:false},'Veri bekle'],
  ['S14: kanıtsız büyük kayıp bekler',{...base(50,100),evidence:[]},'Veri bekle'],
  ['S15: küçük ortalama konum kaybı korunur',{...base(),current:{...base().current,position:3.4}},'Koru'],
  ['S16: 3→12 konum kaybı sabit tıklamada da araştırılır',{...base(),current:{...base().current,position:12}},'İncele'],
  ['S17: az örneklemde konum kaybı kesinleşmez',{...base(10,10,150,150),current:{clicks:10,impressions:150,ctr:10/150,position:12}},'Koru'],
  ['S18: konum iyileşmesi gereksiz değişiklik üretmez',{...base(),previous:{...base().previous,position:12}},'Koru'],
  ['S19: mevsimsel kapsam yokken kayıp yalnız araştırılır',{...base(50,100),seasonalityKnown:false},'İncele'],
  ['S20: yıllık veri varlığı düşüşün nedenini kanıtlamaz',{...base(50,100),seasonalityKnown:true},'İncele'],
  ['S21: NaN ölçüm koru kararı üretemez',{...base(),current:{...base().current,clicks:NaN}},'Veri bekle'],
  ['S22: negatif ölçüm karar üretemez',{...base(),current:{...base().current,clicks:-1}},'Veri bekle'],
  ['S23: yanlış CTR karar üretemez',{...base(),current:{...base().current,ctr:0.8}},'Veri bekle'],
  ['S24: sıfırdan başlayan trafik müdahale gerektirmez',base(100,0,1000,1000),'Koru'],
];
it.each(cases)('%s',(name,input,expected)=>{const result=decide(input);expect(result.decision).toBe(expected);expect(result.calculation).toBeTruthy();expect(result.decision).not.toBe('İyileştir');});
it('S25: mobil kayıp toplam masaüstü artışı altında gizlenmez',async()=>{
  await auditSeed();
  await env.DB.prepare("UPDATE gsc_daily_by_page SET clicks=1,ctr=0.01 WHERE date>='2026-09-01'").run();
  await env.DB.prepare("INSERT INTO gsc_daily_by_page SELECT dataset_id,date,page,country,'DESKTOP',CASE WHEN date>='2026-09-01' THEN 30 ELSE 1 END,100,CASE WHEN date>='2026-09-01' THEN 0.3 ELSE 0.01 END,3 FROM gsc_daily_by_page").run();
  const p=(await analyze(env,'2026-09',AUDIT_TIME)).products.find(p=>p.id==='brosur')!;
  expect(p.current!.clicks).toBeGreaterThan(p.previous!.clicks);expect(p.decision).toBe('İncele');expect(p.devices.find(d=>d.device==='MOBILE')!.decision).toBe('İncele');expect(p.devices.find(d=>d.device==='DESKTOP')!.decision).toBe('Koru');
});
it('S26: markasız kayıp marka artışı altında gizlenmez',async()=>{
  await auditSeed();
  await env.DB.prepare("UPDATE gsc_daily_by_query_device SET clicks=1,ctr=0.01 WHERE date>='2026-09-01'").run();
  await env.DB.prepare("INSERT INTO gsc_daily_by_query_device SELECT dataset_id,date,page,'Mavi Basım',country,device,1,CASE WHEN date>='2026-09-01' THEN 30 ELSE 1 END,100,CASE WHEN date>='2026-09-01' THEN 0.3 ELSE 0.01 END,3 FROM gsc_daily_by_query_device").run();
  const p=(await analyze(env,'2026-09',AUDIT_TIME)).products.find(p=>p.id==='brosur')!;expect(p.decision).toBe('İncele');expect(p.reason).toContain('markasız');
});
it('S27: iki farklı ürün aynı sorguda görünürse yönlendirme önerilmez',async()=>{
  await auditSeed();await env.DB.prepare("INSERT INTO gsc_daily_by_query_device SELECT dataset_id,date,'https://mavibasim.com/el-ilani',query,country,device,is_brand,clicks,impressions,ctr,position FROM gsc_daily_by_query_device").run();
  const report=await analyze(env,'2026-09',AUDIT_TIME);expect(report.collisions).toEqual(expect.arrayContaining([expect.objectContaining({query:'broşür baskı',pages:expect.arrayContaining(['https://mavibasim.com/brosur','https://mavibasim.com/el-ilani'])})]));expect(JSON.stringify(report.collisions)).toContain('tek başına sorun');
});
it('S28: eksik eski başarılı sorgu sıfır sayılmaz ve koruma listesinde kalır',async()=>{
  await auditSeed();await env.DB.prepare("DELETE FROM gsc_daily_by_query_device WHERE date>='2026-09-01'").run();
  const p=(await analyze(env,'2026-09',AUDIT_TIME)).products.find(p=>p.id==='brosur')!;expect(p.queries[0]).toMatchObject({clicks:null,missing_current:true,protect:true});expect(p.risk).toContain('zarar');
});
it('S29: ilk 100 sorgu dışındaki başarılı geçmiş sorgunun koruması kaybolmaz',async()=>{
  await auditSeed();await env.DB.prepare("DELETE FROM gsc_daily_by_query_device WHERE date>='2026-09-01'").run();
  await env.DB.batch(insertRows(env.DB,'gsc_daily_by_query_device',Array.from({length:101},(_,i)=>({dataset_id:'audit:2026-09-01:query',date:'2026-09-01',page:'https://mavibasim.com/brosur',query:`yeni sorgu ${i}`,country:'tur',device:'MOBILE',is_brand:0,clicks:1,impressions:20,ctr:0.05,position:4}))));
  const p=(await analyze(env,'2026-09',AUDIT_TIME)).products.find(p=>p.id==='brosur')!;expect(p.queries.some(q=>q.query==='broşür baskı'&&q.protect)).toBe(true);expect(p.decision).toBe('Veri bekle');expect(p.missing.join()).toContain('sorgu');
});
for(const [id,patch] of [['S30',"DELETE FROM health_checks WHERE provider='gsc'"],['S31',"UPDATE health_checks SET checked_at='2026-10-01T00:00:00Z' WHERE provider='gsc'"],['S32',"UPDATE health_checks SET checked_at='2026-10-24T00:00:00Z' WHERE provider='gsc'"],['S33',"UPDATE dataset_coverage SET fetched_at='2026-10-24T00:00:00Z'"],['S34',"UPDATE products SET url_verified_at=NULL"],['S35',"DELETE FROM oauth_credentials"]]){
  it(`${id}: eksik, eski, gelecek tarihli veya doğrulanmamış kanıtla karar verilmez`,async()=>{await auditSeed();await env.DB.prepare(patch).run();const p=(await analyze(env,'2026-09',AUDIT_TIME)).products.find(p=>p.id==='brosur')!;expect(p.decision).toBe('Veri bekle');});
}
it('S36: başlık değişiminin ertesi günü kesin başarı iddiası üretilmez',async()=>{
  await auditSeed();const report=await analyze(env,'2026-09',AUDIT_TIME);await saveAnalysis(env,report);const id=await recordAppliedChange(env,{recommendation_id:report.id+':brosur',applied_at:'2026-10-22T10:00:00Z',evidence:'Sentetik denetim değişiklik beyanı',old:{title:'Broşür baskı'},new:{title:'Yeni başlık'}});await measureOneOutcome(env,AUDIT_TIME);
  expect((await env.DB.prepare("SELECT count(*) n FROM outcome_windows WHERE applied_change_id=? AND status='measured'").bind(id).first<{n:number}>())!.n).toBe(0);
  const answer=await answerQuestion(env,report,'Broşür başlığı dün değişti; başarının nedeni bu mu?') as {text:string};expect(answer.text).toContain('kanıtlayamam');
});
it('S37: yüksek Planner hacmi düşük ticari niyette fırsat uydurmaz',async()=>{
  await auditSeed();await env.DB.prepare("INSERT INTO keyword_catalog VALUES('low-intent','brosur','ücretsiz broşür örnekleri','ucretsiz brosur ornekleri')").run();
  await env.DB.prepare("INSERT INTO keyword_sources(id,product_id,path,sha256,exported_at,period_label,header_json,imported_at,row_count) VALUES('planner-fixture','brosur','TEST-ONLY.csv','test','2026-10-01','test','[]','2026-10-01',1)").run();
  await env.DB.prepare("INSERT INTO keyword_metric_observations(source_id,row_number,keyword_id,avg_monthly_searches,advertiser_competition,monthly_json,raw_cells_json) VALUES('planner-fixture',4,'low-intent',1000000,'Low','[]','[]')").run();
  const report=await analyze(env,'2026-09',AUDIT_TIME);const p=report.products.find(p=>p.id==='brosur')!;expect(p.decision).toBe('Koru');expect(p.queries.some(q=>q.query==='ücretsiz broşür örnekleri')).toBe(false);
});
it('S38: bağımsız doğrulama NaN ölçümü ve kanıtsız iyileştirme kararını reddeder',async()=>{
  await auditSeed();const report=await analyze(env,'2026-09',AUDIT_TIME);const p=report.products.find(p=>p.id==='brosur')!;p.current!.clicks=NaN;p.decision='İyileştir';
  const errors=await validateAnalysis(env,report);expect(errors.join()).toContain('NON_FINITE');expect(errors.join()).toContain('UNSUPPORTED_IMPROVEMENT');
});
it('S39: hatalı yeniden senkron önceki sağlam dataset kaydını aktifte tutar',async()=>{
  const cfg=await connected();await enqueue();await env.DB.prepare("INSERT INTO dataset_coverage VALUES('gsc','2026-09-01','page','old-valid',1,0,1,'2026-10-22T00:00:00Z','previous valid snapshot')").run();
  const job=(await claimJob(cfg))!;await processJob(cfg,job,fetcher(async()=>Response.json({responseAggregationType:'byPage',metadata:{first_incomplete_date:'2026-09-01'},rows:[]})));
  expect(await env.DB.prepare('SELECT dataset_id,complete FROM dataset_coverage').first()).toMatchObject({dataset_id:'old-valid',complete:1});
  expect(await env.DB.prepare("SELECT status FROM health_checks WHERE provider='gsc'").first()).toMatchObject({status:'partial'});
});
it('S40: ürün parametresindeki SQL enjeksiyonu kaynak tablolarını değiştiremez',async()=>{
  const response=await worker.fetch(new Request('https://app.example/api/keywords?product='+encodeURIComponent("brosur'; DROP TABLE products;--"),{headers:{Authorization:`Bearer ${env.ADMIN_TOKEN}`}}),env);expect(response.status).toBe(200);expect(await response.json()).toMatchObject({rows:[]});expect((await env.DB.prepare('SELECT count(*) n FROM products').first<{n:number}>())!.n).toBe(2);
});
it('S41: geçmişte tamamlanmış GA4 günleri başarısız güncel bağlantıyı gizleyemez',async()=>{
  await auditSeed();
  const {dates,monthPeriod}=await import('../src/analysis');
  await env.DB.batch(insertRows(env.DB,'dataset_coverage',dates(monthPeriod('2026-09')).map(day=>({provider:'ga4',day,scope:'organic',dataset_id:`ga4:${day}`,complete:1,query_partial:0,row_count:1,fetched_at:AUDIT_TIME.toISOString(),notes:'test'}))));
  await env.DB.prepare("INSERT INTO ga4_daily_by_city_device VALUES('ga4:2026-09-01','2026-09-01','/brosur','Türkiye','İstanbul','mobile',50,40,NULL)").run();
  await env.DB.prepare("INSERT INTO health_checks VALUES('ga4','2026-10-23',?,'failed','GOOGLE_HTTP_403')").bind(AUDIT_TIME.toISOString()).run();
  const report=await analyze({...env,GA4_PROPERTY_ID:'123'},'2026-09',AUDIT_TIME);expect(report.region).toBeNull();
});
