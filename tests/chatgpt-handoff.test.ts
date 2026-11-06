import {it,expect} from 'vitest';
import {buildChatGptHandoff} from '../src/browser/chatgpt-handoff.js';

const page='https://mavibasim.com/brosur';
const row=(clicks,device='MOBILE')=>({page,query:'broşür fiyatları',device,country:'tur',clicks,impressions:100,position:12});
const monthly=(month,clicks)=>({
 month,available:true,source:'GSC Search Analytics API',days_verified:month==='2026-10'?31:30,
 query_days_verified:month==='2026-10'?31:30,expected_days:month==='2026-10'?31:30,
 pages:[row(clicks)],queries:[row(clicks)],daily:[{day:month+'-01',verified:true,devices:[row(clicks)],fetched_at:'2026-11-05T00:00:00Z'}],
 evidence:[{scope:'query',day:month+'-01',generation:'hash'}]
});
const base={
 month:'2026-10',device:'ALL',current:[monthly('2026-10',21)],previous:monthly('2026-09',31),
 ga4:{month:'2026-10',closed:true,pages:[{page:'/brosur',sessions:58}]},
 oldGa4:{month:'2026-09',closed:true,pages:[{page:'/brosur',sessions:131}]},
 catalog:{products:[{id:'brosur',name:'Broşür',canonical_url:page,urls:[page]}],source_hash:'verified',changes:[
 {id:'change-1',url:page,observed_from:'2026-10-24T00:00:00Z',observed_to:'2026-10-31T00:00:00Z',changed_fields:['body_hash'],before:{title:'Eski'},after:{title:'Yeni'}}
 ]},
 status:{connected:true},ga4Status:{connected:true}
};
it('exports a stand-alone report with real prior/current GSC, GA4, audit history and dates',()=>{
 const md=buildChatGptHandoff(base);
 expect(md).toContain('MAVI_BASIM_CHATGPT_SEO_DEVIR_V1');
 expect(md).toContain('"delta_clicks": -10');
 expect(md).toContain('"sessions": 131');
 expect(md).toContain('"sessions": 58');
 expect(md).toContain('change-1');
 expect(md).toContain('"title": "Eski"');
 expect(md).toContain('"title": "Yeni"');
 expect(md).toContain('ÖNCE KANIT, SONRA YORUM');
 expect(md).toContain('GSC gizlenmiş sorguları API de göstermez.');
});
it('preserves missing baselines as null, not fabricated zero or change',()=>{
 const md=buildChatGptHandoff({...base,previous:null,oldGa4:null});
 expect(md).toContain('"previous": null');
 expect(md).toContain('"previous_page_days": null');
 expect(md).toContain('"ga4_previous_closed": false');
 expect(md).toContain('"delta_clicks": null');
});
it('keeps device-scoped GSC distinct from unfiltered GA4',()=>{
 const md=buildChatGptHandoff({...base,device:'MOBILE'});
 expect(md).toContain('"device_filter": "MOBILE"');
 expect(md).toContain('GA4 ayrı olarak tüm cihazlar');
});
it('rejects invalid month',()=>expect(()=>buildChatGptHandoff({...base,month:'2026-99'})).toThrow());
