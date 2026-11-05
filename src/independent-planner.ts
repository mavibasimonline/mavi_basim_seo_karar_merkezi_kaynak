// Original public repository CSV observations, served only through authenticated APIs.
import {plannerDigest,plannerPacked} from './generated/planner-data';
type Storage={get<T=unknown>(key:string):Promise<T|undefined>;put(key:string,value:unknown):Promise<unknown>};
const KEY='planner:verified:'+plannerDigest;
const normalize=(v:string)=>v.normalize('NFC').trim().replace(/\s+/g,' ').toLocaleLowerCase('tr-TR');
type Dataset={products:any[];sources:any[];words:[string,string,string,string][];observations:[number,number,number,string[]][]};
let pending:Promise<Dataset>|null=null;
export async function plannerData(){
 if(!pending)pending=(async()=>{const zipped=Uint8Array.from(atob(plannerPacked),c=>c.charCodeAt(0)),stream=new Blob([zipped]).stream().pipeThrough(new DecompressionStream('gzip')),raw=await new Response(stream).arrayBuffer();
  if(raw.byteLength>8_000_000)throw Error('PLANNER_DATA_LIMIT');const hash=[...new Uint8Array(await crypto.subtle.digest('SHA-256',raw))].map(v=>v.toString(16).padStart(2,'0')).join('');if(hash!==plannerDigest)throw Error('PLANNER_DATA_HASH_INVALID');return JSON.parse(new TextDecoder().decode(raw)) as Dataset;})();
 return pending;
}
const numeric=(raw:string|undefined)=>{if(raw===undefined||['','—','--','N/A'].includes(raw.trim()))return null;const n=Number(raw.trim().replace(/[\s.]/g,'').replace(',','.'));return Number.isFinite(n)&&n>=0?n:null;};
export function plannerObservation(data:Dataset,index:number){const [source,row_number,word,cells]=data.observations[index],s=data.sources[source],w=data.words[word],get=(column:string)=>cells[s.header.indexOf(column)];return {source_id:s.id,row_number,keyword_id:w[0],product_id:w[1],keyword:w[2],variant_family:w[3],currency:get('Currency')||null,avg_monthly_searches:numeric(get('Avg. monthly searches')),advertiser_competition:get('Competition')||null,advertiser_competition_index:numeric(get('Competition (indexed value)')),monthly:s.header.flatMap((h:string,i:number)=>h.startsWith('Searches: ')?[{month:h.slice(10),value:numeric(cells[i]),raw:cells[i]}]:[]),raw_cells:cells,file:s.path,source_sha256:s.sha256,exported_at:s.exported_at,export_timezone:null,period_label:s.period_label,location:null,language:null,network:null};}
export async function plannerLookup(query='',product=''){
 const data=await plannerData(),latest=new Map<number,number>();
 for(let i=0;i<data.observations.length;i++){const [si,r,wi]=data.observations[i],word=data.words[wi];if(product&&word[1]!==product||query&&normalize(word[2])!==normalize(query))continue;const old=latest.get(wi);if(old===undefined){latest.set(wi,i);continue;}const [oi,or]=data.observations[old],s=data.sources[si],o=data.sources[oi];if([s.exported_at,s.id,String(r).padStart(8,'0')].join('|')>[o.exported_at,o.id,String(or).padStart(8,'0')].join('|'))latest.set(wi,i);}
 const rows=[...latest.values()].map(i=>plannerObservation(data,i)).sort((a,b)=>(b.avg_monthly_searches??-1)-(a.avg_monthly_searches??-1)).slice(0,query?50:8);
 return {source:'Google Ads Keyword Planner CSV arşivi',dataset_sha256:plannerDigest,query,product_id:product||null,records:rows,total_matches:latest.size,live_google_ads:false,
  limitations:['Arama hacmi pazar tahminidir; GSC tıklaması veya canlı Google Ads sonucu değildir.','Reklamveren rekabeti organik SEO zorluğu değildir.','Yalnız yazımı korunan eşleşmeler kullanılır; farklı varyant veya dışa aktarımların hacimleri toplanmaz.','Aynı kelimenin farklı ürün kayıtları ayrıdır. Lokasyon, dil, ağ ve kaynak saat dilimi belirtilmemişse bilinmiyor.']};
}
type Progress={sources_after:number;rows_after:number;sources_done:boolean;rows_done:boolean;source_bits:string;row_bits:string;conflicts:string;source_conflicts:string;verified_at:string|null;held?:unknown};
const empty=(bytes:number)=>btoa(String.fromCharCode(...new Uint8Array(bytes)));
const bits=(s:string)=>Uint8Array.from(atob(s),c=>c.charCodeAt(0));
const has=(v:Uint8Array,i:number)=>!!(v[i>>3]&(1<<(i%8)));
const set=(v:Uint8Array,i:number)=>{v[i>>3]|=1<<(i%8);};
const count=(v:Uint8Array)=>v.reduce((n,b)=>n+b.toString(2).replaceAll('0','').length,0);
async function progress(storage:Storage){const d=await plannerData();return await storage.get<Progress>(KEY)||{sources_after:0,rows_after:0,sources_done:false,rows_done:false,source_bits:empty(Math.ceil(d.sources.length/8)),row_bits:empty(Math.ceil(d.observations.length/8)),conflicts:empty(Math.ceil(d.observations.length/8)),source_conflicts:empty(Math.ceil(d.sources.length/8)),verified_at:null};}
export async function plannerStatus(storage:Storage){const d=await plannerData(),p=await progress(storage),files=count(bits(p.source_bits)),rows=count(bits(p.row_bits));return {source:'Google Ads Keyword Planner CSV arşivi',dataset_sha256:plannerDigest,files:d.sources.length,rows:d.observations.length,product_keywords:d.words.length,products:d.products.length,d1_verified_files:files,d1_verified_rows:rows,d1_import_complete:files===d.sources.length&&rows===d.observations.length,source_scan_complete:p.sources_done&&p.rows_done,conflicts:count(bits(p.conflicts))+count(bits(p.source_conflicts)),verified_at:p.verified_at,held:p.held||null,live_google_ads:false,d1_requests:0};}
export async function plannerSyncPlan(storage:Storage){const d=await plannerData(),p=await progress(storage),status=await plannerStatus(storage);if(status.d1_import_complete)return {mode:'idle',status};if(!p.sources_done||!p.rows_done)return {mode:'verify',sources_after:p.sources_after,rows_after:p.rows_after,dataset_sha256:plannerDigest};
 const sb=bits(p.source_bits),rb=bits(p.row_bits),bad=bits(p.conflicts),badSource=bits(p.source_conflicts);
 const source=d.sources.findIndex((_,i)=>!has(sb,i)&&!has(badSource,i));
 const first=source>=0?d.observations.findIndex((r)=>r[0]===source):d.observations.findIndex((r,i)=>!has(rb,i)&&!has(bad,i)&&!has(badSource,r[0]));
 const si=source>=0?source:first>=0?d.observations[first][0]:-1;if(si<0)return {mode:'held',code:'PLANNER_EXISTING_RECORD_CONFLICT',status};
 const sourceRecord=d.sources[si],indices=d.observations.flatMap((r,i)=>r[0]===si&&!has(rb,i)&&!has(bad,i)?[i]:[]).slice(0,8),product=d.products.find(p=>p.id===sourceRecord.product_id);
 return {mode:'repair',dataset_sha256:plannerDigest,source:sourceRecord,product,observations:indices.map(i=>plannerObservation(d,i))};
}
export async function verifyPlannerPage(storage:Storage,value:any){const d=await plannerData(),p=await progress(storage);if(value.dataset_sha256!==plannerDigest||!Array.isArray(value.sources)||value.sources.length>20||!Array.isArray(value.rows)||value.rows.length>200)throw Error('PLANNER_VERIFICATION_INVALID');
 const sb=bits(p.source_bits),rb=bits(p.row_bits),bad=bits(p.conflicts),bs=bits(p.source_conflicts),sources=new Map<string,number>(d.sources.map((s,i)=>[s.id,i] as [string,number])),rows=new Map<string,number>(d.observations.map((r,i)=>[d.sources[r[0]].id+':'+r[1],i] as [string,number]));
 for(const row of value.sources){const i=sources.get(row.id);if(i===undefined)continue;const e=d.sources[i];if(row.sha256===e.sha256&&row.path===e.path&&row.product_id===e.product_id&&row.row_count===e.row_count)set(sb,i);else set(bs,i);}
 for(const row of value.rows){const i=rows.get(row.source_id+':'+row.row_number);if(i===undefined)continue;const e=d.observations[i],w=d.words[e[2]];let cells;try{cells=JSON.parse(row.raw_cells_json);}catch{cells=null;}if(row.keyword_id===w[0]&&row.product_id===w[1]&&row.keyword===w[2]&&JSON.stringify(cells)===JSON.stringify(e[3]))set(rb,i);else set(bad,i);}
 if(!value.repair){p.sources_after=value.sources.at(-1)?.source_rowid||p.sources_after;p.rows_after=value.rows.at(-1)?.source_rowid||p.rows_after;p.sources_done=value.sources.length<20;p.rows_done=value.rows.length<200;}
 p.source_bits=btoa(String.fromCharCode(...sb));p.row_bits=btoa(String.fromCharCode(...rb));p.conflicts=btoa(String.fromCharCode(...bad));p.source_conflicts=btoa(String.fromCharCode(...bs));p.verified_at=new Date().toISOString();p.held=null;await storage.put(KEY,p);return plannerStatus(storage);
}
export async function holdPlanner(storage:Storage,value:any){const p=await progress(storage);p.held={at:new Date().toISOString(),code:typeof value.code==='string'&&/^[A-Z_]+$/.test(value.code)?value.code:'PLANNER_SOURCE_UNAVAILABLE',reason:typeof value.reason==='string'&&/^[A-Z_]+$/.test(value.reason)?value.reason:null};await storage.put(KEY,p);return {ok:true};}
