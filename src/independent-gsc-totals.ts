// Separate, final Search Analytics property totals; never substitute page/query sums.
import {encrypt,decrypt} from './security';
import type {GscStorage} from './independent-gsc';
const PROPERTY='sc-domain:mavibasim.com',SOURCE='GSC Search Analytics API';
export type PropertyTotal={source:typeof SOURCE;property:typeof PROPERTY;month:string;from:string;to:string;clicks:number;impressions:number;ctr:number;position:number;captured_at:string;response_sha256:string;data_state:'final';dimensions:[];search_type:'web'};
const key=(month:string)=>'gsc:property-total:v1:'+month;
const validMonth=(month:string)=>/^20\d{2}-(0[1-9]|1[0-2])$/.test(month);
const monthEnd=(month:string)=>new Date(Date.UTC(Number(month.slice(0,4)),Number(month.slice(5)),0)).toISOString().slice(0,10);
const digest=async(raw:string)=>[...new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(raw)))].map(n=>n.toString(16).padStart(2,'0')).join('');
export async function readPropertyTotal(storage:GscStorage,secret:string,month:string):Promise<PropertyTotal|null>{
 if(!validMonth(month))return null;
 const sealed=await storage.get<string>(key(month));if(!sealed)return null;
 const row=await decrypt<PropertyTotal>(sealed,secret);
 if(row.source!==SOURCE||row.property!==PROPERTY||row.month!==month||row.from!==month+'-01'||row.to!==monthEnd(month)||row.data_state!=='final'||row.search_type!=='web'||!Array.isArray(row.dimensions)||row.dimensions.length!==0
  ||![row.clicks,row.impressions,row.ctr,row.position].every(v=>Number.isFinite(v)&&v>=0)||!/^([a-f0-9]{64})$/.test(row.response_sha256))throw Error('GSC_PROPERTY_TOTAL_INVALID');
 return row;
}
// Called from the existing natural Cron, once per closed month. Failures cannot
// be confused with zero traffic and cannot interrupt daily GSC collection.
export async function collectPropertyTotal(storage:GscStorage,secret:string,token:(force:boolean)=>Promise<string>,time=new Date(),fetcher:typeof fetch=fetch){
 const cutoff=new Date(time.getTime()-3*86400000);cutoff.setUTCDate(1);cutoff.setUTCHours(0,0,0,0);
 const month=new Date(Date.UTC(cutoff.getUTCFullYear(),cutoff.getUTCMonth()-1,1)).toISOString().slice(0,7);
 const existing=await readPropertyTotal(storage,secret,month);if(existing)return {status:'stored' as const,month};
 const retryKey='gsc:property-total:attempt:v1:'+month;
 const last=await storage.get<{at:number}>(retryKey);
 if(last&&Number.isFinite(last.at)&&time.getTime()-last.at<20*3600000)return {status:'held' as const,month};
 await storage.put(retryKey,{at:time.getTime()});
 const payload={startDate:month+'-01',endDate:monthEnd(month),type:'web',dataState:'final',aggregationType:'auto',rowLimit:1};
 const url='https://www.googleapis.com/webmasters/v3/sites/'+encodeURIComponent(PROPERTY)+'/searchAnalytics/query';
 let response:Response|null=null;
 for(let attempt=0;attempt<2;attempt++){
  const access=await token(attempt>0);
  response=await fetcher(url,{method:'POST',headers:{Authorization:'Bearer '+access,'Content-Type':'application/json'},body:JSON.stringify(payload),signal:AbortSignal.timeout(12000)});
  if(response.status===401&&attempt===0){await response.body?.cancel();continue;}
  break;
 }
 if(!response?.ok)return {status:'unavailable' as const,month};
 const raw=await response.text();if(raw.length>15000)return {status:'unavailable' as const,month};
 const data=JSON.parse(raw) as {rows?:Array<{clicks?:number;impressions?:number;ctr?:number;position?:number}>;responseAggregationType?:string};
 if(!Array.isArray(data.rows)||data.rows.length!==1)return {status:'unavailable' as const,month};
 const r=data.rows[0];
 if(![r.clicks,r.impressions,r.ctr,r.position].every(x=>typeof x==='number'&&Number.isFinite(x)&&x>=0))return {status:'unavailable' as const,month};
 const row:PropertyTotal={source:SOURCE,property:PROPERTY,month,from:payload.startDate,to:payload.endDate,clicks:r.clicks!,impressions:r.impressions!,ctr:r.ctr!,position:r.position!,captured_at:time.toISOString(),response_sha256:await digest(raw),data_state:'final',dimensions:[],search_type:'web'};
 await storage.put(key(month),await encrypt(row,secret));
 const verified=await readPropertyTotal(storage,secret,month);
 if(!verified||verified.response_sha256!==row.response_sha256)throw Error('GSC_PROPERTY_TOTAL_READBACK_FAILED');
 return {status:'complete' as const,month};
}
