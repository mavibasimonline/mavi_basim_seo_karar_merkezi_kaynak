// Private, once-daily lossless Sheets archive. No R2, GSC imports or data replacement.
import {Env,Fetch,json,nowISO} from './types';
import {accessToken,DRIVE_SCOPE,ProviderError,requestJSON} from './google';
import {withReadBudget,D1BudgetError} from './d1-read-budget';

export const ARCHIVE_SHEET='1uKs8G9hUbmUvU8tqKfnDkZ1PbiVk-JcuJTgGqD3lB-4';
const DRIVE='https://www.googleapis.com/drive/v3/';
const MAX_BYTES=10_000_000;
const MIME='application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
const validId=(id:unknown):id is string=>typeof id==='string'&&/^[A-Za-z0-9_-]{10,200}$/.test(id);
async function digest(bytes:Uint8Array){return [...new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))].map(b=>b.toString(16).padStart(2,'0')).join('');}
async function bytes(response:Response){
 if(!response.body||Number(response.headers.get('content-length'))>MAX_BYTES)throw new ProviderError('ARCHIVE_SOURCE_LIMIT');
 const reader=response.body.getReader(),parts:Uint8Array[]=[];let length=0;
 try{for(;;){const part=await reader.read();if(part.done)break;length+=part.value.length;if(length>MAX_BYTES)throw new ProviderError('ARCHIVE_SOURCE_LIMIT');parts.push(part.value);}}
 finally{await reader.cancel();}
 const result=new Uint8Array(length);let offset=0;for(const part of parts){result.set(part,offset);offset+=part.length;}
 // XLSX is a ZIP container. A Google sign-in/error HTML page is never archived.
 if(length<4||result[0]!==0x50||result[1]!==0x4b||result[2]!==3||result[3]!==4)throw new ProviderError('ARCHIVE_SOURCE_NOT_XLSX');
 return result;
}
async function drive<T>(env:Env,path:string,init:RequestInit,fetcher:Fetch){
 const send=async(refresh:boolean)=>requestJSON<T>(DRIVE+path,{...init,headers:{...init.headers,Authorization:'Bearer '+await accessToken(env,fetcher,refresh,'google-drive')}},fetcher);
 try{return await send(false);}catch(error){if(!(error instanceof ProviderError)||error.code!=='GOOGLE_HTTP_401')throw error;return send(true);}
}
async function source(fetcher:Fetch){
 let url=`https://docs.google.com/spreadsheets/d/${ARCHIVE_SHEET}/export?format=xlsx`;
 for(let i=0;i<4;i++){
  const r=await fetcher(url,{redirect:'manual',signal:AbortSignal.timeout(20_000)});
  if(r.status>=300&&r.status<400){
   const location=r.headers.get('Location');await r.body?.cancel();
   if(!location)throw new ProviderError('ARCHIVE_SOURCE_REDIRECT_REJECTED');
   const next=new URL(location,url);
   if(next.protocol!=='https:'||next.username||next.password||next.port||!(next.hostname==='docs.google.com'||next.hostname.endsWith('.googleusercontent.com')))throw new ProviderError('ARCHIVE_SOURCE_REDIRECT_REJECTED');
   url=next.href;continue;
  }
  if(!r.ok){await r.body?.cancel();throw new ProviderError('ARCHIVE_SOURCE_HTTP_'+r.status);}
  return bytes(r);
 }
 throw new ProviderError('ARCHIVE_SOURCE_REDIRECT_LIMIT');
}
type FileMeta={id?:string;name?:string;trashed?:boolean;size?:string;mimeType?:string;appProperties?:Record<string,string>};
async function metadata(env:Env,id:string,fetcher:Fetch){
 try{return await drive<FileMeta>(env,`files/${id}?fields=id,name,trashed,size,mimeType,appProperties`,{method:'GET'},fetcher);}
 catch(error){if(error instanceof ProviderError&&error.code==='GOOGLE_HTTP_404')return null;throw error;}
}
async function verify(env:Env,id:string,day:string,meta:FileMeta,fetcher:Fetch){
 const props=meta.appProperties;
 if(meta.id!==id||meta.trashed||meta.mimeType!==MIME||props?.source!==ARCHIVE_SHEET||props?.day!==day||!/^[a-f0-9]{64}$/.test(props?.sha256||'')||!/^\d+$/.test(meta.size||'')||Number(meta.size)>MAX_BYTES)throw new ProviderError('DRIVE_ARCHIVE_IDENTITY_MISMATCH');
 let response=await fetcher(DRIVE+`files/${id}?alt=media`,{headers:{Authorization:'Bearer '+await accessToken(env,fetcher,false,'google-drive')},redirect:'manual',signal:AbortSignal.timeout(20_000)});
 if(response.status===401){await response.body?.cancel();response=await fetcher(DRIVE+`files/${id}?alt=media`,{headers:{Authorization:'Bearer '+await accessToken(env,fetcher,true,'google-drive')},redirect:'manual',signal:AbortSignal.timeout(20_000)});}
 if(!response.ok){await response.body?.cancel();throw new ProviderError('DRIVE_VERIFY_HTTP_'+response.status);}
 const content=await bytes(response);
 if(content.length!==Number(meta.size)||await digest(content)!==props!.sha256)throw new ProviderError('DRIVE_ARCHIVE_CHECKSUM_MISMATCH');
}
export async function driveStatus(env:Env){
 const credential=await env.DB.prepare("SELECT scopes FROM oauth_credentials WHERE provider='google-drive'").first<{scopes:string}>();
 const last=await env.DB.prepare("SELECT day,checked_at,status,code FROM health_checks WHERE provider='drive-archive' ORDER BY day DESC LIMIT 1").first();
 return json({connected:!!credential?.scopes.split(' ').includes(DRIVE_SCOPE),scope:DRIVE_SCOPE,source:ARCHIVE_SHEET,last_archive:last,schedule:'Her saat :15 UTC; günde tek dosya. Kota engelinde sonraki uygun çalışmada devam eder.'});
}
export async function archiveDriveDay(env:Env,fetcher:Fetch=fetch,time=new Date()){
 const day=time.toISOString().slice(0,10);
 const connected=await env.DB.prepare("SELECT scopes FROM oauth_credentials WHERE provider='google-drive'").first<{scopes:string}>();
 if(!connected?.scopes.split(' ').includes(DRIVE_SCOPE))return {status:'consent_required'};
 const completed=await env.DB.prepare("SELECT status FROM health_checks WHERE provider='drive-archive' AND day=?").bind(day).first<{status:string}>();
 if(completed?.status==='ok')return {status:'already_archived',day};
 const row=await env.DB.prepare("SELECT code FROM health_checks WHERE provider='drive-archive-file' AND day=?").bind(day).first<{code:string}>();
 if(!row){
  const generated=await drive<{ids?:string[]}>(env,'files/generateIds?count=1&space=drive&type=files',{method:'GET'},fetcher);
  const id=generated.ids?.[0];if(!validId(id))throw new ProviderError('DRIVE_FILE_ID_INVALID');
  // Unique (provider,day) chooses ONE Drive-generated ID even under concurrent
  // executions. Retries reuse it, including after a lost upload response.
  await env.DB.prepare("INSERT OR IGNORE INTO health_checks VALUES('drive-archive-file',?,?,'pending',?)").bind(day,nowISO(),id).run();
 }
 const reserved=await env.DB.prepare("SELECT code FROM health_checks WHERE provider='drive-archive-file' AND day=?").bind(day).first<{code:string}>();
 if(!validId(reserved?.code))throw new ProviderError('DRIVE_FILE_ID_INVALID');
 const id=reserved.code;
 let meta=await metadata(env,id,fetcher);
 if(!meta){
  const content=await source(fetcher),sha256=await digest(content);
  const about=await drive<{storageQuota?:{limit?:string;usage?:string}}>(env,'about?fields=storageQuota',{method:'GET'},fetcher);
  const limit=Number(about.storageQuota?.limit),used=Number(about.storageQuota?.usage);
  if(!Number.isSafeInteger(limit)||!Number.isSafeInteger(used)||used<0||used+content.length>limit)throw new ProviderError('DRIVE_STORAGE_HEADROOM_REQUIRED');
  const boundary='mavi_'+crypto.randomUUID();
  const data={id,name:`MaviBasim-GSC-Sheets-${day}.xlsx`,mimeType:MIME,appProperties:{source:ARCHIVE_SHEET,day,sha256,captured_at:nowISO()}};
  const body=new Blob([`--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(data)}\r\n--${boundary}\r\nContent-Type: ${MIME}\r\n\r\n`,content,`\r\n--${boundary}--\r\n`]);
  // Upload endpoint is fixed; the same reserved ID makes a retry idempotent.
  const send=async(refresh:boolean)=>requestJSON<{id:string}>('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id',{
   method:'POST',headers:{Authorization:'Bearer '+await accessToken(env,fetcher,refresh,'google-drive'),'Content-Type':`multipart/related; boundary=${boundary}`},body},fetcher);
  try{try{await send(false);}catch(error){if(!(error instanceof ProviderError)||error.code!=='GOOGLE_HTTP_401')throw error;await send(true);}}
  catch(error){if(!(error instanceof ProviderError)||error.code!=='GOOGLE_HTTP_409')throw error;}
  meta=await metadata(env,id,fetcher);
  if(!meta)throw new ProviderError('DRIVE_ARCHIVE_NOT_VISIBLE');
 }
 await verify(env,id,day,meta,fetcher);
 await env.DB.prepare("INSERT INTO health_checks VALUES('drive-archive',?,?,'ok','VERIFIED_READBACK') ON CONFLICT(provider,day) DO UPDATE SET checked_at=excluded.checked_at,status=excluded.status,code=excluded.code").bind(day,nowISO()).run();
 return {status:'archived',day};
}
export async function scheduledDriveArchive(env:Env,time:Date,fetcher:Fetch=fetch){
 if(time.getUTCMinutes()!==15)return;
 try{return await withReadBudget(env,'cron',safe=>archiveDriveDay(safe,fetcher,time),time);}
 catch(error){
  // Fail closed. Never write diagnostic rows or retry outside the quota guard.
  const code=error instanceof D1BudgetError?error.reason:error instanceof ProviderError?error.code:'DRIVE_ARCHIVE_UNAVAILABLE';
  console.log(JSON.stringify({event:'drive-archive',status:'held',code}));
  return {status:'held',code};
 }
}
