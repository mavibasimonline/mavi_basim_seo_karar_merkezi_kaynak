import {describe,it,expect} from 'vitest';
import {buildIndependentContext,saveIndependentContext} from '../src/independent-context';
import {tayfunSave,tayfunList} from '../src/tayfun-ledger';
import {tayfunKeywordTrends} from '../src/tayfun-monitor';
const secret=btoa(String.fromCharCode(...new Uint8Array(32).fill(7)));
const url='https://mavibasim.com/afis';
const time=new Date('2026-11-07T16:30:00Z');
function store(){const data=new Map<string,unknown>();return {get:async<T=unknown>(k:string)=>data.get(k) as T|undefined,
 put:async(k:string,v:unknown)=>{data.set(k,structuredClone(v));}};}
async function setup(){
 const s=store();
 const ctx=await buildIndependentContext({captured_at:time.toISOString(),
  products:[{id:'afis',name:'Afiş',canonical_url:url,url_verified_at:'2026-09-01T00:00:00Z'}],
  snapshots:[],changes:[]},time);
 await saveIndependentContext(s,ctx);
 const original=await tayfunSave(s,secret,{month:'2026-10',url,canonical:url,title:'Ekim Afiş',
  h1:'Afiş Fiyatları',description:'Ekim meta',keywords:['afiş fiyatları','reklam afişi fiyatları'],
  status:'aktif'},new Date('2026-10-15T10:00:00Z'));
 await tayfunSave(s,secret,{month:'2026-11',url,canonical:url,title:'Kasım Afiş',
  h1:'Afiş Baskı',description:'Kasım meta',keywords:['afiş fiyatları','büyük afiş fiyatları'],
  source:'ai-review',product_id:'afis',supersedes:original.entry.id,status:'aktif'},
  new Date('2026-11-07T16:00:00Z'));
 const gsc=async(m:string)=>{
  const n=m==='2026-10'?3:m==='2026-11'?1:0;
  return {month:m,available:m==='2026-10',days_verified:m==='2026-10'?31:m==='2026-11'?4:0,
   expected_days:m==='2026-10'?31:m==='2026-09'?30:30,query_days_verified:m==='2026-10'?31:m==='2026-11'?4:0,
   pages:n?[{page:url,device:'MOBILE',clicks:n,impressions:10*n,position:4}]:[],
   queries:n?[{page:url,device:'MOBILE',query:'afiş fiyatları',clicks:n,impressions:10*n,position:4}]:[]};
 };
 return {s,gsc};
}
describe('Tayfun immutable monthly keyword history',()=>{
 it('shows 3 months of verified observations, partial coverage and effective dated SEO versions',async()=>{
  const {s,gsc}=await setup();
  const r=await tayfunKeywordTrends(s,secret,'afis','2026-11','ALL',3,'afiş fiyatları',gsc,time);
  expect(r.months.map(m=>m.month)).toEqual(['2026-09','2026-10','2026-11']);
  expect(r.months[0].query.clicks).toBeNull();
  expect(r.months[0].seo.version_id).toBeNull();
  expect(r.months[1].query.clicks).toBe(3);
  expect(r.months[1].seo.title).toBe('Ekim Afiş');
  expect(r.months[2].query.clicks).toBe(1);
  expect(r.months[2].coverage.page_complete).toBe(false);
  expect(r.months[2].seo.title).toBe('Kasım Afiş');
  expect((await tayfunList(s,secret,'2026-10')).entries[0].title).toBe('Ekim Afiş');
 });
 it('does not permit different-product or untracked keyword requests',async()=>{
  const {s,gsc}=await setup();
  await expect(tayfunKeywordTrends(s,secret,'afis','2026-11','ALL',6,'uydurma sorgu',gsc,time))
   .rejects.toThrow('TAYFUN_TRENDS_UNTRACKED_QUERY');
  await expect(tayfunKeywordTrends(s,secret,'magnet','2026-11','ALL',3,'afiş fiyatları',gsc,time))
   .rejects.toThrow('TAYFUN_TRENDS_UNKNOWN_PRODUCT');
 });
 it('lets a newly visible query with impressions enter history without fabricating old zeros',async()=>{
  const {s,gsc}=await setup();
  const extended=async(m:string)=>{
   const result=await gsc(m);
   if(m==='2026-11')result.queries.push({page:url,device:'MOBILE',query:'yeni afiş sorgusu',clicks:0,impressions:5,position:16});
   return result;
  };
  const r=await tayfunKeywordTrends(s,secret,'afis','2026-11','ALL',3,'yeni afiş sorgusu',extended,time);
  expect(r.months[0].query.clicks).toBeNull();
  expect(r.months[1].query.clicks).toBeNull();
  expect(r.months[2].query).toMatchObject({clicks:0,impressions:5,position:16});
 });

});
