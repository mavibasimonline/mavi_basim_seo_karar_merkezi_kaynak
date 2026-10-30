// Private verified-result store. There is deliberately NO D1 or Google binding.
import {DurableObject} from 'cloudflare:workers';
import {assertBundle,loadMonthlyBundle,metadataRevision,snapshotReport,snapshotPerformance,MonthlyBundle} from './monthly-model';
import {monthPeriod,ENGINE_VERSION,AnalysisOptions} from './analysis';
import {periodSelection,calendarMonth} from './periods';
import {parseQuestion,answerQuestion,QuestionContext} from './questions';
import {hash} from './types';
export interface MonthlyStoreEnv {MONTHLY_STORE:DurableObjectNamespace;SOURCE:Fetcher;STORE_ENABLED?:string}
const MAX=8_000_000,PART=32000;
const requireValue=(v:unknown,code:string)=>{if(!v)throw Error(code);};
type Doc={parts:number;sha:string;size:number;prefix:string};
export class MonthlySnapshotStore extends DurableObject<MonthlyStoreEnv>{
 private building=false;
 private async encode(name:string,value:unknown){
  const data=new TextEncoder().encode(JSON.stringify(value));requireValue(data.length<=MAX,'SNAPSHOT_DOCUMENT_LIMIT');
  const packed=new Uint8Array(await new Response(new Blob([data]).stream().pipeThrough(new CompressionStream('gzip'))).arrayBuffer());
  const prefix='cache-chunk:'+crypto.randomUUID()+':',parts:Uint8Array[]=[];for(let i=0;i<packed.length;i+=PART)parts.push(packed.slice(i,i+PART));
  return {name,parts,manifest:{parts:parts.length,sha:await hash(new TextDecoder().decode(data)),size:data.length,prefix} satisfies Doc};
 }
 private async read<T>(name:string):Promise<T|null>{
  const m=await this.ctx.storage.get<Doc>('doc:'+name);if(!m)return null;requireValue(m.size<=MAX&&m.parts<1000,'SNAPSHOT_MANIFEST_INVALID');
  const parts:Uint8Array[]=[];for(let i=0;i<m.parts;i++){const part=await this.ctx.storage.get<Uint8Array>(m.prefix+i);requireValue(part,'SNAPSHOT_CHUNK_MISSING');parts.push(part!);}
  const stream=new Blob(parts).stream().pipeThrough(new DecompressionStream('gzip')),reader=stream.getReader(),chunks:Uint8Array[]=[];let size=0;
  try{for(;;){const p=await reader.read();if(p.done)break;size+=p.value.length;requireValue(size<=m.size&&size<=MAX,'SNAPSHOT_DECOMPRESSION_LIMIT');chunks.push(p.value);}}finally{await reader.cancel();}
  const text=await new Response(new Blob(chunks)).text();requireValue(size===m.size&&await hash(text)===m.sha,'SNAPSHOT_HASH_MISMATCH');return JSON.parse(text);
 }
 private async commit(documents:Awaited<ReturnType<MonthlySnapshotStore['encode']>>[]){
  requireValue(this.ctx.storage.sql.databaseSize<256_000_000,'SNAPSHOT_FREE_STORAGE_HEADROOM');
  await this.ctx.storage.transaction(async store=>{
   for(const d of documents){
    const old=await store.get<Doc>('doc:'+d.name);
    for(let i=0;i<d.parts.length;i++)await store.put(d.manifest.prefix+i,d.parts[i]);
    await store.put('doc:'+d.name,d.manifest);
    // Only replaced derived-cache chunks are evicted. Questions and D1 records
    // are never removed, and a failed transaction retains the preceding cache.
    if(old)for(let i=0;i<old.parts;i++)await store.delete(old.prefix+i);
   }
  });
 }
 private info(bundle:MonthlyBundle,report:any){return {...report.snapshot,refresh_pending:!!this.building,source_window:bundle.window,served_at:new Date().toISOString()};}
 private key(month:string,options:AnalysisOptions={}){return 'monthly:'+month+':'+(options.device||'ALL')+':'+JSON.stringify([options.current||null,options.previous||null]);}
 async seed(bundle:MonthlyBundle){
  assertBundle(bundle);requireValue(bundle.evidence.products.length>0&&bundle.evidence.products.length<=200,'SNAPSHOT_PRODUCT_SCOPE');
  const documents=[];
  for(const month of bundle.window.months)for(const device of [null,'MOBILE','DESKTOP','TABLET']){
   const report=snapshotReport(bundle,month,{device}),performance=snapshotPerformance(bundle,report);
   documents.push(await this.encode(this.key(month,{device}),{report,performance,revision:bundle.revision}));
  }
  documents.push(await this.encode('source',bundle));
  await this.commit(documents);
  for(const q of bundle.contexts)if(/^[0-9a-f-]{36}$/i.test(q.id)&&q.context&&!await this.ctx.storage.get('question-context:'+q.id))await this.ctx.storage.put('question-context:'+q.id,q.context);
  await this.ctx.storage.put('ready',{revision:bundle.revision,validated_at:bundle.captured_at,cost:bundle.cost,months:bundle.window.months,engine:ENGINE_VERSION});
  await this.ctx.storage.delete('last_error');return {ok:true,months:bundle.window.months,source_cost:bundle.cost};
 }
 private async source(){const bundle=await this.read<MonthlyBundle>('source');requireValue(bundle,'VERIFIED_MONTHLY_SNAPSHOT_UNAVAILABLE');return bundle!;}
 private async getReport(month:string,options:AnalysisOptions={}){
  monthPeriod(month);requireValue(month>='2020-01'&&month<=calendarMonth(),'INVALID_MONTH');requireValue(!options.device||['MOBILE','DESKTOP','TABLET'].includes(options.device),'INVALID_DEVICE');
  const key=this.key(month,options),cached=await this.read<any>(key);
  if(cached)return cached;
  const bundle=await this.source();
  requireValue((options.current?.start||monthPeriod(month).start)>=bundle.window.start&&(options.current?.end||monthPeriod(month).end)<=bundle.window.end,'VERIFIED_MONTHLY_SCOPE_UNAVAILABLE');
  const report=snapshotReport(bundle,month,options),value={report,performance:snapshotPerformance(bundle,report),revision:bundle.revision};
  await this.commit([await this.encode(key,value)]);return value;
 }
 private async status(){
  const b=await this.source(),scopes=['page','query'].map(scope=>({scope,days:b.evidence.coverage.filter(c=>c.scope===scope&&b.window.months.slice(0,3).includes(c.day.slice(0,7))).length,rows:b.evidence.coverage.filter(c=>c.scope===scope).reduce((n,c)=>n+c.row_count,0)}));
  const expected=b.window.months.slice(0,3).reduce((n,m)=>n+monthPeriod(m).days*2,0),completed=scopes.reduce((n,s)=>n+s.days,0);
  return {...b.flags,google_connected:!!b.evidence.credential,ga4_configured:false,ads_configured:false,health:b.evidence.health,jobs:[],recent_failures:[],recent_sync_runs:[],coverage:[],priority_progress:{start:monthPeriod(b.window.months[0]).start,end:monthPeriod(b.window.months[2]).end,expected_datasets:expected,completed_datasets:completed,complete:expected===completed,scopes},read_budget:{enabled:true,mode:'snapshot',reason:'Doğrulanmış aylık arşiv gösteriliyor; canlı kota durumu bu yanıtta ölçülmedi.'},snapshot:{validated_at:b.captured_at,source_updated_at:b.evidence.coverage.map(c=>c.fetched_at).sort().at(-1)||null,d1_requests:0,historical:true},note:'Kayıtlı doğrulama zamanı esas alınır; arşivde olmayan veri sıfır sayılmaz.'};
 }
 async fetch(request:Request){
  try{
   const url=new URL(request.url),path=url.pathname;
   if(path==='/health'){await this.ctx.storage.get('ready');return Response.json({ok:true,storage:'durable-object-sqlite',d1_requests:0,ready:!!await this.ctx.storage.get('ready')});}
   if(path==='/seed'&&request.method==='POST')return Response.json(await this.seed(await request.json() as MonthlyBundle));
   if(path==='/activate'&&request.method==='POST'){requireValue(this.env.STORE_ENABLED==='true','SNAPSHOT_STORE_DISABLED');await this.ctx.storage.setAlarm(Date.now()+6*3600000);return Response.json({ok:true,alarm:await this.ctx.storage.getAlarm()});}
   if(path==='/refresh-now'&&request.method==='POST'){const background=request.headers.get('X-Snapshot-Background')==='true';try{return Response.json(await this.refresh(background));}catch(e){const code=e instanceof Error&&/^[A-Z0-9_]+$/.test(e.message)?e.message:'SNAPSHOT_REFRESH_UNAVAILABLE';await this.ctx.storage.put('last_error',{at:new Date().toISOString(),code});return Response.json({held:true,code},{status:429});}}
   if(path==='/status')return Response.json(await this.status());
   if(path==='/report'||path==='/performance'||path==='/export'){
    const selected=periodSelection(url.searchParams),options={...selected.options,device:selected.options.device==='ALL'?null:selected.options.device};
    const cached=await this.getReport(selected.month,options);const value=path==='/performance'?cached.performance:cached.report;
    const ready=await this.ctx.storage.get<any>('ready');return Response.json({...value,snapshot:{...value.snapshot,served_at:new Date().toISOString(),refresh_pending:!!await this.ctx.storage.get('last_error'),current_revision:ready?.revision||null}});
   }
   if(path==='/questions'&&request.method==='POST'){
    const body=await request.json() as any;requireValue(typeof body.question==='string'&&body.question.trim().length>0&&body.question.length<=1000,'INVALID_QUESTION');
    let previous:QuestionContext|undefined;if(body.previous_question_id){requireValue(typeof body.previous_question_id==='string'&&/^[0-9a-f-]{36}$/i.test(body.previous_question_id),'INVALID_QUESTION_CONTEXT');previous=await this.ctx.storage.get<QuestionContext>('question-context:'+body.previous_question_id);requireValue(previous,'INVALID_QUESTION_CONTEXT');}
    const bundle=await this.source(),selected=typeof body.month==='string'?body.month:bundle.window.months[2];
    const plan=parseQuestion(body.question,bundle.evidence.products,selected,previous);
    const selection=periodSelection(new URLSearchParams({month:plan.context.month,rangeMonths:String(body.rangeMonths??1),device:String(body.device??'ALL')}));
    if(!plan.context.device&&selection.options.device!=='ALL')plan.context.device=selection.options.device;
    const options:AnalysisOptions={device:plan.context.device,...plan.period?{current:plan.period,previous:plan.previous}:selection.options.current?{current:selection.period,previous:selection.previous}:{}};
    const cached=await this.getReport(plan.context.month,options);
    const answer=await answerQuestion(null,cached.report,body.question,plan,{save:async row=>{
     requireValue(this.ctx.storage.sql.databaseSize<256_000_000,'SNAPSHOT_FREE_STORAGE_HEADROOM');
     row.answer={...row.answer,snapshot:cached.report.snapshot};await this.commit([await this.encode('question-answer:'+row.id,row)]);await this.ctx.storage.put('question-context:'+row.id,row.answer.context);
    }}) as any;
    return Response.json({...answer,snapshot:cached.report.snapshot,limitations:[...answer.limitations,'Yanıt, belirtilen tarihte doğrulanmış geçmiş ölçümlere dayanır; güncel durum veya kesin neden iddiası değildir.']});
   }
   return Response.json({code:'NOT_FOUND'},{status:404});
  }catch(e){const code=e instanceof Error&&/^[A-Z0-9_]+$/.test(e.message)?e.message:'SNAPSHOT_UNAVAILABLE';return Response.json({error:'Doğrulanmış arşiv verisi bu kapsam için hazır değil; eksik veri yerine yanıt üretilmedi.',code},{status:code.startsWith('INVALID_')?400:503});}
 }
 async refresh(background=true){
  if(this.building)throw Error('SNAPSHOT_REFRESH_RUNNING');this.building=true;
  try{
   const fetchPart=async(part:string,month?:string)=>{
    const response=await this.env.SOURCE.fetch('https://monthly-source.internal/?'+new URLSearchParams({part,...month?{month}:{}}),{headers:{'X-Snapshot-Background':String(background)}});
    const data=await response.json<any>();if(!response.ok)throw Error(data.reason||data.code||'SNAPSHOT_SOURCE_UNAVAILABLE');return data;
   };
   const old=await this.ctx.storage.get<any>('ready');
   const header=await fetchPart('header');
   if(old){const {meta,mapping,connection}=header.data;if(old.revision===await metadataRevision(meta,mapping,connection)){await this.ctx.storage.delete('last_error');return {ok:true,unchanged:true,...old};}}
   const result=await this.seed(await loadMonthlyBundle(fetchPart,header));return result;
  }finally{this.building=false;}
 }
 async alarm(){
  if(this.env.STORE_ENABLED!=='true')return;
  try{await this.refresh(true);await this.ctx.storage.delete('last_error');await this.ctx.storage.setAlarm(Date.now()+6*3600000);}
  catch(e){await this.ctx.storage.put('last_error',{at:new Date().toISOString(),code:e instanceof Error&&/^[A-Z0-9_]+$/.test(e.message)?e.message:'SNAPSHOT_REFRESH_UNAVAILABLE'});await this.ctx.storage.setAlarm(Date.now()+3600000);}
 }

}
export default {fetch(request:Request,env:MonthlyStoreEnv){return env.MONTHLY_STORE.get(env.MONTHLY_STORE.idFromName('verified-monthly-seo-v1')).fetch(request);}};
