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
