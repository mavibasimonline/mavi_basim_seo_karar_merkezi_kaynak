// Independent GSC Search Analytics daily collector. No D1 binding or D1 access.
// Never treat anonymized query rows, truncated pagination or absent days as zero.
import {encrypt,decrypt} from './security';
import {gscRowIssue,GscRow} from './providers';
import {isBrand} from './urls';
const PROPERTY='sc-domain:mavibasim.com',PAGE=200,MAX_PAGES=250,CHUNK=36000;
type Scope='page'|'query';
type PageProof={index:number;count:number;bytes:number;chunks:number;sha256:string};
type Job={day:string;scope:Scope;generation:string;cursor:number;pages:PageProof[];started_at:string;attempts:number;incomplete?:boolean;ready?:boolean;truncated?:boolean;completed_at?:string};
export type DailyProof={day:string;scope:Scope;generation:string;captured_at:string;rows:number;pages:number;query_partial:boolean;source:'GSC Search Analytics API';d1_requests:0;page_proofs:PageProof[]};
export type GscStorage=Pick<DurableObjectStorage,'get'|'put'>&{sql?:{readonly databaseSize:number}};
export type GscPhase='authorization'|'provider'|'response'|'validation'|'storage'|'publication';
const PHASE_CODE:Record<GscPhase,string>={authorization:'GSC_TOKEN_UNAVAILABLE',provider:'GSC_PROVIDER_UNAVAILABLE',response:'GSC_RESPONSE_INVALID',validation:'GSC_VALIDATION_UNAVAILABLE',storage:'GSC_STORAGE_UNAVAILABLE',publication:'GSC_PUBLICATION_UNAVAILABLE'};
const bytes=(s:string)=>new TextEncoder().encode(s);
const digest=async(s:string)=>[...new Uint8Array(await crypto.subtle.digest('SHA-256',bytes(s)))].map(n=>n.toString(16).padStart(2,'0')).join('');
const key=(day:string,scope:Scope)=>'gsc:daily:'+day+':'+scope;
const pageKey=(j:Job,index:number,chunk:number)=>'gsc:part:'+j.day+':'+j.scope+':'+j.generation+':'+index+':'+chunk;
const seenKey=(j:Job,index:number)=>'gsc:seen:'+j.day+':'+j.scope+':'+j.generation+':'+index;
const dayAgo=(n:number,time:Date)=>new Date(Date.UTC(time.getUTCFullYear(),time.getUTCMonth(),time.getUTCDate()-n)).toISOString().slice(0,10);
function ensure(yes:unknown,code:string):asserts yes {if(!yes)throw Error(code);}
function safeDay(day:string,time:Date){ensure(/^20\d\d-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/.test(day)&&new Date(day+'T00:00:00Z').toISOString().slice(0,10)===day&&day<=dayAgo(3,time)&&day>=dayAgo(400,time),'GSC_DAY_OUT_OF_RANGE');}
class RowFailure extends Error{constructor(public reason:string){super('GSC_ROW_REJECTED');}}
type StorageBudget={version:1;measured_since:string;day:string;reserved_bytes:number;day_reserved_bytes:number};
const STORAGE_TOTAL=128*1024*1024,STORAGE_DAY=8*1024*1024;
async function reserveStorage(storage:GscStorage,planned:number,time:Date){
 const saved=await storage.get<StorageBudget>('gsc:storage-budget:v1'),day=time.toISOString().slice(0,10);
 ensure(Number.isSafeInteger(planned)&&planned>0,'GSC_STORAGE_BUDGET_INVALID');
 if(saved)ensure(saved.version===1&&Number.isSafeInteger(saved.reserved_bytes)&&saved.reserved_bytes>=0&&Number.isSafeInteger(saved.day_reserved_bytes)&&saved.day_reserved_bytes>=0,'GSC_STORAGE_BUDGET_INVALID');
 const budget:StorageBudget=saved?{...saved,day,day_reserved_bytes:saved.day===day?saved.day_reserved_bytes:0}:{version:1,measured_since:time.toISOString(),day,reserved_bytes:0,day_reserved_bytes:0};
 // The same SQLite object also holds existing archives. Inspect its physical
 // size when the runtime exposes it; never pretend this measures other objects.
 if(storage.sql)ensure(Number.isFinite(storage.sql.databaseSize)&&storage.sql.databaseSize>=0&&storage.sql.databaseSize+planned<=256*1024*1024,'GSC_STORAGE_OBJECT_LIMIT');
 ensure(budget.reserved_bytes+planned<=STORAGE_TOTAL,'GSC_STORAGE_TOTAL_LIMIT');
 ensure(budget.day_reserved_bytes+planned<=STORAGE_DAY,'GSC_STORAGE_DAILY_LIMIT');
 // Reservation precedes chunks and is retained even after a failed write. It is
 // deliberately conservative; pre-upgrade/account-wide usage is not measured.
 budget.reserved_bytes+=planned;budget.day_reserved_bytes+=planned;
 await storage.put('gsc:storage-budget:v1',budget);
}
const identities=(rows:GscRow[])=>Promise.all(rows.map(r=>digest(JSON.stringify([r.date,r.page,r.country,r.device,r.query]))));
async function boundedResponse(response:Response){
 if(Number(response.headers.get('content-length'))>1100000){await response.body?.cancel();throw Error('GSC_RESPONSE_BYTES_LIMIT');}
 if(!response.body)return '';
 const reader=response.body.getReader(),parts:Uint8Array[]=[];let size=0;
 try{for(;;){const p=await reader.read();if(p.done)break;size+=p.value.length;ensure(size<=1100000,'GSC_RESPONSE_BYTES_LIMIT');parts.push(p.value);}}
 finally{await reader.cancel();}
 const buffer=new Uint8Array(size);let offset=0;for(const p of parts){buffer.set(p,offset);offset+=p.length;}
 try{return new TextDecoder('utf-8',{fatal:true,ignoreBOM:false}).decode(buffer);}catch{throw Error('GSC_RESPONSE_INVALID');}
}
export function validateGscPage(body:unknown,day:string,scope:Scope,cursor:number){
 ensure(body&&typeof body==='object'&&!Array.isArray(body),'GSC_RESPONSE_INVALID');
 const reply=body as {rows?:{keys?:unknown;clicks?:unknown;impressions?:unknown;ctr?:unknown;position?:unknown}[];responseAggregationType?:string;metadata?:{first_incomplete_date?:string}};
 ensure(reply.responseAggregationType==='byPage'&&(reply.rows===undefined||Array.isArray(reply.rows)),'GSC_AGGREGATION_INVALID');
 ensure((reply.rows?.length||0)<=PAGE&&Number.isSafeInteger(cursor)&&cursor>=0&&cursor<=50000,'GSC_PAGE_LIMIT');
 const dimensions=scope==='query'?['date','page','query','country','device']:['date','page','country','device'];
 const seen=new Set<string>(),rows:GscRow[]=[];
 for(const raw of reply.rows||[]){
  ensure(raw&&typeof raw==='object'&&!Array.isArray(raw),'GSC_RESPONSE_INVALID');
  ensure(Array.isArray(raw.keys)&&raw.keys.length===dimensions.length&&raw.keys.every(k=>typeof k==='string'),'GSC_DIMENSIONS_INVALID');
  const dim=Object.fromEntries(dimensions.map((k,i)=>[k,(raw.keys as string[])[i]]));
  const row:GscRow={date:dim.date,page:dim.page,country:dim.country,device:dim.device.toUpperCase(),
   clicks:raw.clicks as number,impressions:raw.impressions as number,ctr:raw.ctr as number,position:raw.position as number};
  if(scope==='query'){row.query=dim.query;row.is_brand=Number(isBrand(dim.query));}
  const issue=gscRowIssue(row,day,PROPERTY);if(issue)throw new RowFailure(issue);
  if(!Number.isSafeInteger(row.clicks)||!Number.isSafeInteger(row.impressions))throw new RowFailure('COUNTS');
  // Preserve Google's exact observed identity; URL variants are not evidence of
  // canonical equivalence, and stripping parameters could collapse source rows.
  const identity=JSON.stringify([row.date,row.page,row.country,row.device,row.query]);
  ensure(!seen.has(identity),'GSC_DUPLICATE_ROW');seen.add(identity);rows.push(row);
 }
 ensure(rows.length<=PAGE&&cursor+rows.length<=50000,'GSC_PAGE_LIMIT');
 const marker=reply.metadata?.first_incomplete_date;
 ensure(marker===undefined||typeof marker==='string'&&/^20\d\d-\d\d-\d\d$/.test(marker),'GSC_METADATA_INVALID');
 const incomplete=!!marker&&marker<=day;
 return {rows,next:rows.length===PAGE?cursor+PAGE:null,incomplete};
}
async function writePage(storage:GscStorage,j:Job,rows:GscRow[],secret:string,time:Date,hashes:string[]):Promise<PageProof>{
 const index=j.pages.length,serialized=JSON.stringify(rows),hash=await digest(serialized),binary=bytes(serialized);
 const chunks=Math.ceil(binary.length/CHUNK);
 ensure(chunks>=1&&chunks<=20&&binary.length<=PAGE*2300,'GSC_PAGE_BYTES_LIMIT');
 ensure(index<MAX_PAGES,'GSC_PAGE_LIMIT');
 // 2x serialized plaintext covers base64+encryption overhead; identity lists,
 // page manifests and active/final pointers receive an additional allowance.
 await reserveStorage(storage,binary.length*2+bytes(JSON.stringify(hashes)).length*2+4096,time);
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
 await storage.put(seenKey(j,index),hashes);
 return {index,count:rows.length,bytes:binary.length,chunks,sha256:hash};
}
async function previousIdentities(storage:GscStorage,j:Job,secret:string,time:Date){
 const seen=new Set<string>();
 for(const p of j.pages){
  const saved=await storage.get<string[]>(seenKey(j,p.index));
  if(saved){
   ensure(Array.isArray(saved)&&saved.length===p.count&&saved.every(v=>typeof v==='string'&&/^[a-f0-9]{64}$/.test(v)),'GSC_IDENTITY_INDEX_INVALID');
   for(const h of saved){ensure(!seen.has(h),'GSC_DUPLICATE_ROW');seen.add(h);}continue;
  }
  // Compatibility for an in-flight generation created before this version.
  // Rebuild at most one index per tick without another Google request.
  ensure(p.chunks>=1&&p.chunks<=20&&p.bytes<=PAGE*2300,'GSC_IDENTITY_INDEX_INVALID');
  const all=new Uint8Array(p.bytes);let at=0;
  for(let c=0;c<p.chunks;c++){
   const sealed=await storage.get<string>(pageKey(j,p.index,c));ensure(typeof sealed==='string','GSC_CHUNK_MISSING');
   const {chunk}=await decrypt<{chunk:string}>(sealed!,secret),part=Uint8Array.from(atob(chunk),v=>v.charCodeAt(0));
   ensure(at+part.length<=all.length,'GSC_READBACK_REJECTED');all.set(part,at);at+=part.length;
  }
  const raw=new TextDecoder().decode(all);ensure(at===p.bytes&&await digest(raw)===p.sha256,'GSC_READBACK_REJECTED');
  const rows=JSON.parse(raw) as GscRow[];ensure(Array.isArray(rows)&&rows.length===p.count,'GSC_READBACK_REJECTED');
  const hashes=await identities(rows);
  await reserveStorage(storage,bytes(JSON.stringify(hashes)).length*2+1024,time);
  await storage.put(seenKey(j,p.index),hashes);
  return null;
 }
 return seen;
}
export function selectGscDay(time:Date,backfill=0,history=false){
 const index=Math.max(0,Math.min(390,backfill));
 return dayAgo(history?10+index:3,time);
}
export class IndependentGscCollector {
 constructor(private storage:GscStorage,private keySecret:string,private token:(force:boolean)=>Promise<string>,private fetcher:typeof fetch=fetch){}
 private async finish(j:Job,time:Date){
  const final:DailyProof={day:j.day,scope:j.scope,generation:j.generation,captured_at:j.completed_at||time.toISOString(),
   rows:j.cursor,pages:j.pages.length,query_partial:j.scope==='query'||!!j.incomplete||!!j.truncated,
   source:'GSC Search Analytics API',d1_requests:0,page_proofs:j.pages};
  const history='gsc:history:'+j.day+':'+j.scope+':'+j.generation,existing=await this.storage.get<DailyProof>(history);
  // A failed pointer write may retry publication, but a verified historical
  // generation is immutable and never overwritten with a different manifest.
  if(existing)ensure(JSON.stringify(existing)===JSON.stringify(final),'GSC_HISTORY_CONFLICT');
  else await this.storage.put(history,final);
  await this.storage.put(key(j.day,j.scope),final);
  await this.storage.put('gsc:active',null);
  if(j.day===selectGscDay(time,(await this.storage.get<number>('gsc:backfill-index'))||0,true)&&j.scope==='query')
   await this.storage.put('gsc:backfill-index',(((await this.storage.get<number>('gsc:backfill-index'))||0)+1)%391);
  await this.storage.put('gsc:last-attempt',{at:time.toISOString(),status:'complete',day:j.day,scope:j.scope,rows:j.cursor});
  await this.storage.put('gsc:last-complete',{at:time.toISOString(),status:'complete',day:j.day,scope:j.scope,rows:j.cursor,generation:j.generation});
  return {status:'complete' as const,day:j.day,scope:j.scope,rows:j.cursor,query_partial:final.query_partial,d1_requests:0};
 }
 private async choose(time:Date){
  const active=await this.storage.get<Job>('gsc:active');if(active){safeDay(active.day,time);if(active.incomplete===undefined&&active.pages.length){active.incomplete=true;await this.storage.put('gsc:active',active);}return active;}
  const serial=(await this.storage.get<number>('gsc:tick-count'))||0;
  await this.storage.put('gsc:tick-count',(serial+1)%1000000);
  const historical=serial%4===3,backfill=(await this.storage.get<number>('gsc:backfill-index'))||0;
  const recent:{day:string;scope:Scope;history:boolean}[]=[];
  for(let ago=3;ago<=9;ago++)for(const scope of ['page','query'] as Scope[])recent.push({day:dayAgo(ago,time),scope,history:false});
  const d=selectGscDay(time,backfill,true),older=[{day:d,scope:'page' as Scope,history:true},{day:d,scope:'query' as Scope,history:true}];
  // A historical slot prefers its planned older date. If both scopes are fresh
  // or held, use the slot for recent missing work instead of reporting idle.
  for(const candidates of historical?[older,recent]:[recent]){
   const checked=await Promise.all(candidates.map(async c=>({...c,old:await this.storage.get<DailyProof>(key(c.day,c.scope))})));
   // Within each priority group, missing dates precede another generation of a
   // collected date. Historical cadence and recent scope fairness both survive.
   checked.sort((a,b)=>Number(!!a.old)-Number(!!b.old));
   for(const c of checked){
    const old=c.old,maxAge=c.history?30*86400000:24*3600000;
    if(old&&time.getTime()-Date.parse(old.captured_at)<maxAge)continue;
    const held=await this.storage.get<{until:number}>('gsc:held:'+c.day+':'+c.scope);
    if(held&&Number.isFinite(held.until)&&held.until>time.getTime())continue;
    const job:Job={day:c.day,scope:c.scope,generation:crypto.randomUUID(),cursor:0,pages:[],started_at:time.toISOString(),attempts:0,incomplete:false};
    await this.storage.put('gsc:active',job);return job;
   }
   if(historical&&candidates===older)await this.storage.put('gsc:backfill-index',(backfill+1)%391);
  }
  return null;
 }
 async tick(time=new Date()){
  const last=await this.storage.get<{until:number}>('gsc:retry');
  if(last&&time.getTime()<last.until){
   await this.storage.put('gsc:last-attempt',{at:time.toISOString(),status:'held',code:'GSC_RETRY_BACKOFF'});
   return {status:'held',code:'GSC_RETRY_BACKOFF',d1_requests:0};
  }
  const j=await this.choose(time);
  if(!j){
   await this.storage.put('gsc:last-attempt',{at:time.toISOString(),status:'idle'});
   return {status:'idle',d1_requests:0};
  }
  let phase:GscPhase='storage';
  try{
   if(j.ready){phase='publication';return await this.finish(j,time);}
   const seen=await previousIdentities(this.storage,j,this.keySecret,time);
   if(!seen){
    await this.storage.put('gsc:last-attempt',{at:time.toISOString(),status:'partial',day:j.day,scope:j.scope,cursor:j.cursor,code:'GSC_IDENTITY_INDEX_BUILDING'});
    return {status:'partial',day:j.day,scope:j.scope,cursor:j.cursor,code:'GSC_IDENTITY_INDEX_BUILDING',d1_requests:0};
   }
   const dimensions=j.scope==='query'?['date','page','query','country','device']:['date','page','country','device'];
   const endpoint='https://www.googleapis.com/webmasters/v3/sites/'+encodeURIComponent(PROPERTY)+'/searchAnalytics/query';
   // Use Google's recommended auto aggregation for page dimensions; reject non-byPage responses.
   const payload={startDate:j.day,endDate:j.day,dimensions,type:'web',dataState:'final',aggregationType:'auto',rowLimit:PAGE,startRow:j.cursor};
   const send=async(force:boolean)=>{
    phase='authorization';
    const access=await this.token(force);
    phase='provider';
    // Workers' native fetch rejects a collector instance as its receiver.
    // Call the captured transport as a function, as the global API requires.
    const transport=this.fetcher;
    try{return await transport(endpoint,{method:'POST',redirect:'manual',signal:AbortSignal.timeout(20000),headers:{Authorization:'Bearer '+access,'Content-Type':'application/json'},body:JSON.stringify(payload)});}
    catch(error){throw Error(error instanceof Error&&['TimeoutError','AbortError'].includes(error.name)?'GSC_NETWORK_TIMEOUT':'GSC_NETWORK_UNAVAILABLE');}
   };
   let response=await send(false);
   if(response.status===401){await response.body?.cancel();response=await send(true);}
   if(!response.ok){
    const code='GSC_HTTP_'+response.status;
    await response.body?.cancel();
    // Status-only diagnostics: never persist Google's response body, queries or tokens.
    throw Error(code);
   }
   phase='response';
   const raw=await boundedResponse(response);let body:unknown;
   try{body=JSON.parse(raw);}catch{throw Error('GSC_RESPONSE_INVALID');}
   phase='validation';
   const page=validateGscPage(body,j.day,j.scope,j.cursor),hashes=await identities(page.rows);
   for(const h of hashes)ensure(!seen.has(h),'GSC_DUPLICATE_ROW');
   phase='storage';
   const proof=await writePage(this.storage,j,page.rows,this.keySecret,time,hashes);
   phase='publication';
   j.pages.push(proof);j.cursor+=page.rows.length;
   j.incomplete=!!j.incomplete||page.incomplete;
   if(page.next!==null&&j.cursor<50000){
    await this.storage.put('gsc:active',j);
    await this.storage.put('gsc:last-attempt',{at:time.toISOString(),status:'partial',day:j.day,scope:j.scope,cursor:j.cursor});
    return {status:'partial',day:j.day,scope:j.scope,cursor:j.cursor,d1_requests:0};
   }
   // Persist finalization state before publishing either pointer. A storage
   // interruption resumes publication without re-requesting a finished page.
   j.ready=true;j.truncated=page.next!==null;j.completed_at=time.toISOString();
   await this.storage.put('gsc:active',j);
   return await this.finish(j,time);
  }catch(error){
   const code=error instanceof Error&&/^GSC_[A-Z0-9_]{1,80}$/.test(error.message)?error.message:PHASE_CODE[phase];
   const detail=error instanceof RowFailure&&/^(DATE|PAGE_PROPERTY_SCOPE|PAGE_ORIGIN|COUNTRY|DEVICE|METRIC_NUMBER|COUNTS|METRIC_RANGE|CTR_RATIO|QUERY)$/.test(error.reason)?error.reason:undefined;
   const failure={at:time.toISOString(),status:'held',day:j.day,scope:j.scope,code,phase,...(detail?{validation_reason:detail}:{}),cursor:j.cursor};
   await this.storage.put('gsc:last-failure',failure);
   if(['GSC_STORAGE_DAILY_LIMIT','GSC_STORAGE_TOTAL_LIMIT','GSC_STORAGE_OBJECT_LIMIT'].includes(code)){
    const until=code==='GSC_STORAGE_DAILY_LIMIT'?Date.UTC(time.getUTCFullYear(),time.getUTCMonth(),time.getUTCDate()+1):time.getTime()+86400000;
    await this.storage.put('gsc:retry',{until});
    await this.storage.put('gsc:last-attempt',failure);
    // Keep the staged cursor. The daily cap expires automatically next UTC day;
    // total/object caps require storage review and never delete old records.
    return {status:'held',code,d1_requests:0};
   }
   if(code==='GSC_OAUTH_RECONNECT_REQUIRED')await this.storage.put('gsc:oauth-reconnect',{at:time.toISOString()});
   const retryable=code==='GSC_HTTP_429'||/^GSC_HTTP_5\d\d$/.test(code)||['GSC_RESPONSE_BYTES_LIMIT','GSC_NETWORK_TIMEOUT','GSC_NETWORK_UNAVAILABLE','GSC_SYNC_UNAVAILABLE','GSC_TOKEN_BROKER_UNAVAILABLE','GSC_TOKEN_REFRESH_UNAVAILABLE','GSC_STORAGE_UNAVAILABLE','GSC_PUBLICATION_UNAVAILABLE','GSC_PROVIDER_UNAVAILABLE'].includes(code);
   // A bad source day must not monopolize the private queue. Keep prior verified days.
   j.attempts++;
   if(!retryable||j.attempts>=3){
    await this.storage.put('gsc:held:'+j.day+':'+j.scope,{until:time.getTime()+24*3600000,code});
    await this.storage.put('gsc:active',null);
   }else await this.storage.put('gsc:active',j);
   await this.storage.put('gsc:retry',{until:time.getTime()+(retryable?3600000:15*60000)});
   // Failed job remains staged, never overwriting an earlier verified complete day.
   const safeCode=/^GSC_[A-Z0-9_]+$/.test(code)?code:'GSC_SYNC_UNAVAILABLE';
   await this.storage.put('gsc:last-attempt',{...failure,code:safeCode});
   return {status:'held',code:safeCode,d1_requests:0};
  }
 }
 async status(time=new Date()){
  const active=await this.storage.get<Job>('gsc:active');
  const lastAttempt=await this.storage.get<{at:string;status:string;day?:string;scope?:Scope;code?:string}>('gsc:last-attempt');
  const lastFailure=await this.storage.get('gsc:last-failure'),lastComplete=await this.storage.get('gsc:last-complete');
  const budget=await this.storage.get<StorageBudget>('gsc:storage-budget:v1'),retry=await this.storage.get<{until:number}>('gsc:retry');
  const tickCount=(await this.storage.get<number>('gsc:tick-count'))||0,backfillIndex=(await this.storage.get<number>('gsc:backfill-index'))||0;
  const held=[] as Array<{day:string;scope:Scope;until:string;code:string;active:boolean}>;
  const heldCandidates=new Map<string,{day:string;scope:Scope}>();
  for(let ago=3;ago<=9;ago++)for(const scope of ['page','query'] as Scope[])heldCandidates.set(dayAgo(ago,time)+':'+scope,{day:dayAgo(ago,time),scope});
  for(const scope of ['page','query'] as Scope[])heldCandidates.set(selectGscDay(time,backfillIndex,true)+':'+scope,{day:selectGscDay(time,backfillIndex,true),scope});
  if(active)heldCandidates.set(active.day+':'+active.scope,{day:active.day,scope:active.scope});
  for(const c of heldCandidates.values()){
   const saved=await this.storage.get<{until:number;code?:unknown}>('gsc:held:'+c.day+':'+c.scope);
   if(saved&&Number.isFinite(saved.until)&&Number.isFinite(new Date(saved.until).getTime()))held.push({...c,until:new Date(saved.until).toISOString(),code:typeof saved.code==='string'&&/^GSC_[A-Z0-9_]{1,80}$/.test(saved.code)?saved.code:'GSC_SYNC_UNAVAILABLE',active:saved.until>time.getTime()});
  }
  const rows=[] as Array<{day:string;scope:Scope;rows:number;query_partial:boolean;captured_at:string}>,incomplete=[] as Array<{day:string;scope:Scope}>,invalid=[] as Array<{day:string;scope:Scope}>;
  for(let i=3;i<=9;i++)for(const scope of ['page','query'] as Scope[]){
   const proof=await this.storage.get<DailyProof>(key(dayAgo(i,time),scope));
   if(!proof)continue;
   const valid=proof.day===dayAgo(i,time)&&proof.scope===scope&&proof.source==='GSC Search Analytics API'&&proof.d1_requests===0
    &&Number.isSafeInteger(proof.rows)&&proof.rows>=0&&proof.rows<=50000&&typeof proof.query_partial==='boolean'
    &&typeof proof.captured_at==='string'&&Number.isFinite(Date.parse(proof.captured_at))&&Date.parse(proof.captured_at)<=time.getTime()
    &&Array.isArray(proof.page_proofs)&&proof.pages===proof.page_proofs.length&&proof.pages>=1&&proof.pages<=250
    &&proof.page_proofs.every((p,n)=>p.index===n&&Number.isSafeInteger(p.count)&&p.count>=0&&p.count<=200&&Number.isSafeInteger(p.bytes)&&p.bytes>=2&&p.bytes<=460000&&Number.isSafeInteger(p.chunks)&&p.chunks>=1&&p.chunks<=20&&typeof p.sha256==='string'&&/^[a-f0-9]{64}$/.test(p.sha256))
    &&proof.page_proofs.reduce((n,p)=>n+p.count,0)===proof.rows;
   if(!valid){invalid.push({day:dayAgo(i,time),scope});continue;}
   if(scope==='page'&&proof.query_partial){incomplete.push({day:proof.day,scope});continue;}
   rows.push({day:proof.day,scope,rows:proof.rows,query_partial:proof.query_partial,captured_at:proof.captured_at});
  }
  return {source:'GSC Search Analytics API',d1_requests:0,connected:true,coverage:rows,incomplete_coverage:incomplete,invalid_manifests:invalid,coverage_validation:'saved manifest metadata; chunk readback uses the proof endpoint',held,tick_count:tickCount,backfill_index:backfillIndex,last_attempt:lastAttempt||null,last_failure:lastFailure||null,last_complete:lastComplete||null,retry_until:retry&&retry.until>time.getTime()?new Date(retry.until).toISOString():null,
   storage_budget:{measured_since:budget?.measured_since||null,reserved_bytes:budget?.reserved_bytes||0,daily_reserved_bytes:budget?.day===time.toISOString().slice(0,10)?budget.day_reserved_bytes:0,total_limit_bytes:STORAGE_TOTAL,daily_limit_bytes:STORAGE_DAY,object_limit_bytes:256*1024*1024,object_database_bytes:storageSize(this.storage),account_usage_measured:false,prior_usage_included:false},
   pending:active?{day:active.day,scope:active.scope,cursor:active.cursor}:null,
   limitations:['GSC anonymous queries are not complete.','Uncollected days are not zero.']};
 }
}
function storageSize(storage:GscStorage){return storage.sql&&Number.isFinite(storage.sql.databaseSize)?storage.sql.databaseSize:null;}
