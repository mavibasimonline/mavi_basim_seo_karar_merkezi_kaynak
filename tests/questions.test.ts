import {beforeEach,it,expect} from 'vitest';
import {init,env} from './helpers';
import {auditSeed} from './audit-fixtures';
import {analyze,saveAnalysis} from '../src/analysis';
import {prepareQuestion,parseQuestion,answerQuestion} from '../src/questions';
import worker from '../src/index';
import {insertRows} from '../src/sync';

beforeEach(async()=>{
 await init();await auditSeed();
 const stamp=new Date().toISOString();await env.DB.prepare('UPDATE health_checks SET checked_at=?').bind(stamp).run();await env.DB.prepare('UPDATE dataset_coverage SET fetched_at=?').bind(stamp).run();
 await env.DB.prepare("INSERT INTO products(id,group_id,name,source_folder,canonical_url,url_verified_at) VALUES('kartvizit','print','Kartvizit','group/kartvizit','https://mavibasim.com/kartvizit','2026-10-23'),('zarf','print','Zarf','group/zarf','https://mavibasim.com/zarf','2026-10-23')").run();
});
const cases:[string,string,string|null,string|null,string][]=[
 ['Broşür sayfam neden düştü?','performance','brosur',null,'2026-09'],
 ['Son 30 günde hangi ürünler yükseldi?','rising',null,null,'2026-09'],
 ['Hangi kelimelerde gösterim artıyor ama tıklama gelmiyor?','query_ctr',null,null,'2026-09'],
 ['Kartvizit sayfamda hangi kelimeleri korumalıyım?','protect','kartvizit',null,'2026-09'],
 ['Zarf sayfam için en önemli fırsat nedir?','opportunity','zarf',null,'2026-09'],
 ['Mobilde düşüş yaşayan sayfalar hangileri?','mobile_loss',null,'MOBILE','2026-09'],
 ['Son yaptığımız SEO değişiklikleri işe yaradı mı?','outcomes',null,null,'2026-09'],
 ['Hangi sayfalar ikinci sayfadan birinci sayfaya yaklaşmış?','ranking',null,null,'2026-09'],
 ['Hangi ürünlerde veri yetersiz?','insufficient',null,null,'2026-09'],
 ['Bu ay hangi üç ürüne öncelik vermeliyim?','priorities',null,null,new Date().toISOString().slice(0,7)],
 ['Broşür mobilde neden geriledi?','performance','brosur','MOBILE','2026-09'],
 ['Broşür masaüstünde neden düştü?','performance','brosur','DESKTOP','2026-09'],
 ['El İlanı neden düştü?','performance','el-ilani',null,'2026-09'],
 ['Broşür Eylül 2026 performansı nedir?','performance','brosur',null,'2026-09'],
 ['Broşür 2026-08 performansı nedir?','performance','brosur',null,'2026-08'],
 ['Hangi ürünler yükseliyor?','rising',null,null,'2026-09'],
 ['Hangi başarılı kelimelere dokunmayalım?','protect',null,null,'2026-09'],
 ['Broşür için hangi kelimeleri koru?','protect','brosur',null,'2026-09'],
 ['Kartvizit mobilde hangi kelimeleri korumalıyım?','protect','kartvizit','MOBILE','2026-09'],
 ['Zarf için fırsat var mı?','opportunity','zarf',null,'2026-09'],
 ['Broşür İstanbul verisi var mı?','region','brosur',null,'2026-09'],
 ['İstanbul mobilde nasıl?','region',null,'MOBILE','2026-09'],
 ['Bu ay hangi ürünlerin verisi eksik?','insufficient',null,null,new Date().toISOString().slice(0,7)],
 ['Hangi ürünlere öncelik vereyim?','priorities',null,null,'2026-09'],
 ['Broşür gösterim artarken tıklama neden yok?','query_ctr','brosur',null,'2026-09'],
 ['Broşür hangi sorgularda ilk sayfaya yaklaşıyor?','ranking','brosur',null,'2026-09'],
 ['Son 28 günde hangi ürünler yükseliyor?','rising',null,null,'2026-09'],
 ['Broşür SEO değişiklikleri nasıl sonuçlandı?','outcomes','brosur',null,'2026-09'],
 ['Broşür dün değişti, kesin sebep bu mu?','performance','brosur',null,'2026-09'],
 ['Hangi sayfalarda veri yetersiz?','insufficient',null,null,'2026-09'],
];
it.each(cases)('Türkçe kabul: %s',async(question,intent,product,device,month)=>{
 const response=await worker.fetch(new Request('https://app.example/api/questions',{method:'POST',headers:{Authorization:`Bearer ${env.ADMIN_TOKEN}`,'Content-Type':'application/json'},body:JSON.stringify({question,month:'2026-09'})}),env);
 expect(response.status).toBe(200);const a=await response.json() as any;
 expect(a.intent).toBe(intent);expect(a.context.product_id).toBe(product);expect(a.context.device).toBe(device);expect(a.context.month).toBe(month);
 expect(a.source).toBe(intent==='region'?'GA4':intent==='outcomes'?'GSC + SEO değişiklik hafızası':'GSC');
 expect(a.period.start).toBeTruthy();expect(a.comparison_period.end).toBeTruthy();expect(a.sections.action).toBeTruthy();expect(a.measured_at).toBeTruthy();expect(a.question_id).toBeTruthy();
 if(product&&intent==='performance')expect(a.url).toBe(`https://mavibasim.com/${product}`);
});
it('takip soruları ürün, cihaz ve tarih bağlamını sunucudaki kayıttan korur',async()=>{
 const report=await analyze(env,'2026-09');await saveAnalysis(env,report);
 const a=await answerQuestion(env,report,'Broşür neden düştü?') as any;
 const mobile=await prepareQuestion(env,'Peki mobilde?','2026-09',a.question_id);expect(mobile.context).toMatchObject({product_id:'brosur',device:'MOBILE',month:'2026-09'});
 const filtered=await analyze(env,'2026-09',new Date(),{device:'MOBILE'});await saveAnalysis(env,filtered);const b=await answerQuestion(env,filtered,'Peki mobilde?',mobile) as any;
 const comparison=await prepareQuestion(env,'Geçen ayla karşılaştır','2026-09',b.question_id);expect(comparison.context).toMatchObject({product_id:'brosur',device:'MOBILE',month:'2026-09'});
 const c=await prepareQuestion(env,'Peki masaüstünde?','2026-09',b.question_id);expect(c.context.device).toBe('DESKTOP');
 const all=await prepareQuestion(env,'Hangi ürünler yükseldi?','2026-09',b.question_id);expect(all.context.product_id).toBeNull();expect(all.context.device).toBeNull();
 const changed=await prepareQuestion(env,'Peki mobilde?','2026-08',b.question_id);expect(changed.context.product_id).toBeNull();
});
it('son 30 gün gerçek eşit uzunlukta iki kesinleşmiş pencere kullanır',async()=>{
 const plan=parseQuestion('Son 30 günde hangi ürünler yükseldi?',[], '2026-09',undefined,new Date('2026-10-23T12:00:00Z'));
 expect(plan.period).toMatchObject({start:'2026-09-20',end:'2026-10-19',days:30});expect(plan.previous).toMatchObject({start:'2026-08-21',end:'2026-09-19',days:30});
 const report=await analyze(env,'2026-09',new Date('2026-10-23T12:00:00Z'),{current:plan.period,previous:plan.previous});expect(report.missing.join()).toContain('eksik');
});
it('tam gerçek şemalı günlük veriyle 30 günlük artışı aylık toplamla karıştırmaz',async()=>{
 const plan=parseQuestion('Son 30 günde hangi ürünler yükseldi?',[],'2026-09');
 await env.DB.batch([env.DB.prepare('DELETE FROM gsc_daily_by_page'),env.DB.prepare('DELETE FROM gsc_daily_by_query_device'),env.DB.prepare('DELETE FROM dataset_coverage')]);
 const stamp=new Date().toISOString(),rows=[],coverage=[];
 for(let i=0;i<60;i++){
   const day=new Date(Date.parse(plan.previous!.start)+i*86400_000).toISOString().slice(0,10),clicks=i<30?10:20;
   for(const scope of ['page','query'])coverage.push({provider:'gsc',day,scope,dataset_id:`qa:${day}:${scope}`,complete:1,query_partial:Number(scope==='query'),row_count:1,fetched_at:stamp,notes:'SYNTHETIC TEST ONLY'});
   rows.push({dataset_id:`qa:${day}:page`,date:day,page:'https://mavibasim.com/brosur',country:'tur',device:'MOBILE',clicks,impressions:100,ctr:clicks/100,position:3});
 }
 await env.DB.batch(insertRows(env.DB,'dataset_coverage',coverage));await env.DB.batch(insertRows(env.DB,'gsc_daily_by_page',rows));await env.DB.batch(insertRows(env.DB,'gsc_daily_by_query_device',rows.map(r=>({...r,dataset_id:`qa:${r.date}:query`,query:'broşür baskı',is_brand:0}))));
 const report=await analyze(env,plan.context.month,new Date(),{current:plan.period,previous:plan.previous});await saveAnalysis(env,report);
 const answer=await answerQuestion(env,report,'Son 30 günde hangi ürünler yükseldi?',plan) as any;
 expect(answer.products[0]).toMatchObject({product_id:'brosur',current:{clicks:600},previous:{clicks:300},change:{clicks:300}});expect(answer.period.days).toBe(30);expect(answer.comparison_period.days).toBe(30);
});
it('bağlam enjeksiyonu, bilinmeyen kayıt ve gelecek ay reddedilir',async()=>{
 await expect(prepareQuestion(env,'Peki mobilde?','2026-09',"';DROP TABLE products")).rejects.toThrow('INVALID_QUESTION_CONTEXT');
 await expect(prepareQuestion(env,'Peki mobilde?','2026-09','00000000-0000-0000-0000-000000000000')).rejects.toThrow('INVALID_QUESTION_CONTEXT');
 expect(()=>parseQuestion('Broşür 2099-01 nasıl?',[], '2026-09')).toThrow('INVALID_MONTH');
 expect((await env.DB.prepare('SELECT count(*) n FROM products').first<{n:number}>())!.n).toBe(4);
});
it('kayıp başarılı kelime korunur ve ölçülmeyen değişiklik başarı sayılmaz',async()=>{
 await env.DB.prepare("UPDATE gsc_daily_by_query_device SET clicks=0,ctr=0,impressions=200 WHERE date>='2026-09-01'").run();
 const report=await analyze(env,'2026-09');await saveAnalysis(env,report);
 const protection=await answerQuestion(env,report,'Broşür hangi kelimeleri korumalıyım?') as any;expect(protection.products[0].queries[0].protect).toBe(true);
 const ctr=await answerQuestion(env,report,'Broşür gösterim artarken tıklama neden yok?') as any;expect(ctr.items[0]).toMatchObject({query:'broşür baskı',current:{clicks:0},protect:true});
 const outcomes=await answerQuestion(env,report,'SEO değişiklikleri işe yaradı mı?') as any;expect(outcomes.text).toContain('Nedensellik doğrulanamadı');expect(outcomes.outcomes).toEqual([]);
});
it('soru metni SQL olarak çalıştırılmaz; bağlantı yoksa sıfır başarı uydurulmaz',async()=>{
 await env.DB.prepare('DELETE FROM oauth_credentials').run();
 const report=await analyze(env,'2026-09');await saveAnalysis(env,report);
 const a=await answerQuestion(env,report,"Broşür'; DROP TABLE products;-- neden düştü?") as any;expect(a.decision).toBe('Veri bekle');expect(a.source).toBe('GSC');expect(a.missing.join()).toContain('Google bağlantısı yok');
 const b=await answerQuestion(env,report,'Hangi ürünler yükseldi?') as any;expect(b.products).toEqual([]);
 expect((await env.DB.prepare('SELECT count(*) n FROM products').first<{n:number}>())!.n).toBe(4);
});
