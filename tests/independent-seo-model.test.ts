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
  expect(a.evidence).toEqual(['URUNLER2026-09-01brosur','URUNLER2026-08-01brosur']);
  expect(r.products[0].previous_source_key).toBe('URUNLER2026-08-01brosur');
  expect(a.evidence_details).toEqual([
   {source_key:'URUNLER2026-09-01brosur',source:'verified-sheet',section:'URUNLER',period:{start:'2026-09-01',end:'2026-09-30'}},
   {source_key:'URUNLER2026-08-01brosur',source:'verified-sheet',section:'URUNLER',period:{start:'2026-08-01',end:'2026-08-31'}}
  ]);
 });
 it('keeps an absent baseline unknown and cites only the observed month',()=>{
  const r=independentReport(records.filter(r=>r.section!=='URUNLER'||!r.start.startsWith('2026-08')),'2026-09','2026-10-30T12:00:00Z',0);
  if(!r.available)throw Error('fixture');
  expect(r.products[0]).toMatchObject({previous:null,previous_source_key:null,previous_evidence:null,delta:null,rate:null,decision:'Veri bekle'});
  const a=independentAnswer(r,'Broşür neden düştü?');
  expect(a.decision).toBe('Veri bekle');
  expect(a.evidence).toEqual(['URUNLER2026-09-01brosur']);
  expect(a.answer).toContain('Düşüş veya yükseliş iddiasında bulunmuyorum');
 });
 it('never invents missing periods or city/device evidence',()=>{
  const r=independentReport(records,'2026-07','2026-10-30T12:00:00Z',0);
  expect(r.available).toBe(false);
  expect(independentAnswer(r,'Broşür neden düştü?').decision).toBe('Veri bekle');
  expect(independentAnswer(independentReport(records,'2026-09','2026-10-30T12:00:00Z',0),'İstanbul nasıl?').decision).toBe('Veri bekle');
 });
 it('rejects corrupt records and invalid questions',()=>{
  expect(()=>independentReport([...records,fixture('URUNLER','brosur','2026-09-01','2026-09-30',30)],'2026-09','2026-10-30T12:00:00Z',0)).toThrow('INDEPENDENT_AMBIGUOUS_PERIOD');
  expect(()=>independentAnswer(independentReport(records,'2026-09','2026-10-30T12:00:00Z',0),'')).toThrow('INVALID_QUESTION');
 });
});
