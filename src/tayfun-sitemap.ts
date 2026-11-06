// Owned-site sitemap inventory for Tayfun. No user URLs or cross-domain crawler input.
import {siteURL} from './urls';
type Store={get<T=unknown>(key:string):Promise<T|undefined>;put(key:string,value:unknown):Promise<unknown>};
const KEY='tayfun:sitemap:v1',ORIGIN='https://mavibasim.com';
type Saved={captured_at:string;urls:string[];source:string};
const decode=(s:string)=>s.replace(/&amp;/g,'&').replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&quot;/g,'"');
const locations=(xml:string)=>[...xml.matchAll(/<loc\b[^>]*>([^<]+)<\/loc>/gi)].map(m=>decode(m[1].trim()));
export async function tayfunSitemap(storage:Store,fetcher:typeof fetch=fetch,now=new Date()){
 const saved=await storage.get<Saved>(KEY);
 if(saved&&now.getTime()-Date.parse(saved.captured_at)<12*3600000)return {...saved,stale:false,d1_requests:0};
 const urls=new Set<string>(),queue=[ORIGIN+'/sitemap.xml'];const visited=new Set<string>();
 try{
  while(queue.length&&visited.size<6&&urls.size<2500){
   const next=queue.shift()!;if(visited.has(next))continue;visited.add(next);
   const response=await fetcher(next,{redirect:'manual',signal:AbortSignal.timeout(12000),headers:{Accept:'application/xml,text/xml'}});
   if(!response.ok||response.status>=300)throw Error('SITEMAP_HTTP_UNAVAILABLE');
   if(Number(response.headers.get('content-length')||0)>1500000)throw Error('SITEMAP_TOO_LARGE');
   const bytes=await response.arrayBuffer();if(bytes.byteLength>1500000)throw Error('SITEMAP_TOO_LARGE');
   const text=new TextDecoder().decode(bytes);
   const isIndex=/<sitemapindex\b/i.test(text);
   for(const raw of locations(text)){
    const owned=siteURL(raw);
    if(!owned||owned!==raw.replace(/\/+$/,'')&&owned!==raw)continue;
    if(isIndex){
     if(/^https:\/\/mavibasim\.com\/[\w/-]*sitemap[\w/-]*\.xml$/i.test(raw)&&!visited.has(raw)&&queue.length<6)queue.push(raw);
    }else if(urls.size<2500)urls.add(owned);
   }
  }
  if(!urls.size)throw Error('SITEMAP_EMPTY');
  const latest:Saved={captured_at:now.toISOString(),urls:[...urls].sort(),source:'https://mavibasim.com/sitemap.xml'};
  await storage.put(KEY,latest);
  return {...latest,stale:false,d1_requests:0};
 }catch(error){
  if(saved)return {...saved,stale:true,warning:'Güncel sitemap okunamadı; son doğrulanmış liste kullanıldı.',d1_requests:0};
  return {captured_at:null,urls:[],source:'https://mavibasim.com/sitemap.xml',stale:true,warning:'Sitemap okunamadı; katalog ve GSC kayıtları kullanılır.',d1_requests:0};
 }
}
