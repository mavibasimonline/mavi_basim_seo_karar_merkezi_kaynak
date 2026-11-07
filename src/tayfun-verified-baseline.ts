// Create a dated, immutable Tayfun tracking revision only from an existing verified SEO snapshot.
// The user's reference date is a label, never a claim about when the page was published or crawled.
import {historyDetail} from './seo-history';
import {tayfunList,tayfunSave} from './tayfun-ledger';
import {gscPageURL} from './urls';
type Storage={get<T=unknown>(key:string):Promise<T|undefined>;put(key:string,value:unknown):Promise<unknown>;list<T=unknown>(options:{prefix?:string;start?:string;startAfter?:string;limit?:number;reverse?:boolean;end?:string}):Promise<Map<string,T>>};
const assert:(v:unknown)=>asserts v=(v)=>{if(!v)throw Error('TAYFUN_VERIFIED_BASELINE_INVALID');};
const str=(v:unknown,max:number)=>typeof v==='string'?v.slice(0,max):'';
const json=(v:unknown,max:number)=>v===undefined||v===null?'':JSON.stringify(v).slice(0,max);
export async function tayfunSaveVerifiedSnapshot(storage:Storage,secret:string,input:unknown,now=new Date()){
 assert(input&&typeof input==='object'&&!Array.isArray(input));
 const data=input as Record<string,unknown>;
 const url=data.url,id=data.snapshot_id,reference=data.reference_date;
 assert(typeof url==='string'&&url.length<=2048&&gscPageURL(url)===url);
 assert(typeof id==='string'&&/^[A-Za-z0-9_-]{1,100}$/.test(id));
 assert(typeof reference==='string'&&/^20\d\d-(0[1-9]|1[0-2])-([0-2]\d|3[01])$/.test(reference)&&!Number.isNaN(Date.parse(reference))&&new Date(reference).toISOString().slice(0,10)===reference);
 assert(reference<=now.toISOString().slice(0,10));
 const snapshot=await historyDetail(storage,secret,'snapshot',id);
 assert(snapshot&&snapshot.url===url&&typeof snapshot.observed_at==='string'&&Date.parse(snapshot.observed_at)<=now.getTime()+300000);
 const fields=snapshot.fields as Record<string,unknown>;
 assert(fields&&typeof fields==='object'&&fields.status===200&&typeof fields.title==='string'&&fields.title.trim().length>0);
 const period=now.toISOString().slice(0,7);
 const ledger=await tayfunList(storage,secret,period);
 const evidence='seo_snapshots:'+id;
 const existing=ledger.entries.find(e=>e.url===url&&e.notes.includes(evidence));
 if(existing)return {ok:true,already_saved:true,entry:existing,source:'seo_snapshots',site_mutations:0,d1_requests:0};
 const existingRevisions=ledger.entries.filter(e=>e.url===url).sort((a,b)=>a.created_at.localeCompare(b.created_at));
 const latest=existingRevisions.at(-1);
 const headings=Array.isArray(fields.headings)?fields.headings.filter((h:any)=>h&&typeof h.text==='string'&&Number.isInteger(h.level)):[];
 const h1=headings.filter((h:any)=>h.level===1).map((h:any)=>h.text).join(' / ').slice(0,500);
 const canonical=Array.isArray(fields.canonical)?fields.canonical.find((c:unknown)=>typeof c==='string'&&gscPageURL(c)===c):fields.canonical;
 const notes='Kanıtlı SEO taramasından takip sürümü. Kullanıcı referans tarihi: '+reference+
  ' (yayın/tarama tarihi değildir). Gerçek gözlem: '+snapshot.observed_at+
  '. Kaynak: '+evidence+'. İçerik hash: '+snapshot.content_hash+
  '. Bu sürüm canlı siteyi değiştirmez.';
 const result=await tayfunSave(storage,secret,{
  month:period,url,source:'user-entry',status:'aktif',supersedes:latest?.id||null,
  title:str(fields.title,300),description:str(fields.description,1000),h1,
  canonical:typeof canonical==='string'&&gscPageURL(canonical)===canonical?canonical:'',
  robots:json(fields.robots,200),headings:json(headings,2500),internal_links:json(fields.links,2500),
  structured_data:json(fields.structured_data,5000),notes:notes.slice(0,2500),
  keywords:latest?.keywords||[],hreflang:json(fields.hreflang,2500),images:json(fields.images,2500),
  open_graph:json(fields.open_graph,2500),twitter_card:json(fields.twitter_card,2500),
  x_robots:str(fields.x_robots,200),viewport:str(fields.viewport,500),lang:str(fields.lang,100),
  redirect:str(fields.redirect,2048),status_code:String(fields.status),content_excerpt:str(fields.excerpt,5000)
 },now);
 return {...result,reference_date:reference,snapshot_observed_at:snapshot.observed_at,snapshot_id:id,
  source:'seo_snapshots',publication_verified:false,site_mutations:0,d1_requests:0};
}
