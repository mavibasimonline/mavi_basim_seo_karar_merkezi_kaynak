import {describe,it,expect} from 'vitest';
import {independentReport,independentAnswer,periodsOf,SheetRecord} from '../src/independent-seo-model';
const fixture=(section:string,identity:any,start:string,end:string,clicks:number):SheetRecord=>({
 source:'verified-sheet',source_key:section+start+String(identity),section,family:'period',
 identity,start,end,daily_page_query_coverage:false,source_filters_verified:false,
 payload:{'Ürün ID':identity,'Ürün Adı':identity==='brosur'?'Broşür':'Ürün',Sorgu:'broşür baskı',validated_metrics:{clicks,impressions:1000,ctr:clicks/1000,position:5}}
});
const records=[
 fixture('OZET','2026-08','2026-08-01','2026-08-31',90),
 fixture('OZET','2026-09','2026-09-01','2026-09-30',80),
 fixture('URUNLER','brosur','2026-08-01','2026-08-31',100),
 fixture('URUNLER','brosur','2026-09-01','2026-09-30',95),
 fixture('SORGULAR',['brosur','broşür baskı'],'2026-09-01','2026-09-30',20)
] as SheetRecord[];
describe('independent SEO report - no D1',()=>{
 it('compares only actually validated closed months and protects minor fluctuation',()=>{
  expect(periodsOf(records)).toEqual(['2026-08','2026-09']);
  const r=independentReport(records,'2026-09','2026-10-30T12:00:00Z',0);
  expect(r.available).toBe(true);
  if(!r.available)throw Error('fixture');
  expect(r.products[0].decision).toBe('Koru');
  expect(r.products[0].delta).toBe(-5);
  expect(r.d1_requests).toBe(0);
  const a=independentAnswer(r,'Broşür neden düştü?');
  expect(a.decision).toBe('Koru');
  expect(a.answer).toContain('nedeni');
  expect(a.evidence).toHaveLength(1);
 });
 it('never invents missing periods or city/device evidence',()=>{
  const r=independentReport(records,'2026-07','2026-10-30T12:00:00Z',0);
  expect(r.available).toBe(false);
  expect(independentAnswer(r,'Broşür neden düştü?').decision).toBe('Veri bekle');
  expect(independentAnswer(independentReport(records,'2026-09','2026-10-30T12:00:00Z',0),'İstanbul nasıl?').decision).toBe('Veri bekle');
 });
 it('never invents a previous month or evidence for an unmatched product',()=>{
  const oneMonth=records.filter(r=>!r.start.startsWith('2026-08'));
  const report=independentReport(oneMonth,'2026-09','2026-10-30T12:00:00Z',0);
  expect(report.available).toBe(true);
  if(!report.available)throw Error('fixture');
  expect(report.previous_month).toBeNull();
  expect(independentAnswer(report,'Broşür neden düştü?').decision).toBe('Veri bekle');
  expect(independentAnswer(report,'Olmayan bir ürün neden düştü?').decision).toBe('Veri bekle');
 });
 it('rejects corrupt records and invalid questions',()=>{
  expect(()=>independentReport([...records,fixture('URUNLER','brosur','2026-09-01','2026-09-30',30)],'2026-09','2026-10-30T12:00:00Z',0)).toThrow('INDEPENDENT_AMBIGUOUS_PERIOD');
  expect(()=>independentAnswer(independentReport(records,'2026-09','2026-10-30T12:00:00Z',0),'')).toThrow('INVALID_QUESTION');
 });
});