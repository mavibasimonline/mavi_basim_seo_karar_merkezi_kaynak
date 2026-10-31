// One-time guarded transfer of existing Google GSC OAuth grant into private SQLite DO.
// D1 is read ONLY for the initial migration; the new collector never reads D1.
import type {Env} from './types';
import {decrypt} from './security';
type E=Env&{DRIVE_ARCHIVE_SERVICE?:Fetcher};
const GSC_READ='https://www.googleapis.com/auth/webmasters.readonly';
const GSC_ALL='https://www.googleapis.com/auth/webmasters';
const read=async(res:Response)=>{
 if(!res.ok)throw Error('GSC_PRIVATE_SERVICE_UNAVAILABLE');
 return res.json() as Promise<Record<string,unknown>>;
};
export async function independentGscCron(env:E,time=new Date()):Promise<'imported'|'collected'|'unavailable'>{
 if(env.AUTOMATION_ENABLED!=='true'||typeof env.DRIVE_ARCHIVE_SERVICE?.fetch!=='function')return 'unavailable';
 const svc=env.DRIVE_ARCHIVE_SERVICE;
 let status=await read(await svc.fetch('https://archive.private/api/internal/gsc-status'));
 if(status.connected!==true){
  // Only attempt migration once per UTC day, not on every 15-minute Cron.
  if(time.getUTCHours()!==0||time.getUTCMinutes()!==15)return 'unavailable';
  if(!env.TOKEN_ENCRYPTION_KEY)return 'unavailable';
  const record=await env.DB.prepare("SELECT encrypted_tokens,scopes FROM oauth_credentials WHERE provider='google' LIMIT 1").first<{encrypted_tokens:string;scopes:string}>();
  if(!record)return 'unavailable';
  const scopes=record.scopes.split(' ');
  if(!scopes.includes(GSC_READ)&&!scopes.includes(GSC_ALL))return 'unavailable';
  const token=await decrypt<{refresh_token?:string}>(record.encrypted_tokens,env.TOKEN_ENCRYPTION_KEY);
  if(typeof token.refresh_token!=='string'||!token.refresh_token)return 'unavailable';
  const imported=await read(await svc.fetch('https://archive.private/api/internal/gsc-import',{
   method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({refresh_token:token.refresh_token,scope:record.scopes})}));
  if(imported.connected!==true||imported.d1_requests!==0)throw Error('GSC_MIGRATION_UNVERIFIED');
  status=imported;
 }
 if(status.connected!==true)return 'unavailable';
 const result=await read(await svc.fetch('https://archive.private/api/internal/gsc-tick',{method:'POST'}));
 if(result.d1_requests!==0||!['partial','complete','idle','held'].includes(String(result.status)))throw Error('GSC_INDEPENDENT_TICK_UNVERIFIED');
 return 'collected';
}
