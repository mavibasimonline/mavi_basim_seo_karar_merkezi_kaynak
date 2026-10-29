/** Loopback-only CI importer. It never handles production owner/OAuth secrets. */
import {boundedText} from './google';
import {withReadBudget,D1BudgetError} from './d1-read-budget';
import {Env,hash} from './types';
import {equalSecret} from './security';
import {reserveSyncPage,settleSyncPage,writtenRows} from './sync-budget';

export const SHEETS_SOURCE='1uKs8G9hUbmUvU8tqKfnDkZ1PbiVk-JcuJTgGqD3lB-4';
const KIND='sheets-source-evidence';
interface RecoveryRecord {source_key:string;source:string;section:string;family:string;identity:unknown;start:string;end:string;payload:unknown;content_json:string;provenance:{snapshot_sha256:string;retrieved_at:string};daily_page_query_coverage:false;source_filters_verified:false}
function stable(value:unknown):string{return JSON.stringify(value&&typeof value==='object'?Array.isArray(value)?value.map(v=>JSON.parse(stable(v))):Object.fromEntries(Object.entries(value).sort(([a],[b])=>a.localeCompare(b,'en')).map(([k,v])=>[k,JSON.parse(stable(v))])):value);}
export async function validateRecord(record:RecoveryRecord){
 if(!record||record.source!==SHEETS_SOURCE||!/^[a-f0-9]{64}$/.test(record.source_key)||!['GSC_GUNLUK','OZET','URUNLER','SORGULAR'].includes(record.section)||!['site_daily_total','period_total','product_period','query_period'].includes(record.family)||record.daily_page_query_coverage!==false||record.source_filters_verified!==false||!record.provenance||!/^[a-f0-9]{64}$/.test(record.provenance.snapshot_sha256))throw Error('RECOVERY_SOURCE_REJECTED');
 if(typeof record.content_json!=='string'||record.content_json.length>32000||await hash(record.content_json)!==record.source_key)throw Error('RECOVERY_HASH_REJECTED');
 if(new TextEncoder().encode(JSON.stringify(record)).byteLength>16000)throw Error('RECOVERY_RECORD_SIZE_REJECTED');
 const content=JSON.parse(record.content_json) as Record<string,unknown>;
 for(const key of ['source','section','family','start','end'] as const)if(content[key]!==record[key])throw Error('RECOVERY_CONTENT_MISMATCH');
 if(stable(content.payload)!==stable(record.payload)||stable(content.identity)!==stable(record.identity))throw Error('RECOVERY_CONTENT_MISMATCH');
 if(!/^\d{4}-\d{2}-\d{2}$/.test(record.start)||!/^\d{4}-\d{2}-\d{2}$/.test(record.end)||record.start>record.end)throw Error('RECOVERY_PERIOD_REJECTED');
 return record;
}
export async function importEvidence(env:Env,records:RecoveryRecord[],time=new Date()){
 if(!Array.isArray(records)||records.length<1||records.length>90)throw Error('RECOVERY_BATCH_REJECTED');
 await Promise.all(records.map(validateRecord));
 if(new Set(records.map(r=>r.source_key)).size!==records.length)throw Error('RECOVERY_DUPLICATE_BATCH');
 return withReadBudget(env,'cron',async safe=>{
  const placeholders=records.map(()=>'?').join(',');
  const keys=records.map(r=>r.source_key);
  const count=async()=>Number((await safe.DB.prepare(`SELECT count(*) n FROM insight_runs WHERE kind='${KIND}' AND source_key IN (${placeholders})`).bind(...keys).first<{n:number}>())?.n);
  const before=await count();
  if(before===records.length)return {inserted:0,already_present:before,daily_jobs_completed:0};
  if(!await reserveSyncPage(safe,time))return {inserted:0,already_present:before,daily_jobs_completed:0,held:'SYNC_WRITE_BUDGET'};
  const statements:D1PreparedStatement[]=[];
  for(let offset=0;offset<records.length;offset+=15){
   const chunk=records.slice(offset,offset+15);
   statements.push(safe.DB.prepare('INSERT OR IGNORE INTO insight_runs(id,kind,source_key,created_at,result_json) VALUES '+chunk.map(()=>'(?,?,?,?,?)').join(','))
    .bind(...chunk.flatMap(record=>['sheets:'+record.source_key,KIND,record.source_key,time.toISOString(),JSON.stringify(record)])));
  }
  const results=await safe.DB.batch(statements);
  await settleSyncPage(safe,time,writtenRows(results));
  const after=await count();
  if(after!==records.length)throw Error('RECOVERY_PERSISTENCE_REJECTED');
  return {inserted:after-before,already_present:before,daily_jobs_completed:0};
 },time);
}
interface PilotEnv extends Env {RECOVERY_KEY:string}
export default {async fetch(request:Request,env:PilotEnv){
 if(!env.RECOVERY_KEY||!await equalSecret(request.headers.get('Authorization')||'','Bearer '+env.RECOVERY_KEY))return new Response(null,{status:404});
 const url=new URL(request.url);
 if(request.method==='GET'&&url.pathname==='/health')return Response.json({ready:true});
 try{
  if(request.method==='GET'&&url.pathname==='/keys'){
   const after=url.searchParams.get('after')||'';
   if(after&&!/^[a-f0-9]{64}$/.test(after))throw Error('RECOVERY_KEY_REJECTED');
   return Response.json(await withReadBudget(env,'cron',async safe=>(await safe.DB.prepare("SELECT source_key FROM insight_runs WHERE kind=? AND source_key>? ORDER BY source_key LIMIT 500").bind(KIND,after).all()).results));
  }
  if(request.method==='POST'&&url.pathname==='/apply')return Response.json(await importEvidence(env,JSON.parse(await boundedText(new Response(request.body),1_000_000))));
  return new Response(null,{status:404});
 }catch(error){
  if(error instanceof D1BudgetError)return Response.json({held:true,code:error.code,reason:error.reason,inserted:0,daily_jobs_completed:0},{status:429});
  const code=error instanceof Error&&/^RECOVERY_[A-Z_]+$/.test(error.message)?error.message:'RECOVERY_FAILED_NO_RETRY';
  return Response.json({code},{status:503});
 }
}};
