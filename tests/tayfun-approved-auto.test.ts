import {describe,it,expect} from 'vitest';
import {claimHistory,saveHistoryPage} from '../src/seo-history';
import {tayfunApplyApprovedBaseline} from '../src/tayfun-verified-baseline';
import {tayfunList} from '../src/tayfun-ledger';
const secret=btoa(String.fromCharCode(...new Uint8Array(32).fill(7)));
function store(){
 const data=new Map<string,unknown>();
 return {data,get:async<T=unknown>(key:string)=>data.get(key) as T|undefined,
  put:async(key:string,value:unknown)=>{data.set(key,value);},
  list:async<T=unknown>({prefix=''}:{prefix?:string})=>new Map([...data.entries()].filter(([k])=>k.startsWith(prefix)) as [string,T][])};
}
describe('approved initial Tayfun SEO archive',()=>{
 it('saves three real backed snapshots exactly once and never forges an October crawl',async()=>{
  const storage=store(),now=new Date(),stamp=new Date(now.getTime()-3600000).toISOString();
  const urls=['brosur','el-ilani','afis'];
  const lease=await claimHistory(storage,{trigger:'Authenticated maintenance'});
  expect(lease.status).toBe('ready');
  await saveHistoryPage(storage,secret,{lease:lease.lease,events_after:lease.events_after,snapshots_after:lease.snapshots_after,
   events:[],snapshots:urls.map((slug,i)=>({source_rowid:i+1,id:'verified-'+slug,url:'https://mavibasim.com/'+slug,
    observed_at:stamp,content_hash:'a'.repeat(64),fields:{status:200,title:'Gerçek '+slug,description:'Meta '+slug,
     canonical:['https://mavibasim.com/'+slug],headings:[{level:1,text:'H1 '+slug}],links:[]}})),
   events_caught_up:true,snapshots_caught_up:true,captured_at:now.toISOString()});
  const first=await tayfunApplyApprovedBaseline(storage,secret,now);
  expect(first.ok).toBe(true);
  expect(first.items.map(v=>v.status)).toEqual(['saved','saved','saved']);
  const month=now.toISOString().slice(0,7);
  const records=(await tayfunList(storage,secret,month)).entries;
  expect(records).toHaveLength(3);
  for(const row of records){
   expect(row.created_at.slice(0,7)).toBe(month);
   expect(row.notes).toContain('2026-10-22');
   expect(row.notes).toContain(stamp);
   expect(row.title).toContain('Gerçek');
  }
  const second=await tayfunApplyApprovedBaseline(storage,secret,now);
  expect(second.items.map(v=>v.status)).toEqual(['already_saved','already_saved','already_saved']);
  expect((await tayfunList(storage,secret,month)).entries).toHaveLength(3);
 });
});
