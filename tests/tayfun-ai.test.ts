import {describe,it,expect} from 'vitest';
import {buildIndependentContext,saveIndependentContext} from '../src/independent-context';
import {tayfunAiContext,tayfunAiSave} from '../src/tayfun-ai';
import {tayfunList,tayfunSave} from '../src/tayfun-ledger';
const secret=btoa(String.fromCharCode(...new Uint8Array(32).fill(7)));
const stamp=new Date('2026-11-06T18:20:00Z'),url='https://mavibasim.com/magnet';
const initial={month:'2026-10',url,title:'Eski Magnet SEO',description:'Önceki açıklama',h1:'Magnet',canonical:url,
 robots:'index,follow',headings:'Magnet baskı',internal_links:'/etiket',structured_data:'{}',notes:'Ekim kaydı',
 keywords:['magnet fiyatları','toptan magnet'],status:'aktif'};
const fields={title:'Yeni Magnet Title',description:'Yeni meta',h1:'Magnet baskı',canonical:url,robots:'index,follow',
 headings:'[{"level":2,"text":"Magnet fiyatları"}]',internal_links:'["/brosur"]',structured_data:'{}',notes:'Yapay zekâ önerisi',
 hreflang:'',images:'',open_graph:'',twitter_card:'',x_robots:'',viewport:'',lang:'tr',redirect:'',status_code:'200',content_excerpt:''};
function store(){const data=new Map<string,unknown>();return {data,get:async<T=unknown>(k:string)=>data.get(k) as T|undefined,put:async(k:string,v:unknown)=>{data.set(k,structuredClone(v));}};}
async function fixture(){
 const s=store(),ctx=await buildIndependentContext({captured_at:stamp.toISOString(),products:[
  {id:'magnet',name:'Magnet',canonical_url:url,url_verified_at:'2026-09-10T09:00:00Z'},
  {id:'brosur',name:'Broşür',canonical_url:'https://mavibasim.com/brosur',url_verified_at:'2026-09-11T09:00:00Z'}],
  snapshots:[],changes:[]},stamp);
 await saveIndependentContext(s,ctx);const first=await tayfunSave(s,secret,initial,stamp);
 return {s,first};
}
const answer=(latest:string|null)=>({format:'MAVI_BASIM_TAYFUN_AI_PRODUCT_V1',product_id:'magnet',url,month:'2026-11',
 expected_latest_id:latest,seo:fields,keywords:['yeni magnet kelimesi'],
 keyword_decisions:[{query:'magnet fiyatları',action:'koru',reason:'Eski kazanan sorgu korunmalı'}],
 page_proposals:[{keyword:'özel kesim magnet',reason:'Ayrı niyet için araştırma adayı',url_suggestion:'https://mavibasim.com/ozel-kesim-magnet'}]});
describe('Tayfun AI product-scoped handoff and append-only keyword history',()=>{
 it('returns only the selected product revisions and the true earliest record date',async()=>{
  const {s,first}=await fixture();
  await tayfunSave(s,secret,{...initial,url:'https://mavibasim.com/brosur',canonical:'https://mavibasim.com/brosur',month:'2026-11',title:'Unrelated Broşür',keywords:['broşür baskı']},stamp);
  const ctx=await tayfunAiContext(s,secret,'magnet',stamp);
  expect(ctx.product.id).toBe('magnet');
  expect(ctx.product.urls).toEqual([url]);
  expect(ctx.versions).toHaveLength(1);
  expect(ctx.versions[0].id).toBe(first.entry.id);
  expect(ctx.tracked_keywords).toEqual(['magnet fiyatları','toptan magnet']);
  expect(ctx.oldest_recorded_at).toBe(first.entry.created_at);
  expect(ctx.save_month).toBe('2026-11');
 });
 it('saves new server dated SEO revision without rewriting old October text or deleting prior keywords',async()=>{
  const {s,first}=await fixture(),v=answer(first.entry.id);
  const saved=await tayfunAiSave(s,secret,v,stamp);
  expect(saved.site_mutations).toBe(0);expect(saved.publication_verified).toBe(false);
  expect(saved.previous_revision_id).toBe(first.entry.id);
  expect(saved.entry.source).toBe('ai-review');
  expect(saved.entry.created_at).toBe(stamp.toISOString());
  expect(saved.entry.keywords).toEqual(['magnet fiyatları','toptan magnet','yeni magnet kelimesi']);
  expect(saved.entry.page_proposals?.[0].keyword).toBe('özel kesim magnet');
  const oct=await tayfunList(s,secret,'2026-10');
  expect(oct.entries[0].title).toBe('Eski Magnet SEO');
  expect(oct.entries[0].keywords).toEqual(['magnet fiyatları','toptan magnet']);
  expect((await tayfunList(s,secret,'2026-11')).entries[0].title).toBe('Yeni Magnet Title');
 });
 it('blocks unrelated product URLs, tampered months and stale concurrent imports',async()=>{
  const {s,first}=await fixture();
  for(const bad of [
   {...answer(first.entry.id),url:'https://mavibasim.com/brosur'},
   {...answer(first.entry.id),product_id:'brosur'},
   {...answer(first.entry.id),month:'2026-10'},
   {...answer(first.entry.id),expected_latest_id:'fake'}
  ])await expect(tayfunAiSave(s,secret,bad,stamp)).rejects.toThrow('TAYFUN_AI_INVALID');
  const v=answer(first.entry.id);
  await tayfunAiSave(s,secret,v,stamp);
  const repeated=await tayfunAiSave(s,secret,v,stamp);
  expect(repeated.already_saved).toBe(true);
  expect(repeated.entry.id).toBe((await tayfunList(s,secret,'2026-11')).entries[0].id);
  await expect(tayfunAiSave(s,secret,{...v,seo:{...v.seo,title:'Eşleşmeyen güncel başlık'}},stamp)).rejects.toThrow('TAYFUN_AI_INVALID');
  await expect(tayfunAiSave(s,secret,{...v,keywords:['başka kelime']},stamp)).rejects.toThrow('TAYFUN_AI_INVALID');
  expect((await tayfunList(s,secret,'2026-11')).entries).toHaveLength(1);
 });
});
