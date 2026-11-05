// Separate, final Search Analytics property totals; never substitute page/query sums.
import {encrypt,decrypt} from './security';
import type {GscStorage} from './independent-gsc';
const PROPERTY='sc-domain:mavibasim.com',SOURCE='GSC Search Analytics API';
export type PropertyTotal={source:typeof SOURCE;property:typeof PROPERTY;month:string;from:string;to:string;clicks:number;impressions:number;ctr:number;position:number;captured_at:string;response_sha256:string;data_state:'final';dimensions:[];search_type:'web';timezone?:'America/Los_Angeles';device?:'ALL';country?:'ALL'};
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
export async function collectPropertyTotal(storage:GscStorage,secret:string,token:(force:boolean)=>Promise<string>,time=new Date(),fetcher:typeof fetch=fetch,requestedMonth?:string){
 const cutoff=new Date(time.getTime()-3*86400000);cutoff.setUTCDate(1);cutoff.setUTCHours(0,0,0,0);
 const month=requestedMonth||new Date(Date.UTC(cutoff.getUTCFullYear(),cutoff.getUTCMonth()-1,1)).toISOString().slice(0,7);
 if(!validMonth(month)||Date.parse(monthEnd(month)+'T23:59:59Z')>time.getTime()-3*86400000)throw Error('GSC_PROPERTY_MONTH_NOT_FINAL');
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
 if(data.responseAggregationType!=='byProperty'||!Array.isArray(data.rows)||data.rows.length!==1)return {status:'unavailable' as const,month};
 const r=data.rows[0];
 if(![r.clicks,r.impressions,r.ctr,r.position].every(x=>typeof x==='number'&&Number.isFinite(x)&&x>=0))return {status:'unavailable' as const,month};
 const row:PropertyTotal={source:SOURCE,property:PROPERTY,month,from:payload.startDate,to:payload.endDate,clicks:r.clicks!,impressions:r.impressions!,ctr:r.ctr!,position:r.position!,captured_at:time.toISOString(),response_sha256:await digest(raw),data_state:'final',dimensions:[],search_type:'web',timezone:'America/Los_Angeles',device:'ALL',country:'ALL'};
 await storage.put(key(month),await encrypt(row,secret));
 const verified=await readPropertyTotal(storage,secret,month);
 if(!verified||verified.response_sha256!==row.response_sha256)throw Error('GSC_PROPERTY_TOTAL_READBACK_FAILED');
 return {status:'complete' as const,month};
}
type PropertyDay={source:typeof SOURCE;property:typeof PROPERTY;day:string;clicks:number;impressions:number;ctr:number;position:number;captured_at:string;response_sha256:string;data_state:'final';dimensions:['date'];search_type:'web';timezone?:'America/Los_Angeles';device?:'ALL';country?:'ALL'};
export async function readPropertyDays(storage:GscStorage,secret:string,month:string){
 if(!validMonth(month))throw Error('GSC_PROPERTY_MONTH_INVALID');
 const rows:PropertyDay[]=[];
 for(let n=1;n<=Number(monthEnd(month).slice(8));n++){const day=month+'-'+String(n).padStart(2,'0'),cipher=await storage.get<string>('gsc:property-day:v1:'+day);if(!cipher)continue;const row=await decrypt<PropertyDay>(cipher,secret);
  if(row.day!==day||row.source!==SOURCE||row.property!==PROPERTY||row.data_state!=='final'||row.search_type!=='web'||JSON.stringify(row.dimensions)!=='["date"]'||![row.clicks,row.impressions,row.ctr,row.position].every(x=>Number.isFinite(x)&&x>=0))throw Error('GSC_PROPERTY_DAY_INVALID');rows.push(row);
 }
 return {source:SOURCE,month,rows,days_verified:rows.length,expected_days:Number(monthEnd(month).slice(8)),dimensions:['date'],search_type:'web',device:'ALL',country:'ALL',d1_requests:0};
}
export async function collectPropertyHistory(storage:GscStorage,secret:string,token:(force:boolean)=>Promise<string>,time=new Date(),fetcher:typeof fetch=fetch){
 const retry=await storage.get<{until:number}>('gsc:retry');if(retry&&retry.until>time.getTime())return {status:'held',code:'GSC_RETRY_BACKOFF',d1_requests:0};
 const cutoff=new Date(time.getTime()-3*86400000);cutoff.setUTCDate(1);cutoff.setUTCMonth(cutoff.getUTCMonth()-1);
 const months=[...new Set(['2026-06','2026-07','2026-08','2026-09','2026-10',cutoff.toISOString().slice(0,7)])];
 for(const month of months){
  if(Date.parse(monthEnd(month)+'T23:59:59Z')>time.getTime()-3*86400000)continue;
  const total=await readPropertyTotal(storage,secret,month),days=await readPropertyDays(storage,secret,month);
  if(total&&days.days_verified===days.expected_days)continue;
  if(!total){const result=await collectPropertyTotal(storage,secret,token,time,fetcher,month);if(!['complete','stored'].includes(result.status))return {...result,d1_requests:0};}
  if(days.days_verified!==days.expected_days){
   const last=await storage.get<number>('gsc:property-days-attempt:'+month);if(last&&time.getTime()-last<3600000)continue;
   await storage.put('gsc:property-days-attempt:'+month,time.getTime());
   const payload={startDate:month+'-01',endDate:monthEnd(month),dimensions:['date'],type:'web',dataState:'final',aggregationType:'auto',rowLimit:32};
   let response=await fetcher('https://www.googleapis.com/webmasters/v3/sites/'+encodeURIComponent(PROPERTY)+'/searchAnalytics/query',{method:'POST',headers:{Authorization:'Bearer '+await token(false),'Content-Type':'application/json'},body:JSON.stringify(payload),signal:AbortSignal.timeout(15000)});
   if(response.status===401){await response.body?.cancel();response=await fetcher('https://www.googleapis.com/webmasters/v3/sites/'+encodeURIComponent(PROPERTY)+'/searchAnalytics/query',{method:'POST',headers:{Authorization:'Bearer '+await token(true),'Content-Type':'application/json'},body:JSON.stringify(payload),signal:AbortSignal.timeout(15000)});}
   if(!response.ok){const status=response.status;await response.body?.cancel();if(status===429||status>=500)await storage.put('gsc:retry',{until:time.getTime()+3600000});return {status:'held',month,code:'GSC_HTTP_'+status,d1_requests:0};}
   const raw=await response.text();if(raw.length>32000)throw Error('GSC_PROPERTY_DAYS_LIMIT');const data=JSON.parse(raw),seen=new Set<string>(),hash=await digest(raw);
   if(data.responseAggregationType!=='byProperty'||!Array.isArray(data.rows)||data.rows.length>31)throw Error('GSC_PROPERTY_DAYS_INVALID');
   for(const row of data.rows){const day=row.keys?.[0];if(!Array.isArray(row.keys)||row.keys.length!==1||typeof day!=='string'||!/^20\d\d-\d\d-\d\d$/.test(day)||new Date(day).toISOString().slice(0,10)!==day||!day.startsWith(month+'-')||day<month+'-01'||day>monthEnd(month)||seen.has(day)||![row.clicks,row.impressions,row.ctr,row.position].every(x=>typeof x==='number'&&Number.isFinite(x)&&x>=0)||row.impressions<row.clicks||row.ctr>1)throw Error('GSC_PROPERTY_DAYS_INVALID');seen.add(day);
    const record:PropertyDay={source:SOURCE,property:PROPERTY,day,clicks:row.clicks,impressions:row.impressions,ctr:row.ctr,position:row.position,captured_at:time.toISOString(),response_sha256:hash,data_state:'final',dimensions:['date'],search_type:'web',timezone:'America/Los_Angeles',device:'ALL',country:'ALL'};
    const existing=days.rows.find(r=>r.day===day);if(existing){if(existing.clicks!==record.clicks||existing.impressions!==record.impressions){const conflict='gsc:property-day-conflict:'+day+':'+hash;if(!await storage.get(conflict))await storage.put(conflict,await encrypt(record,secret));}continue;}
    await storage.put('gsc:property-day:v1:'+day,await encrypt(record,secret));
   }
  }
  const verified=await readPropertyDays(storage,secret,month);return {status:verified.days_verified===verified.expected_days?'complete':'partial',month,days_verified:verified.days_verified,expected_days:verified.expected_days,d1_requests:0};
 }
 return {status:'idle',complete:true,d1_requests:0};
}
