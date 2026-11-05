// Read-only product/crawl evidence cache. No D1, Google calls or URL inference.
import {stable} from './drive-records';
import {gscPageURL,variantFamily} from './urls';

type Storage={get<T=unknown>(key:string):Promise<T|undefined>;put(key:string,value:unknown):Promise<unknown>};
export type ContextProduct={id:string;name:string;canonical_url:string;url_verified_at:string;urls?:string[]};
export type ContextCrawl={id:string;url:string;observed_at:string;content_hash:string;title:string;h1:string[];body_hash:string|null;status:number};
export type ContextChange={id:string;url:string;previous_snapshot_id:string;next_snapshot_id:string;observed_from:string;observed_to:string;
 published_at:string|null;publication_evidence:{verified:true;source:'cms_log'|'deploy_log';ref:string}|null;changed_fields:string[];before:ContextCrawl;after:ContextCrawl};
type Payload={format:'independent-evidence-context-v1';source:'D1 product mappings and crawl metadata';captured_at:string;
 products:ContextProduct[];snapshots:ContextCrawl[];changes:ContextChange[];
 coverage:{products_truncated:boolean;changes_truncated:boolean;unverified_products:number;quarantined_records:number;change_selection:'latest 100 inserted events; not complete publication history'};
 d1_source_mutations:0;limitations:string[]};
export type IndependentContext=Payload&{source_hash:string};
export type ContextInput={captured_at:string;products:unknown[];snapshots:unknown[];changes:unknown[]};
const PREFIX='independent:context:',POINTER=PREFIX+'active',CHUNK=36000,MAX_BYTES=1_500_000;
const fieldNames=new Set(['status','redirect','canonical','robots','x_robots','title','description','headings','links','hreflang','images','structured_data','viewport','lang','body_hash','excerpt','rendering']);
const sha=async(raw:string)=>[...new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(raw)))].map(b=>b.toString(16).padStart(2,'0')).join('');
function requireValue(ok:unknown):asserts ok{if(!ok)throw Error('INDEPENDENT_CONTEXT_INVALID');}
function text(value:unknown,max=512):string{requireValue(typeof value==='string'&&value.length<=max&&!/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(value));return value;}
function id(value:unknown){const result=text(value,100);requireValue(result.length>0);return result;}
function stamp(value:unknown,captured:string){const result=text(value,40);requireValue(Number.isFinite(Date.parse(result))&&Date.parse(result)<=Date.parse(captured)+300000);return new Date(result).toISOString();}
function url(value:unknown){const result=text(value,2048);requireValue(!!gscPageURL(result));return result;}
function digest(value:unknown){const result=text(value,64);requireValue(/^[a-f0-9]{64}$/.test(result));return result;}
function object(value:unknown):Record<string,unknown>{requireValue(value&&typeof value==='object'&&!Array.isArray(value));return value as Record<string,unknown>;}
function parsed(value:unknown,max:number){return typeof value==='string'?(requireValue(value.length<=max),JSON.parse(value)):value;}
function crawl(value:unknown,captured:string):ContextCrawl{
 const row=object(value),headings=parsed(row.headings_json??row.h1??[],8192);requireValue(Array.isArray(headings));
 const h1=headings.flatMap(h=>typeof h==='string'?[text(h)]:object(h).level===1?[text(object(h).text)]:[]);
 requireValue(h1.length<=10&&Number.isInteger(row.status)&&Number(row.status)>=100&&Number(row.status)<=599);
 return {id:id(row.id),url:url(row.url),observed_at:stamp(row.observed_at,captured),content_hash:digest(row.content_hash),
  title:text(row.title??''),h1,body_hash:row.body_hash?digest(row.body_hash):null,status:Number(row.status)};
}
function change(value:unknown,captured:string):ContextChange{
 const row=object(value),before=crawl(parsed(row.before_json??row.before,20000),captured),after=crawl(parsed(row.after_json??row.after,20000),captured);
 const from=stamp(row.observed_from,captured),to=stamp(row.observed_to,captured),page=url(row.url);
 requireValue(before.id===row.previous_snapshot_id&&after.id===row.next_snapshot_id&&before.url===page&&after.url===page
  &&before.observed_at===from&&after.observed_at===to&&from<=to);
 const fields=parsed(row.changed_fields_json??row.changed_fields,2048);requireValue(Array.isArray(fields)&&fields.length>0&&fields.length<=32&&fields.every(f=>typeof f==='string'&&fieldNames.has(f)));
 let published_at:string|null=null,publication_evidence:ContextChange['publication_evidence']=null;
 // A bare date or an arbitrary user note never becomes a proven publication time.
 try{
  const proof=object(parsed(row.publication_evidence,2048));
  if(row.published_at&&proof.verified===true&&(proof.source==='cms_log'||proof.source==='deploy_log')){
   const ref=text(proof.ref,1024);requireValue(ref.length>0);
   published_at=stamp(row.published_at,captured);publication_evidence={verified:true,source:proof.source,ref};
  }
 }catch{/* Keep the independently observed crawl interval. */}
 return {id:id(row.id),url:page,previous_snapshot_id:before.id,next_snapshot_id:after.id,observed_from:from,observed_to:to,
  published_at,publication_evidence,changed_fields:[...new Set(fields as string[])],before,after};
}
export async function buildIndependentContext(input:ContextInput,time=new Date()):Promise<IndependentContext>{
 requireValue(input&&Array.isArray(input.products)&&input.products.length<=101&&Array.isArray(input.snapshots)&&input.snapshots.length<=200
  &&Array.isArray(input.changes)&&input.changes.length<=101);
 const captured_at=stamp(input.captured_at,time.toISOString()),products:ContextProduct[]=[],snapshots:ContextCrawl[]=[],changes:ContextChange[]=[];
 let unverified=0,quarantined=0;
 const identities=new Set<string>(),urls=new Set<string>();
 for(const value of input.products.slice(0,100)){
  const row=object(value),productId=id(row.id),name=text(row.name);requireValue(name.length>0&&!identities.has(productId));identities.add(productId);
  if(!row.canonical_url||!row.url_verified_at){unverified++;continue;}
  const canonical_url=url(row.canonical_url),url_verified_at=stamp(row.url_verified_at,captured_at);requireValue(!urls.has(canonical_url));urls.add(canonical_url);
  products.push({id:productId,name,canonical_url,url_verified_at});
 }
 for(const value of input.snapshots)try{const item=crawl(value,captured_at);requireValue(urls.has(item.url));snapshots.push(item);}catch{quarantined++;}
 for(const value of input.changes.slice(0,100))try{const item=change(value,captured_at);if(urls.has(item.url))changes.push(item);}catch{quarantined++;}
 const payload:Payload={format:'independent-evidence-context-v1',source:'D1 product mappings and crawl metadata',captured_at,
  products,snapshots,changes,coverage:{products_truncated:input.products.length>100,changes_truncated:input.changes.length>100,unverified_products:unverified,quarantined_records:quarantined,
   change_selection:'latest 100 inserted events; not complete publication history'},d1_source_mutations:0,
  limitations:['Ürün eşlemesi yalnızca kayıtlı canonical URL ve tarama doğrulama tarihine dayanır; URL tahmin edilmez.',
   'Başlık/H1 ve hash kayıtları statik HTML taramasıdır; tam CMS sürüm geçmişi değildir.',
   'CMS/deploy yayın kanıtı yoksa değişiklik yalnızca iki tarama arasındaki aralıktadır.',
   'Sınırlı değişiklik listesinde kayıt bulunmaması değişiklik yapılmadığını kanıtlamaz. Korelasyon nedensellik değildir.']};
 requireValue(new TextEncoder().encode(stable(payload)).length<=MAX_BYTES);
 return {...payload,source_hash:await sha(stable(payload))};
}
/** Validate a built private-service payload without changing its provenance counters or hash. */
export async function validateIndependentContext(value:unknown,time=new Date()):Promise<IndependentContext>{
 const row=object(value),source_hash=digest(row.source_hash),{source_hash:ignored,...payload}=row;
 const raw=stable(payload);requireValue(new TextEncoder().encode(raw).length<=MAX_BYTES&&await sha(raw)===source_hash);
 requireValue(row.format==='independent-evidence-context-v1'&&row.source==='D1 product mappings and crawl metadata'&&row.d1_source_mutations===0);
 const captured_at=stamp(row.captured_at,time.toISOString());
 requireValue(Array.isArray(row.products)&&row.products.length<=100&&Array.isArray(row.snapshots)&&row.snapshots.length<=200&&Array.isArray(row.changes)&&row.changes.length<=100);
 const ids=new Set<string>(),urls=new Set<string>();
 for(const item of row.products){const p=object(item);id(p.id);text(p.name);const page=url(p.canonical_url);stamp(p.url_verified_at,captured_at);
  requireValue(!ids.has(String(p.id))&&!urls.has(page));ids.add(String(p.id));urls.add(page);}
 for(const item of row.snapshots){const normalized=crawl(item,captured_at);requireValue(urls.has(normalized.url)&&stable(normalized)===stable(item));}
 for(const item of row.changes){const normalized=change(item,captured_at);requireValue(urls.has(normalized.url)&&stable(normalized)===stable(item));}
 const coverage=object(row.coverage);requireValue(typeof coverage.products_truncated==='boolean'&&typeof coverage.changes_truncated==='boolean'
  &&Number.isSafeInteger(coverage.unverified_products)&&Number(coverage.unverified_products)>=0&&Number(coverage.unverified_products)<=100
  &&Number.isSafeInteger(coverage.quarantined_records)&&Number(coverage.quarantined_records)>=0&&Number(coverage.quarantined_records)<=300
  &&coverage.change_selection==='latest 100 inserted events; not complete publication history');
 requireValue(Array.isArray(row.limitations)&&row.limitations.length<=10&&row.limitations.every(v=>typeof v==='string'&&v.length<=512));
 return value as IndependentContext;
}
type Manifest={source_hash:string;captured_at:string;bytes:number;chunks:number};
async function restore(storage:Storage,manifest:Manifest):Promise<IndependentContext>{
 requireValue(/^[a-f0-9]{64}$/.test(manifest.source_hash)&&Number.isSafeInteger(manifest.bytes)&&manifest.bytes>0&&manifest.bytes<=MAX_BYTES&&manifest.chunks===Math.ceil(manifest.bytes/CHUNK));
 const bytes=new Uint8Array(manifest.bytes);let offset=0;
 for(let i=0;i<manifest.chunks;i++){
  const chunk=await storage.get<string>(PREFIX+'part:'+manifest.source_hash+':'+i);requireValue(typeof chunk==='string');
  const part=Uint8Array.from(atob(chunk),c=>c.charCodeAt(0));requireValue(part.length===Math.min(CHUNK,manifest.bytes-offset));bytes.set(part,offset);offset+=part.length;
 }
 const raw=new TextDecoder('utf-8',{fatal:true,ignoreBOM:false}).decode(bytes);requireValue(await sha(raw)===manifest.source_hash);
 const result=JSON.parse(raw) as Payload;requireValue(result.format==='independent-evidence-context-v1'&&result.captured_at===manifest.captured_at&&result.d1_source_mutations===0
  &&Array.isArray(result.products)&&Array.isArray(result.snapshots)&&Array.isArray(result.changes));
 return {...result,source_hash:manifest.source_hash};
}
export async function saveIndependentContext(storage:Storage,context:IndependentContext){
 const {source_hash,...payload}=context,raw=stable(payload),bytes=new TextEncoder().encode(raw);
 requireValue(bytes.length>0&&bytes.length<=MAX_BYTES&&await sha(raw)===source_hash);
 const manifest:Manifest={source_hash,captured_at:context.captured_at,bytes:bytes.length,chunks:Math.ceil(bytes.length/CHUNK)};
 for(let i=0;i<manifest.chunks;i++)await storage.put(PREFIX+'part:'+source_hash+':'+i,btoa(String.fromCharCode(...bytes.subarray(i*CHUNK,(i+1)*CHUNK))));
 const restored=await restore(storage,manifest);requireValue(stable(restored)===stable(context));
 await storage.put(PREFIX+'history:'+source_hash,manifest);await storage.put(POINTER,manifest);
 return {ok:true,available:true,source_hash,captured_at:context.captured_at,d1_requests:0};
}
export async function readIndependentContext(storage:Storage){const manifest=await storage.get<Manifest>(POINTER);return manifest?restore(storage,manifest):null;}
export async function independentContextStatus(storage:Storage){
 const manifest=await storage.get<Manifest>(POINTER);
 return {available:!!manifest,captured_at:manifest?.captured_at||null,source_hash:manifest?.source_hash||null,d1_requests:0};
}

export function answerContextQuestion(context:IndependentContext|null,question:string,month:string){
 requireValue(typeof question==='string'&&question.trim().length>0&&question.length<=1000&&/^20\d{2}-(0[1-9]|1[0-2])$/.test(month));
 const q=variantFamily(question),requestedUrls:string[]=Array.from(question.match(/https?:\/\/[^\s<>"')]+/g)||[]);
 const word=(value:string)=>new RegExp('(?:^|[^a-z0-9])'+variantFamily(value).replace(/[.*+?^${}()|[\]\\]/g,'\\$&')+'(?:[^a-z0-9]|$)').test(q);
 const product=context?.products.find(p=>requestedUrls.length?requestedUrls.includes(p.canonical_url):word(p.name)||word(p.id.replaceAll('-',' ')));
 const wholeSite=!requestedUrls.length&&/site|genel|tum|hangi.*degis|degisiklik gecmis|neler.*degis/.test(q);
 const start=month+'-01T00:00:00.000Z',end=new Date(Date.UTC(Number(month.slice(0,4)),Number(month.slice(5,7)),1)).toISOString();
 const selected=context&&(product||wholeSite)?context.changes.filter(c=>(!product||c.url===product.canonical_url)&&c.observed_to>=start&&c.observed_from<end)
  .sort((a,b)=>b.observed_to.localeCompare(a.observed_to)).slice(0,5):[];
 const evidence_refs=selected.map(event=>({source_hash:context!.source_hash,event_id:event.id,url:event.url,
  before:{id:event.before.id,observed_at:event.before.observed_at,content_hash:event.before.content_hash,body_hash:event.before.body_hash,title:event.before.title,h1:event.before.h1,status:event.before.status},
  after:{id:event.after.id,observed_at:event.after.observed_at,content_hash:event.after.content_hash,body_hash:event.after.body_hash,title:event.after.title,h1:event.after.h1,status:event.after.status},
  changed_fields:event.changed_fields,observed_interval:{from:event.observed_from,to:event.observed_to},published_at:event.publication_evidence?event.published_at:null,
  publication_evidence:event.publication_evidence}));
 const answer=!context?'Doğrulanmış ürün eşlemesi ve değişiklik arşivi henüz kullanılamıyor. Yayın zamanı veya SEO etkisi tahmin edilmedi.'
  :!product&&!wholeSite?'Kayıtlı ürün adı veya doğrulanmış tam URL ile değişiklik geçmişi seçilemedi. Hangi sayfanın değiştiği tahmin edilmedi.'
  :!selected.length?'Seçili ürün/URL ve ay için bu sınırlı arşivde doğrulanmış değişiklik kaydı bulunamadı. Bu sonuç değişiklik yapılmadığını kanıtlamaz.'
  :selected.length+' doğrulanmış değişiklik kaydı gösteriliyor. CMS/deploy kanıtı bulunmayan kayıtlarda kesin yayın zamanı yerine önceki ve sonraki tarama aralığı kullanılır. Başlık, H1 ve hash farkları gözlemdir; GSC düşüşünün nedenini veya SEO etkisini tek başına kanıtlamaz.';
 return {answer,decision:'Veri bekle',source:'Doğrulanmış SEO tarama/değişiklik arşivi',month,product_id:product?.id||null,url:product?.canonical_url||null,
  source_hash:context?.source_hash||null,captured_at:context?.captured_at||null,evidence:evidence_refs.map(e=>context!.source_hash+':'+e.event_id),evidence_refs,
  available:evidence_refs.length>0,d1_requests:0,coverage:context?.coverage||null,
  sections:{evidence:evidence_refs,interpretation:answer,decision:'GSC ölçümleri ve değişiklik öncesi/sonrası karşılaştırma doğrulanana kadar SEO müdahalesi önerilmez.'},
  limitations:['Liste en fazla beş değişiklik içerir; değişiklik bulunmaması değişiklik yapılmadığını kanıtlamaz.','Korelasyon nedensellik değildir. Bu yanıt GSC performans etkisi hesaplamaz.']};
}
