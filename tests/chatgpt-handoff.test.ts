import {it,expect} from 'vitest';
// @ts-expect-error Browser module is deliberately plain JavaScript.
import {buildChatGptHandoff} from '../src/browser/chatgpt-handoff.js';

const page='https://mavibasim.com/brosur';
const row=(clicks:number,device='MOBILE')=>({page,query:'broşür fiyatları',device,country:'tur',clicks,impressions:100,position:12});
const monthly=(month:string,clicks:number)=>({
 month,available:true,source:'GSC Search Analytics API',days_verified:month==='2026-10'?31:30,
 query_days_verified:month==='2026-10'?31:30,expected_days:month==='2026-10'?31:30,
 property_total:{clicks:clicks+100,impressions:1000,position:12,ctr:.1},
 pages:[row(clicks)],queries:[row(clicks)],daily:[{day:month+'-01',verified:true,devices:[row(clicks)],fetched_at:'2026-11-05T00:00:00Z'}],
 evidence:[{scope:'query',day:month+'-01',generation:'hash'}]
});
const base={
 month:'2026-10',device:'ALL',current:[monthly('2026-10',21)],previous:monthly('2026-09',31),
 ga4:{month:'2026-10',closed:true,totals:{sessions:58},devices:[{sessions:60}],cities:[{sessions:58}],pages:[{page:'/brosur',sessions:58}]},
 oldGa4:{month:'2026-09',closed:true,totals:{sessions:131},pages:[{page:'/brosur',sessions:131}]},
 catalog:{products:[{id:'brosur',name:'Broşür',canonical_url:page,urls:[page]}],source_hash:'verified',changes:[
 {id:'change-1',url:page,observed_from:'2026-10-24T00:00:00Z',observed_to:'2026-10-31T00:00:00Z',changed_fields:['body_hash'],before:{id:'snapshot1',title:'Eski'},after:{id:'snapshot2',title:'Yeni'}}
 ],snapshots:[{id:'snapshot1'},{id:'snapshot2'},{id:'orphan'}]},
 status:{connected:true},ga4Status:{connected:true}
};
const unpack=(markdown:string)=>JSON.parse(markdown.split('## Tekil ham kaynak paketi (JSON, tekrar içermeyen alanlar)\n\n')[1]);
it('exports stand-alone compact V2 report with prior/current data and audit events',()=>{
 const md=buildChatGptHandoff(base),data=unpack(md);
 expect(data.format).toBe('MAVI_BASIM_CHATGPT_SEO_DEVIR_V2');
 expect(md).toContain('31 → 21');
 expect(data.gsc.current.pages[0].clicks).toBe(21);
 expect(data.gsc.previous.pages[0].clicks).toBe(31);
 expect(data.ga4.current.totals.sessions).toBe(58);
 expect(data.ga4.previous.totals.sessions).toBe(131);
 expect(data.seo_change_history.events[0].before.title).toBe('Eski');
 expect(data.seo_change_history.events[0].after.title).toBe('Yeni');
 expect(data.seo_change_history.other_snapshots).toEqual([{id:'orphan'}]);
 expect(md).toContain('Önce kanıt, sonra yorum');
});
it('does not duplicate individual raw query/page rows across sections',()=>{
 const data=unpack(buildChatGptHandoff(base));
 expect(data.aggregate_observations).toBeUndefined();
 expect(data.product_catalog_and_observations).toBeUndefined();
 expect(data.gsc.current.queries).toHaveLength(1);
 expect(data.catalog.products[0].name).toBe('Broşür');
});
it('reports reconciliations for separate GSC and GA4 metrics rather than hiding differences',()=>{
 const data=unpack(buildChatGptHandoff(base));
 expect(data.reconciliation.gsc.current.observed_minus_official).toBe(-100);
 expect(data.reconciliation.ga4.current.facets.devices.delta_vs_official).toBe(2);
 expect(data.reconciliation.ga4.current.facets.pages.delta_vs_official).toBe(0);
});
it('preserves missing baselines as null, not fabricated zero',()=>{
 const data=unpack(buildChatGptHandoff({...base,previous:null,oldGa4:null}));
 expect(data.gsc.previous).toBeNull();
 expect(data.reconciliation.gsc.previous).toBeNull();
 expect(data.completeness.previous_page_days).toBeNull();
 expect(data.completeness.ga4_previous_closed).toBe(false);
});
it('does not compare device-scoped data to site-wide property totals',()=>{
 const data=unpack(buildChatGptHandoff({...base,device:'MOBILE'}));
 expect(data.device_filter).toBe('MOBILE');
 expect(data.reconciliation.gsc.current.official_site_clicks).toBeNull();
 expect(data.ga4.current.totals.sessions).toBe(58);
});
it('rejects invalid month',()=>expect(()=>buildChatGptHandoff({...base,month:'2026-99'})).toThrow());

it('separates city, sector, blog and product pages without repeating raw page records',()=>{
 const p=(url:string,clicks:number,device='MOBILE')=>({page:url,device,country:'tur',clicks,impressions:100,position:12});
 const cur={...monthly('2026-10',21),pages:[
  p(page,21),p('https://mavibasim.com/istanbul-brosur-baski',7),
  p('https://mavibasim.com/sektor/kuafor-kartvizit-baski',2),
  p('https://mavibasim.com/blog/varak-baski-nedir',1),
  p('https://mavibasim.com/iletisim',3)],
  queries:[
  {...p('https://mavibasim.com/istanbul-brosur-baski',7),query:'istanbul broşür baskı'},
  {...p('https://mavibasim.com/sektor/kuafor-kartvizit-baski',2),query:'kuaför kartvizit'}]
 };
 const prev={...monthly('2026-09',31),pages:[
  p(page,31),p('https://mavibasim.com/istanbul-brosur-baski',4),
  p('https://mavibasim.com/sektor/kuafor-kartvizit-baski',3),
  p('https://mavibasim.com/blog/varak-baski-nedir',2),
  p('https://mavibasim.com/iletisim',3)]};
 const md=buildChatGptHandoff({...base,current:[cur],previous:prev});
 const data=unpack(md);
 expect(data.taxonomy.counts.urun.current_url_count).toBe(1);
 expect(data.taxonomy.counts.sehir.current_url_count).toBe(1);
 expect(data.taxonomy.counts.sektorel.current_url_count).toBe(1);
 expect(data.taxonomy.counts.blog.current_url_count).toBe(1);
 expect(data.taxonomy.counts.diger.current_url_count).toBe(1);
 expect(md).toContain('## Şehir ve şehre özel baskı sayfaları');
 expect(md).toContain('## Sektörel sayfalar');
 expect(md).toContain('## Blog yazıları');
 expect(md).toContain('Mobil / masaüstü / tablet URL kırılımı:');
 expect(data.gsc.current.pages).toHaveLength(5);
 expect(data.taxonomy.counts.sehir.not_all_indexed_urls).toBe(true);
});
it('preserves daily device totals but does not claim daily URL-query series',()=>{
 const data=unpack(buildChatGptHandoff(base));
 expect(data.daily_device_totals.current.by_device[0].device).toBe('MOBILE');
 expect(data.daily_device_totals.current.by_device[0].clicks).toBe(21);
 expect(data.daily_device_totals.current.caveat).toContain('URL veya sorgunun gün bazlı');
});
it('keeps absent page in a month as missing, rather than a fabricated zero',()=>{
 const md=buildChatGptHandoff({...base,current:[{...monthly('2026-10',21),pages:[]}],previous:monthly('2026-09',31)});
 expect(md).toContain('bu ay kayıt yok (sıfır olduğu kanıtlanmadı)');
});
