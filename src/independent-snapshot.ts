// DO values are limited to 128 KiB. Publish the manifest only after chunk readback.
// Content-addressed chunks and old manifests are retained; no D1/archive deletion.
import type {SheetRecord} from './independent-seo-model';
export type IndependentSnapshot={format:'independent-sheets-v1';captured_at:string;source:string;records:SheetRecord[];quarantined_records:number;source_hash:string};
type Manifest=Omit<IndependentSnapshot,'records'|'format'>&{format:'independent-sheets-v2';bytes:number;chunks:number;record_count:number};
const POINTER='independent:snapshot:v2',CHUNK=48_000,MAX=12_000_000;
const digest=async(data:Uint8Array)=>[...new Uint8Array(await crypto.subtle.digest('SHA-256',data))].map(b=>b.toString(16).padStart(2,'0')).join('');
const key=(hash:string,index:number)=>`independent:chunk:${hash}:${index}`;
async function restore(storage:DurableObjectStorage,m:Manifest):Promise<IndependentSnapshot>{
 if(m.format!=='independent-sheets-v2'||!/^[a-f0-9]{64}$/.test(m.source_hash)||!Number.isSafeInteger(m.bytes)||m.bytes<1||m.bytes>MAX||m.chunks!==Math.ceil(m.bytes/CHUNK)||!Number.isSafeInteger(m.record_count)||m.record_count<1||!Number.isFinite(Date.parse(m.captured_at)))throw Error('INDEPENDENT_SNAPSHOT_MANIFEST_INVALID');
 const bytes=new Uint8Array(m.bytes);let offset=0;
 for(let i=0;i<m.chunks;i++){
  const value=await storage.get<string>(key(m.source_hash,i));
  if(typeof value!=='string')throw Error('INDEPENDENT_SNAPSHOT_CHUNK_MISSING');
  const chunk=Uint8Array.from(atob(value),c=>c.charCodeAt(0));
  if(chunk.length!==Math.min(CHUNK,m.bytes-offset))throw Error('INDEPENDENT_SNAPSHOT_CHUNK_INVALID');
  bytes.set(chunk,offset);offset+=chunk.length;
 }
 if(await digest(bytes)!==m.source_hash)throw Error('INDEPENDENT_SNAPSHOT_HASH_MISMATCH');
 const records=JSON.parse(new TextDecoder('utf-8',{fatal:true,ignoreBOM:false}).decode(bytes));
 if(!Array.isArray(records)||records.length!==m.record_count)throw Error('INDEPENDENT_SNAPSHOT_COUNT_MISMATCH');
 return {format:'independent-sheets-v1',captured_at:m.captured_at,source:m.source,records,quarantined_records:m.quarantined_records,source_hash:m.source_hash};
}
export async function readIndependentSnapshot(storage:DurableObjectStorage){
 const manifest=await storage.get<Manifest>(POINTER);
 if(manifest)return restore(storage,manifest);
 // Compatibility only: never delete or rewrite an older single-value snapshot.
 return storage.get<IndependentSnapshot>('independent:snapshot');
}
export async function saveIndependentSnapshot(storage:DurableObjectStorage,snapshot:IndependentSnapshot){
 const bytes=new TextEncoder().encode(JSON.stringify(snapshot.records));
 if(bytes.length>MAX||bytes.length===0)throw Error('INDEPENDENT_SNAPSHOT_TOO_LARGE');
 if(await digest(bytes)!==snapshot.source_hash)throw Error('INDEPENDENT_SNAPSHOT_HASH_MISMATCH');
 const {records,...meta}=snapshot;
 const manifest:Manifest={...meta,format:'independent-sheets-v2',bytes:bytes.length,chunks:Math.ceil(bytes.length/CHUNK),record_count:records.length};
 for(let i=0;i<manifest.chunks;i++)await storage.put(key(manifest.source_hash,i),btoa(String.fromCharCode(...bytes.subarray(i*CHUNK,(i+1)*CHUNK))));
 await restore(storage,manifest);
 await storage.put('independent:history:'+snapshot.source_hash,manifest);
 await storage.put(POINTER,manifest);
 return {bytes:manifest.bytes,chunks:manifest.chunks};
}

/** Restore at most one prior complete month from previously verified immutable manifests.
 * Source hashes and chunk checks are verified by restore(); never infer missing months.
 * Historical manifests are read-only, originals remain untouched. */
export async function withVerifiedPreviousMonth(storage:DurableObjectStorage,current:IndependentSnapshot):Promise<IndependentSnapshot & {previous_source_hash?:string}>{
 const months=[...new Set(current.records.filter(r=>r.section==='OZET'&&r.start.endsWith('-01')
  &&r.start.slice(0,7)===r.end.slice(0,7)
  &&new Date(Date.parse(r.end+'T00:00:00Z')+86400000).getUTCDate()===1).map(r=>r.start.slice(0,7)))].sort();
 if(!months.length)return current;
 const currentMonth=months.at(-1)!;
 const previous=new Date(currentMonth+'-01T00:00:00Z');
 previous.setUTCMonth(previous.getUTCMonth()-1);
 const previousMonth=previous.toISOString().slice(0,7);
 if(months.includes(previousMonth))return current;
 const existing=await storage.list<Manifest>({prefix:'independent:history:',limit:32});
 const manifests=[...existing.values()].filter(m=>m?.format==='independent-sheets-v2'
  &&m.source_hash!==current.source_hash).sort((a,b)=>b.captured_at.localeCompare(a.captured_at));
 for(const manifest of manifests){
  let older:IndependentSnapshot;
  try{older=await restore(storage,manifest);}catch{continue;}
  const overview=older.records.filter(r=>r.section==='OZET'&&r.start.slice(0,7)===previousMonth
    &&r.start===previousMonth+'-01'&&r.end.slice(0,7)===previousMonth
    &&new Date(Date.parse(r.end+'T00:00:00Z')+86400000).getUTCDate()===1);
  if(overview.length!==1)continue;
  const productRows=older.records.filter(r=>r.section==='URUNLER'&&r.start.slice(0,7)===previousMonth);
  if(!productRows.length)continue;
  const historical=older.records.filter(r=>(r.section==='OZET'||r.section==='URUNLER'||r.section==='SORGULAR')
    &&r.start.slice(0,7)===previousMonth);
  return {...current,records:[...current.records,...historical],previous_source_hash:older.source_hash};
 }
 return current;
}
