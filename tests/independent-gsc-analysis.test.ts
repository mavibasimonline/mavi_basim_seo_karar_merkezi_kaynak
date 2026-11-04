import {describe,it,expect} from 'vitest';
import {analyzeVerifiedGsc,answerVerifiedGsc,GscMetricRow,MonthlyGscAnalysisInput} from '../src/independent-gsc-analysis';
const page='https://mavibasim.com/brosur';
const mapping=[{id:'brosur',name:'Broşür',pages:[page]}];
const row=(clicks=10,impressions=100,device='MOBILE',url=page):GscMetricRow=>({page:url,device,country:'tur',clicks,impressions,ctr:clicks/impressions,position:4});
const period=(month:string,rows:GscMetricRow[]):MonthlyGscAnalysisInput=>({available:true,month,days_verified:30,expected_days:30,missing_days:[],query_days_verified:30,query_missing_days:[],query_partial:true,pages:rows,queries:[],evidence:[{day:month+'-01',scope:'page',generation:month,captured_at:'2026-11-04T00:00:00Z',rows:rows.length,page_hashes:['a'.repeat(64)]},{day:month+'-01',scope:'query',generation:month+'-q',captured_at:'2026-11-04T00:00:00Z',rows:0,page_hashes:['b'.repeat(64)]}]});
describe('verified GSC dimensions and conservative answers',()=>{
 it('aggregates weighted position and CTR from page rows, independently of query subsets',()=>{
  const report=period('2026-09',[row(10,100),{...row(20,400,'DESKTOP'),position:10}]);
  report.queries=[{...row(1,10),query:'broşür baskı'},{...row(2,40),query:'broşür baski'},{...row(1,10),query:'Mavi Basım broşür'}];
  const result=analyzeVerifiedGsc(report,mapping);
  expect(result.totals).toEqual({clicks:30,impressions:500,ctr:.06,position:8.8});
  expect(result.products[0]).toMatchObject({id:'brosur',clicks:30});
  expect(result.devices).toHaveLength(2);
  expect(result.countries[0]).toMatchObject({id:'tur',clicks:30});
  expect(result.queries).toHaveLength(3);
  expect(result.brands.find(r=>r.id==='brand')?.clicks).toBe(1);
  expect(result.query_scope).toContain('site toplamı değildir');
 });
 it('requires explicit exact URL mappings and refuses ambiguous products',()=>{
  const report=period('2026-09',[row(),row(5,100,'MOBILE','http://www.mavibasim.com/brosur')]);
  const result=analyzeVerifiedGsc(report,mapping);
  expect(result.products[0].clicks).toBe(10);
  expect(result.unmapped_pages).toEqual(['http://www.mavibasim.com/brosur']);
  expect(()=>analyzeVerifiedGsc(report,[...mapping,{id:'el-ilani',name:'El İlanı',pages:[page]}])).toThrow('GSC_PRODUCT_MAPPING_AMBIGUOUS');
 });
 it('does not report totals or a drop when daily coverage is missing',()=>{
  const report={...period('2026-10',[]),available:false,days_verified:0,expected_days:31,missing_days:['2026-10-01']};
  expect(analyzeVerifiedGsc(report).totals).toBeNull();
  const result=answerVerifiedGsc(report,period('2026-09',[row(200,1000)]),'Broşür neden düştü?',mapping);
  expect(result.decision).toBe('Veri bekle');
  expect(result.answer).toContain('eksik günler sıfır trafik değildir');
  expect(result.answer).not.toContain('-200');
 });
 it('protects a 2 to 1 fluctuation and includes both month references',()=>{
  const result=answerVerifiedGsc(period('2026-10',[row(1)]),period('2026-09',[row(2)]),'Broşür neden düştü?',mapping);
  expect(result.decision).toBe('Koru');
  expect(result.evidence).toEqual(['gsc:history:2026-10-01:page:2026-10','gsc:history:2026-09-01:page:2026-09']);
  expect(result.answer).toContain('nedeni kanıtlamaz');
 });
 it('investigates a material mobile drop using the identical filter',()=>{
  const result=answerVerifiedGsc(period('2026-10',[row(100,1000),row(400,2000,'DESKTOP')]),period('2026-09',[row(200,1000),row(100,2000,'DESKTOP')]),'Broşür mobilde neden düştü?',mapping);
  expect(result.filters).toMatchObject({product:'brosur',device:'MOBILE'});
  expect(result.decision).toBe('İncele');
  expect(result.answer).toContain('tıklama farkı -100');
  expect(result.answer).toContain('değişiklik geçmişiyle doğrulamadan');
 });
 it('does not turn growing impressions and falling CTR into failure',()=>{
  const result=answerVerifiedGsc(period('2026-10',[row(110,2000)]),period('2026-09',[row(100,1000)]),'Broşür nasıl?',mapping);
  expect(result.decision).toBe('Koru');
  expect(result.answer).toContain('CTR düşüşü tek başına başarısızlık sayılmaz');
 });
 it('does not fabricate hidden query values or merge query variants',()=>{
  const report=period('2026-10',[row()]);
  const empty=answerVerifiedGsc(report,undefined,'Broşür anahtar kelimeleri nedir?',mapping);
  expect(empty.answer).toContain('sıfır trafik veya arama talebi anlamına gelmez');
  report.queries=[{...row(1,10),query:'broşür baskı'},{...row(2,20),query:'broşür baski'}];
  const answer=answerVerifiedGsc(report,undefined,'Broşür anahtar kelimeleri nedir?',mapping);
  expect(answer.answer).toContain('“broşür baskı”: 1 tıklama');
  expect(answer.answer).toContain('“broşür baski”: 2 tıklama');
  expect(answer.decision).toBe('Veri bekle');
  expect(answer.evidence.every(key=>key.includes(':query:'))).toBe(true);
 });
 it('rejects city and unproved publication-history claims',()=>{
  const report=period('2026-10',[row()]);
  expect(answerVerifiedGsc(report,undefined,'İstanbul neden düştü?').answer).toContain('GSC ülke boyutu sağlar');
  expect(answerVerifiedGsc(report,undefined,'Broşür başlık ne zaman değişti?',mapping).answer).toContain('kesin yayın tarihi atfetme');
 });
 it('compares an observed exact query only with both verified query periods and references',()=>{
  const current=period('2026-10',[row()]),previous=period('2026-09',[row()]);
  current.queries=[{...row(10,100),query:'broşür baskı'}];
  previous.queries=[{...row(20,100),query:'broşür baskı'}];
  const answer=answerVerifiedGsc(current,previous,'Broşür baskı neden düştü?',mapping);
  expect(answer.answer).toContain('görünür sorgu tıklamaları 20 → 10');
  expect(answer.answer).toContain('anonimleştirme');
  expect(answer.evidence).toEqual(['gsc:history:2026-10-01:query:2026-10-q','gsc:history:2026-09-01:query:2026-09-q']);
  previous.queries=[];
  expect(answerVerifiedGsc(current,previous,'Broşür baskı neden düştü?',mapping).answer).toContain('önceki değer sıfır sayılamaz');
 });
 it('does not use source-free metrics to recommend a change',()=>{
  const report={...period('2026-10',[row()]),evidence:[]};
  const answer=answerVerifiedGsc(report,period('2026-09',[row(200,1000)]),'Broşür nasıl?',mapping);
  expect(answer.decision).toBe('Veri bekle');
  expect(answer.evidence).toEqual([]);
 });
 it('does not replace an absent filtered baseline with zero or a nonadjacent month',()=>{
  const report=period('2026-10',[row(100,1000)]);
  expect(answerVerifiedGsc(report,period('2026-09',[row(200,1000,'DESKTOP')]),'Broşür mobil nasıl?',mapping).decision).toBe('Veri bekle');
  expect(answerVerifiedGsc(report,period('2026-08',[row(200,1000)]),'Broşür nasıl?',mapping).decision).toBe('Veri bekle');
 });
 it('validates questions and limits response facet size while keeping totals',()=>{
  const report=period('2026-10',Array.from({length:170},(_,i)=>row(1,10,'MOBILE',page+'/'+i)));
  const analyzed=analyzeVerifiedGsc(report);
  expect(analyzed.pages).toHaveLength(150);
  expect(analyzed.facet_counts.pages).toBe(170);
  expect(analyzed.totals?.clicks).toBe(170);
  expect(()=>answerVerifiedGsc(report,undefined,'')).toThrow('INVALID_QUESTION');
 });
});
