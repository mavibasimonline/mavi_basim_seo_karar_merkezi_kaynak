// Independent Drive OAuth + serialized archive storage. Intentionally no DB/D1 binding.
import {DurableObject} from 'cloudflare:workers';
import {encrypt,decrypt,cookie,equalSecret} from './security';
import {hash,json} from './types';
import {boundedText,ProviderError} from './google';
import {DRIVE_SHEET,DRIVE_SECTIONS,gvizRows,verifiedDriveRecords} from './drive-records';
import {independentReport,independentAnswer,SheetRecord} from './independent-seo-model';
import {readIndependentSnapshot,saveIndependentSnapshot,IndependentSnapshot} from './independent-snapshot';

const SCOPE='https://www.googleapis.com/auth/drive.file',API='https://www.googleapis.com/drive/v3/';
const XLSX='application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
const MAX=12_000_000,CHUNK=48_000;
export interface IndependentDriveEnv{OAUTH_BROKER:Fetcher;ARCHIVE_ENCRYPTION_KEY?:string;ARCHIVE_ENABLED?:string;DRIVE_ARCHIVE_STORE:DurableObjectNamespace}
type Token={access_token:string;refresh_token:string;expires_at:number;scope:string};
type Part={id:string;kind:'xlsx'|'json';mime:string;size:number;sha256:string;chunks:number};
type Pending={day:string;captured_at:string;records:number;files:Part[]};
type Summary={day:string;checked_at:string;status:'ok';files:number;records:number;d1_requests:0};
const requireValue=(value:unknown,code:string)=>{if(!value)throw new ProviderError(code);};
const validId=(value:unknown):value is string=>typeof value==='string'&&/^[A-Za-z0-9_-]{10,200}$/.test(value);
const sha=async(value:Uint8Array)=>[...new Uint8Array(await crypto.subtle.digest('SHA-256',value))].map(b=>b.toString(16).padStart(2,'0')).join('');
const b64=(value:Uint8Array)=>btoa(String.fromCharCode(...value));
const unb64=(value:string)=>Uint8Array.from(atob(value),c=>c.charCodeAt(0));
async function readBytes(response:Response,zip=false){
 requireValue(response.ok&&response.body,'ARCHIVE_RESPONSE_UNAVAILABLE');
 requireValue(Number(response.headers.get('content-length'))<=MAX,'ARCHIVE_RESPONSE_LIMIT');
 const reader=response.body!.getReader(),parts:Uint8Array[]=[];let size=0;
 try{for(;;){const part=await reader.read();if(part.done)break;size+=part.value.length;requireValue(size<=MAX,'ARCHIVE_RESPONSE_LIMIT');parts.push(part.value);}}
 finally{await reader.cancel();}
 const data=new Uint8Array(size);let at=0;for(const part of parts){data.set(part,at);at+=part.length;}
 requireValue(size>0&&(!zip||data[0]===80&&data[1]===75&&data[2]===3&&data[3]===4),'ARCHIVE_SOURCE_INVALID');return data;
}
async function publicSource(url:string){
 for(let i=0;i<4;i++){
  const response=await fetch(url,{redirect:'manual',signal:AbortSignal.timeout(25000)});
  if(response.status>=300&&response.status<400){
   const location=response.headers.get('Location');await response.body?.cancel();requireValue(location,'SHEETS_REDIRECT_INVALID');
   const next=new URL(location!,url);requireValue(next.protocol==='https:'&&!next.username&&!next.password&&!next.port&&(next.hostname==='docs.google.com'||next.hostname.endsWith('.googleusercontent.com')),'SHEETS_REDIRECT_INVALID');url=next.href;continue;
  }
  return readBytes(response,url.includes('/export')||url.includes('/xlsx'));
 }
 throw new ProviderError('SHEETS_REDIRECT_LIMIT');
}

export class IndependentDriveStore extends DurableObject<IndependentDriveEnv>{
 private serial:Promise<unknown>=Promise.resolve();
 private exclusive<T>(task:()=>Promise<T>){const next=this.serial.then(task);this.serial=next.catch(()=>{});return next;}
 private key(){requireValue(this.env.ARCHIVE_ENCRYPTION_KEY,'DRIVE_ENCRYPTION_KEY_REQUIRED');return this.env.ARCHIVE_ENCRYPTION_KEY!;}
 private config(){requireValue(typeof this.env.OAUTH_BROKER?.fetch==='function','DRIVE_OAUTH_CONFIG_REQUIRED');this.key();}
 private async broker<T>(path:string,body?:unknown){
  const response=await this.env.OAUTH_BROKER.fetch('https://drive-broker.internal'+path,{method:body===undefined?'GET':'POST',redirect:'manual',headers:{'Content-Type':'application/json'},body:body===undefined?undefined:JSON.stringify(body)});
  requireValue(response.ok,'DRIVE_OAUTH_BROKER_UNAVAILABLE');return response.json<T>();
 }
 private async token(refresh=false){
  this.config();const saved=await this.ctx.storage.get<string>('oauth');requireValue(saved,'DRIVE_CONSENT_REQUIRED');
  let token=await decrypt<Token>(saved!,this.key());requireValue(token.scope.split(' ').includes(SCOPE)&&token.refresh_token,'DRIVE_CONSENT_REQUIRED');
  if(!refresh&&token.expires_at>Date.now()+60000)return token.access_token;
  const reply=await this.broker<any>('/refresh',{refresh_token:token.refresh_token});
  requireValue(typeof reply.access_token==='string'&&Number.isFinite(reply.expires_in)&&reply.expires_in>0,'DRIVE_TOKEN_RESPONSE_INVALID');
  token={access_token:reply.access_token,refresh_token:reply.refresh_token||token.refresh_token,scope:reply.scope||token.scope,expires_at:Date.now()+reply.expires_in*1000};
  requireValue(token.scope.split(' ').includes(SCOPE),'DRIVE_CONSENT_REQUIRED');await this.ctx.storage.put('oauth',await encrypt(token,this.key()));return token.access_token;
 }
 private async google<T>(url:string,init:RequestInit={method:'GET'}){
  const send=async(refresh:boolean)=>{
   let response:Response;
   try{response=await fetch(url,{...init,headers:{...init.headers,Authorization:'Bearer '+await this.token(refresh)},redirect:'manual',signal:AbortSignal.timeout(25000)});}
   catch{throw new ProviderError('GOOGLE_NETWORK_UNAVAILABLE',true);}
   const text=await boundedText(response,200000);
   if(!response.ok){
    let code='GOOGLE_HTTP_'+response.status;
    if(response.status===403)try{const error=JSON.parse(text).error,reasons=error?.errors?.map((e:any)=>e.reason)||[],details=error?.details||[];
     if(reasons.includes('accessNotConfigured')||details.some((d:any)=>d.reason==='SERVICE_DISABLED'&&d.metadata?.service==='drive.googleapis.com'))code='DRIVE_API_NOT_ENABLED';
     else if(reasons.includes('insufficientPermissions'))code='DRIVE_PERMISSION_REQUIRED';
     else if(reasons.includes('storageQuotaExceeded'))code='DRIVE_STORAGE_HEADROOM_REQUIRED';
    }catch{}
    throw new ProviderError(code,response.status===429||response.status>=500);
   }
   try{return JSON.parse(text) as T;}catch{throw new ProviderError('DRIVE_RESPONSE_INVALID');}
  };
  try{return await send(false);}catch(error){if(!(error instanceof ProviderError)||error.code!=='GOOGLE_HTTP_401')throw error;return send(true);}
 }
 private async start(){
  this.config();const info=await this.broker<{client_id:string;redirect_uri:string}>('/config');
  const active=await this.ctx.storage.list<{expires:number}>({prefix:'state:',limit:16});
  for(const [key,value] of active)if(value.expires<Date.now())await this.ctx.storage.delete(key);
  requireValue([...active.values()].filter(v=>v.expires>=Date.now()).length<8,'DRIVE_CONSENT_RATE_LIMIT');
  const state='drive2.'+crypto.randomUUID()+crypto.randomUUID();await this.ctx.storage.put('state:'+await hash(state),{expires:Date.now()+600000});
  const url=new URL('https://accounts.google.com/o/oauth2/v2/auth');url.search=new URLSearchParams({client_id:info.client_id,redirect_uri:info.redirect_uri,response_type:'code',scope:SCOPE,access_type:'offline',prompt:'consent',state}).toString();
  return new Response(JSON.stringify({authorization_url:url.href}),{headers:{'Content-Type':'application/json','Cache-Control':'no-store','Set-Cookie':`mavi_drive2_oauth=${state}; HttpOnly; Secure; SameSite=Lax; Path=/api/oauth/google; Max-Age=600`}});
 }
 private async callback(request:Request){
  this.config();const url=new URL(request.url),state=url.searchParams.get('state')||'',key='state:'+await hash(state),record=await this.ctx.storage.get<{expires:number}>(key);
  requireValue(state.startsWith('drive2.')&&record&&record.expires>Date.now()&&await equalSecret(state,cookie(request,'mavi_drive2_oauth')||''),'DRIVE_STATE_INVALID');
  await this.ctx.storage.delete(key);const code=url.searchParams.get('code');requireValue(code&&!url.searchParams.has('error'),'DRIVE_CONSENT_DENIED');
  const reply=await this.broker<any>('/exchange',{code});
  requireValue(typeof reply.access_token==='string'&&typeof reply.refresh_token==='string'&&Number.isFinite(reply.expires_in)&&reply.expires_in>0&&reply.scope?.split(' ').includes(SCOPE),'DRIVE_OFFLINE_CONSENT_REQUIRED');
  await this.ctx.storage.put('oauth',await encrypt({access_token:reply.access_token,refresh_token:reply.refresh_token,expires_at:Date.now()+reply.expires_in*1000,scope:reply.scope},this.key()));
  await this.ctx.storage.delete('last_error');await this.ctx.storage.setAlarm(Date.now()+1000);
  return new Response(null,{status:303,headers:{Location:'/drive-independent','Cache-Control':'no-store','Set-Cookie':'mavi_drive2_oauth=; HttpOnly; Secure; SameSite=Lax; Path=/api/oauth/google; Max-Age=0'}});
 }
 async fetch(request:Request){
  return this.exclusive(async()=>{
   try{
    const url=new URL(request.url),path=url.pathname;
    if(path==='/api/independent/auth-limit'&&request.method==='POST'){
      const body=await request.json() as {client?:unknown;valid?:unknown};
      if(typeof body.client!=='string'||!/^[a-f0-9]{64}$/.test(body.client)||typeof body.valid!=='boolean')return json({code:'AUTH_LIMIT_INPUT_INVALID'},400);
      const key='independent:auth:'+body.client,time=Date.now(),saved=await this.ctx.storage.get<{attempts:number;window:number}>(key);
      const active=!!saved&&time-saved.window<15*60_000;
      if(active&&saved!.attempts>=5)return json({allowed:false,locked:true,d1_requests:0});
      if(body.valid){await this.ctx.storage.delete(key);return json({allowed:true,locked:false,d1_requests:0});}
      await this.ctx.storage.put(key,{attempts:active?saved!.attempts+1:1,window:active?saved!.window:time});
      return json({allowed:false,locked:false,d1_requests:0});
    }
    if(path==='/api/internal/independent-refresh'&&request.method==='POST'){
      const snapshot=await this.independentSnapshot();
      const report=independentReport(snapshot.records,undefined,snapshot.captured_at,snapshot.quarantined_records);
      requireValue(report.available&&!snapshot.stale,'INDEPENDENT_REFRESH_SOURCE_STALE');
      return json({ok:true,source_hash:snapshot.source_hash,captured_at:snapshot.captured_at,records:snapshot.records.length,stale:false,d1_requests:0});
    }
    if(path.startsWith('/api/independent/'))return this.independentRoute(request);
    if(request.method==='GET'&&path==='/api/drive-independent/health'){
     this.config();await this.ctx.storage.get('format');const info=await this.broker<any>('/config');
     return json({ok:!!info.client_id&&!!info.redirect_uri,storage:'durable-object-sqlite',d1_requests:0,separate_oauth:true});
    }
    if(request.method==='GET'&&path==='/api/oauth/google/callback')return await this.callback(request);
    if(request.method==='POST'&&(path==='/api/drive-independent/start'||path==='/api/oauth/google/start'&&url.searchParams.get('purpose')==='drive'))return await this.start();
    if(request.method==='GET'&&(path==='/api/drive-independent/status'||path==='/api/drive/status'))return json({connected:!!await this.ctx.storage.get('oauth'),storage:'durable-object-sqlite',d1_requests:0,last_archive:await this.ctx.storage.get('last_archive')||null,last_error:await this.ctx.storage.get('last_error')||null,next_run:await this.ctx.storage.getAlarm(),scope:SCOPE});
    return json({error:'Bulunamadı.'},404);
   }catch(error){return json({error:'Drive bağlantısı tamamlanamadı.',code:error instanceof ProviderError?error.code:'DRIVE_UNAVAILABLE'},400);}
  });
 }
 private async independentSnapshot(){
  const cached=await readIndependentSnapshot(this.ctx.storage);
  const age=cached?Date.now()-Date.parse(cached.captured_at):Infinity;
  if(cached&&cached.format==='independent-sheets-v1'&&age>=0&&age<24*3600000)return {...cached,stale:false};
  try{
   const base=`https://docs.google.com/spreadsheets/d/${DRIVE_SHEET}/gviz/tq?tqx=out:json&headers=1&sheet=`;
   const sheets=await Promise.all(DRIVE_SECTIONS.map(async name=>[name,gvizRows(new TextDecoder().decode(await publicSource(base+encodeURIComponent(name))))] as const));
   const verified=await verifiedDriveRecords(Object.fromEntries(sheets));
   requireValue(verified.record_count>0,'INDEPENDENT_VERIFIED_SOURCE_EMPTY');
   const data=JSON.stringify(verified.records);
   requireValue(new TextEncoder().encode(data).length<=MAX,'INDEPENDENT_SNAPSHOT_TOO_LARGE');
   const source_hash=await sha(new TextEncoder().encode(data));
   const snapshot:IndependentSnapshot={format:'independent-sheets-v1',captured_at:new Date().toISOString(),source:DRIVE_SHEET,records:verified.records,quarantined_records:verified.quarantined_records,source_hash};
   await saveIndependentSnapshot(this.ctx.storage,snapshot);
   return {...snapshot,stale:false};
  }catch(error){
   if(cached&&cached.format==='independent-sheets-v1')return {...cached,stale:true};
   throw error;
  }
 }
 private async independentRoute(request:Request){
  try{
   const url=new URL(request.url),path=url.pathname;
   const snapshot=await this.independentSnapshot();
   const report=independentReport(snapshot.records,url.searchParams.get('month')||undefined,snapshot.captured_at,snapshot.quarantined_records);
   if(request.method==='GET'&&path==='/api/independent/status')return json({ok:true,storage:'durable-object-sqlite',d1_requests:0,source:'verified Google Sheets',captured_at:snapshot.captured_at,source_hash:snapshot.source_hash,records:snapshot.records.length,stale:snapshot.stale,available_months:report.months});
   if(request.method==='GET'&&path==='/api/independent/report')return json({...report,stale:snapshot.stale,source_hash:snapshot.source_hash});
   if(request.method==='POST'&&path==='/api/independent/questions'){
    const body=await request.json() as {question?:unknown;month?:unknown};
    if(typeof body.question!=='string'||body.question.length>1000||body.month!==undefined&&typeof body.month!=='string')return json({code:'INVALID_QUESTION'},400);
    const selected=independentReport(snapshot.records,body.month||undefined,snapshot.captured_at,snapshot.quarantined_records);
    return json({...independentAnswer(selected,body.question),stale:snapshot.stale,source_hash:snapshot.source_hash,captured_at:snapshot.captured_at});
   }
   return json({code:'INDEPENDENT_ROUTE_UNSUPPORTED'},404);
  }catch(error){
   const reason=error instanceof Error?error.message:'INDEPENDENT_SOURCE_UNAVAILABLE';
   const invalid=reason==='INVALID_MONTH'||reason==='INVALID_QUESTION';
   const safeCode=/^(INDEPENDENT_|SOURCE_|SHEETS_|ARCHIVE_RESPONSE_)[A-Z0-9_]+$/.test(reason)?reason:'INDEPENDENT_SOURCE_UNAVAILABLE';
   return json({error:invalid?'İstek geçersiz.':'Doğrulanmış bağımsız Sheets kaynağı henüz okunamıyor. Geçmiş SEO kayıtları korunuyor.',code:invalid?reason:safeCode},invalid?400:503);
  }
 }
 private async staged(pending:Pending,part:Part){
  const data=new Uint8Array(part.size);let offset=0;
  for(let i=0;i<part.chunks;i++){const saved=await this.ctx.storage.get<string>(`stage:${pending.day}:${part.kind}:${i}`);requireValue(saved,'ARCHIVE_STAGE_MISSING');const chunk=unb64((await decrypt<{data:string}>(saved!,this.key())).data);data.set(chunk,offset);offset+=chunk.length;}
  requireValue(offset===part.size&&await sha(data)===part.sha256,'ARCHIVE_STAGE_INTEGRITY');return data;
 }
 private async prepare(time:Date):Promise<Pending>{
  const day=time.toISOString().slice(0,10),base=`https://docs.google.com/spreadsheets/d/${DRIVE_SHEET}`;
  const [xlsx,sheets]=await Promise.all([publicSource(base+'/export?format=xlsx'),Promise.all(DRIVE_SECTIONS.map(async name=>[name,gvizRows(new TextDecoder().decode(await publicSource(base+'/gviz/tq?tqx=out:json&headers=1&sheet='+name)))]))]);
  requireValue(xlsx[0]===80&&xlsx[1]===75&&xlsx[2]===3&&xlsx[3]===4,'ARCHIVE_SOURCE_INVALID');
  const verified=await verifiedDriveRecords(Object.fromEntries(sheets)),source_sha256=await sha(xlsx),captured_at=time.toISOString();
  requireValue(verified.record_count>0,'VERIFIED_SOURCE_RECORDS_REQUIRED');
  const document={format:'mavi-sheets-verified-v1',source:DRIVE_SHEET,captured_at,workbook_sha256:source_sha256,structured_source:'Google Sheets GViz',...verified,note:'JSON ve XLSX aynı aktarım penceresinde ayrı ayrı alınır. Dönem toplamları günlük sayfa/sorgu ayrıntılarının yerine geçmez. Kullanıcı alanları ham XLSX arşivinde de korunur.'};
  const encoded=new TextEncoder().encode(JSON.stringify(document));requireValue(encoded.length<=MAX,'VERIFIED_ARCHIVE_LIMIT');
  const quota=await this.google<any>(API+'about?fields=storageQuota'),limit=Number(quota.storageQuota?.limit),used=Number(quota.storageQuota?.usage);
  requireValue(Number.isSafeInteger(limit)&&Number.isSafeInteger(used)&&used>=0&&used+xlsx.length+encoded.length<=limit,'DRIVE_STORAGE_HEADROOM_REQUIRED');
  const generated=await this.google<{ids?:string[]}>(API+'files/generateIds?count=2&space=drive&type=files');requireValue(generated.ids?.length===2&&generated.ids.every(validId),'DRIVE_FILE_ID_INVALID');
  const pending:Pending={day,captured_at,records:verified.record_count,files:[]};
  for(const [index,content] of [encoded,xlsx].entries()){
   const kind=index===0?'json':'xlsx',part:Part={id:generated.ids![index],kind,mime:index===0?'application/json':XLSX,size:content.length,sha256:await sha(content),chunks:Math.ceil(content.length/CHUNK)};
   for(let i=0;i<part.chunks;i++)await this.ctx.storage.put(`stage:${day}:${kind}:${i}`,await encrypt({data:b64(content.slice(i*CHUNK,(i+1)*CHUNK))},this.key()));
   pending.files.push(part);
  }
  // Reserve both stable IDs BEFORE any Drive write. All invocations share one
  // serialized object; lost upload replies reuse exactly these IDs and bytes.
  await this.ctx.storage.put('pending',pending);return pending;
 }
 private async fileMetadata(id:string){
  try{return await this.google<any>(API+`files/${id}?fields=id,mimeType,trashed,size,appProperties`);}
  catch(error){if(error instanceof ProviderError&&error.code==='GOOGLE_HTTP_404')return null;throw error;}
 }
 private async publishPart(pending:Pending,part:Part){
  let meta=await this.fileMetadata(part.id);
  if(!meta){
   const content=await this.staged(pending,part),boundary='mavi_'+crypto.randomUUID();
   const metadata={id:part.id,name:`MaviBasim-GSC-${part.kind==='json'?'Dogrulanmis':'Sheets'}-${pending.day}.${part.kind}`,mimeType:part.mime,appProperties:{source:DRIVE_SHEET,day:pending.day,kind:part.kind,sha256:part.sha256,records:String(pending.records),captured_at:pending.captured_at}};
   const body=new Blob([`--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(metadata)}\r\n--${boundary}\r\nContent-Type: ${part.mime}\r\n\r\n`,content,`\r\n--${boundary}--\r\n`]);
   try{await this.google('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id',{method:'POST',headers:{'Content-Type':`multipart/related; boundary=${boundary}`},body});}
   catch(error){if(!(error instanceof ProviderError)||error.code!=='GOOGLE_HTTP_409')throw error;}
   meta=await this.fileMetadata(part.id);
  }
  requireValue(meta?.id===part.id&&!meta.trashed&&meta.mimeType===part.mime&&Number(meta.size)===part.size&&meta.appProperties?.source===DRIVE_SHEET&&meta.appProperties?.day===pending.day&&meta.appProperties?.kind===part.kind&&meta.appProperties?.sha256===part.sha256,'DRIVE_FILE_IDENTITY_MISMATCH');
  const read=async(refresh:boolean)=>fetch(API+`files/${part.id}?alt=media`,{headers:{Authorization:'Bearer '+await this.token(refresh)},redirect:'manual',signal:AbortSignal.timeout(25000)});
  let response=await read(false);if(response.status===401){await response.body?.cancel();response=await read(true);}
  const actual=await readBytes(response,part.kind==='xlsx');requireValue(actual.length===part.size&&await sha(actual)===part.sha256,'DRIVE_READBACK_MISMATCH');
  if(part.kind==='json')requireValue(JSON.parse(new TextDecoder().decode(actual)).records?.length===pending.records,'DRIVE_RECORD_COUNT_MISMATCH');
 }
 async archive(time=new Date()){
  requireValue(await this.ctx.storage.get('oauth'),'DRIVE_CONSENT_REQUIRED');const day=time.toISOString().slice(0,10);
  let pending=await this.ctx.storage.get<Pending>('pending');
  if(!pending&&await this.ctx.storage.get('archive:'+day))return {already_archived:true,day};
  pending=pending||await this.prepare(time);
  for(const part of pending.files)await this.publishPart(pending,part);
  const summary:Summary={day:pending.day,checked_at:new Date().toISOString(),status:'ok',files:pending.files.length,records:pending.records,d1_requests:0};
  await this.ctx.storage.transaction(async store=>{await store.put('archive:'+pending!.day,summary);await store.put('last_archive',summary);await store.delete('pending');await store.delete('last_error');});
  // Only temporary encrypted staging chunks are removed after verified readback.
  // Existing Drive archives, source rows and all D1 data remain untouched.
  for(const part of pending.files)for(let i=0;i<part.chunks;i++)await this.ctx.storage.delete(`stage:${pending.day}:${part.kind}:${i}`);
  return summary;
 }
 async alarm(){
  if(this.env.ARCHIVE_ENABLED!=='true')return;
  return this.exclusive(async()=>{
   let next=Date.now()+3600000;
   try{
    const result=await this.archive();console.log(JSON.stringify({event:'independent-drive',...result}));
    const now=new Date();next=Date.now()+86400000;
    if('day' in result&&result.day!==now.toISOString().slice(0,10))next=Date.now()+1000;
   }catch(error){
    const code=error instanceof ProviderError?error.code:error instanceof Error&&/^[A-Z_]+$/.test(error.message)?error.message:'INDEPENDENT_DRIVE_UNAVAILABLE';
    const day=new Date().toISOString().slice(0,10),old=await this.ctx.storage.get<{day:string;attempts:number}>('last_error'),attempts=old?.day===day?old.attempts+1:1;
    await this.ctx.storage.put('last_error',{day,attempts,code});console.log(JSON.stringify({event:'independent-drive',status:'held',code,attempts,d1_requests:0}));
    if(attempts>=3||/^GOOGLE_HTTP_(400|401|403)$|^DRIVE_(API_NOT_ENABLED|PERMISSION_REQUIRED|STORAGE_HEADROOM_REQUIRED)$/.test(code))next=Date.now()+86400000;
   }
   await this.ctx.storage.setAlarm(next);
  });
 }
}

export default {async fetch(request:Request,env:IndependentDriveEnv){
 if(env.ARCHIVE_ENABLED!=='true')return json({error:'Bağımsız arşiv henüz etkin değil.'},503);
 return env.DRIVE_ARCHIVE_STORE.get(env.DRIVE_ARCHIVE_STORE.idFromName('mavi-basim-sheets-drive-v2')).fetch(new Request(request,{redirect:'manual'}));
}};
