import {describe,it,expect} from 'vitest';
import {evaluateSeoMonitor,seoRevisionTimeline} from '../src/tayfun-monitor';
import type {TayfunEntry} from '../src/tayfun-ledger';
const product={id:'magnet',name:'Magnet',canonical_url:'https://mavibasim.com/magnet',urls:['https://mavibasim.com/magnet']};
const entry={id:'version-1',source:'ai-review',url:product.canonical_url,created_at:'2026-09-09T08:00:00Z',keywords:['magnet fiyatları','eski silinmeyen kelime']} as TayfunEntry;
const row=(clicks:number,impressions:number,query?:string)=>({page:product.canonical_url,device:'MOBILE',clicks,impressions,position:6,...query?{query}:{}});
const month=(m:string,clicks:number,impressions:number,available=true)=>({month:m,available,days_verified:available?30:10,expected_days:30,pages:[row(clicks,impressions)],queries:[row(3,50,'magnet fiyatları')]});
describe('Tayfun SEO Takibi read-only monthly monitoring',()=>{
 it('raises a material drop only for two full comparable months, without claiming a deployed edit',()=>{
  const result=evaluateSeoMonitor(product,[entry],month('2026-10',14,200),month('2026-09',20,250));
  expect(result.status).toBe('dusuyor');expect(result.click_delta).toBe(-6);
  expect(result.note).toContain('yayına alınmış değişiklik kanıtı değildir');
 });
 it('protects minor movements and never treats absent query rows as zero',()=>{
  const old=month('2026-09',19,300);old.queries=[];
  const result=evaluateSeoMonitor(product,[entry],month('2026-10',20,300),old);
  expect(result.status).toBe('izle');
  expect(result.keywords[0]).toMatchObject({previous_clicks:null,current_clicks:3,change:null});
  expect(result.keywords[1]).toMatchObject({previous_clicks:null,current_clicks:null,change:null});
 });
 it('identifies meaningful verified rises without recommending live site changes',()=>{
  const result=evaluateSeoMonitor(product,[entry],month('2026-10',60,280),month('2026-09',30,280));
  expect(result.status).toBe('yukseliyor');expect(result.click_delta).toBe(30);
 });
 it('does not flag partial November data as a fall against October',()=>{
  const result=evaluateSeoMonitor(product,[entry],month('2026-11',1,5,false),month('2026-10',50,300));
  expect(result.status).toBe('bekle');expect(result.click_delta).toBeNull();
 });
 it('waits for a post-record complete month and keeps first registration date',()=>{
  const newlySaved={...entry,created_at:'2026-10-17T08:00:00Z'};
  const result=evaluateSeoMonitor(product,[newlySaved],month('2026-10',20,200),month('2026-09',50,300));
  expect(result.status).toBe('bekle');
  expect(result.first_saved_at).toBe(newlySaved.created_at);
 });
 it('does not invent SEO versions for products without AI saves',()=>{
  const result=evaluateSeoMonitor(product,[],month('2026-10',2,100),month('2026-09',20,200));
  expect(result.status).toBe('bekle');expect(result.revisions).toBe(0);
 });
 it('shows October metrics and partial November observed query values without a false drop decision',()=>{
  const older={...entry,keywords:['magnet fiyatları','eski silinmeyen kelime','dönemsel magnet'],keyword_decisions:[
   {query:'magnet fiyatları',action:'koru' as const,reason:'Daha önce tıklama sağlayan arama sorgusu korunsun.'}]};
  const last=month('2026-11',4,65,false);
  last.queries=[{...row(1,19,'magnet fiyatları'),position:4.5}];
  const oct=month('2026-10',15,260);
  oct.queries=[{...row(4,75,'magnet fiyatları'),position:8.25}];
  const result=evaluateSeoMonitor(product,[older],last,oct);
  expect(result.status).toBe('bekle');
  expect(result.click_delta).toBeNull();
  expect(result.observed_previous).toMatchObject({clicks:15,impressions:260});
  expect(result.observed_current).toMatchObject({clicks:4,impressions:65});
  expect(result.keywords[0]).toMatchObject({
   query:'magnet fiyatları',previous_clicks:4,current_clicks:1,
   previous_impressions:75,current_impressions:19,
   previous_position:8.25,current_position:4.5,decision:'koru'});
  expect(result.keywords[0].status).toContain('Kısmi ay');
  expect(result.keywords.find(k=>k.query==='eski silinmeyen kelime')?.current_clicks).toBeNull();
  expect(result.keywords.find(k=>k.query==='dönemsel magnet')).toBeDefined();
 });
 it('keeps historical keyword even when a newer AI version omits it',()=>{
  const latest={...entry,id:'version-2',created_at:'2026-10-20T09:00:00Z',keywords:['magnet fiyatları']};
  const result=evaluateSeoMonitor(product,[entry,latest],month('2026-11',1,30,false),month('2026-10',9,120));
  expect(result.archive_count).toBe(2);
  expect(result.revisions).toBe(2);
  expect(result.tracked_keywords).toContain('eski silinmeyen kelime');
  expect(result.latest_seo?.version_id).toBe('version-2');
 });

 it('displays the exact recording day and explicitly compares changed Title Meta and H1/H2 while preserving old version',()=>{
  const original={...entry,id:'old-2026',month:'2026-10',created_at:'2026-11-07T12:30:00.000Z',source:'user-entry' as const,
   title:'Afiş fiyatları',description:'Eski meta',h1:'Afiş baskı',
   headings:'[{"level":2,"text":"Eski başlık"}]',canonical:product.canonical_url,robots:'index,follow',
   keywords:['eski afiş fiyatları'],supersedes:null} as unknown as TayfunEntry;
  const newer={...original,id:'new-2026',month:'2026-11',created_at:'2026-11-07T15:49:48.000Z',
   source:'ai-review' as const,title:'Afiş Baskı Fiyatları 2026',description:'Yeni meta',
   h1:'Afiş fiyatları ve ölçüler',headings:'[{"level":2,"text":"Yeni başlık"}]',
   keywords:['eski afiş fiyatları','büyük afiş fiyatları'],supersedes:original.id};
  const timeline=seoRevisionTimeline([newer,original]);
  expect(timeline.map(x=>x.created_at)).toEqual([original.created_at,newer.created_at]);
  expect(timeline[0]).toMatchObject({month:'2026-10',edit_is_live:false,previous_version_id:null});
  expect(timeline[1].changed_fields).toEqual(expect.arrayContaining([
   'SEO Title','Meta Description','H1','H2–H6 başlıkları']));
  expect(timeline[1].added_keywords).toContain('büyük afiş fiyatları');
  expect(timeline[0].title).toBe('Afiş fiyatları');
  expect(timeline[1].title).toBe('Afiş Baskı Fiyatları 2026');
  const result=evaluateSeoMonitor(product,[newer,original],month('2026-11',4,30,false),month('2026-10',5,70));
  expect(result.first_recorded_at).toBe(original.created_at);
  expect(result.last_recorded_at).toBe(newer.created_at);
  expect(result.archive_count).toBe(2);
  expect(result.revision_timeline).toHaveLength(2);
  expect(result.tracked_keywords).toContain('eski afiş fiyatları');
  expect(result.tracked_keywords).toContain('büyük afiş fiyatları');
 });

});
