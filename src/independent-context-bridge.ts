// Bounded background copy of existing product/crawl metadata. GSC collection never waits on this copy.
import type {Env} from './types';
import {withReadBudget} from './d1-read-budget';
import {buildIndependentContext,IndependentContext} from './independent-context';
type E=Env&{DRIVE_ARCHIVE_SERVICE?:Fetcher};
const ENDPOINT='https://archive.private/api/internal/evidence-context';
export const CONTEXT_PRODUCTS_SQL='SELECT id,name,canonical_url,url_verified_at FROM products ORDER BY id LIMIT 101';
// json_each contains at most 100 explicitly verified URLs; each nested lookup
// uses snapshots_url and returns the latest two immutable observations.
export const CONTEXT_SNAPSHOTS_SQL=`SELECT s.id,s.url,s.observed_at,s.content_hash,
 substr(COALESCE(json_extract(s.snapshot_json,'$.title'),''),1,513) title,
 substr(COALESCE(json_extract(s.snapshot_json,'$.headings'),'[]'),1,8193) headings_json,
 json_extract(s.snapshot_json,'$.body_hash') body_hash,json_extract(s.snapshot_json,'$.status') status
 FROM json_each(?) u JOIN seo_snapshots s ON s.rowid IN
 (SELECT rowid FROM seo_snapshots INDEXED BY snapshots_url WHERE url=u.value ORDER BY observed_at DESC LIMIT 2)
 ORDER BY s.url,s.observed_at DESC LIMIT 200`;
const crawlJson=(alias:string)=>`json_object('id',${alias}.id,'url',${alias}.url,'observed_at',${alias}.observed_at,'content_hash',${alias}.content_hash,
 'title',substr(COALESCE(json_extract(${alias}.snapshot_json,'$.title'),''),1,513),
 'headings_json',substr(COALESCE(json_extract(${alias}.snapshot_json,'$.headings'),'[]'),1,8193),
 'body_hash',json_extract(${alias}.snapshot_json,'$.body_hash'),'status',json_extract(${alias}.snapshot_json,'$.status'))`;
// There is no event-date index in the legacy schema. Reverse rowid selection
// bounds input to 101 inserted rows instead of scanning/sorting the whole table.
export const CONTEXT_CHANGES_SQL=`SELECT e.id,e.url,e.previous_snapshot_id,e.next_snapshot_id,e.observed_from,e.observed_to,e.published_at,
 substr(e.publication_evidence,1,2049) publication_evidence,
 substr((SELECT json_group_array(key) FROM json_each(e.diff_json)),1,2049) changed_fields_json,
 ${crawlJson('b')} before_json,${crawlJson('a')} after_json
 FROM seo_change_events e LEFT JOIN seo_snapshots b ON b.id=e.previous_snapshot_id LEFT JOIN seo_snapshots a ON a.id=e.next_snapshot_id
 WHERE e.rowid IN (SELECT rowid FROM seo_change_events ORDER BY rowid DESC LIMIT 101)
 ORDER BY e.rowid DESC LIMIT 101`;

export async function loadIndependentContext(env:Env,time=new Date()):Promise<IndependentContext>{
 return withReadBudget(env,'cron',async safe=>{
  const products=(await safe.DB.prepare(CONTEXT_PRODUCTS_SQL).all<Record<string,unknown>>()).results;
  const urls=products.slice(0,100).filter(p=>typeof p.canonical_url==='string'&&typeof p.url_verified_at==='string').map(p=>p.canonical_url);
  const [snapshots,changes]=await Promise.all([
   safe.DB.prepare(CONTEXT_SNAPSHOTS_SQL).bind(JSON.stringify(urls)).all(),
   safe.DB.prepare(CONTEXT_CHANGES_SQL).all(),
  ]);
  return buildIndependentContext({captured_at:time.toISOString(),products,snapshots:snapshots.results,changes:changes.results},time);
 },time);
}
export async function independentContextCron(env:E,time=new Date()):Promise<'updated'|'idle'|'unavailable'|'held'>{
 if(env.AUTOMATION_ENABLED!=='true'||typeof env.DRIVE_ARCHIVE_SERVICE?.fetch!=='function')return 'unavailable';
 // Existing contexts refresh only at 00:15 UTC. An absent context can retry
 // hourly at :15; status reads and every failure remain isolated from GSC.
 if(time.getUTCMinutes()!==15)return 'idle';
 try{
  const response=await env.DRIVE_ARCHIVE_SERVICE.fetch(ENDPOINT,{method:'GET'});
  if(!response.ok)return 'held';
  const status=await response.json<{available?:unknown;captured_at?:unknown;d1_requests?:unknown}>();
  if(status.d1_requests!==0||typeof status.available!=='boolean')return 'held';
  if(status.available){
   if(typeof status.captured_at!=='string'||!Number.isFinite(Date.parse(status.captured_at))||Date.parse(status.captured_at)>time.getTime()+300000)return 'held';
   if(status.captured_at.slice(0,10)>=time.toISOString().slice(0,10)||time.getUTCHours()!==0)return 'idle';
  }
  const context=await loadIndependentContext(env,time);
  const saved=await env.DRIVE_ARCHIVE_SERVICE.fetch(ENDPOINT,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(context)});
  if(!saved.ok)return 'held';
  const proof=await saved.json<{ok?:unknown;source_hash?:unknown;captured_at?:unknown;d1_requests?:unknown}>();
  if(proof.ok!==true||proof.source_hash!==context.source_hash||proof.captured_at!==context.captured_at||proof.d1_requests!==0)return 'held';
  return 'updated';
 }catch{return 'held';}
}
