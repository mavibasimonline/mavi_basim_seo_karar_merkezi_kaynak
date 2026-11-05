// Incremental, metered reads of immutable D1 history; never changes source rows.
import type {Env} from './types';
import {withReadBudget,D1BudgetError} from './d1-read-budget';
type E=Env&{DRIVE_ARCHIVE_SERVICE?:Fetcher};
const BASE='https://archive.private/api/internal/seo-history';
export const HISTORY_EVENTS_SQL=`SELECT rowid AS source_rowid,id,url,previous_snapshot_id,next_snapshot_id,observed_from,observed_to,published_at,publication_evidence,
 (SELECT json_group_array(key) FROM json_each(e.diff_json)) changed_fields_json
 FROM seo_change_events e WHERE rowid>? ORDER BY rowid LIMIT 20`;
export const HISTORY_SNAPSHOTS_SQL=`SELECT rowid AS source_rowid,id,url,observed_at,content_hash,
 json_object('status',json_extract(snapshot_json,'$.status'),'title',json_extract(snapshot_json,'$.title'),
 'description',json_extract(snapshot_json,'$.description'),'headings',json_extract(snapshot_json,'$.headings'),
 'canonical',json_extract(snapshot_json,'$.canonical'),'body_hash',json_extract(snapshot_json,'$.body_hash'),
 'excerpt',json_extract(snapshot_json,'$.excerpt'),'links',json_extract(snapshot_json,'$.links')) fields_json
 FROM seo_snapshots WHERE rowid>? ORDER BY rowid LIMIT 10`;
export async function syncSeoHistory(env:E,trigger='Authenticated maintenance',scheduled_at:string|null=null){
 const service=env.DRIVE_ARCHIVE_SERVICE;
 if(typeof service?.fetch!=='function')return {status:'held',code:'HISTORY_SERVICE_UNAVAILABLE',source_mutations:0};
 const call=async(path:string,body:unknown)=>{
  const r=await service.fetch(BASE+path,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
  if(!r.ok)throw Error('HISTORY_ARCHIVE_UNAVAILABLE');return r.json<any>();
 };
 let claim:any;
 try{
  claim=await call('/claim',{trigger,scheduled_at});
  if(!claim.lease)return {status:claim.status||'held',code:claim.code||null,source_mutations:0};
  const time=new Date();
  const page=await withReadBudget(env,trigger==='Cloudflare Cron'?'cron':'/internal/context-source-read',async safe=>{
   // Both queries seek by the integer primary rowid. Output limits bound input;
   // filters and sorting never cause D1 table scans or OFFSET pagination.
   const events=await safe.DB.prepare(HISTORY_EVENTS_SQL).bind(claim.events_after).all();
   const snapshots=await safe.DB.prepare(HISTORY_SNAPSHOTS_SQL).bind(claim.snapshots_after).all();
   const value={lease:claim.lease,events_after:claim.events_after,snapshots_after:claim.snapshots_after,
    captured_at:time.toISOString(),events:events.results,snapshots:snapshots.results,
    events_caught_up:events.results.length<20,snapshots_caught_up:snapshots.results.length<10};
   if(new TextEncoder().encode(JSON.stringify(value)).length>2_000_000)throw Error('HISTORY_PAGE_TOO_LARGE');
   return value;
  },time);
  const proof=await call('/page',page);
  return {status:proof.caught_up?'caught_up':'partial',events:proof.events,snapshots:proof.snapshots,through:proof.through,
   source_mutations:0,metered_d1:true};
 }catch(error){
  const code=error instanceof D1BudgetError?error.code:error instanceof Error&&/^HISTORY_[A-Z_]+$/.test(error.message)?error.message:'HISTORY_SOURCE_UNAVAILABLE';
  const reason=error instanceof D1BudgetError?error.reason:null;
  if(claim?.lease)try{await call('/held',{lease:claim.lease,code,reason});}catch{/* Existing cursor and records remain intact. */}
  return {status:'held',code,reason,source_mutations:0,metered_d1:true};
 }
}
