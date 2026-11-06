import {describe,it,expect} from 'vitest';
import {buildProductAiHandoff,productKeywordTracking} from '../public/seo/tayfun-ai.js';
const magnet='https://mavibasim.com/magnet',brosur='https://mavibasim.com/brosur';
const product={id:'magnet',name:'Magnet',category:'Reklam Ürünleri',canonical_url:magnet,urls:[magnet]};
const row=(page:string,query:string,clicks:number,impressions:number)=>({page,query,clicks,impressions,position:12,ctr:0,device:'MOBILE',country:'tur'});
const before={month:'2026-09',available:true,days_verified:30,expected_days:30,query_days_verified:30,pages:[row(magnet,'',2,50),row(brosur,'',50,500)],queries:[
 row(magnet,'magnet fiyatları',1,50),row(magnet,'kaybolan magnet sorgusu',3,30),row(brosur,'broşür özel ticaret sırrı',50,200)]};
const current={month:'2026-10',available:true,days_verified:31,expected_days:31,query_days_verified:31,pages:[row(magnet,'',9,120),row(brosur,'',60,600)],queries:[
 row(magnet,'magnet fiyatları',5,80),row(magnet,'yeni magnet fırsatı',2,20),row(brosur,'broşür özel ticaret sırrı',55,250)]};
const history={save_month:'2026-11',versions:[{id:'old-version',url:magnet,created_at:'2026-10-01T12:00:00Z',title:'Eski Magnet SEO',
 keywords:['magnet fiyatları','eski takip kelimesi'],status:'aktif',source:'user-entry',description:'',h1:'',supersedes:null}],
 tracked_keywords:['magnet fiyatları','eski takip kelimesi'],oldest_recorded_at:'2026-10-01T12:00:00Z',latest_revision_id:'old-version'};
describe('Tayfun SEO İşleri single product AI handoff',()=>{
 it('exports only magnet GSC, SEO and keyword records; never other product data',()=>{
  const text=buildProductAiHandoff({product,month:'2026-10',device:'ALL',report:current,previous:before,history,observed:null});
  expect(text).toContain('MAVI_BASIM_TAYFUN_PRODUCT_HANDOFF_V1');
  expect(text).toContain('magnet fiyatları');
  expect(text).toContain('eski takip kelimesi');
  expect(text).toContain('Eski Magnet SEO');
  expect(text).not.toContain('broşür özel ticaret sırrı');
  expect(text).not.toContain(brosur);
  expect(text).toContain('"expected_latest_id": "old-version"');
  expect(text).toContain('"month": "2026-11"');
  expect(text).toContain('SADECE "Magnet"');
 });
 it('tracks revived or rising words and never equates absent query rows with zero traffic',()=>{
  const rows=productKeywordTracking({product,current,previous:before,history,device:'ALL'});
  const rising=rows.find((r:any)=>r.query==='magnet fiyatları');
  expect(rising.signal).toContain('Yükseliyor');
  expect(rising.delta_clicks).toBe(4);
  const missing=rows.find((r:any)=>r.query==='kaybolan magnet sorgusu');
  expect(missing.current_clicks).toBeNull();
  expect(missing.delta_clicks).toBeNull();
  expect(missing.signal).toContain('Kayıt');
  const archive=rows.find((r:any)=>r.query==='eski takip kelimesi');
  expect(archive).toBeTruthy();
  expect(archive.current_clicks).toBeNull();
  expect(rows.some((r:any)=>r.query==='broşür özel ticaret sırrı')).toBe(false);
 });
});
