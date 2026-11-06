import {it,expect} from 'vitest';
import {buildProductDecisionLedger} from '../src/product-decision-ledger';

const ref=(scope:'page'|'query')=>({day:'2026-10-01',scope,generation:'verified',captured_at:'2026-11-01T00:00:00Z',rows:1,page_hashes:['a'.repeat(64)]});
const point=(page:string,clicks:number,impressions:number,device='MOBILE')=>({page,device,country:'tur',clicks,impressions,position:8,ctr:impressions?clicks/impressions:0});
const input=(month:string,pages:any[],queries:any[]=[])=>({available:true,month,days_verified:month==='2026-09'?30:31,expected_days:month==='2026-09'?30:31,query_days_verified:month==='2026-09'?30:31,pages,queries,evidence:[ref('page'),ref('query')],source:'GSC Search Analytics API'});
const catalog=Array.from({length:29},(_,i)=>({id:i===0?'brosur':'product-'+i,name:i===0?'Broşür':'Ürün '+i,canonical_url:'https://mavibasim.com/'+(i===0?'brosur':'product-'+i),urls:['https://mavibasim.com/'+(i===0?'brosur':'product-'+i)],url_verified_at:'2026-10-01T00:00:00Z'}));
const query=(page:string,query:string,clicks:number)=>({...point(page,clicks,200),'query':query});
const ga4=(month:string,sessions:number)=>({source:'Google Analytics 4 Data API',month,channel:'Organic Search',hostnames:['mavibasim.com','www.mavibasim.com'],closed:true,from:month+'-01',to:month==='2026-10'?'2026-10-31':'2026-09-30',property:{id:'532525867',time_zone:'Europe/Istanbul'},pages:[{page:'/brosur',sessions,active_users:sessions,engaged_sessions:sessions}],evidence:[{source:'Google Analytics 4 Data API',property:'532525867',month,kind:'pages',from:month+'-01',to:month==='2026-10'?'2026-10-31':'2026-09-30',timezone:'Europe/Istanbul',generation:'x',captured_at:'2026-11-02T00:00:00Z',rows:1,hashes:['a'.repeat(64)]}]});
it('covers 29 products, identifies cross-source priority and protects observed winners without claiming causality',()=>{
 const path='https://mavibasim.com/brosur';
 const now=input('2026-10',[point(path,60,800)],[query(path,'brosur fiyat',10),query(path,'broşür kaliteli',20)]);
 const old=input('2026-09',[point(path,120,900)],[query(path,'brosur fiyat',45),query(path,'broşür kaliteli',12)]);
 const rows=buildProductDecisionLedger(now,old,ga4('2026-10',40),ga4('2026-09',80),catalog);
 expect(rows).toHaveLength(29);expect(new Set(rows.map(r=>r.id)).size).toBe(29);
 const product=rows.find(r=>r.id==='brosur')!;
 expect(product.priority).toBe('Öncelikli incele');
 expect(product.gsc.delta).toBe(-60);
 expect(product.queries.losses.some(r=>r.query==='brosur fiyat')).toBe(true);
 expect(product.queries.protected.some(r=>r.query==='broşür kaliteli')).toBe(true);
 expect(product.ga4.cross_source_decline).toBe(true);
 expect(product.cause_confirmed).toBe(false);expect(product.content_change_recommended).toBe(false);
 expect(rows.filter(r=>r.id!=='brosur').every(r=>r.priority==='Veri bekle')).toBe(true);
});
it('does not invent a lost keyword or zero traffic when previous period is absent',()=>{
 const page='https://mavibasim.com/brosur',now=input('2026-10',[point(page,15,250)],[query(page,'tek ay sorgusu',15)]);
 const result=buildProductDecisionLedger(now,null,null,null,catalog);
 expect(result).toHaveLength(29);
 const product=result.find(r=>r.id==='brosur')!;
 expect(product.priority).toBe('Veri bekle');
 expect(product.queries.losses).toHaveLength(0);expect(product.queries.protected).toHaveLength(0);
 expect(product.queries.comparable).toBe(false);
 expect(product.ga4.scope_comparable).toBe(false);
});
it('keeps GA4 all-device scope separate from a GSC mobile-only comparison',()=>{
 const page='https://mavibasim.com/brosur',now=input('2026-10',[point(page,12,200)]),old=input('2026-09',[point(page,30,200)]);
 const rows=buildProductDecisionLedger(now,old,ga4('2026-10',8),ga4('2026-09',100),catalog,[],{device:'MOBILE'});
 const r=rows.find(x=>x.id==='brosur')!;
 expect(r.ga4.scope_comparable).toBe(false);expect(r.ga4.cross_source_decline).toBe(false);
 expect(r.content_change_recommended).toBe(false);
});
it('quarantines ambiguous URL mappings instead of double-counting traffic',()=>{
 const duplicated=[...catalog.slice(0,2),{...catalog[2],urls:[catalog[0].canonical_url]},...catalog.slice(3)];
 const page=catalog[0].canonical_url,now=input('2026-10',[point(page,100,500)]),old=input('2026-09',[point(page,200,800)]);
 const rows=buildProductDecisionLedger(now,old,null,null,duplicated);
 expect(rows.find(r=>r.id==='brosur')?.priority).toBe('Veri bekle');
 expect(rows.find(r=>r.id==='product-2')?.priority).toBe('Veri bekle');
});

it('explains loss with dated evidence, target URL and safe final decision instead of just inspect',()=>{
 const page='https://mavibasim.com/brosur';
 const now=input('2026-10',[{...point(page,21,739),position:27.65,ctr:21/739}],[query(page,'broşür baskı',4)]);
 const before=input('2026-09',[{...point(page,31,900),position:22,ctr:31/900}],[query(page,'broşür baskı',9)]);
 const rows=buildProductDecisionLedger(now,before,null,null,catalog);
 const row=rows.find(r=>r.id==='brosur')!;
 expect(row.diagnosis.summary).toContain('31 → 21');
 expect(row.diagnosis.summary).toContain('2026-09 → 2026-10');
 expect(row.diagnosis.observed_mechanisms.some(s=>s.includes('Ortalama konum'))).toBe(true);
 expect(row.diagnosis.target_url).toBe(page);
 expect(row.diagnosis.top_loss_query).toBe('broşür baskı');
 expect(row.diagnosis.decision).toContain('değiştirme');
 expect(row.action).toContain('TESPİT VE KANIT:');
 expect(row.action).toContain('KARAR:');
 expect(row.content_change_recommended).toBe(false);
});
it('provides explicit preservation action for stable and insufficient data',()=>{
 const page='https://mavibasim.com/brosur';
 const same=buildProductDecisionLedger(input('2026-10',[point(page,30,500)]),input('2026-09',[point(page,29,490)]),null,null,catalog).find(r=>r.id==='brosur')!;
 expect(same.diagnosis.decision).toContain('koru');
 const missing=buildProductDecisionLedger(input('2026-10',[point(page,5,100)]),null,null,null,catalog).find(r=>r.id==='brosur')!;
 expect(missing.diagnosis.confidence).toBe('veri_yetersiz');
 expect(missing.diagnosis.decision).toContain('Şimdi SEO içeriğini değiştirme');
});

/*
 * October screen regression: all 29 product rows transcribed from the user's
 * 2026-10 / 2026-09 view. Only October clicks, impressions and click deltas
 * are observations; prior impressions/positions below are neutral synthetic
 * controls. This does NOT claim to read live D1 or reconstruct full GSC history.
 */
it('audits all 29 displayed product decisions without inventing missing baselines',()=>{
 const observed:[string,number,number,number|null][]=[
  ['Broşür',21,739,-10],['Katalog',14,588,3],['Magnet',8,185,3],
  ['Etiket',4,504,-1],['Kutu',3,51,-2],['Oto Paspas',3,43,1],
  ['Dosya',3,133,3],['Afiş',2,51,1],['Yağ Kartı',2,31,1],
  ['Tahsilat Makbuzu',1,110,-1],['Amerikan Servis',1,89,0],
  ['Para Makbuzu',1,70,0],['Ambalaj',1,47,1],
  ['Karton Çanta',1,56,1],['Küp Bloknot',1,63,1],
  ['Tediye Makbuzu',0,20,-4],['Gider Makbuzu',0,19,-2],
  ['Bloknot',0,80,-1],['Kartvizit',0,151,-1],
  ['Adisyon',0,13,0],['Antetli Kağıt',0,98,0],
  ['Araç Kiralama',0,1,0],['El İlanı',0,6,0],
  ['Kitap Ayracı',0,10,0],['Reçete',0,10,0],
  ['Sipariş Fişi',0,84,0],['Zarf',0,90,0],
  ['Sigorta Poliçeleri',0,2,null],['Sözleşme Baskı',0,12,null]
 ];
 const catalog29=observed.map(([name],i)=>({
  id:'screen-'+i,name,canonical_url:'https://mavibasim.com/test-audit-'+i,
  urls:['https://mavibasim.com/test-audit-'+i],url_verified_at:'2026-10-01T00:00:00Z'
 }));
 const now=observed.map(([,clicks,impressions],i)=>point(catalog29[i].canonical_url,clicks,impressions));
 const before=observed.flatMap(([,clicks,impressions,diff],i)=>diff===null?[]:[
  point(catalog29[i].canonical_url,clicks-diff,impressions)
 ]);
 const results=buildProductDecisionLedger(input('2026-10',now),input('2026-09',before),null,null,catalog29);
 expect(results).toHaveLength(29);
 expect(new Set(results.map(r=>r.id)).size).toBe(29);
 for(const [i,[name,clicks,,diff]] of observed.entries()){
  const row=results.find(r=>r.id==='screen-'+i)!;
  expect(row.name).toBe(name);
  expect(row.content_change_recommended).toBe(false);
  expect(row.cause_confirmed).toBe(false);
  expect(row.diagnosis.decision).toContain('KARAR:');
  if(diff===null){
   expect(row.priority).toBe('Veri bekle');
   expect(row.comparison_available).toBe(false);
   expect(row.diagnosis.confidence).toBe('veri_yetersiz');
  }else{
   expect(row.gsc.delta).toBe(diff);
   expect(row.gsc.current?.clicks).toBe(clicks);
   expect(row.comparison_available).toBe(true);
   if(name==='Broşür')expect(row.priority).toBe('İncele');
   else expect(row.priority).toBe('Koru');
   if(diff<0&&name!=='Broşür')expect(row.diagnosis.decision).toContain('müdahale etme');
  }
 }
 expect(results.filter(r=>r.priority==='İncele')).toHaveLength(1);
 expect(results.filter(r=>r.priority==='Koru')).toHaveLength(26);
 expect(results.filter(r=>r.priority==='Veri bekle')).toHaveLength(2);
});
