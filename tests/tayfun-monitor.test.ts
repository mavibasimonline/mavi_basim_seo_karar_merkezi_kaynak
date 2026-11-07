import {describe,it,expect} from 'vitest';
import {evaluateSeoMonitor} from '../src/tayfun-monitor';
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
});
