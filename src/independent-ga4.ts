// Private GA4 OAuth, bounded collection and immutable encrypted reports. No D1.
import {encrypt,decrypt,cookie,equalSecret} from './security';
import {hash,json} from './types';
import {boundedText} from './google';
import {reserveIndependentBytes,GscStorage} from './independent-gsc';
export const GA4_SCOPE='https://www.googleapis.com/auth/analytics.readonly';
const ROOT='ga4:',PAGE=200,CHUNK=36000;
const SOURCE='Google Analytics 4 Data API',METRICS=['activeUsers','sessions','engagedSessions'];
const DIMS={total:[],cities:['country','region','city'],devices:['deviceCategory'],pages:['landingPage']} as const;
type Kind=keyof typeof DIMS;
type Token={access_token:string;refresh_token:string;scope:string;expires_at:number};
type Property={id:string;name:string;time_zone:string;verified_at:string};
type Row={dimensions:string[];activeUsers:number;sessions:number;engagedSessions:number};
type Part={index:number;count:number;bytes:number;chunks:number;sha256:string};
type Job={property:Property;month:string;kind:Kind;from:string;to:string;closed:boolean;generation:string;cursor:number;pages:Part[];completed_at?:string;row_count?:number;thresholded:boolean;other_rows:boolean};
type Manifest=Job&{source:typeof SOURCE;captured_at:string;complete:boolean;d1_requests:0};
type Broker=(path:string,body?:unknown)=>Promise<any>;
function check(ok:unknown,code:string):asserts ok{if(!ok)throw Error(code);}
const count=(n:unknown)=>Number.isSafeInteger(n)&&Number(n)>=0;
const safeCode=(e:unknown)=>e instanceof Error&&/^(GA4_|GSC_STORAGE_)[A-Z0-9_]{1,100}$/.test(e.message)?e.message.replace(/^GSC_STORAGE_/,'GA4_STORAGE_'):'GA4_SOURCE_UNAVAILABLE';
const label=(v:unknown,max=512):v is string=>typeof v==='string'&&v.length<=max&&!/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(v);
const manifestKey=(p:string,m:string,k:Kind)=>ROOT+'report:'+p+':'+m+':'+k;
const partKey=(j:Job,i:number,c:number)=>ROOT+'part:'+j.property.id+':'+j.month+':'+j.kind+':'+j.generation+':'+i+':'+c;
function propertyDate(time:Date,zone:string){return new Intl.DateTimeFormat('sv-SE',{timeZone:zone,year:'numeric',month:'2-digit',day:'2-digit'}).format(time);}
function cutoff(time:Date,zone:string){const d=new Date(propertyDate(time,zone)+'T00:00:00Z');d.setUTCDate(d.getUTCDate()-2);return d.toISOString().slice(0,10);}
function period(month:string,time:Date,zone:string){
 check(/^20\d\d-(0[1-9]|1[0-2])$/.test(month),'GA4_MONTH_INVALID');
 const from=month+'-01',end=new Date(Date.UTC(Number(month.slice(0,4)),Number(month.slice(5)),0)).toISOString().slice(0,10),last=cutoff(time,zone);
 check(from<=last&&Date.parse(from)>=time.getTime()-400*86400000,'GA4_MONTH_OUT_OF_RANGE');
 return {from,to:end<last?end:last,closed:end<=last};
}
function months(time:Date,zone:string){
 const d=new Date(cutoff(time,zone)+'T00:00:00Z');d.setUTCDate(1);
 return Array.from({length:3},(_,i)=>{const x=new Date(d);x.setUTCMonth(x.getUTCMonth()-i);return x.toISOString().slice(0,7);});
}
function ownStream(value:unknown){try{const u=new URL(String(value));return ['http:','https:'].includes(u.protocol)&&!u.username&&!u.password&&!u.port&&['mavibasim.com','www.mavibasim.com'].includes(u.hostname);}catch{return false;}}
export class IndependentGa4 {
 constructor(private store:GscStorage,private secret:string,private broker:Broker,private transport:typeof fetch=fetch){}
 async status(){
  const [token,property,reconnect,last,retry,inspection]=await Promise.all([this.store.get(ROOT+'oauth'),this.store.get<Property>(ROOT+'property'),this.store.get(ROOT+'reconnect'),this.store.get(ROOT+'last'),this.store.get<{until:number;code:string}>(ROOT+'retry'),this.store.get(ROOT+'inspection')]);
  return {connected:!!token,reauthorization_required:!!reconnect,property:property||null,last_attempt:last||null,retry_until:retry&&retry.until>Date.now()?new Date(retry.until).toISOString():null,inspection:inspection||null,source:SOURCE,channel:'Organic Search',hostnames:['mavibasim.com','www.mavibasim.com'],d1_requests:0};
 }
 async start(){
  const info=await this.broker('/config'),time=Date.now();
  const active=(await this.store.get<number[]>(ROOT+'state-times')||[]).filter(t=>t>time-600000);check(active.length<5,'GA4_CONSENT_RATE_LIMIT');
  const state='ga42.'+crypto.randomUUID()+crypto.randomUUID();await this.store.put(ROOT+'state:'+await hash(state),{expires:time+600000,used:false});await this.store.put(ROOT+'state-times',[...active,time]);
  const url=new URL('https://accounts.google.com/o/oauth2/v2/auth');url.search=new URLSearchParams({client_id:info.client_id,redirect_uri:info.redirect_uri,response_type:'code',scope:GA4_SCOPE,access_type:'offline',prompt:'consent',include_granted_scopes:'true',state}).toString();
  return new Response(JSON.stringify({authorization_url:url.href}),{headers:{'Content-Type':'application/json','Cache-Control':'no-store','Set-Cookie':`mavi_ga42_oauth=${state}; HttpOnly; Secure; SameSite=Lax; Path=/api/oauth/google; Max-Age=600`}});
 }
 async callback(request:Request){
  const url=new URL(request.url),state=url.searchParams.get('state')||'',key=ROOT+'state:'+await hash(state),record=await this.store.get<{expires:number;used:boolean}>(key);
  check(state.startsWith('ga42.')&&record&&!record.used&&record.expires>Date.now()&&await equalSecret(state,cookie(request,'mavi_ga42_oauth')||''),'GA4_STATE_INVALID');
  await this.store.put(key,{...record,used:true});
  let outcome='connected';
  if(url.searchParams.has('error'))outcome='denied';
  else{const code=url.searchParams.get('code');check(code&&code.length<=8192,'GA4_CONSENT_DENIED');await this.saveGrant(await this.broker('/exchange-ga4',{code}));await this.prepare();}
  return new Response(null,{status:303,headers:{Location:'/independent-seo.html?ga4='+outcome,'Cache-Control':'no-store','Set-Cookie':'mavi_ga42_oauth=; HttpOnly; Secure; SameSite=Lax; Path=/api/oauth/google; Max-Age=0'}});
 }
 private async saveGrant(reply:any,refresh?:string){
  check(typeof reply.access_token==='string'&&reply.access_token.length>10&&typeof (reply.refresh_token||refresh)==='string'&&(reply.refresh_token||refresh).length>20&&typeof reply.scope==='string'&&reply.scope.split(' ').includes(GA4_SCOPE)&&Number.isFinite(reply.expires_in)&&reply.expires_in>0,'GA4_OFFLINE_CONSENT_REQUIRED');
  const token:Token={access_token:reply.access_token,refresh_token:reply.refresh_token||refresh,scope:reply.scope,expires_at:Date.now()+reply.expires_in*1000};
  await this.store.put(ROOT+'oauth',await encrypt(token,this.secret));await this.store.put(ROOT+'reconnect',false);await this.store.put(ROOT+'retry',null);
 }
 async inspectExisting(){
  if(await this.store.get(ROOT+'oauth'))return {available:true,...await this.status()};
  const previous=await this.store.get<{at:string;code:string}>(ROOT+'inspection');if(previous&&Date.now()-Date.parse(previous.at)<3600000)return {available:false,code:previous.code,d1_requests:0};
  try{
   const sealed=await this.store.get<string>('gsc:oauth');check(sealed,'GA4_PERMISSION_REQUIRED');const gsc=await decrypt<Token>(sealed!,this.secret);
   // A refresh cannot grant a new scope. Google must confirm the already granted
   // readonly Analytics scope; otherwise leave the GSC credential untouched.
   const grant=await this.broker('/refresh-ga4',{refresh_token:gsc.refresh_token});await this.saveGrant(grant,gsc.refresh_token);
   return {available:true,...await this.status()};
  }catch(error){const code=safeCode(error);await this.store.put(ROOT+'inspection',{at:new Date().toISOString(),code});return {available:false,code,d1_requests:0};}
 }
 async prepare(){
  if(!await this.store.get(ROOT+'oauth'))return {available:false,code:'GA4_PERMISSION_REQUIRED',d1_requests:0};
  if(await this.store.get(ROOT+'property'))return {available:true,d1_requests:0};
  const retry=await this.store.get<{until:number;code:string}>(ROOT+'retry');if(retry&&retry.until>Date.now())return {available:false,code:retry.code,d1_requests:0};
  try{const list=await this.properties();if(list.properties.length===1&&!list.truncated){await this.select(list.properties[0].id);return {available:true,d1_requests:0};}
   await this.store.put(ROOT+'retry',{until:Date.now()+3600000,code:'GA4_PROPERTY_SELECTION_REQUIRED'});return {available:false,code:'GA4_PROPERTY_SELECTION_REQUIRED',d1_requests:0};
  }catch(error){const code=safeCode(error);await this.store.put(ROOT+'inspection',{at:new Date().toISOString(),code});await this.store.put(ROOT+'retry',{until:Date.now()+3600000,code});return {available:false,code,d1_requests:0};}
 }
 private async token(force=false){
  const sealed=await this.store.get<string>(ROOT+'oauth');check(sealed,'GA4_PERMISSION_REQUIRED');const t=await decrypt<Token>(sealed!,this.secret);
  if(!force&&t.expires_at>Date.now()+60000)return t.access_token;
  const reply=await this.broker('/refresh-ga4',{refresh_token:t.refresh_token});await this.saveGrant(reply,t.refresh_token);return reply.access_token as string;
 }
 private async api(path:string,body?:unknown){
  const send=async(force:boolean)=>{const transport=this.transport;return transport(path,{method:body===undefined?'GET':'POST',headers:{Authorization:'Bearer '+await this.token(force),'Content-Type':'application/json'},body:body===undefined?undefined:JSON.stringify(body),redirect:'manual',signal:AbortSignal.timeout(25000)});};
  let response=await send(false);if(response.status===401){await response.body?.cancel();response=await send(true);}
  const text=await boundedText(response,1100000);let parsed:any;try{parsed=JSON.parse(text);}catch{throw Error('GA4_RESPONSE_INVALID');}
  if(!response.ok){
   const reasons=(parsed?.error?.details||[]).map((d:any)=>d.reason);
   const code=response.status===429?'GA4_RATE_LIMITED':reasons.includes('SERVICE_DISABLED')?'GA4_API_NOT_ENABLED':reasons.includes('ACCESS_TOKEN_SCOPE_INSUFFICIENT')?'GA4_PERMISSION_REQUIRED':response.status===403?'GA4_PROPERTY_PERMISSION_REQUIRED':'GA4_HTTP_'+response.status;
   if(response.status===429||response.status>=500){const seconds=Number(response.headers.get('Retry-After'));await this.store.put(ROOT+'retry',{until:Date.now()+Math.max(3600000,Math.min(86400000,Number.isFinite(seconds)?seconds*1000:0)),code});}
   if(response.status===401)await this.store.put(ROOT+'reconnect',true);
   throw Error(code);
  }
  return parsed;
 }
 async properties(){
  const data=await this.api('https://analyticsadmin.googleapis.com/v1beta/accountSummaries?pageSize=50');
  const items=(data.accountSummaries||[]).flatMap((a:any)=>(a.propertySummaries||[]).map((p:any)=>({id:String(p.property||'').replace(/^properties\//,''),name:p.displayName||p.property}))).filter((p:any)=>/^\d{1,20}$/.test(p.id)&&label(p.name,256));
  return {properties:items.slice(0,50),truncated:!!data.nextPageToken||items.length>50,d1_requests:0};
 }
 async select(id:unknown){
  check(typeof id==='string'&&/^\d{1,20}$/.test(id),'GA4_PROPERTY_INVALID');
  const [p,streams]=await Promise.all([this.api('https://analyticsadmin.googleapis.com/v1beta/properties/'+id),this.api('https://analyticsadmin.googleapis.com/v1beta/properties/'+id+'/dataStreams?pageSize=200')]);
  check(p.name==='properties/'+id&&label(p.displayName,256)&&typeof p.timeZone==='string'&&(streams.dataStreams||[]).some((s:any)=>ownStream(s.webStreamData?.defaultUri)),'GA4_PROPERTY_SCOPE_UNVERIFIED');
  try{propertyDate(new Date(),p.timeZone);}catch{throw Error('GA4_PROPERTY_TIMEZONE_INVALID');}
  const property:Property={id,name:p.displayName,time_zone:p.timeZone,verified_at:new Date().toISOString()};
  await this.store.put(ROOT+'property',property);await this.store.put(ROOT+'active',null);return {property,d1_requests:0};
 }
 private async write(job:Job,rows:Row[]){
  const raw=JSON.stringify(rows),bytes=new TextEncoder().encode(raw),part:Part={index:job.pages.length,count:rows.length,bytes:bytes.length,chunks:Math.ceil(bytes.length/CHUNK),sha256:await hash(raw)};
  await reserveIndependentBytes(this.store,bytes.length*2+8192,new Date(),'ga4');
  for(let n=0;n<part.chunks;n++)await this.store.put(partKey(job,part.index,n),await encrypt({chunk:btoa(String.fromCharCode(...bytes.subarray(n*CHUNK,(n+1)*CHUNK)))},this.secret));
  const restored=await this.readPart(job,part);check(JSON.stringify(restored)===raw,'GA4_READBACK_REJECTED');return part;
 }
 private async readPart(job:Job,part:Part){
  check(count(part.index)&&count(part.count)&&part.count<=PAGE&&count(part.bytes)&&part.bytes<=400000&&part.chunks===Math.ceil(part.bytes/CHUNK)&&/^[a-f0-9]{64}$/.test(part.sha256),'GA4_MANIFEST_INVALID');
  const bytes=new Uint8Array(part.bytes);let at=0;
  for(let n=0;n<part.chunks;n++){
   const sealed=await this.store.get<string>(partKey(job,part.index,n));check(typeof sealed==='string','GA4_PART_MISSING');const p=await decrypt<{chunk:string}>(sealed!,this.secret),b=Uint8Array.from(atob(p.chunk),c=>c.charCodeAt(0));check(at+b.length<=bytes.length,'GA4_PART_INVALID');bytes.set(b,at);at+=b.length;
  }
  const raw=new TextDecoder('utf-8',{fatal:true,ignoreBOM:false}).decode(bytes);check(at===bytes.length&&await hash(raw)===part.sha256,'GA4_HASH_MISMATCH');const rows=JSON.parse(raw);check(Array.isArray(rows)&&rows.length===part.count,'GA4_ROW_COUNT_INVALID');
  check(rows.every((r:any)=>Array.isArray(r.dimensions)&&r.dimensions.length===DIMS[job.kind].length&&r.dimensions.every((v:unknown)=>label(v))&&count(r.activeUsers)&&count(r.sessions)&&count(r.engagedSessions)&&r.engagedSessions<=r.sessions),'GA4_ROW_INVALID');return rows as Row[];
 }
 async tick(time=new Date()){
  const property=await this.store.get<Property>(ROOT+'property');if(!property||!await this.store.get(ROOT+'oauth'))return {status:'unavailable',code:'GA4_CONNECTION_REQUIRED',d1_requests:0};
  const retry=await this.store.get<{until:number;code:string}>(ROOT+'retry');if(retry&&retry.until>time.getTime())return {status:'held',code:retry.code,d1_requests:0};
  let job=await this.store.get<Job>(ROOT+'active');
  try{
   if(!job){
    select: for(const month of months(time,property.time_zone))for(const kind of ['total','cities','devices','pages'] as Kind[]){
     const range=period(month,time,property.time_zone),old=await this.store.get<Manifest>(manifestKey(property.id,month,kind));
     if(old?.complete&&(old.closed||old.to===range.to))continue;
     job={property,month,kind,...range,generation:crypto.randomUUID(),cursor:0,pages:[],thresholded:false,other_rows:false};break select;
    }
    if(!job)return {status:'idle',d1_requests:0};await this.store.put(ROOT+'active',job);
   }
   if(job.completed_at)return await this.publish(job);
   const result=await this.api('https://analyticsdata.googleapis.com/v1beta/properties/'+job.property.id+':runReport',{
    dateRanges:[{startDate:job.from,endDate:job.to}],dimensions:DIMS[job.kind].map(name=>({name})),metrics:METRICS.map(name=>({name})),
    dimensionFilter:{andGroup:{expressions:[{filter:{fieldName:'sessionDefaultChannelGroup',stringFilter:{matchType:'EXACT',value:'Organic Search'}}},{filter:{fieldName:'hostName',inListFilter:{values:['mavibasim.com','www.mavibasim.com']}}}]}},
    limit:PAGE,offset:job.cursor,returnPropertyQuota:true,keepEmptyRows:false,orderBys:DIMS[job.kind].map(dimensionName=>({dimension:{dimensionName}})),
   });
   check(JSON.stringify((result.dimensionHeaders||[]).map((h:any)=>h.name))===JSON.stringify(DIMS[job.kind])&&JSON.stringify((result.metricHeaders||[]).map((h:any)=>h.name))===JSON.stringify(METRICS),'GA4_HEADERS_INVALID');
   const rowCount=result.rowCount??0;check(count(rowCount)&&rowCount<=4000&&(job.kind!=='total'||rowCount<=1)&&(job.row_count===undefined||job.row_count===rowCount),'GA4_SOURCE_CHANGED_OR_LIMITED');job.row_count=rowCount;
   const rows:Row[]=(result.rows||[]).map((r:any)=>{
    const dimensions=(r.dimensionValues||[]).map((v:any)=>v.value);check(dimensions.length===DIMS[job!.kind].length&&dimensions.every((v:unknown)=>label(v))&&r.metricValues?.length===3,'GA4_ROW_INVALID');
    const values=r.metricValues.map((v:any)=>{check(typeof v.value==='string'&&/^\d+$/.test(v.value)&&count(Number(v.value)),'GA4_METRIC_INVALID');return Number(v.value);});
    check(values[2]<=values[1],'GA4_METRIC_INVALID');return {dimensions,activeUsers:values[0],sessions:values[1],engagedSessions:values[2]};
   });
   check(rows.length<=PAGE&&job.cursor+rows.length<=rowCount,'GA4_ROW_COUNT_INVALID');
   const identities=new Set<string>();
   for(const part of job.pages)for(const row of await this.readPart(job,part))identities.add(JSON.stringify(row.dimensions));
   for(const row of rows){const id=JSON.stringify(row.dimensions);check(!identities.has(id),'GA4_DUPLICATE_ROW');identities.add(id);}
   job.thresholded ||= result.metadata?.subjectToThresholding===true;job.other_rows ||= result.metadata?.dataLossFromOtherRow===true;
   job.pages.push(await this.write(job,rows));job.cursor+=rows.length;
   const quota=result.propertyQuota?.tokensPerHour?.remaining;if(typeof quota==='number'&&quota<64)await this.store.put(ROOT+'retry',{until:time.getTime()+3600000,code:'GA4_QUOTA_LOW'});
   if(job.cursor<rowCount){check(rows.length>0,'GA4_PAGINATION_INVALID');await this.store.put(ROOT+'active',job);const partial={status:'partial',month:job.month,kind:job.kind,cursor:job.cursor,d1_requests:0};await this.store.put(ROOT+'last',{at:time.toISOString(),...partial});return partial;}
   job.completed_at=time.toISOString();await this.store.put(ROOT+'active',job);return await this.publish(job);
  }catch(error){const code=safeCode(error);if(code==='GA4_SOURCE_CHANGED_OR_LIMITED')await this.store.put(ROOT+'active',null);await this.store.put(ROOT+'last',{at:time.toISOString(),status:'held',code});
   const current=await this.store.get<{until:number}>(ROOT+'retry');if(!current||current.until<=time.getTime())await this.store.put(ROOT+'retry',{until:time.getTime()+(code.includes('STORAGE_DAILY')?86400000-(time.getTime()%86400000):3600000),code});
   if(code==='GA4_OAUTH_RECONNECT_REQUIRED'||code==='GA4_PERMISSION_REQUIRED')await this.store.put(ROOT+'reconnect',true);
   return {status:'held',code,d1_requests:0};}
 }
 private async publish(job:Job){
  check(job.completed_at&&job.cursor===job.row_count,'GA4_PUBLICATION_INCOMPLETE');
  const manifest:Manifest={...job,source:SOURCE,captured_at:job.completed_at,complete:true,d1_requests:0};
  const history=ROOT+'history:'+job.property.id+':'+job.month+':'+job.kind+':'+job.generation,old=await this.store.get<Manifest>(history);
  check(!old||JSON.stringify(old)===JSON.stringify(manifest),'GA4_HISTORY_CONFLICT');
  if(!old)await this.store.put(history,manifest);
  check(JSON.stringify(await this.store.get(history))===JSON.stringify(manifest),'GA4_READBACK_REJECTED');
  await this.store.put(manifestKey(job.property.id,job.month,job.kind),manifest);await this.store.put(ROOT+'active',null);
  const done={status:'complete',month:job.month,kind:job.kind,rows:job.cursor,d1_requests:0};await this.store.put(ROOT+'last',{at:job.completed_at,...done});return done;
 }
 async report(month:string){
  check(/^20\d\d-(0[1-9]|1[0-2])$/.test(month),'GA4_MONTH_INVALID');
  const property=await this.store.get<Property>(ROOT+'property');if(!property)return {available:false,connected:!!await this.store.get(ROOT+'oauth'),property:null,month,rows:[],message:'GA4 Google izni ve mavibasim.com web mülkü doğrulaması gerekiyor.',source:SOURCE,d1_requests:0};
  const views:Partial<Record<Kind,{manifest:Manifest;rows:Row[]}>>={};
  for(const kind of ['total','cities','devices','pages'] as Kind[]){
   const m=await this.store.get<Manifest>(manifestKey(property.id,month,kind));if(!m)continue;
   check(m.property.id===property.id&&m.month===month&&m.kind===kind&&m.source===SOURCE&&m.d1_requests===0&&m.complete===true&&count(m.cursor)&&m.cursor<=4000,'GA4_MANIFEST_INVALID');
   const range=period(month,new Date(m.captured_at),m.property.time_zone);check(Number.isFinite(Date.parse(m.captured_at))&&Date.parse(m.captured_at)<=Date.now()+300000&&m.property.time_zone===property.time_zone&&m.from===range.from&&m.to===range.to&&m.closed===range.closed&&Array.isArray(m.pages)&&m.pages.length>0&&m.pages.length<=21&&m.pages.every((p,i)=>p.index===i),'GA4_MANIFEST_INVALID');
   let rows:Row[]=[];const identities=new Set<string>();for(const part of m.pages){const r=await this.readPart(m,part);for(const row of r){const id=JSON.stringify(row.dimensions);check(!identities.has(id),'GA4_DUPLICATE_ROW');identities.add(id);}rows.push(...r);}
   check(rows.length===m.cursor&&m.cursor===m.row_count,'GA4_ROW_COUNT_INVALID');views[kind]={manifest:m,rows};
  }
  const city=views.cities,total=views.total,available=!!city&&city.rows.length>0;
  return {available,connected:!!await this.store.get(ROOT+'oauth'),property,month,source:SOURCE,channel:'Organic Search',hostnames:['mavibasim.com','www.mavibasim.com'],
   from:city?.manifest.from||total?.manifest.from||null,to:city?.manifest.to||total?.manifest.to||null,closed:city?.manifest.closed===true,
   captured_at:city?.manifest.captured_at||null,thresholded:Object.values(views).some(v=>v!.manifest.thresholded),other_rows:Object.values(views).some(v=>v!.manifest.other_rows),
   totals:total?.rows.length===1?total.rows[0]:null,
   cities:(city?.rows||[]).map(r=>({country:r.dimensions[0],region:r.dimensions[1],city:r.dimensions[2],active_users:r.activeUsers,sessions:r.sessions,engaged_sessions:r.engagedSessions})),
   devices:(views.devices?.rows||[]).map(r=>({device:r.dimensions[0],active_users:r.activeUsers,sessions:r.sessions,engaged_sessions:r.engagedSessions})),
   pages:(views.pages?.rows||[]).map(r=>({page:r.dimensions[0],active_users:r.activeUsers,sessions:r.sessions,engaged_sessions:r.engagedSessions})),
   evidence:Object.values(views).map(v=>({source:SOURCE,property:property.id,month,kind:v!.manifest.kind,from:v!.manifest.from,to:v!.manifest.to,timezone:property.time_zone,generation:v!.manifest.generation,captured_at:v!.manifest.captured_at,rows:v!.rows.length,hashes:v!.manifest.pages.map(p=>p.sha256)})),
   message:available?'GA4 organik arama oturumları ve aktif kullanıcılar doğrulandı.':'Bu dönemin şehir kayıtları henüz doğrulanmadı; eksik kayıt sıfır ziyaretçi değildir.',
   limitations:['Aktif kullanıcılar ve şehir/cihaz/sayfa satırları toplanarak benzersiz ziyaretçi toplamı hesaplanmaz.','Şehir, arayanın sorgusu değildir; GA4 oturumu GSC tıklamasıyla eşit sayılmaz.','Gizlilik eşiği ve (not set)/(other) konumlar ayrıca belirtilir.'],d1_requests:0};
 }
}
export function answerGa4(current:any,previous:any,question:string){
 const fold=(s:string)=>s.toLocaleLowerCase('tr-TR').replace(/ı/g,'i').normalize('NFD').replace(/[\u0300-\u036f]/g,'');
 const city=current.cities?.filter((r:any)=>question.toLowerCase().includes(r.city.toLowerCase())||fold(question).includes(fold(r.city)));
 const selected=city?.length?city:[];
 const refs=current.evidence||[],base={requires_ga4:!current.available,source:SOURCE,month:current.month,decision:'Veri bekle',d1_requests:0,evidence:refs.map((r:any)=>'ga4:'+r.property+':'+r.month+':'+r.kind+':'+r.generation),evidence_refs:refs};
 if(!current.available)return {...base,answer:'Kanıt: GA4 şehir verisi doğrulanmadı. Yorum: GSC ülke veya sorgu verisi şehir ziyaretçisi değildir. SEO kararı: Google Analytics bağlantısı ve gerçek şehir kayıtları gelene kadar veri bekle.'};
 if(!selected.length)return {...base,answer:'Kanıt: '+current.month+' için '+current.cities.length+' şehir kırılımı var. Şehir adını belirterek sorun. Yorum: eksik veya gizlenen konum sıfır ziyaretçi değildir. SEO kararı: konumu doğrulamadan yerel içerik değişikliği yapma.'};
 const observations=selected.slice(0,5).map((r:any)=>{
  const old=previous?.available&&previous?.closed&&current.closed?previous.cities.find((p:any)=>p.city===r.city&&p.region===r.region&&p.country===r.country):null;
  return r.city+' / '+r.region+' / '+r.country+': '+r.active_users+' aktif kullanıcı, '+r.sessions+' organik oturum'+(old?' (önceki ay '+old.active_users+' kullanıcı / '+old.sessions+' oturum)':' (aynı filtrede önceki dönem doğrulanmadı)');
 }).join('; ');
 return {...base,evidence_refs:[...refs,...(previous?.evidence||[])],evidence:[...base.evidence,...(previous?.evidence||[]).map((r:any)=>'ga4:'+r.property+':'+r.month+':'+r.kind+':'+r.generation)],answer:'Kanıt: '+current.month+', Organic Search, '+observations+'. Yorum: GA4 ziyaretçi/oturum ölçümüdür; anonim sorgular veya şehirde yapılan anahtar kelimeler çıkarılamaz.'+(current.thresholded?' Gizlilik eşiği uygulanmış olabilir.':'')+' SEO kararı: şehir farkını tek başına içerik veya yönlendirme değişikliğine gerekçe yapma.'};
}
