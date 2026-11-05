// Explicit, auditable user-managed product mappings; separate from immutable crawl context.
import {encrypt,decrypt} from './security';
import {gscPageURL} from './urls';
import type {IndependentContext,ContextProduct} from './independent-context';
import type {MonthlyGscAnalysisInput} from './independent-gsc-analysis';
type Storage={get<T=unknown>(key:string):Promise<T|undefined>;put(key:string,value:unknown):Promise<unknown>};
export type CustomProduct=ContextProduct&{category:string;source:'user-confirmed';source_month:string;created_at:string};
type Saved={version:1;based_on:string;revision:string;products:CustomProduct[];updated_at:string};
const KEY='catalog:custom:v1';
const categories=['Broşürler ve El İlanları','Reklam Ürünleri','Kurumsal Ürünler','Makbuz ve Formlar','Diğer Sayfalar'];
const valid:(ok:unknown)=>asserts ok=(ok)=>{if(!ok)throw Error('CATALOG_MAPPING_INVALID');};
export async function readCustomCatalog(storage:Storage,secret:string,context:IndependentContext|null){
 const cipher=await storage.get<string>(KEY);if(!cipher)return {products:[] as CustomProduct[],revision:null as string|null};
 const saved=await decrypt<Saved>(cipher,secret);
 valid(saved.version===1&&typeof saved.revision==='string'&&Array.isArray(saved.products)&&saved.products.length<=100);
 const base=new Set(context?.products.map(p=>p.canonical_url)||[]),taken=new Set<string>();
 for(const p of saved.products){
  valid(p.source==='user-confirmed'&&p.id.startsWith('custom-')&&p.name.length>0&&p.name.length<=100&&categories.includes(p.category)
   &&gscPageURL(p.canonical_url)===p.canonical_url&&/^20\d\d-(0[1-9]|1[0-2])$/.test(p.source_month)
   &&!taken.has(p.canonical_url));
  taken.add(p.canonical_url);
 }
 return {products:saved.products.filter(p=>!base.has(p.canonical_url)),revision:saved.revision};
}
export async function addCustomProduct(storage:Storage,secret:string,context:IndependentContext|null,
 report:MonthlyGscAnalysisInput,input:unknown,time=new Date()){
 valid(context&&report.available&&report.days_verified===report.expected_days&&report.evidence?.some(e=>e.scope==='page'));
 valid(input&&typeof input==='object'&&!Array.isArray(input));
 const row=input as Record<string,unknown>;
 valid(row.base_hash===context.source_hash&&row.month===report.month&&typeof row.name==='string'&&row.name.trim().length>0&&row.name.trim().length<=100);
 valid(typeof row.category==='string'&&categories.includes(row.category));
 valid(typeof row.url==='string'&&gscPageURL(row.url)===row.url&&row.url.length<=2048
  &&report.pages?.some(p=>p.page===row.url));
 const current=await readCustomCatalog(storage,secret,context);
 valid(current.products.length<100&&!context.products.some(p=>p.canonical_url===row.url)
  &&!current.products.some(p=>p.canonical_url===row.url));
 const now=time.toISOString(),newProduct:CustomProduct={id:'custom-'+crypto.randomUUID(),name:row.name.trim(),category:row.category,
  canonical_url:row.url,url_verified_at:now,source:'user-confirmed',source_month:report.month,created_at:now};
 const saved:Saved={version:1,based_on:context.source_hash,revision:crypto.randomUUID(),products:[...current.products,newProduct],updated_at:now};
 await storage.put(KEY,await encrypt(saved,secret));
 const after=await readCustomCatalog(storage,secret,context);
 valid(after.revision===saved.revision&&after.products.some(p=>p.id===newProduct.id));
 return {ok:true,product:newProduct,revision:saved.revision,d1_requests:0};
}
