// Tayfun: encrypted append-only monthly SEO decisions. Never writes to the live site or source crawl records.
import {encrypt,decrypt} from './security';
import {gscPageURL} from './urls';

type Store={get<T=unknown>(key:string):Promise<T|undefined>;put(key:string,value:unknown):Promise<unknown>};
export type TayfunEntry={
 id:string;month:string;url:string;created_at:string;status:'aktif'|'pasif';kind:'manuel';source:'user-entry'|'ai-review';
 title:string;description:string;h1:string;canonical:string;robots:string;keywords:string[];
 headings:string;internal_links:string;structured_data:string;notes:string;supersedes:string|null;
 hreflang:string;images:string;open_graph:string;twitter_card:string;x_robots:string;viewport:string;lang:string;redirect:string;status_code:string;content_excerpt:string;
 keyword_decisions?:{query:string;action:'koru'|'izle'|'yeni_sayfa_adayi';reason:string}[];page_proposals?:{keyword:string;reason:string;url_suggestion:string}[]; product_id?:string|null;
};
type StoreIndex={version:2;ids:string[];updated_at:string};
const INDEX='tayfun:ledger:v2:index:',ROW='tayfun:ledger:v2:record:';
const fail:(ok:unknown)=>asserts ok=(ok)=>{if(!ok)throw Error('TAYFUN_INPUT_INVALID');};
const owned=(url:unknown):url is string=>typeof url==='string'&&url.length<=2048&&gscPageURL(url)===url;
const text=(v:unknown,max:number)=>{fail(typeof v==='string'&&v.length<=max&&!/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(v));return v as string;};
const month=(v:unknown)=>{fail(typeof v==='string'&&/^20\d\d-(0[1-9]|1[0-2])$/.test(v));return v as string;};
async function index(storage:Store,secret:string,period:string):Promise<StoreIndex>{
 const sealed=await storage.get<string>(INDEX+period);
 if(!sealed)return {version:2,ids:[],updated_at:''};
 const value=await decrypt<StoreIndex>(sealed,secret);
 fail(value.version===2&&Array.isArray(value.ids)&&value.ids.length<=2000&&value.ids.every(v=>typeof v==='string'&&/^[a-f0-9-]{36}$/.test(v)));
 return value;
}
async function getEntry(storage:Store,secret:string,id:string){
 const sealed=await storage.get<string>(ROW+id);if(!sealed)return null;
 return decrypt<TayfunEntry>(sealed,secret);
}
export async function tayfunList(storage:Store,secret:string,period:string){
 month(period);const saved=await index(storage,secret,period);
 const entries=(await Promise.all(saved.ids.map(id=>getEntry(storage,secret,id)))).filter((e):e is TayfunEntry=>!!e);
 return {month:period,entries,source:'Kullanıcı SEO sürüm kaydı',storage:'Şifreli, silinmeyen sürüm geçmişi',updated_at:saved.updated_at,
  read_only_site:true,archived_records_immutable:true,caveat:'Aktif etiketi yalnızca takip planıdır; sitenin gerçekten yayınladığı SEO sürümü olduğunu kanıtlamaz. GSC gözlemleri bağımsızdır.',d1_requests:0};
}
export async function tayfunSave(storage:Store,secret:string,input:unknown,time=new Date()){
 fail(input&&typeof input==='object'&&!Array.isArray(input));
 const r=input as Record<string,unknown>,period=month(r.month);
 fail(owned(r.url));
 const now=time.toISOString();fail(period<=now.slice(0,7));
 const saved=await index(storage,secret,period);
 fail(saved.ids.length<2000);
 const supersedes=r.supersedes===null||r.supersedes===undefined?null:text(r.supersedes,100);
 let parent:TayfunEntry|null=null;
 if(supersedes){parent=await getEntry(storage,secret,supersedes);fail(!!parent&&parent.url===r.url&&parent.month<=period);}
 const isAi=r.source==='ai-review';
 if(r.source!==undefined)fail(r.source==='ai-review'||r.source==='user-entry');
 if(isAi){
  // AI handoffs can only create new revisions in today's real month, never backdate.
  fail(period===now.slice(0,7)&&typeof r.product_id==='string'&&r.product_id.length>0&&r.product_id.length<=100);
  fail(!!supersedes===!!parent||!supersedes);
 }
 const decisions=r.keyword_decisions??[],proposals=r.page_proposals??[];
 fail(Array.isArray(decisions)&&decisions.length<=80&&decisions.every((x:any)=>x&&typeof x.query==='string'&&x.query.length>0&&x.query.length<=120&&
  ['koru','izle','yeni_sayfa_adayi'].includes(x.action)&&typeof x.reason==='string'&&x.reason.length<=500));
 fail(Array.isArray(proposals)&&proposals.length<=20&&proposals.every((x:any)=>x&&typeof x.keyword==='string'&&x.keyword.length>0&&x.keyword.length<=120&&typeof x.reason==='string'&&x.reason.length<=500&&typeof x.url_suggestion==='string'&&x.url_suggestion.length<=2048&&(!x.url_suggestion||owned(x.url_suggestion))));

 const title=text(r.title||'',300),description=text(r.description||'',1000),h1=text(r.h1||'',500);
 const canonical=text(r.canonical||'',2048);fail(!canonical||owned(canonical));
 const keywords=r.keywords||[];fail(Array.isArray(keywords)&&keywords.length<=50&&keywords.every(k=>typeof k==='string'&&k.length<=120));
 // Preserve all previously tracked keywords in the new revision, even if an AI omits them.
 const retained=[...new Set([...(parent?.keywords||[]),...keywords.map((x:string)=>x.trim()).filter(Boolean)])];
 fail(retained.length<=120);
 const status=r.status||'aktif';fail(status==='aktif'||status==='pasif');
 const entry:TayfunEntry={id:crypto.randomUUID(),month:period,url:r.url,created_at:now,status,kind:'manuel',source:isAi?'ai-review':'user-entry',
  title,description,h1,canonical,robots:text(r.robots||'',200),
  keywords:retained,headings:text(r.headings||'',2500),
  internal_links:text(r.internal_links||'',2500),structured_data:text(r.structured_data||'',5000),
  notes:text(r.notes||'',2500),supersedes,
  hreflang:text(r.hreflang||'',2500),images:text(r.images||'',2500),open_graph:text(r.open_graph||'',2500),twitter_card:text(r.twitter_card||'',2500),
  x_robots:text(r.x_robots||'',200),viewport:text(r.viewport||'',500),lang:text(r.lang||'',100),redirect:text(r.redirect||'',2048),status_code:text(r.status_code||'',100),content_excerpt:text(r.content_excerpt||'',5000),
  keyword_decisions:decisions.map((x:any)=>({query:x.query,action:x.action,reason:x.reason})),
  page_proposals:proposals.map((x:any)=>({keyword:x.keyword,reason:x.reason,url_suggestion:x.url_suggestion})),
  product_id:isAi?String(r.product_id):null};
 // Superseded version is not deleted or overwritten: current status is derived by latest successor.
 const next:StoreIndex={version:2,ids:[...saved.ids,entry.id],updated_at:now};
 await storage.put(ROW+entry.id,await encrypt(entry,secret));
 await storage.put(INDEX+period,await encrypt(next,secret));
 return {ok:true,entry,d1_requests:0,site_mutations:0,immutable_history:true};
}
