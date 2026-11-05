import {it,expect} from 'vitest';
import {answerTopProductPriorities} from '../src/top-product-priorities';
const ref=(scope:'page'|'query')=>({day:'2026-10-01',scope,generation:'verified',captured_at:'2026-11-01T00:00:00Z',rows:1,page_hashes:['a'.repeat(64)]});
const point=(p:string,c:number,i=300)=>({page:p,device:'MOBILE',country:'tur',clicks:c,impressions:i,position:8,ctr:c/i});
const products=Array.from({length:5},(_,i)=>({id:'p'+i,name:'Ürün '+i,canonical_url:'https://mavibasim.com/p'+i,urls:['https://mavibasim.com/p'+i],url_verified_at:'2026-11-01'}));
const report=(month:string,clicks:number[])=>({source:'GSC Search Analytics API',available:true,month,days_verified:month==='2026-09'?30:31,expected_days:month==='2026-09'?30:31,query_days_verified:month==='2026-09'?30:31,pages:clicks.map((c,i)=>point(products[i].canonical_url,c)),queries:[],evidence:[ref('page'),ref('query')]});
it('returns three independent, evidence-backed products and labels small fluctuations honestly',()=>{
 const old=report('2026-09',[100,100,40,30,20]);
 const now=report('2026-10',[50,98,43,34,22]);
 const r=answerTopProductPriorities(now,old,null,null,products);
 expect(r.items).toHaveLength(3);expect(new Set(r.items.map(x=>x.product_id)).size).toBe(3);
 expect(r.items[0].name).toBe('Ürün 0');
 expect(r.items[0].task).toBe('Önemli düşüşü incele');
 expect(r.items[1].task).toBe('Küçük düşüşü izle; sayfayı değiştirme');
 expect(r.items[2].task).toBe('Başarılı performansı koru');
 expect(r.answer).toContain('1. Ürün 0');expect(r.answer).toContain('2. Ürün 1');expect(r.answer).toContain('3. Ürün 2');
 expect(r.content_change_recommended).toBe(false);expect(r.cause_confirmed).toBe(false);
});
it('does not fill empty candidates with invented data or treat missing months as zero',()=>{
 const r=answerTopProductPriorities(report('2026-10',[10,0,0,0,0]),null,null,null,products);
 expect(r.items).toHaveLength(0);expect(r.decision).toBe('Veri bekle');expect(r.answer).toContain('üç ürün seçilemez');
});
it('does not treat a one-month missing product row as a valid monthly comparison',()=>{
 const curr=report('2026-10',[20,40,50,60,80]);
 const old=report('2026-09',[30,30,30,30,30]);old.pages=old.pages.slice(0,2);
 const r=answerTopProductPriorities(curr,old,null,null,products);
 expect(r.items).toHaveLength(2);
 expect(r.total_candidates).toBe(2);
 expect(r.answer).toContain('kalan 1 sıraya veri uydurulmadı');
});
