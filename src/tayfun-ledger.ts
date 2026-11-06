// Tayfun: encrypted append-only monthly SEO decisions. Never writes to the live site or source crawl records.
import {encrypt,decrypt} from './security';
import {gscPageURL} from './urls';

type Store={get<T=unknown>(key:string):Promise<T|undefined>;put(key:string,value:unknown):Promise<unknown>};
export type TayfunEntry={
 id:string;month:string;url:string;created_at:string;status:'aktif'|'pasif';kind:'manuel';source:'user-entry';
 title:string;description:string;h1:string;canonical:string;robots:string;keywords:string[];
 headings:string;internal_links:string;structured_data:string;notes:string; supersedes:string|null;
};
type History={version:1;entries:TayfunEntry[];updated_at:string};
const KEY='tayfun:ledger:v1';
const fail=(ok:unknown):asserts ok=>{if(!ok)throw Error('TAYFUN_INPUT_INVALID');};
const owned=(url:unknown):url is string=>typeof url==='string'&&url.length<=2048&&gscPageURL(url)===url;
const text=(v:unknown,max:number)=>{fail(typeof v==='string'&&v.length<=max&&!/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(v));return v as string;};
const month=(v:unknown)=>{fail(typeof v==='string'&&/^20\d\d-(0[1-9]|1[0-2])$/.test(v));return v as string;};
async function load(storage:Store,secret:string):Promise<History>{
 const sealed=await storage.get<string>(KEY);
 if(!sealed)return {version:1,entries:[],updated_at:''};
 const value=await decrypt<History>(sealed,secret);
 fail(value.version===1&&Array.isArray(value.entries)&&value.entries.length<=5000);
 return value;
}
export async function tayfunList(storage:Store,secret:string,period:string){
 month(period);const saved=await load(storage,secret);
 const entries=saved.entries.filter(e=>e.month===period);
 return {month:period,entries,source:'Kullanıcı SEO sürüm kaydı',storage:'Şifreli, silinmeyen sürüm geçmişi',updated_at:saved.updated_at,
  read_only_site:true,archived_records_immutable:true,caveat:'Aktif etiketi yalnızca takip planıdır; sitenin gerçekten yayınladığı SEO sürümü olduğunu kanıtlamaz. GSC gözlemleri bağımsızdır.',d1_requests:0};
}
export async function tayfunSave(storage:Store,secret:string,input:unknown,time=new Date()){
 fail(input&&typeof input==='object'&&!Array.isArray(input));
 const r=input as Record<string,unknown>,period=month(r.month);
 fail(owned(r.url));
 const now=time.toISOString();fail(period<=now.slice(0,7));
 const saved=await load(storage,secret);
 fail(saved.entries.length<5000);
 const supersedes=r.supersedes===null||r.supersedes===undefined?null:text(r.supersedes,100);
 if(supersedes)fail(saved.entries.some(e=>e.id===supersedes&&e.url===r.url&&e.month<=period));
 const title=text(r.title||'',300),description=text(r.description||'',1000),h1=text(r.h1||'',500);
 const canonical=text(r.canonical||'',2048);fail(!canonical||owned(canonical));
 const keywords=r.keywords||[];fail(Array.isArray(keywords)&&keywords.length<=50&&keywords.every(k=>typeof k==='string'&&k.length<=120));
 const status=r.status||'aktif';fail(status==='aktif'||status==='pasif');
 const entry:TayfunEntry={id:crypto.randomUUID(),month:period,url:r.url,created_at:now,status,kind:'manuel',source:'user-entry',
  title,description,h1,canonical,robots:text(r.robots||'',200),
  keywords:keywords.map((v:string)=>v.trim()).filter(Boolean),headings:text(r.headings||'',2500),
  internal_links:text(r.internal_links||'',2500),structured_data:text(r.structured_data||'',5000),
  notes:text(r.notes||'',2500),supersedes};
 // Superseded version is not deleted or overwritten: current status is derived by latest successor.
 const next:History={version:1,entries:[...saved.entries,entry],updated_at:now};
 await storage.put(KEY,await encrypt(next,secret));
 return {ok:true,entry,d1_requests:0,site_mutations:0,immutable_history:true};
}
