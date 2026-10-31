// Named entrypoint is reachable only through an account-owned service binding.
// Uses OAuth client configuration only; never reads tokens, D1 or GSC state.
import {WorkerEntrypoint} from 'cloudflare:workers';
import {json} from './types';
import {requestJSON,boundedText} from './google';
interface BrokerEnv{GOOGLE_CLIENT_ID?:string;GOOGLE_CLIENT_SECRET?:string;GOOGLE_REDIRECT_URI?:string}
const SCOPE='https://www.googleapis.com/auth/drive.file';
const GSC_SCOPE='https://www.googleapis.com/auth/webmasters.readonly';
export class DriveGoogleBroker extends WorkerEntrypoint<BrokerEnv>{
 async fetch(request:Request){
  const path=new URL(request.url).pathname;
  if(!this.env.GOOGLE_CLIENT_ID||!this.env.GOOGLE_CLIENT_SECRET||!this.env.GOOGLE_REDIRECT_URI)return json({code:'DRIVE_OAUTH_CONFIG_REQUIRED'},503);
  if(request.method==='GET'&&path==='/config')return json({client_id:this.env.GOOGLE_CLIENT_ID,redirect_uri:this.env.GOOGLE_REDIRECT_URI});
  if(request.method!=='POST'||!['/exchange','/refresh','/refresh-gsc'].includes(path))return json({code:'NOT_FOUND'},404);
  try{
   const body=JSON.parse(await boundedText(new Response(request.body),16384));
   const value=path==='/exchange'?body.code:body.refresh_token;
   if(typeof value!=='string'||!value||value.length>8192)return json({code:'DRIVE_GRANT_INVALID'},400);
   const parameters:Record<string,string>={client_id:this.env.GOOGLE_CLIENT_ID,client_secret:this.env.GOOGLE_CLIENT_SECRET};
   if(path==='/exchange')Object.assign(parameters,{grant_type:'authorization_code',code:value,redirect_uri:this.env.GOOGLE_REDIRECT_URI});
   else if(path==='/refresh-gsc')Object.assign(parameters,{grant_type:'refresh_token',refresh_token:value});
   else Object.assign(parameters,{grant_type:'refresh_token',refresh_token:value,scope:SCOPE});
   const reply=await requestJSON<any>('https://oauth2.googleapis.com/token',{method:'POST',body:new URLSearchParams(parameters)});
   if(typeof reply.access_token!=='string'||!Number.isFinite(reply.expires_in)||reply.expires_in<=0||reply.scope&&!reply.scope.split(' ').includes(path==='/refresh-gsc'?GSC_SCOPE:SCOPE))return json({code:'DRIVE_GRANT_SCOPE_INVALID'},400);
   return json(reply);
  }catch{return json({code:'DRIVE_PROVIDER_TOKEN_UNAVAILABLE'},503);}
 }
}
export async function independentDriveRoute(request:Request,bindings:unknown){
 const env=bindings as {DRIVE_ARCHIVE_SERVICE?:Fetcher};
 if(typeof env.DRIVE_ARCHIVE_SERVICE?.fetch!=='function')return json({error:'Bağımsız Drive servisi henüz yapılandırılmadı.'},503);
 return env.DRIVE_ARCHIVE_SERVICE.fetch(new Request(request,{redirect:'manual'}));
}
