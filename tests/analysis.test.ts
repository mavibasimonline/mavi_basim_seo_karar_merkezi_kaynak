import {beforeEach,it,expect} from 'vitest';
import {init,env,connected} from './helpers';
import {analyze,decide,metrics,monthPeriod,dates,saveAnalysis,DecisionInput} from '../src/analysis';
import {validateAnalysis} from '../src/validation';
import {insertRows} from '../src/sync';
import {isBrand,siteURL} from '../src/urls';
import {answerQuestion} from '../src/questions';

beforeEach(init);
function input(clicks:number,previous:number,impressions=1000,previousImpressions=1000):DecisionInput{return {
  current:{clicks,impressions,ctr:clicks/impressions,position:3},previous:{clicks:previous,impressions:previousImpressions,ctr:previous/previousImpressions,position:3},
  complete:true,fresh:true,periodFinished:true,evidence:[{id:'fixture',source:'GSC',ref:'fixture',fetched_at:new Date().toISOString(),scope:{}}],protectedQueries:[],deviceMixChanged:false,seasonalityKnown:false,
};}
async function seed(month:string,query=true){
  await connected();const period=monthPeriod(month),previous=monthPeriod(month,-1),stamp=new Date().toISOString();
  for(const p of [period,previous]){
    const coverage=dates(p).flatMap(day=>['page',...(query?['query']:[])].map(scope=>({provider:'gsc',day,scope,dataset_id:`${day}:${scope}`,complete:1,query_partial:Number(scope==='query'),row_count:2,fetched_at:stamp,notes:'TEST FIXTURE; not live data'})));
    await env.DB.batch(insertRows(env.DB,'dataset_coverage',coverage));
    const rows=dates(p).flatMap(day=>['MOBILE','DESKTOP'].map(device=>({dataset_id:`${day}:page`,date:day,page:'https://mavibasim.com/brosur',country:'tur',device,clicks:p.label===month?(device==='MOBILE'?1:8):(device==='MOBILE'?8:1),impressions:100,ctr:p.label===month?(device==='MOBILE'?0.01:0.08):(device==='MOBILE'?0.08:0.01),position:2})));
    await env.DB.batch(insertRows(env.DB,'gsc_daily_by_page',rows));
    if(query)await env.DB.batch(insertRows(env.DB,'gsc_daily_by_query_device',dates(p).flatMap(day=>['Mavi Basım broşür',...(p.label===month?['broşür baskı']:['eski sorgu','broşür baskı'])].map(word=>({dataset_id:`${day}:query`,date:day,page:'https://mavibasim.com/brosur',query:word,country:'tur',device:'DESKTOP',is_brand:Number(isBrand(word)),clicks:2,impressions:100,ctr:0.02,position:2})))));
  }
}
it('does not turn 2 -> 1 clicks into a crisis',()=>{expect(decide(input(1,2)).decision).toBe('Koru');});
it('investigates a material 200 -> 100 click or 1000 -> 500 impression loss',()=>{
  expect(decide(input(100,200)).decision).toBe('İncele');expect(decide(input(10,10,500,1000)).decision).toBe('İncele');
});
it('does not call lower CTR a failure while impressions grow',()=>{const result=decide(input(120,100,2000,1000));expect(result.decision).toBe('Koru');expect(result.reason).toContain('CTR');});
it('rejects stale, incomplete, future and evidence-free decisions',()=>{
  for(const patch of [{fresh:false},{complete:false},{periodFinished:false},{evidence:[]}])expect(decide({...input(100,200),...patch}).decision).toBe('Veri bekle');
});
it('protects successful keywords before any change',()=>{
  const result=decide({...input(100,200),protectedQueries:[{query:'broşür baskı',clicks:50,impressions:1000,previous_clicks:40,is_brand:false,protect:true,missing_current:false}]});
  expect(result.risk).toContain('korunmalı');expect(result.risk).toContain('zarar');
});
it('calculates impression-weighted position with an independently known result',()=>{
  expect(metrics([{clicks:1,impressions:100,position:10},{clicks:10,impressions:900,position:2}])).toEqual({clicks:11,impressions:1000,ctr:0.011,position:2.8});
});
it('does not fake Google analysis while disconnected or put October 31 in a completed month',async()=>{
  const result=await analyze(env,'2026-10',new Date('2026-10-23T12:00:00Z'));
  expect(result.products.every(p=>p.decision==='Veri bekle'&&p.current===null)).toBe(true);
  expect(result.region).toBeNull();expect(result.missing.join(' ')).toContain('tamamlanmadı');
});
it('keeps mobile/desktop and brand/non-brand traffic separate; missing query is null',async()=>{
  const month=monthPeriod(new Date().toISOString().slice(0,7),-2).label;
  await seed(month);const result=await analyze(env,month);const product=result.products[0];
  expect(product.devices.find(d=>d.device==='MOBILE')!.current!.clicks).toBeLessThan(product.devices.find(d=>d.device==='MOBILE')!.previous!.clicks);
  expect(product.devices.find(d=>d.device==='DESKTOP')!.current!.clicks).toBeGreaterThan(product.devices.find(d=>d.device==='DESKTOP')!.previous!.clicks);
  expect(product.brand.brand.clicks).toBeGreaterThan(0);expect(product.brand.non_brand.clicks).toBeGreaterThan(0);
  const missing=product.queries.find(q=>q.query==='eski sorgu');expect(missing?.missing_current).toBe(true);expect(missing?.clicks).toBeNull();
  expect(product.queries.find(q=>q.query==='broşür baskı')?.protect).toBe(true);
  expect(await validateAnalysis(env,result)).toEqual([]);
});
it('independent SQL validation rejects fabricated totals',async()=>{
  const month=monthPeriod(new Date().toISOString().slice(0,7),-2).label;await seed(month);
  const result=await analyze(env,month);result.products[0].current!.clicks+=1;
  expect((await validateAnalysis(env,result)).join()).toContain('CALCULATION_MISMATCH');
});
it('stores report baselines and evidence; answers cannot invent city queries or causation',async()=>{
  const month=monthPeriod(new Date().toISOString().slice(0,7),-2).label;await seed(month);const result=await analyze(env,month);await saveAnalysis(env,result);
  const recommendation=await env.DB.prepare("SELECT computation_json,evidence_ids_json FROM recommendations WHERE product_id='brosur'").first<{computation_json:string;evidence_ids_json:string}>();
  expect(JSON.parse(recommendation!.computation_json).current).toEqual(result.products[0].current);
  expect(JSON.parse(recommendation!.evidence_ids_json).length).toBeGreaterThan(0);
  const city=await answerQuestion(env,result,'İstanbul neden düştü?') as {text:string};expect(city.text).toContain('çıkarılamaz');
  const cause=await answerQuestion(env,result,'Broşür başlığı dün değişti, düşüşün nedeni mi?') as {text:string};expect(cause.text).toContain('kanıtlayamam');
});
it('requires query coverage and keeps distinct product URLs',async()=>{
  const month=monthPeriod(new Date().toISOString().slice(0,7),-2).label;await seed(month,false);const report=await analyze(env,month);
  expect(report.products.every(p=>p.decision==='Veri bekle')).toBe(true);
  expect(siteURL('/brosur')).not.toBe(siteURL('/el-ilani'));expect(siteURL('https://evil.example/')).toBeNull();
  expect(isBrand('MAVİ BASIM')).toBe(true);expect(isBrand('mavi broşür')).toBe(false);
});
