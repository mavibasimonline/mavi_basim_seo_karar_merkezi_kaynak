import {describe,it,expect} from 'vitest';
import {claimHistory,saveHistoryPage} from '../src/seo-history';
import {tayfunSaveVerifiedSnapshot} from '../src/tayfun-verified-baseline';
import {tayfunList} from '../src/tayfun-ledger';
const secret=btoa(String.fromCharCode(...new Uint8Array(32).fill(7)));
const url='https://mavibasim.com/brosur';
function store(){
 const data=new Map<string,unknown>();
 return {data,get:async<T=unknown>(key:string)=>data.get(key) as T|undefined,
  put:async(key:string,value:unknown)=>{data.set(key,value);},
  list:async<T=unknown>({prefix=''}:{prefix?:string})=>new Map([...data.entries()].filter(([k])=>k.startsWith(prefix)) as [string,T][])};
}
describe('Tayfun verified snapshot baseline',()=>{
 it('rejects fabricated source ids and outside URLs without storing a record',async()=>{
  const s=store(),now=new Date();
  await expect(tayfunSaveVerifiedSnapshot(s,secret,{url,snapshot_id:'fake',reference_date:'2026-10-22'},now)).rejects.toThrow('TAYFUN_VERIFIED_BASELINE_INVALID');
  await expect(tayfunSaveVerifiedSnapshot(s,secret,{url:'https://example.com/brosur',snapshot_id:'fake',reference_date:'2026-10-22'},now)).rejects.toThrow('TAYFUN_VERIFIED_BASELINE_INVALID');
 });
 it('writes only a sourced version and preserves the 22 October reference as a label',async()=>{
  const s=store(),now=new Date();
  const observed=new Date(now.getTime()-3600000).toISOString();
  const lease=await claimHistory(s,{trigger:'Authenticated maintenance'});
  expect(lease.status).toBe('ready');
  await saveHistoryPage(s,secret,{lease:lease.lease,events_after:lease.events_after,snapshots_after:lease.snapshots_after,
   events:[],snapshots:[{source_rowid:1,id:'brochure-snapshot-1',url,observed_at:observed,
    content_hash:'a'.repeat(64),fields:{status:200,title:'Broşür Başlık',description:'Gerçek meta açıklaması',
     canonical:[url],headings:[{level:1,text:'Broşür H1'}],links:['https://mavibasim.com/el-ilani'],excerpt:'Sayfa özeti'}}],
   events_caught_up:true,snapshots_caught_up:true,captured_at:new Date().toISOString()});
  const input={url,snapshot_id:'brochure-snapshot-1',reference_date:'2026-10-22'};
  const first=await tayfunSaveVerifiedSnapshot(s,secret,input,now);
  expect(first.ok).toBe(true);expect(first.site_mutations).toBe(0);
  expect(first.entry.title).toBe('Broşür Başlık');
  expect(first.entry.description).toBe('Gerçek meta açıklaması');
  expect(first.entry.notes).toContain('2026-10-22');
  expect(first.entry.notes).toContain(observed);
  expect(first.entry.created_at).toBe(now.toISOString());
  const again=await tayfunSaveVerifiedSnapshot(s,secret,input,now);
  expect(again.already_saved).toBe(true);
  expect((await tayfunList(s,secret,now.toISOString().slice(0,7))).entries).toHaveLength(1);
 });
});
