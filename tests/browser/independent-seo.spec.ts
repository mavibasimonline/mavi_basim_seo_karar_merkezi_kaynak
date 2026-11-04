import {test,expect,Page} from '@playwright/test';
import {readFileSync} from 'node:fs';

// Browser fixtures verify presentation and request routing; they are never live GSC evidence.
const malicious='broşür <img src=x onerror="window.__gscXss=1">';
const captured='2026-11-04T02:00:00Z';
type Options={archiveUnavailable?:boolean;completeGsc?:boolean};
async function fixtures(page:Page,options:Options={}){
 await page.clock.install({time:new Date('2026-11-04T02:00:00Z')});
 const posts:Array<{path:string;body:unknown}>=[];
 for(const name of ['independent-seo.html','independent-seo.js','independent-seo.css']){
  await page.route('**/'+name,route=>route.fulfill({status:200,contentType:name.endsWith('.js')?'text/javascript':name.endsWith('.css')?'text/css':'text/html',body:readFileSync('public/'+name,'utf8')}));
 }
 await page.route('**/api/independent/**',async route=>{
  const request=route.request(),url=new URL(request.url()),path=url.pathname;
  const json=(body:unknown,status=200)=>route.fulfill({status,contentType:'application/json',body:JSON.stringify(body)});
  const month=url.searchParams.get('month')||'2026-10';
  if(path==='/api/independent/report'){
   if(options.archiveUnavailable)return json({error:'SHEETS_UNAVAILABLE'},503);
   const october=month==='2026-10';
   return json({available:true,month,months:['2026-09','2026-10'],previous_month:october?'2026-09':null,
    source:'Google Sheets',source_scope:'Tarihsel doğrulanmış Sheets arşivi; günlük GSC değildir.',captured_at:captured,
    source_hash:'a'.repeat(64),previous_source_hash:october?'b'.repeat(64):null,stale:false,d1_requests:0,
    products:[{id:'brosur',title:'Broşür',metrics:{clicks:october?100:200,impressions:1000,ctr:october?.1:.2,position:5},
     previous:october?{clicks:200,impressions:1000,ctr:.2,position:4}:null,delta:october?-100:null,decision:october?'İncele':'Veri bekle'}]});
  }
  if(path==='/api/independent/ga4-status')return json({connected:false,reauthorization_required:false,property:null,inspection:{code:'GA4_PERMISSION_REQUIRED'},d1_requests:0});
  if(path==='/api/independent/ga4-report')return json({available:false,connected:false,month,property:null,cities:[],devices:[],pages:[],source:'Google Analytics 4 Data API',evidence:[],message:'GA4 şehir kayıtları henüz doğrulanmadı; eksik kayıt sıfır ziyaretçi değildir.',d1_requests:0});
  if(path==='/api/independent/change-history')return json({answer:'CMS kanıtı yoksa yalnız tarama aralığı gösterilir.',evidence_refs:[{event_id:'fixture-event',url:'https://mavibasim.com/brosur',source_hash:'d'.repeat(64),observed_interval:{from:'2026-09-01T00:00:00Z',to:'2026-10-01T00:00:00Z'},before:{title:malicious,h1:['Önceki'],content_hash:'e'.repeat(64)},after:{title:'Yeni başlık',h1:['Sonraki'],content_hash:'f'.repeat(64)}}],d1_requests:0});
  if(path==='/api/independent/gsc-status')return json({connected:true,reauthorization_required:false,source:'GSC Search Analytics API',d1_requests:0,
   coverage:[],expected_records:14,last_attempt:{at:captured,status:'held',code:'GSC_ROW_REJECTED',day:'2026-11-01',scope:'page'},
   last_failure:{at:captured,code:'GSC_ROW_REJECTED',day:'2026-11-01',scope:'page'},last_complete:null,
   cron:{last:{scheduled_at:captured,status:'held',day:'2026-11-01',scope:'page'},days:[]}});
  if(path==='/api/independent/gsc-analysis'){
   const complete=options.completeGsc===true,expected=month==='2026-09'?30:31;
   const metric={id:'https://mavibasim.com/brosur',label:'https://mavibasim.com/brosur',clicks:100,impressions:1000,ctr:.1,position:4};
   return json({available:complete,month,source:'GSC Search Analytics API',d1_requests:0,
    coverage:{days_verified:complete?expected:0,expected_days:expected,missing_days:complete?[]:[month+'-01'],query_days_verified:complete?expected:0,query_missing_days:complete?[]:[month+'-01'],query_partial:true},
    totals:complete?{clicks:100,impressions:1000,ctr:.1,position:4}:null,
    pages:complete?[metric]:[],products:complete?[{...metric,id:'brosur',label:'Broşür'}]:[],
    devices:complete?[{...metric,id:'MOBILE',label:'MOBILE'}]:[],countries:complete?[{...metric,id:'tur',label:'tur'}]:[],
    queries:complete?[{...metric,id:malicious,label:malicious}]:[],brands:[],facet_counts:{pages:complete?1:0,products:complete?1:0,queries:complete?1:0},
    evidence:complete?[{day:month+'-01',scope:'page',generation:'fixture-generation',captured_at:captured,rows:1,page_hashes:['c'.repeat(64)]}]:[],
    limitations:['Eksik günler sıfır değildir.','Anonimleştirilmiş sorgular tahmin edilmez.']});
  }
  if(request.method()==='POST'&&(path==='/api/independent/questions'||path==='/api/independent/gsc-questions')){
   posts.push({path,body:request.postDataJSON()});
   return json({answer:path.endsWith('/gsc-questions')?'GSC kanıtlı fixture yanıtı '+malicious:'Otomatik kaynak fixture yanıtı',decision:'Veri bekle',source:path.endsWith('/gsc-questions')?'GSC Search Analytics API':'Google Sheets',
    evidence:['fixture-source-reference'],evidence_refs:[],month:(request.postDataJSON() as {month:string}).month,d1_requests:0});
  }
  return json({error:'UNEXPECTED_FIXTURE_ROUTE:'+path},404);
 });
 return posts;
}

test('independent GSC status and missing coverage remain visible when the Sheets archive fails',async({page})=>{
 const errors:string[]=[];page.on('pageerror',error=>errors.push(error.message));
 await fixtures(page,{archiveUnavailable:true});
 await page.goto('/independent-seo.html');
 await expect(page.locator('#state')).toContainText(/kullanılamıyor|erişilemiyor|doğrulanamadı/i);
 await expect(page.locator('#daily-coverage')).toContainText('0/14');
 await expect(page.locator('#gsc-failure')).toContainText('GSC_ROW_REJECTED');
 await expect(page.locator('#gsc-month-note')).toContainText('0/31');
 await expect(page.locator('#gsc-month-note')).toContainText(/sıfır/);
 await expect(page.locator('#gsc-note')).toContainText(/Google|GSC/);
 await expect(page.locator('#gsc-rows')).not.toContainText('0 tıklama');
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
 expect(errors).toEqual([]);
});

test('daily GSC evidence renders while the unrelated monthly archive is still pending',async({page})=>{
 await fixtures(page);
 let release=()=>{};
 const pending=new Promise<void>(resolve=>{release=resolve;});
 await page.route('**/api/independent/report?*',async route=>{
  await pending;
  await route.fulfill({status:503,contentType:'application/json',body:JSON.stringify({error:'SHEETS_UNAVAILABLE'})});
 });
 try{
  await page.goto('/independent-seo.html');
  await expect(page.locator('#daily-coverage')).toContainText('0/14');
  await expect(page.locator('#gsc-month-note')).toContainText('0/31');
  await expect(page.locator('#state')).toContainText('kontrol ediliyor');
 }finally{release();}
 await expect(page.locator('#state')).toContainText('kullanılamıyor');
});

test('independent GSC facets and evidence render actual strings safely on desktop and mobile',async({page})=>{
 const errors:string[]=[];page.on('pageerror',error=>errors.push(error.message));
 await fixtures(page,{completeGsc:true});
 await page.goto('/independent-seo.html');
 await expect(page.locator('#gsc-month-note')).toContainText('31/31');
 await expect(page.locator('#gsc-rows')).toContainText('https://mavibasim.com/brosur');
 await expect(page.locator('#gsc-rows')).toContainText('100');
 await page.locator('#gsc-facet').selectOption('queries');
 await expect(page.locator('#gsc-rows')).toContainText(malicious);
 await expect(page.locator('#gsc-rows img')).toHaveCount(0);
 expect(await page.evaluate(()=>Boolean((window as unknown as {__gscXss?:number}).__gscXss))).toBe(false);
 await expect(page.locator('#gsc-evidence')).toContainText('fixture-generation');
 await expect(page.locator('#gsc-evidence')).toContainText('c'.repeat(64));
 await page.locator('#gsc-facet').selectOption('devices');
 await expect(page.locator('#gsc-rows')).toContainText('Mobil');
 await page.locator('#gsc-facet').selectOption('countries');
 await expect(page.locator('#gsc-rows')).toContainText('tur');
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
 expect(errors).toEqual([]);
});

test('September–October archive comparison remains separate and question sources route explicitly',async({page})=>{
 const posts=await fixtures(page,{completeGsc:true});
 await page.goto('/independent-seo.html');
 await expect(page.locator('#month')).toHaveValue('2026-10');
 await expect(page.locator('#products')).toContainText('Broşür');
 await expect(page.locator('#products')).toContainText('200');
 await expect(page.locator('#products')).toContainText('-100');
 await expect(page.locator('#source')).toContainText('Google Sheets');
 await page.locator('#month').selectOption('2026-09');
 await page.locator('#reload').click();
 await expect(page.locator('#products')).toContainText('200');
 await expect(page.locator('#products')).not.toContainText('-100');
 await page.locator('#month').selectOption('2026-10');
 await page.locator('#reload').click();
 await expect(page.locator('#products')).toContainText('-100');
 await page.locator('#question-source').selectOption('gsc');
 await page.locator('#question').fill('Broşür mobilde neden düştü?');
 await page.locator('#ask button[type="submit"]').click();
 await expect(page.locator('#answer')).toContainText('GSC kanıtlı fixture yanıtı');
 await expect(page.locator('#answer-evidence')).toContainText('fixture-source-reference');
 await expect(page.locator('#answer img')).toHaveCount(0);
 expect(posts[0]).toEqual({path:'/api/independent/gsc-questions',body:{month:'2026-10',question:'Broşür mobilde neden düştü?'}});
 await page.locator('#question-source').selectOption('auto');
 await page.locator('#question').fill('Broşür neden düştü?');
 await page.locator('#ask button[type="submit"]').click();
 await expect(page.locator('#answer')).toContainText('Otomatik kaynak fixture yanıtı');
 expect(posts[1]).toEqual({path:'/api/independent/questions',body:{month:'2026-10',question:'Broşür neden düştü?'}});
 expect(await page.evaluate(()=>Boolean((window as unknown as {__gscXss?:number}).__gscXss))).toBe(false);
});


test('GA4 missing permission and before/after SEO evidence are explicit in the same Turkish panel',async({page})=>{
 const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));await fixtures(page);await page.goto('/independent-seo.html');
 await expect(page.locator('#ga4-note')).toContainText('Analytics izni doğrulanmadı');await expect(page.locator('#ga4-connect')).toBeVisible();await expect(page.locator('#ga4-rows')).toContainText('sıfır ziyaretçi değildir');
 await expect(page.locator('#changes')).toContainText('fixture-event');await expect(page.locator('#changes')).toContainText(malicious);await expect(page.locator('#changes')).toContainText('Yeni başlık');await expect(page.locator('#changes img')).toHaveCount(0);
 await page.locator('#question-source').selectOption('ga4');await page.locator('#question').fill('İstanbul ziyaretçisi kaç?');await page.locator('#ask button[type="submit"]').click();await expect(page.locator('#answer')).toContainText('Otomatik kaynak fixture yanıtı');
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);expect(errors).toEqual([]);
});
