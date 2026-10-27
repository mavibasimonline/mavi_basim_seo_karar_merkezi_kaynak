// Independent scheduled observer. Never imports the application, OAuth or sync engine.
import {ACCOUNT_READ_STOP,ACCOUNT_WRITE_STOP} from './d1-read-budget';

export const OBSERVER_CRON='2,32 * * * *';
const APP='https://mavi-basim-seo-prod.mavibasimonline.workers.dev/api/health';
const GRAPHQL='https://api.cloudflare.com/client/v4/graphql';
const QUERY=`query D1ReadBudget($accountTag: string, $filter: ZoneWorkersRequestsFilter_InputObject) {
 viewer { accounts(filter:{accountTag:$accountTag}) { d1AnalyticsAdaptiveGroups(limit:10000,filter:$filter) {
 sum { rowsRead rowsWritten } dimensions { datetimeHour } } } } }`;
export interface ObserverEnv {
 DB:D1Database;
 QUOTA_OBSERVER_ENABLED?:string;
 CLOUDFLARE_ACCOUNT_ID?:string;
 CF_QUOTA_ANALYTICS_TOKEN?:string;
}
type Sample={day:string;observed_at:string;data_through:string;valid_until:string;account_reads:number;account_writes:number;mode:'open'|'slow'|'blocked';reason:string};
export const CHECKPOINT_SQL=`INSERT INTO d1_quota_state(day,observed_at,data_through,valid_until,account_reads,account_writes,mode,reason) VALUES(?,?,?,?,?,?,?,?)
 ON CONFLICT(day) DO UPDATE SET observed_at=excluded.observed_at,data_through=excluded.data_through,valid_until=excluded.valid_until,
 account_reads=max(d1_quota_state.account_reads,excluded.account_reads),account_writes=max(d1_quota_state.account_writes,excluded.account_writes),
 mode=CASE WHEN d1_quota_state.mode='blocked' THEN 'blocked' ELSE excluded.mode END,
 reason=CASE WHEN d1_quota_state.mode='blocked' THEN d1_quota_state.reason ELSE excluded.reason END
 WHERE excluded.observed_at>d1_quota_state.observed_at`;

export function parseObservation(value:unknown,now:Date):Sample{
 const v=value as any;
 if(!Number.isFinite(now.getTime())||(v?.errors!==undefined&&(!Array.isArray(v.errors)||v.errors.length!==0))||!Array.isArray(v?.data?.viewer?.accounts)||v.data.viewer.accounts.length!==1)throw Error('ANALYTICS_INVALID');
 const rows=v.data.viewer.accounts[0]?.d1AnalyticsAdaptiveGroups;
 // Only datetimeHour is selected: at most 24 hourly groups in one UTC day.
 if(!Array.isArray(rows)||rows.length===0||rows.length>48)throw Error('ANALYTICS_EMPTY_OR_TRUNCATED');
 const day=now.toISOString().slice(0,10),start=Date.parse(day+'T00:00:00Z');
 let reads=0,writes=0,latest=0;
 const seen=new Set<string>();
 for(const r of rows){
  const read=r?.sum?.rowsRead,write=r?.sum?.rowsWritten,stamp=r?.dimensions?.datetimeHour;
  const at=typeof stamp==='string'&&/(Z|[+]00:00)$/.test(stamp)?Date.parse(stamp):NaN;
  if(!Number.isSafeInteger(read)||read<0||!Number.isSafeInteger(write)||write<0||!Number.isFinite(at)||at<start||at>now.getTime()||seen.has(new Date(at).toISOString()))throw Error('ANALYTICS_INVALID');
  seen.add(new Date(at).toISOString());reads+=read;writes+=write;latest=Math.max(latest,at);
 }
 if(!Number.isSafeInteger(reads)||!Number.isSafeInteger(writes)||now.getTime()-latest>7_200_000)throw Error('ANALYTICS_STALE_OR_INVALID');
 const mode=reads>=ACCOUNT_READ_STOP||writes>=ACCOUNT_WRITE_STOP?'blocked':now.getTime()-latest>4_500_000||reads>=2_000_000?'slow':'open';
 return {day,observed_at:now.toISOString(),data_through:new Date(latest).toISOString(),valid_until:new Date(Math.min(now.getTime()+75*60_000,start+86_400_000)).toISOString(),account_reads:reads,account_writes:writes,mode,
  reason:'Hesap analitiği + mevcut yerel atomik rezervasyon; bağımsız salt okunur gözlemci.'};
}
async function boundedJson(fetcher:typeof fetch,url:string,init:RequestInit,maximum:number){
 const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),8_000);
 let reader:ReadableStreamDefaultReader<Uint8Array>|undefined;
 try{
  const r=await fetcher(url,{...init,redirect:'error',signal:controller.signal});
  if(!r.ok||!r.body)throw Error('UPSTREAM_UNAVAILABLE');
  reader=r.body.getReader();const chunks:Uint8Array[]=[];let size=0;
  for(;;){const part=await reader.read();if(part.done)break;size+=part.value.byteLength;if(size>maximum)throw Error('UPSTREAM_RESPONSE_LIMIT');chunks.push(part.value);}
  const bytes=new Uint8Array(size);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.length;}
  return JSON.parse(new TextDecoder().decode(bytes));
 }finally{clearTimeout(timer);if(reader)await reader.cancel().catch(()=>{});}
}
export async function observeQuota(env:ObserverEnv,fetcher:typeof fetch=fetch,clock:()=>Date=()=>new Date()){
 if(env.QUOTA_OBSERVER_ENABLED!=='true')return {status:'disabled'};
 if(!/^[a-f0-9]{32}$/.test(env.CLOUDFLARE_ACCOUNT_ID||'')||!env.CF_QUOTA_ANALYTICS_TOKEN||/[\r\n]/.test(env.CF_QUOTA_ANALYTICS_TOKEN))return {status:'held',code:'OBSERVER_BINDINGS_REQUIRED'};
 try{
  const start=clock();
  const health=await boundedJson(fetcher,APP,{method:'GET',headers:{'Cache-Control':'no-cache'}},4096);
  const deployment=health?.deployment;
  if(health.ok!==true||deployment?.read_guard_revision!=='d1-account-reads-v1'||!/^[a-f0-9]{40}$/.test(deployment.commit||'')||!/^[a-f0-9-]{36}$/.test(deployment.version_id||''))return {status:'held',code:'LIVE_READ_GUARD_REQUIRED'};
  const response=await boundedJson(fetcher,GRAPHQL,{method:'POST',headers:{Authorization:'Bearer '+env.CF_QUOTA_ANALYTICS_TOKEN,'Content-Type':'application/json'},body:JSON.stringify({query:QUERY,variables:{accountTag:env.CLOUDFLARE_ACCOUNT_ID,filter:{AND:[{datetimeHour_geq:start.toISOString().slice(0,10)+'T00:00:00Z',datetimeHour_leq:start.toISOString()}]}}})},64_000);
  const now=clock();
  if(start.toISOString().slice(0,10)!==now.toISOString().slice(0,10))return {status:'held',code:'UTC_DAY_CHANGED'};
  const state=parseObservation(response,now);
  if(state.mode==='blocked')return {status:'held',code:'ACCOUNT_BUDGET_HOLD'};
  // One primary-key upsert only. No ledger reset, fact reads, retries or work dispatch.
  const r=await env.DB.prepare(CHECKPOINT_SQL).bind(...['day','observed_at','data_through','valid_until','account_reads','account_writes','mode','reason'].map(k=>state[k as keyof Sample])).run();
  if(r.success!==true||!Number.isSafeInteger(r.meta?.rows_read)||!Number.isSafeInteger(r.meta?.rows_written)||r.meta.rows_read>10||r.meta.rows_written>10)throw Error('CHECKPOINT_COST_OR_WRITE_UNVERIFIED');
  return {status:r.meta.changes?'checkpoint_recorded':'newer_checkpoint_preserved',rows_read:r.meta.rows_read,rows_written:r.meta.rows_written};
 }catch{
  // Never log secrets, provider payloads, URLs, query terms or account usage.
  return {status:'held',code:'OBSERVER_UNAVAILABLE_NO_RETRY'};
 }
}
export default {
 async fetch(){return new Response(null,{status:404});},
 async scheduled(event:ScheduledController,env:ObserverEnv,context:ExecutionContext){
  if(event.cron!==OBSERVER_CRON)return;
  const now=Date.now();
  if(!Number.isFinite(event.scheduledTime)||event.scheduledTime>now||now-event.scheduledTime>30*60_000)return;
  context.waitUntil(observeQuota(env).then(result=>{console.log(JSON.stringify({event:'quota-observer',...result}));}));
 },
};
