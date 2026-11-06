import {it,expect,vi} from 'vitest';
import {appendProductActionDiagnostic} from '../src/product-action-diagnostic';

const url='https://mavibasim.com/brosur';
const product={id:'brosur',name:'Broşür',canonical_url:url,urls:[url],url_verified_at:'2026-11-01'};
const metric=(clicks:number,impressions:number,position:number,query?:string)=>({
 page:url,device:'MOBILE',country:'tur',clicks,impressions,position,ctr:impressions?clicks/impressions:0,...(query?{query}:{})
});
const proof=(scope:'query'|'page')=>({day:'2026-10-01',scope,generation:'v',captured_at:'2026-11-04T00:00:00Z',rows:5,page_hashes:['a'.repeat(64)]});
const month=(value:'2026-09'|'2026-10')=>({
 available:true,month:value,days_verified:value==='2026-10'?31:30,
 expected_days:value==='2026-10'?31:30,query_days_verified:value==='2026-10'?31:30,
 pages:value==='2026-10'?[metric(10,259,18.7)]:[metric(19,386,13.06)],
 queries:value==='2026-10'?[metric(3,100,19,'broşür fiyatları'),metric(5,80,10,'yeni görünen')]:
  [metric(9,190,13,'broşür fiyatları'),metric(3,70,11,'sadece eski')],
 evidence:[proof('page'),proof('query')]
});
const context={products:[product],snapshots:[{id:'s',url,observed_at:'2026-11-02T00:00:00Z',content_hash:'a',title:'Broşür',h1:['Broşür'],body_hash:'abc',status:200}],changes:[]};
const answer={answer:'GSC düşüşü var.',decision:'İncele',month:'2026-10',previous_month:'2026-09',
 comparison:{current:{clicks:10,impressions:259,ctr:10/259,position:18.7},previous:{clicks:19,impressions:386,ctr:19/386,position:13.06},
 delta:-9,rate:-9/19,pages:[{page:url}]},filters:{device:'MOBILE'},evidence_refs:[],evidence:[],evaluation:{changes:[],cause_confirmed:false,content_change_recommended:false}};
function series(value:string,query:string,allVerified=true){
 const n=value==='2026-09'?30:31;
 return {month:value,scope:'query',filters:{query,page:url,device:'MOBILE'},days_verified:allVerified?n:n-1,expected_days:n,d1_requests:0,
 series:Array.from({length:n},(_,i)=>({day:value+'-'+String(i+1).padStart(2,'0'),verified:allVerified||i<n-1,observed:i<2,
 metrics:i<2?{clicks:1,impressions:25,ctr:.04,position:13}:null,
 evidence:i<2?{day:value+'-'+String(i+1).padStart(2,'0'),scope:'query',generation:'v',captured_at:'2026-11-04T00:00:00Z',rows:5,page_hashes:['a'.repeat(64)]}:undefined}))};
}
it('investigates an observed query loss using two full daily month series, giving an actionable but noncausal conclusion',async()=>{
 const read=vi.fn(async(m:string,f:{query:string})=>series(m,f.query));
 const result=await appendProductActionDiagnostic(answer,month('2026-10'),month('2026-09'),product,context,read);
 expect(result.diagnostic?.mechanism).toBe('Sıralama ile gösterim birlikte kötüleşmiş');
 expect(result.diagnostic?.top_visible_query?.query).toBe('broşür fiyatları');
 expect(result.diagnostic?.daily_query_coverage).toHaveLength(2);
 expect(result.answer).toContain('1) Sorun nerede?');
 expect(result.answer).toContain('2) Hangi kelime ve ne zaman?');
 expect(result.answer).toContain('3) SEO değişikliğine bakıldı mı?');
 expect(result.answer).toContain('SONUÇ:');
 expect(result.answer).toContain('şu anda değiştirme');
 expect(read).toHaveBeenCalledTimes(2);
 expect(result.diagnostic?.daily_query_coverage?.every((v:any)=>v.daily_absence_is_zero===false)).toBe(true);
 expect(result.cause_confirmed).toBe(false);expect(result.content_change_recommended).toBe(false);
});
it('does not claim an onset or zero when a daily archive is incomplete',async()=>{
 const read=vi.fn(async(m:string,f:{query:string})=>series(m,f.query,m!=='2026-10'));
 const result=await appendProductActionDiagnostic(answer,month('2026-10'),month('2026-09'),product,context,read);
 expect(result.diagnostic?.daily_query_coverage).toHaveLength(0);
 expect(result.answer).toContain('Günlük sorgu kapsamı veya kayıtların bütünlüğü doğrulanamadı');
 expect(result.diagnostic?.cause_confirmed).toBe(false);
});
it('returns unchanged answer on an important growth rather than forcing a fall diagnosis',async()=>{
 const source={...answer,comparison:{...answer.comparison,delta:18},decision:'Koru'};
 const read=vi.fn();
 const result=await appendProductActionDiagnostic(source,month('2026-10'),month('2026-09'),product,context,read);
 expect(result).toBe(source);expect(read).not.toHaveBeenCalled();
});
it('does not guess a missing query baseline',async()=>{
 const current=month('2026-10');current.queries=[metric(3,100,19,'yeni sorgu')];
 const old=month('2026-09');old.queries=[metric(9,190,13,'eski sorgu')];
 const read=vi.fn();
 const result=await appendProductActionDiagnostic(answer,current,old,product,context,read);
 expect(result.diagnostic?.top_visible_query).toBe(null);
 expect(result.answer).toContain('sorgu adı veya kayıp sayısı tahmin edilmedi');
 expect(read).not.toHaveBeenCalled();
});
