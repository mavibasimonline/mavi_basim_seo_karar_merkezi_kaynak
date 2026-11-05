// Append-only encrypted history in the existing private DO. No D1 or provider IO.
import {encrypt,decrypt} from './security';
import {stable} from './drive-records';
import {gscPageURL} from './urls';
type Storage={sql?:{readonly databaseSize:number};get<T=unknown>(key:string):Promise<T|undefined>;put(key:string,value:unknown):Promise<unknown>;list<T=unknown>(options:{prefix?:string;start?:string;startAfter?:string;limit?:number;reverse?:boolean;end?:string}):Promise<Map<string,T>>};
export type HistorySnapshot={source_rowid:number;id:string;url:string;observed_at:string;content_hash:string;fields:Record<string,unknown>};
export type HistoryEvent={source_rowid:number;id:string;url:string;previous_snapshot_id:string;next_snapshot_id:string;observed_from:string;observed_to:string;changed_fields:string[];published_at:string|null;publication_evidence:{verified:true;source:string;ref:string}|null};
type State={events_after:number;snapshots_after:number;events:number;snapshots:number;reserved_bytes:number;captured_at:string|null;events_caught_up:boolean;snapshots_caught_up:boolean;earliest:string|null;latest:string|null;last_attempt?:any;last_natural?:any;held?:unknown};
type Ref={id:string;source_rowid:number;url:string;at:string;hash:string;bytes:number;chunks:number;changed_fields?:string[];observed_from?:string};
const P='seo-history:v1:',STATE=P+'state',CHUNK=24000,MAX_BYTES=32*1024*1024;
const fail:(ok:unknown,code?:string)=>asserts ok=(ok,code='HISTORY_RECORD_INVALID')=>{if(!ok)throw Error(code);};
const sha=async(s:string)=>[...new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(s)))].map(n=>n.toString(16).padStart(2,'0')).join('');
const seq=(n:number)=>String(n).padStart(16,'0');
const identity=(v:unknown):string=>{fail(typeof v==='string'&&/^[A-Za-z0-9_-]{1,100}$/.test(v));return v;};
const stamp=(v:unknown):string=>{fail(typeof v==='string'&&Number.isFinite(Date.parse(v)));return new Date(v).toISOString();};
const owned=(v:unknown):string=>{fail(typeof v==='string'&&v.length<=2048&&gscPageURL(v)===v);return v;};
const integer=(v:unknown):number=>{fail(Number.isSafeInteger(v)&&Number(v)>0);return Number(v);};
const parsed=(v:unknown)=>typeof v==='string'?JSON.parse(v):v;
const init=():State=>({events_after:0,snapshots_after:0,events:0,snapshots:0,reserved_bytes:0,captured_at:null,events_caught_up:false,snapshots_caught_up:false,earliest:null,latest:null});
export async function historyStatus(storage:Storage){
 const s=await storage.get<State>(STATE)||init();
 return {...s,available:s.events>0||s.snapshots>0,caught_up:s.events_caught_up&&s.snapshots_caught_up,
  source:'seo_change_events + seo_snapshots',storage:'Encrypted independent history',d1_requests:0,source_mutations:0,
  budget:{reserved_history_bytes:s.reserved_bytes,history_limit_bytes:MAX_BYTES,account_usage_measured:false},
  limitations:['Yalnız kaynakta kayıtlı gözlemler arşivlenir; ilk kayıttan önceki geçmiş bilinmiyor.','Tarama zamanı, kanıtlı CMS/deploy kaydı olmadan yayın tarihi değildir.','İçerik kaydı hash ve kaynakta saklanan özetle sınırlıdır; tam CMS sürümü değildir.']};
}
export async function claimHistory(storage:Storage,input:any){
 const now=Date.now(),s=await storage.get<State>(STATE)||init(),lease=await storage.get<{token:string;until:number}>(P+'lease');
 if(lease&&lease.until>now)return {status:'held',code:'HISTORY_SYNC_BUSY'};
 if(s.events_caught_up&&s.snapshots_caught_up&&s.captured_at&&now-Date.parse(s.captured_at)<14*60000){if(input.trigger==='Cloudflare Cron')await storage.put(STATE,{...s,last_natural:{at:new Date(now).toISOString(),scheduled_at:stamp(input.scheduled_at),trigger:'Cloudflare Cron',status:'idle'}});return {status:'idle',code:null};}
 const token=crypto.randomUUID(),attempt={at:new Date(now).toISOString(),trigger:input.trigger==='Cloudflare Cron'?'Cloudflare Cron':'Authenticated maintenance',scheduled_at:input.trigger==='Cloudflare Cron'?stamp(input.scheduled_at):null};
 await storage.put(P+'lease',{token,until:now+90000});
 await storage.put(STATE,{...s,last_attempt:attempt,...(attempt.trigger==='Cloudflare Cron'?{last_natural:attempt}:{})});
 return {lease:token,events_after:s.events_after,snapshots_after:s.snapshots_after,status:'ready'};
}
function snapshot(raw:any):HistorySnapshot{
 const fields=parsed(raw.fields_json??raw.fields);fail(fields&&typeof fields==='object'&&!Array.isArray(fields));
 fail(typeof raw.content_hash==='string'&&/^[a-f0-9]{64}$/.test(raw.content_hash));
 return {source_rowid:integer(raw.source_rowid),id:identity(raw.id),url:owned(raw.url),observed_at:stamp(raw.observed_at),content_hash:raw.content_hash,fields};
}
function event(raw:any):HistoryEvent{
 const fields=parsed(raw.changed_fields_json??raw.changed_fields);fail(Array.isArray(fields)&&fields.length<=64&&fields.every(f=>typeof f==='string'&&f.length<=100));
 const from=stamp(raw.observed_from),to=stamp(raw.observed_to);fail(from<=to);
 let published_at:string|null=null,publication_evidence:HistoryEvent['publication_evidence']=null;
 try{const p=parsed(raw.publication_evidence);if(p?.verified===true&&['cms_log','deploy_log'].includes(p.source)&&typeof p.ref==='string'&&p.ref.length>0&&p.ref.length<=2048&&raw.published_at){published_at=stamp(raw.published_at);publication_evidence={verified:true,source:p.source,ref:p.ref};}}catch{/* Unverified publication claims are never promoted. */}
 return {source_rowid:integer(raw.source_rowid),id:identity(raw.id),url:owned(raw.url),previous_snapshot_id:identity(raw.previous_snapshot_id),next_snapshot_id:identity(raw.next_snapshot_id),observed_from:from,observed_to:to,changed_fields:fields,published_at,publication_evidence};
}
async function record(storage:Storage,secret:string,kind:'event'|'snapshot',row:HistoryEvent|HistorySnapshot){
 const raw=stable(row),bytes=new TextEncoder().encode(raw);fail(bytes.length<=1_500_000,'HISTORY_RECORD_TOO_LARGE');
 const digest=await sha(raw),key=P+kind+':record:'+seq(row.source_rowid),existing=await storage.get<Ref>(key);
 if(existing){fail(existing.hash===digest&&existing.id===row.id,'HISTORY_SOURCE_CONFLICT');fail(stable(await restore(storage,secret,existing))===raw,'HISTORY_READBACK_FAILED');const suffix=existing.at+':'+seq(existing.source_rowid);await storage.put(P+kind+':id:'+row.id,existing);await storage.put(P+kind+':index:all:'+suffix,existing);await storage.put(P+kind+':index:url:'+await sha(row.url)+':'+suffix,existing);return {ref:existing,added:false,cost:0};}
 const ref:Ref={id:row.id,source_rowid:row.source_rowid,url:row.url,at:'observed_to'in row?row.observed_to:row.observed_at,hash:digest,bytes:bytes.length,chunks:Math.ceil(bytes.length/CHUNK),...('changed_fields'in row?{changed_fields:row.changed_fields,observed_from:row.observed_from}:{})};
 const pieces=[];let cost=JSON.stringify(ref).length*6+2048;
 for(let i=0;i<ref.chunks;i++){const sealed=await encrypt({data:btoa(String.fromCharCode(...bytes.subarray(i*CHUNK,(i+1)*CHUNK)))},secret);pieces.push(sealed);cost+=sealed.length*2;}
 const s=await storage.get<State>(STATE)||init();fail(s.reserved_bytes+cost<=MAX_BYTES,'HISTORY_STORAGE_BUDGET_WAIT');
 if(storage.sql)fail(Number.isFinite(storage.sql.databaseSize)&&storage.sql.databaseSize+cost<=224*1024*1024,'HISTORY_GSC_STORAGE_HEADROOM');
 // Reserve before writes. Interrupted pages may overcount storage, never undercount it.
 await storage.put(STATE,{...s,reserved_bytes:s.reserved_bytes+cost});
 for(let i=0;i<pieces.length;i++)await storage.put(P+'part:'+digest+':'+i,pieces[i]);
 await storage.put(key,ref);await storage.put(P+kind+':id:'+row.id,ref);
 const suffix=ref.at+':'+seq(ref.source_rowid);
 await storage.put(P+kind+':index:all:'+suffix,ref);await storage.put(P+kind+':index:url:'+await sha(row.url)+':'+suffix,ref);
 fail(stable(await restore(storage,secret,ref))===raw,'HISTORY_READBACK_FAILED');
 return {ref,added:true,cost};
}
async function restore(storage:Storage,secret:string,ref:Ref){
 fail(ref&&ref.bytes>0&&ref.bytes<=1_500_000&&ref.chunks===Math.ceil(ref.bytes/CHUNK),'HISTORY_MANIFEST_INVALID');
 const bytes=new Uint8Array(ref.bytes);let offset=0;
 for(let i=0;i<ref.chunks;i++){const sealed=await storage.get<string>(P+'part:'+ref.hash+':'+i);fail(typeof sealed==='string','HISTORY_PART_MISSING');const value=await decrypt<{data:string}>(sealed,secret),part=Uint8Array.from(atob(value.data),c=>c.charCodeAt(0));fail(part.length===Math.min(CHUNK,ref.bytes-offset),'HISTORY_MANIFEST_INVALID');bytes.set(part,offset);offset+=part.length;}
 const raw=new TextDecoder('utf-8',{fatal:true,ignoreBOM:false}).decode(bytes);fail(await sha(raw)===ref.hash,'HISTORY_HASH_MISMATCH');return JSON.parse(raw);
}
export async function saveHistoryPage(storage:Storage,secret:string,input:any){
 const lease=await storage.get<{token:string;until:number}>(P+'lease'),s=await storage.get<State>(STATE)||init();
 fail(lease?.token===input.lease&&lease!.until>=Date.now()&&input.events_after===s.events_after&&input.snapshots_after===s.snapshots_after,'HISTORY_LEASE_INVALID');
 fail(Array.isArray(input.events)&&input.events.length<=20&&Array.isArray(input.snapshots)&&input.snapshots.length<=10);
 const captured=stamp(input.captured_at);fail(Date.parse(captured)<=Date.now()+300000);
 const events=input.events.map(event) as HistoryEvent[],snapshots=input.snapshots.map(snapshot) as HistorySnapshot[];
 for(const [rows,after]of [[events,s.events_after],[snapshots,s.snapshots_after]] as const){let last=after;for(const row of rows){fail(row.source_rowid>last);last=row.source_rowid;}}
 fail(input.events_caught_up===(events.length<20)&&input.snapshots_caught_up===(snapshots.length<10));
 for(const row of snapshots)await record(storage,secret,'snapshot',row);
 for(const row of events)await record(storage,secret,'event',row);
 const reserved=(await storage.get<State>(STATE))!.reserved_bytes;
 const times=[...events.map(e=>e.observed_from),...snapshots.map(e=>e.observed_at),...(s.earliest?[s.earliest]:[])].sort();
 const latest=[...events.map(e=>e.observed_to),...snapshots.map(e=>e.observed_at),...(s.latest?[s.latest]:[])].sort().at(-1)||null;
 const next:State={...s,events_after:events.at(-1)?.source_rowid||s.events_after,snapshots_after:snapshots.at(-1)?.source_rowid||s.snapshots_after,events:s.events+events.length,snapshots:s.snapshots+snapshots.length,reserved_bytes:reserved,captured_at:captured,events_caught_up:input.events_caught_up,snapshots_caught_up:input.snapshots_caught_up,...(s.last_attempt?.trigger==='Cloudflare Cron'?{last_natural:{...s.last_natural,status:'saved',events_copied:events.length,snapshots_copied:snapshots.length}}:{}),earliest:times[0]||null,latest,held:null};
 await storage.put(STATE,next);await storage.put(P+'lease',{token:'',until:0});
 return {ok:true,caught_up:next.events_caught_up&&next.snapshots_caught_up,events:next.events,snapshots:next.snapshots,through:{events:next.events_after,snapshots:next.snapshots_after},d1_requests:0};
}
export async function holdHistory(storage:Storage,input:any){
 const lease=await storage.get<{token:string}>(P+'lease');fail(lease?.token===input.lease,'HISTORY_LEASE_INVALID');
 const s=await storage.get<State>(STATE)||init(),code=typeof input.code==='string'&&/^[A-Z_]{1,100}$/.test(input.code)?input.code:'HISTORY_SOURCE_UNAVAILABLE',reason=typeof input.reason==='string'&&/^[A-Z_]{1,100}$/.test(input.reason)?input.reason:null;
 await storage.put(STATE,{...s,held:{at:new Date().toISOString(),code,reason}});await storage.put(P+'lease',{token:'',until:0});return {ok:true,d1_requests:0};
}
export type HistoryFilters={kind?:string;url?:string;urls?:string[];from?:string;to?:string;type?:string;cursor?:string};
export async function listHistory(storage:Storage,secret:string,filters:HistoryFilters={}){
 fail(!filters.kind||['event','snapshot'].includes(filters.kind),'HISTORY_FILTER_INVALID');
 const kind=filters.kind==='snapshot'?'snapshot':'event',url=filters.url?owned(filters.url):null;
 const validDay=(s:string|undefined)=>{if(!s)return null;fail(/^20\d\d-\d\d-\d\d$/.test(s)&&new Date(s).toISOString().slice(0,10)===s,'HISTORY_FILTER_INVALID');return s;};
 const from=validDay(filters.from),to=validDay(filters.to),fromStamp=from?new Date(from+'T00:00:00+03:00').toISOString():null,toStamp=to?new Date(to+'T23:59:59.999+03:00').toISOString():null;fail(!from||!to||from<=to,'HISTORY_FILTER_INVALID');
 fail(!filters.type||/^[a-z_]{1,100}$/.test(filters.type),'HISTORY_FILTER_INVALID');
 const urls=filters.urls?new Set(filters.urls.map(owned)):null;fail(!urls||urls.size<=200);
 const prefix=P+kind+':index:'+(url?'url:'+await sha(url)+':':'all:'),scope=await sha(stable({kind,url,urls:urls?[...urls].sort():null,from,to,type:filters.type||null}));
 const status=await historyStatus(storage),high=kind==='event'?status.events_after:status.snapshots_after;
 let after='',watermark=high;
 if(filters.cursor){fail(filters.cursor.length<=2048,'HISTORY_CURSOR_INVALID');const c=await decrypt<any>(filters.cursor,secret);fail(c.scope===scope&&typeof c.after==='string'&&c.after.startsWith(prefix)&&Number.isSafeInteger(c.high)&&c.high<=high,'HISTORY_CURSOR_INVALID');after=c.after;watermark=c.high;}
 const rows=await storage.list<Ref>({prefix,...(after?{end:after}:{}),limit:80,reverse:true});
 const items:any[]=[];let last='',scanned=0;
 for(const [key,ref]of rows){last=key;scanned++;if(ref.source_rowid>watermark)continue;
  if((url&&ref.url!==url)||(urls&&!urls.has(ref.url))||(fromStamp&&ref.at<fromStamp)||(toStamp&&(kind==='event'?ref.observed_from||ref.at:ref.at)>toStamp)||(filters.type&&kind==='event'&&!ref.changed_fields?.includes(filters.type)))continue;
  const value=kind==='event'?await restore(storage,secret,ref):{id:ref.id,url:ref.url,source_rowid:ref.source_rowid,observed_at:ref.at};
  items.push({...value,record_hash:ref.hash,archive_ref:kind+':'+seq(ref.source_rowid)});if(items.length===20)break;
 }
 const more=!!last&&(scanned<rows.size||rows.size===80),next_cursor=more?await encrypt({scope,after:last,high:watermark},secret):null;
 return {source:status.source,items,next_cursor,scanned,filters:{kind,url,from,to,type:filters.type||null},coverage:status,captured_at:status.captured_at,d1_requests:0,
  message:!items.length?(status.caught_up?'Bu sayfada filtreye uyan kayıt yok; kayıtsız dönem değişiklik yapılmadığını kanıtlamaz.':'Veri bekle: kaynak geçmişinin aktarımı tamamlanmadı; kayıtsız dönem sıfır değildir.'):'Yalnız doğrulanmış arşiv kayıtları. Tarama aralığı yayın tarihi değildir.'};
}
export async function historyDetail(storage:Storage,secret:string,kind:string,id:string){
 fail(kind==='event'||kind==='snapshot','HISTORY_FILTER_INVALID');identity(id);
 const ref=await storage.get<Ref>(P+kind+':id:'+id);if(!ref)return null;
 const value=await restore(storage,secret,ref);
 if(kind==='snapshot')return {...value,record_hash:ref.hash,source:'seo_snapshots',d1_requests:0};
 const load=async(id:string)=>{const r=await storage.get<Ref>(P+'snapshot:id:'+id);return r?{...await restore(storage,secret,r),record_hash:r.hash}:null;};
 const before=await load(value.previous_snapshot_id),after=await load(value.next_snapshot_id);
 if(before)fail(before.url===value.url&&before.observed_at===value.observed_from,'HISTORY_REFERENCE_INVALID');
 if(after)fail(after.url===value.url&&after.observed_at===value.observed_to,'HISTORY_REFERENCE_INVALID');
 const diffs=before&&after?Object.fromEntries(['title','description','canonical','headings','body_hash','excerpt','links','status'].map(field=>[field,{old:before.fields[field]??null,new:after.fields[field]??null,recorded_changed:value.changed_fields.includes(field)}])):{};
 return {...value,before,after,diffs,details_available:!!before&&!!after,content_comparable:before?.fields.status===200&&after?.fields.status===200,record_hash:ref.hash,source:'seo_change_events + seo_snapshots',d1_requests:0,content_limit:'İçerik hash ve kaynakta saklanan özetle sınırlıdır; tam CMS metni veya gerçek yayın tarihi varsayılmaz.'};
}
