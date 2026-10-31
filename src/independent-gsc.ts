// Independent GSC Search Analytics daily collector. No D1 binding or D1 access.
// Never treat anonymized query rows, truncated pagination or absent days as zero.
import {encrypt,decrypt} from './security';
import {gscRowIssue,GscRow} from './providers';
import {siteURL,isBrand} from './urls';
const PROPERTY='sc-domain:mavibasim.com',PAGE=200,MAX_PAGES=250,CHUNK=36000;
type Scope='page'|'query';
type PageProof={index:number;count:number;bytes:number;chunks:number;sha256:string};
type Job={day:string;scope:Scope;generation:string;cursor:number;pages:PageProof[];started_at:string;attempts:number};
export type DailyProof={day:string;scope:Scope;generation:string;captured_at:string;rows:number;pages:number;query_partial:boolean;source:'GSC Search Analytics API';d1_requests:0;page_proofs:PageProof[]};
export type GscStorage=Pick<DurableObjectStorage,'get'|'put'>;
const bytes=(s:string)=>new TextEncoder().encode(s);
const digest=async(s:string)=>[...new Uint8Array(await crypto.subtle.digest('SHA-256',bytes(s)))].map(n=>n.toString(16).padStart(2,'0')).join('');
const key=(day:string,scope:Scope)=>'gsc:daily:'+day+':'+scope;
const pageKey=(j:Job,index:number,chunk:number)=>'gsc:part:'+j.day+':'+j.scope+':'+j.generation+':'+index+':'+chunk;
const dayAgo=(n:number,time:Date)=>new Date(Date.UTC(time.getUTCFullYear(),time.getUTCMonth(),time.getUTCDate()-n)).toISOString().slice(0,10);
function ensure(yes:unknown,code:string):asserts yes {if(!yes)throw Error(code);}
function safeDay(day:string,time:Date){ensure(/^20\d\d-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/.test(day)&&!Number.isNaN(Date.parse(day))&&day<=dayAgo(3,time)&&day>=dayAgo(400,time),'GSC_DAY_OUT_OF_RANGE');}
export function validateGscPage(body:unknown,day:string,scope:Scope,cursor:number){
 ensure(body&&typeof body==='object'&&!Array.isArray(body),'GSC_RESPONSE_INVALID');
 const reply=body as {rows?:{keys?:unknown;clicks?:unknown;impressions?:unknown;ctr?:unknown;position?:unknown}[];responseAggregationType?:string;metadata?:{first_incomplete_date?:string}};
 ensure(reply.responseAggregationType==='byPage'&&(reply.rows===undefined||Array.isArray(reply.rows)),'GSC_AGGREGATION_INVALID');
 const dimensions=scope==='query'?['date','page','query','country','device']:['date','page','country','device'];
 const seen=new Set<string>(),rows:GscRow[]=[];
 for(const raw of reply.rows||[]){
  ensure(Array.isArray(raw.keys)&&raw.keys.length===dimensions.length&&raw.keys.every(k=>typeof k==='string'),'GSC_DIMENSIONS_INVALID');
  const dim=Object.fromEntries(dimensions.map((k,i)=>[k,(raw.keys as string[])[i]]));
  const row:GscRow={date:dim.date,page:dim.page,country:dim.country,device:dim.device.toUpperCase(),
   clicks:raw.clicks as number,impressions:raw.impressions as number,ctr:raw.ctr as number,position:raw.position as number};
  if(scope==='query'){row.query=dim.query;row.is_brand=Number(isBrand(dim.query));}
  ensure(!gscRowIssue(row,day,PROPERTY),'GSC_ROW_REJECTED');
  row.page=siteURL(dim.page)||dim.page;
  const identity=JSON.stringify([row.date,row.page,row.country,row.device,row.query]);
  ensure(!seen.has(identity),'GSC_DUPLICATE_ROW');seen.add(identity);rows.push(row);
 }
 ensure(rows.length<=PAGE&&cursor+rows.length<=50000,'GSC_PAGE_LIMIT');
 const incomplete=!!reply.metadata?.first_incomplete_date&&reply.metadata.first_incomplete_date<=day;
 return {rows,next:rows.length===PAGE?cursor+PAGE:null,incomplete};
}
async function writePage(storage:GscStorage,j:Job,rows:GscRow[],secret:string):Promise<PageProof>{
 const index=j.pages.length,serialized=JSON.stringify(rows),hash=await digest(serialized),binary=bytes(serialized);
 const chunks=Math.ceil(binary.length/CHUNK);
 ensure(chunks>=1&&chunks<=20&&binary.length<=PAGE*2300,'GSC_PAGE_BYTES_LIMIT');
 for(let i=0;i<chunks;i++){
  const slice=binary.subarray(i*CHUNK,(i+1)*CHUNK);
  await storage.put(pageKey(j,index,i),await encrypt({chunk:btoa(String.fromCharCode(...slice))},secret));
 }
 const restored:Uint8Array[]=[];
 for(let i=0;i<chunks;i++){
  const sealed=await storage.get<string>(pageKey(j,index,i));ensure(typeof sealed==='string','GSC_CHUNK_MISSING');
  const piece=await decrypt<{chunk:string}>(sealed!,secret);
  restored.push(Uint8Array.from(atob(piece.chunk),c=>c.charCodeAt(0)));
 }
 const all=new Uint8Array(binary.length);let at=0;for(const part of restored){all.set(part,at);at+=part.length;}
 ensure(at===binary.length&&await digest(new TextDecoder().decode(all))===hash,'GSC_READBACK_REJECTED');
 return {index,count:rows.length,bytes:binary.length,chunks,sha256:hash};
}
export function selectGscDay(time:Date,backfill=0,history=false){
 const index=Math.max(0,Math.min(390,backfill));
 return dayAgo(history?10+index:3,time);
}
export class IndependentGscCollector {
 constructor(private storage:GscStorage,private keySecret:string,private token:(force:boolean)=>Promise<string>,private fetcher:typeof fetch=fetch){}
 private async choose(time:Date){
  const active=await this.storage.get<Job>('gsc:active');if(active){safeDay(active.day,time);return active;}
  const serial=(await this.storage.get<number>('gsc:tick-count'))||0;
  await this.storage.put('gsc:tick-count',(serial+1)%1000000);
  const historical=serial%4===3,backfill=(await this.storage.get<number>('gsc:backfill-index'))||0;
  const candidates:{day:string;scope:Scope;history:boolean}[]=[];
  if(historical){
   const d=selectGscDay(time,backfill,true);
   candidates.push({day:d,scope:'page',history:true},{day:d,scope:'query',history:true});
  }else{
   for(let ago=3;ago<=9;ago++)for(const scope of ['page','query'] as Scope[])candidates.push({day:dayAgo(ago,time),scope,history:false});
  }
  for(const c of candidates){
   const old=await this.storage.get<DailyProof>(key(c.day,c.scope));
   const maxAge=c.history?30*86400000:24*3600000;
   if(old&&time.getTime()-Date.parse(old.captured_at)<maxAge)continue;
   const job:Job={day:c.day,scope:c.scope,generation:crypto.randomUUID(),cursor:0,pages:[],started_at:time.toISOString(),attempts:0};
   await this.storage.put('gsc:active',job);return job;
  }
  if(historical)await this.storage.put('gsc:backfill-index',(backfill+1)%391);
  return null;
 }
 async tick(time=new Date()){
  const last=await this.storage.get<{until:number}>('gsc:retry');
  if(last&&time.getTime()<last.until)return {status:'held',code:'GSC_RETRY_BACKOFF',d1_requests:0};
  const j=await this.choose(time);
  if(!j)return {status:'idle',d1_requests:0};
  try{
   const dimensions=j.scope==='query'?['date','page','query','country','device']:['date','page','country','device'];
   const endpoint='https://www.googleapis.com/webmasters/v3/sites/'+encodeURIComponent(PROPERTY)+'/searchAnalytics/query';
   const payload={startDate:j.day,endDate:j.day,dimensions,type:'web',dataState:'final',aggregationType:'byPage',rowLimit:PAGE,startRow:j.cursor};
   const send=async(force:boolean)=>this.fetcher(endpoint,{method:'POST',redirect:'manual',signal:AbortSignal.timeout(20000),
      headers:{Authorization:'Bearer '+await this.token(force),'Content-Type':'application/json'},body:JSON.stringify(payload)});
   let response=await send(false);
   if(response.status===401){await response.body?.cancel();response=await send(true);}
   ensure(response.ok,'GSC_PROVIDER_UNAVAILABLE');
   const raw=await response.text();ensure(bytes(raw).length<=1100000,'GSC_RESPONSE_BYTES_LIMIT');
   const page=validateGscPage(JSON.parse(raw),j.day,j.scope,j.cursor);
   const proof=await writePage(this.storage,j,page.rows,this.keySecret);
   j.pages.push(proof);j.cursor+=page.rows.length;
   if(page.next!==null&&j.cursor<50000){
    await this.storage.put('gsc:active',j);
    return {status:'partial',day:j.day,scope:j.scope,cursor:j.cursor,d1_requests:0};
   }
   const final:DailyProof={day:j.day,scope:j.scope,generation:j.generation,captured_at:time.toISOString(),
      rows:j.cursor,pages:j.pages.length,query_partial:j.scope==='query'||page.incomplete||page.next!==null,
      source:'GSC Search Analytics API',d1_requests:0,page_proofs:j.pages};
   // Pointer changes only after each encrypted chunk has been read back and verified.
   await this.storage.put('gsc:history:'+j.day+':'+j.scope+':'+j.generation,final);
   await this.storage.put(key(j.day,j.scope),final);
   await this.storage.put('gsc:active',null);
   if(j.day===selectGscDay(time,(await this.storage.get<number>('gsc:backfill-index'))||0,true)&&j.scope==='query')
    await this.storage.put('gsc:backfill-index',(((await this.storage.get<number>('gsc:backfill-index'))||0)+1)%391);
   return {status:'complete',day:j.day,scope:j.scope,rows:j.cursor,query_partial:final.query_partial,d1_requests:0};
  }catch(error){
   const code=error instanceof Error?error.message:'GSC_SYNC_UNAVAILABLE';
   const retryable=['GSC_PROVIDER_UNAVAILABLE','GSC_RESPONSE_BYTES_LIMIT'].includes(code);
   await this.storage.put('gsc:retry',{until:time.getTime()+(retryable?3600000:86400000)});
   // Failed job remains staged, never overwriting an earlier verified complete day.
   return {status:'held',code:/^GSC_[A-Z_]+$/.test(code)?code:'GSC_SYNC_UNAVAILABLE',d1_requests:0};
  }
 }
 async status(time=new Date()){
  const active=await this.storage.get<Job>('gsc:active');
  const rows=[] as Array<{day:string;scope:Scope;rows:number;query_partial:boolean;captured_at:string}>;
  for(let i=3;i<=9;i++)for(const scope of ['page','query'] as Scope[]){
   const proof=await this.storage.get<DailyProof>(key(dayAgo(i,time),scope));
   if(proof)rows.push({day:proof.day,scope,rows:proof.rows,query_partial:proof.query_partial,captured_at:proof.captured_at});
  }
  return {source:'GSC Search Analytics API',d1_requests:0,connected:true,coverage:rows,
   pending:active?{day:active.day,scope:active.scope,cursor:active.cursor}:null,
   limitations:['GSC anonymous queries are not complete.','Uncollected days are not zero.']};
 }
}
