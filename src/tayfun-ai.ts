// Product-scoped AI handoff imports: validated against the verified catalog, append-only and never deployed to the site.
import {readIndependentContext} from './independent-context';
import {resolvedCatalog} from './independent-catalog';
import {tayfunList,tayfunSave,type TayfunEntry} from './tayfun-ledger';
import {gscPageURL} from './urls';
type Store={get<T=unknown>(key:string):Promise<T|undefined>;put(key:string,value:unknown):Promise<unknown>};
const reject:(ok:unknown)=>asserts ok=(ok)=>{if(!ok)throw Error('TAYFUN_AI_INVALID');};
const dateMonth=(time:Date)=>time.toISOString().slice(0,7);
const monthRange=(from:string,to:string)=>{
 const a=new Date(from+'-01T00:00:00Z'),b=new Date(to+'-01T00:00:00Z'),result:string[]=[];
 for(let i=0;a<=b&&i<48;i++,a.setUTCMonth(a.getUTCMonth()+1))result.push(a.toISOString().slice(0,7));
 return result;
};
export async function tayfunAiContext(storage:Store,secret:string,productId:string,time=new Date()){
 reject(typeof productId==='string'&&productId.length>0&&productId.length<=100);
 const context=await readIndependentContext(storage),catalog=await resolvedCatalog(storage,secret,context);
 const product=catalog.products.find(p=>p.id===productId);reject(!!product);
 const allowed=new Set(product.urls||[product.canonical_url]);
 const months=monthRange('2026-01',dateMonth(time)),versions:TayfunEntry[]=[];
 for(const m of months){
  const ledger=await tayfunList(storage,secret,m);
  for(const v of ledger.entries)if(allowed.has(v.url))versions.push(v);
 }
 versions.sort((a,b)=>a.created_at.localeCompare(b.created_at));
 const latest=versions.filter(v=>v.url===product.canonical_url).at(-1)||null,tracked=[...new Set(versions.flatMap(v=>v.keywords))];
 return {product:{id:product.id,name:product.name,category:(product as any).category||null,canonical_url:product.canonical_url,
  urls:[...allowed]},versions,latest_revision_id:latest?.id||null,tracked_keywords:tracked,save_month:dateMonth(time),
  oldest_recorded_at:versions[0]?.created_at||null,
  source:'Immutable Tayfun SEO revision archive',read_only_site:true,d1_requests:0,
  caveat:'İlk kayıt geçmişteki gerçek SEO başlangıcını kanıtlamaz; kayıt tarihi asla değiştirilmez.'};
}
export async function tayfunAiSave(storage:Store,secret:string,input:unknown,time=new Date()){
 reject(input&&typeof input==='object'&&!Array.isArray(input));
 const x=input as Record<string,unknown>;
 reject(x.format==='MAVI_BASIM_TAYFUN_AI_PRODUCT_V1'&&typeof x.product_id==='string'&&typeof x.url==='string');
 const ctx=await tayfunAiContext(storage,secret,x.product_id as string,time);
 const product=ctx.product,nowMonth=dateMonth(time);
 reject(x.url===product.canonical_url&&gscPageURL(x.url)===x.url&&x.month===nowMonth);
 // The client must have read this product's latest revision; a concurrent edit cannot be overwritten.
 reject((x.expected_latest_id??null)===ctx.latest_revision_id);
 const seo=x.seo;
 reject(seo&&typeof seo==='object'&&!Array.isArray(seo));
 const fields=seo as Record<string,unknown>;
 const tracked=x.keywords??[];
 reject(Array.isArray(tracked)&&tracked.length<=500&&tracked.every(v=>typeof v==='string'&&v.length<=120));
 const decisions=x.keyword_decisions??[];
 reject(Array.isArray(decisions)&&decisions.length<=160);
 const proposal=x.page_proposals??[];
 reject(Array.isArray(proposal)&&proposal.length<=20);
 const union=[...new Set([...ctx.tracked_keywords,...tracked])];
 reject(union.length<=500);
 // Full old SEO text is never deleted, even when the new AI proposal omits it:
 // the previous immutable revision remains available for before/after comparison.
 const allowedFields=['title','description','h1','canonical','robots','headings','internal_links','structured_data','notes',
  'hreflang','images','open_graph','twitter_card','x_robots','viewport','lang','redirect','status_code','content_excerpt'];
 reject(Object.keys(fields).every(k=>allowedFields.includes(k)));
 const cleaned=Object.fromEntries(allowedFields.map(k=>[k,fields[k]??'']));
 reject(Object.values(cleaned).every(v=>typeof v==='string'));
 const entry=await tayfunSave(storage,secret,{
  ...cleaned,url:product.canonical_url,month:nowMonth,product_id:product.id,source:'ai-review',status:'aktif',
  supersedes:ctx.latest_revision_id,keywords:union,keyword_decisions:decisions,page_proposals:proposal
 },time);
 return {...entry,product_id:product.id,previous_revision_id:ctx.latest_revision_id,
  original_records_unchanged:true,site_mutations:0,publication_verified:false,
  response:'Yapay zekâ taslağı yeni tarihli SEO takip sürümü olarak kaydedildi. Siteye uygulanmadı.'};
}
