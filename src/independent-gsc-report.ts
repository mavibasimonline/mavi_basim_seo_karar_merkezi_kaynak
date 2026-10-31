// Source-hash verified monthly GSC readback; never infer unavailable dates or queries.
import {decrypt} from './security';
import {gscRowIssue,GscRow} from './providers';
import {DailyProof,GscStorage} from './independent-gsc';
const PAGE_LIMIT=4000,MAX_ROWS=250000;
const sha=async(raw:string)=>[...new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(raw)))].map(n=>n.toString(16).padStart(2,'0')).join('');
function fail(ok:unknown,code:string):asserts ok{if(!ok)throw Error(code);}
const dayKey=(day:string,scope:string)=>'gsc:daily:'+day+':'+scope;
async function readProof(storage:GscStorage,secret:string,proof:DailyProof){
 fail(proof.source==='GSC Search Analytics API'&&proof.d1_requests===0,'GSC_MONTH_SOURCE_INVALID');
 fail(proof.pages===proof.page_proofs.length&&proof.pages>=1&&proof.pages<=250,'GSC_MONTH_MANIFEST_INVALID');
 const result:GscRow[]=[];
 for(const part of proof.page_proofs){
  fail(part.index===result.length/200||part.index>=0,'GSC_MONTH_PAGE_INDEX_INVALID');
  fail(part.chunks>0&&part.chunks<=20&&part.count>=0&&part.count<=200,'GSC_MONTH_CHUNK_INVALID');
  const arrays:Uint8Array[]=[];let size=0;
  for(let i=0;i<part.chunks;i++){
   const sealed=await storage.get<string>('gsc:part:'+proof.day+':'+proof.scope+':'+proof.generation+':'+part.index+':'+i);
   fail(typeof sealed==='string','GSC_MONTH_CHUNK_MISSING');
   const record=await decrypt<{chunk:string}>(sealed!,secret);
   fail(typeof record.chunk==='string','GSC_MONTH_CHUNK_INVALID');
   const data=Uint8Array.from(atob(record.chunk),c=>c.charCodeAt(0));
   size+=data.length;fail(size<=460000,'GSC_MONTH_BYTES_LIMIT');arrays.push(data);
  }
  const complete=new Uint8Array(size);let n=0;for(const a of arrays){complete.set(a,n);n+=a.length;}
  const raw=new TextDecoder().decode(complete);
  fail(size===part.bytes&&await sha(raw)===part.sha256,'GSC_MONTH_HASH_MISMATCH');
  const rows=JSON.parse(raw) as GscRow[];
  fail(Array.isArray(rows)&&rows.length===part.count,'GSC_MONTH_COUNT_MISMATCH');
  for(const row of rows)fail(!gscRowIssue(row,proof.day),'GSC_MONTH_ROW_INVALID');
  result.push(...rows);
  fail(result.length<=MAX_ROWS,'GSC_MONTH_ROW_LIMIT');
 }
 fail(result.length===proof.rows,'GSC_MONTH_ROW_COUNT_INVALID');
 return result;
}
export async function verifiedGscMonth(storage:GscStorage,secret:string,month:string,time=new Date()){
 fail(/^20\d\d-(0[1-9]|1[0-2])$/.test(month),'INVALID_MONTH');
 const end=new Date(Date.UTC(Number(month.slice(0,4)),Number(month.slice(5,7)),0));
 fail(end.getTime()<time.getTime()-3*86400000&&end.getTime()>time.getTime()-401*86400000,'GSC_MONTH_NOT_CLOSED');
 const dates=Array.from({length:end.getUTCDate()},(_,i)=>month+'-'+String(i+1).padStart(2,'0'));
 const proofs:DailyProof[]=[],missing:string[]=[];let queryDays=0,totalPages=0;
 for(const day of dates){
  const p=await storage.get<DailyProof>(dayKey(day,'page'));
  if(!p||p.day!==day||p.scope!=='page'||p.query_partial){missing.push(day);continue;}
  totalPages+=p.pages;fail(totalPages<=PAGE_LIMIT,'GSC_MONTH_PAGE_LIMIT');proofs.push(p);
  const q=await storage.get<DailyProof>(dayKey(day,'query'));
  if(q&&q.day===day&&q.scope==='query')queryDays++;
 }
 if(missing.length)return {available:false as const,month,days_verified:proofs.length,expected_days:dates.length,
   missing_days:missing,query_days_verified:queryDays,source:'GSC Search Analytics API',d1_requests:0,
   message:'Eksik günlük GSC kaynakları sıfır değildir; aylık sonuç kanıtlanmadı.'};
 const group=new Map<string,{page:string;device:string;country:string;clicks:number;impressions:number;weighted_position:number}>();
 let total=0;
 for(const p of proofs){
  const rows=await readProof(storage,secret,p);total+=rows.length;fail(total<=MAX_ROWS,'GSC_MONTH_ROW_LIMIT');
  for(const r of rows){
   const k=JSON.stringify([r.page,r.country,r.device]),old=group.get(k)||{page:r.page,device:r.device,country:r.country,clicks:0,impressions:0,weighted_position:0};
   old.clicks+=r.clicks;old.impressions+=r.impressions;old.weighted_position+=r.position*r.impressions;group.set(k,old);
  }
 }
 const pages=[...group.values()].map(({weighted_position,...p})=>({...p,
   ctr:p.impressions?p.clicks/p.impressions:0,position:p.impressions?weighted_position/p.impressions:0})).sort((a,b)=>b.clicks-a.clicks);
 return {available:true as const,month,days_verified:proofs.length,expected_days:dates.length,query_days_verified:queryDays,
   query_partial:true,source:'GSC Search Analytics API',scope:'verified daily page-country-device; anonymized queries are incomplete',d1_requests:0,pages,
   total_clicks:pages.reduce((n,p)=>n+p.clicks,0),total_impressions:pages.reduce((n,p)=>n+p.impressions,0)};
}
