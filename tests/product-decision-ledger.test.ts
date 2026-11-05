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
