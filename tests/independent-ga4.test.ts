import {it,expect,vi} from 'vitest';
import {IndependentGa4,GA4_SCOPE,answerGa4,ownStream} from '../src/independent-ga4';
import {encrypt} from '../src/security';
const KEY='AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=';
function fixture(){
 const values=new Map<string,unknown>();
 const store={get:async<T>(key:string)=>structuredClone(values.get(key)) as T|undefined,put:async(key:string,value:unknown)=>{values.set(key,structuredClone(value));}} as any;
 const broker=vi.fn(async(path:string)=>path==='/config'?{client_id:'fixture-client',redirect_uri:'https://app.example/api/oauth/google/callback'}:{access_token:'fixture-analytics-access-token',refresh_token:'fixture-analytics-refresh-token',scope:GA4_SCOPE,expires_in:3600});
 return {values,store,broker};
}
async function authorize(f:ReturnType<typeof fixture>,ga4:IndependentGa4){
 const start=await ga4.start(),state=new URL((await start.json<any>()).authorization_url).searchParams.get('state');
 const request=new Request('https://app.example/api/oauth/google/callback?state='+state+'&code=fixture',{headers:{Cookie:start.headers.get('Set-Cookie')!}});
 return {request,start,response:await ga4.callback(request)};
}
function provider(){return vi.fn(async(url:RequestInfo|URL,init?:RequestInit)=>{
 if(String(url).endsWith('/accountSummaries?pageSize=50'))return Response.json({accountSummaries:[{propertySummaries:[{property:'properties/123',displayName:'Mavi Basım'}]}]});
 if(String(url).endsWith('/dataStreams?pageSize=200'))return Response.json({dataStreams:[{webStreamData:{defaultUri:'mavibasim.com'}}]});
 if(String(url).endsWith('/properties/123'))return Response.json({name:'properties/123',displayName:'Mavi Basım',timeZone:'Europe/Istanbul'});
 const body=JSON.parse(String(init?.body)),dims=body.dimensions.map((d:any)=>d.name);
 const values=dims.length===3?['Türkiye','İstanbul','İstanbul']:dims[0]==='deviceCategory'?['mobile']:dims[0]==='landingPage'?['/brosur']:[];
 return Response.json({dimensionHeaders:dims.map((name:string)=>({name})),metricHeaders:['activeUsers','sessions','engagedSessions'].map(name=>({name})),rowCount:1,rows:[{dimensionValues:values.map(value=>({value})),metricValues:['10','12','8'].map(value=>({value}))}],metadata:{subjectToThresholding:true}});
 });}
it('requires cookie-bound, one-use Analytics consent and never replaces the GSC grant',async()=>{
 const f=fixture(),transport=provider(),ga4=new IndependentGa4(f.store,KEY,f.broker,transport as typeof fetch);
 f.values.set('gsc:oauth','existing encrypted GSC');
 const start=await ga4.start(),url=new URL((await start.json<any>()).authorization_url),state=url.searchParams.get('state');
 expect(url.searchParams.get('scope')).toBe(GA4_SCOPE);expect(start.headers.get('Set-Cookie')).toContain('HttpOnly; Secure; SameSite=Lax');
 const callback=new Request('https://app.example/api/oauth/google/callback?state='+state+'&code=fixture');
 await expect(ga4.callback(callback)).rejects.toThrow('GA4_STATE_INVALID');
 const valid=new Request(callback,{headers:{Cookie:start.headers.get('Set-Cookie')!}});
 expect((await ga4.callback(valid)).status).toBe(303);await expect(ga4.callback(valid)).rejects.toThrow('GA4_STATE_INVALID');
 expect(f.values.get('gsc:oauth')).toBe('existing encrypted GSC');expect(f.values.get('ga4:oauth')).not.toContain('fixture-analytics-refresh-token');
 expect((await ga4.status()).property?.id).toBe('123');
 expect((await ga4.status()).property?.web_stream).toMatchObject({origin:'https://mavibasim.com',address_format:'scheme-less',source:'Google Analytics Admin API'});
});
it('does not pretend the existing GSC-only permission includes Analytics',async()=>{
 const f=fixture();f.values.set('gsc:oauth',await encrypt({refresh_token:'existing-gsc-refresh-token'},KEY));const original=f.values.get('gsc:oauth');
 f.broker.mockImplementation(async()=>{throw Error('GA4_PERMISSION_REQUIRED');});const transport=vi.fn();const ga4=new IndependentGa4(f.store,KEY,f.broker,transport);
 expect(await ga4.inspectExisting()).toMatchObject({available:false,code:'GA4_PERMISSION_REQUIRED',d1_requests:0});
 expect(await ga4.inspectExisting()).toMatchObject({available:false});expect(f.broker).toHaveBeenCalledTimes(1);expect(transport).not.toHaveBeenCalled();
 expect(f.values.get('gsc:oauth')).toBe(original);expect((await ga4.report('2026-10')).available).toBe(false);
});
it('rejects a different site property without writing a selected property',async()=>{
 for(const uri of ['mavibasim.com','www.mavibasim.com/','https://mavibasim.com/','HTTP://WWW.MAVIBASIM.COM/path'])expect(ownStream(uri)?.hostname).toMatch(/^(www\.)?mavibasim\.com$/);
 for(const uri of ['other.example','https://mavibasim.com.evil.example','https://evil.example/mavibasim.com','https://evil.example@mavibasim.com','mavibasim.com@evil.example','//mavibasim.com','https:mavibasim.com','https://mavibasim.com:444','mavibasim.com:443','https://mavibasim.com\\@evil.example',' mavibasim.com','mavibasim.com\n','javascript:alert(1)','ｍavibasim.com'])expect(ownStream(uri)).toBeNull();
 const f=fixture();f.values.set('ga4:oauth',await encrypt({access_token:'fixture-access-token',refresh_token:'fixture-refresh-token',scope:GA4_SCOPE,expires_at:Date.now()+3600000},KEY));
 const ga4=new IndependentGa4(f.store,KEY,f.broker,vi.fn(async(url)=>Response.json(String(url).includes('dataStreams')?{dataStreams:[{webStreamData:{defaultUri:'https://other.example'}}]}:{name:'properties/123',displayName:'Other',timeZone:'UTC'})) as typeof fetch);
 await expect(ga4.select('123')).rejects.toThrow('GA4_PROPERTY_SCOPE_UNVERIFIED');expect(f.values.has('ga4:property')).toBe(false);
});
it('stores hashed encrypted reports, filters organic own-site traffic, and skips completed months permanently',async()=>{
 const f=fixture(),transport=provider(),ga4=new IndependentGa4(f.store,KEY,f.broker,transport as typeof fetch);await authorize(f,ga4);
 // Keep the property clock inside the actual 400-day retention window.
 const now=new Date();const current=now.toISOString().slice(0,7);
 for(let i=0;i<12;i++)expect((await ga4.tick(now)).status).toBe('complete');
 const calls=transport.mock.calls.filter(([url])=>String(url).endsWith(':runReport'));
 expect(calls).toHaveLength(12);
 for(const [,init] of calls){const request=JSON.parse(String(init?.body));expect(request.dimensionFilter.andGroup.expressions).toEqual([{filter:{fieldName:'sessionDefaultChannelGroup',stringFilter:{matchType:'EXACT',value:'Organic Search'}}},{filter:{fieldName:'hostName',inListFilter:{values:['mavibasim.com','www.mavibasim.com']}}}]);}
 expect(await ga4.tick(now)).toMatchObject({status:'idle',d1_requests:0});expect(transport.mock.calls.filter(([url])=>String(url).endsWith(':runReport'))).toHaveLength(12);
 const report:any=await ga4.report(current);expect(report.totals.activeUsers).toBe(10);expect(report.cities[0]).toMatchObject({city:'İstanbul',active_users:10,sessions:12});expect(report.thresholded).toBe(true);expect(report.evidence[0].hashes[0]).toMatch(/^[a-f0-9]{64}$/);
 const answer=answerGa4(report,null,'İstanbul ziyaretçisi kaç?');expect(answer.answer).toContain('10 aktif kullanıcı, 12 organik oturum');expect(answer.answer).toContain('Gizlilik eşiği');
 const part=[...f.values.keys()].find(key=>key.startsWith('ga4:part:'))!;f.values.set(part,'corrupted encrypted chunk');await expect(ga4.report(current)).rejects.toThrow();
});
it('empty provider results are available evidence but never presented as zero visitors',async()=>{
 const f=fixture(),base=provider(),transport=vi.fn(async(url:RequestInfo|URL,init?:RequestInit)=>String(url).endsWith(':runReport')?Response.json({dimensionHeaders:JSON.parse(String(init?.body)).dimensions,metricHeaders:['activeUsers','sessions','engagedSessions'].map(name=>({name})),rowCount:0,rows:[]}):base(url,init));
 const ga4=new IndependentGa4(f.store,KEY,f.broker,transport as typeof fetch);await authorize(f,ga4);await ga4.tick();await ga4.tick();
 const d=new Date();d.setUTCDate(d.getUTCDate()-2);const result:any=await ga4.report(d.toISOString().slice(0,7));expect(result.available).toBe(false);expect(result.totals).toBeNull();expect(result.message).toContain('sıfır ziyaretçi değildir');
});
it('does not expose partial GA4 totals or cities before all four report dimensions are verified',async()=>{
 const f=fixture(),ga4=new IndependentGa4(f.store,KEY,f.broker,provider() as typeof fetch);await authorize(f,ga4);
 const first:any=await ga4.tick();
 expect(first).toMatchObject({status:'complete',kind:'total'});
 const incomplete:any=await ga4.report(first.month);
 expect(incomplete.available).toBe(false);
 expect(incomplete.period_consistent).toBeNull();
 expect(incomplete.totals).toBeNull();
 expect(incomplete.cities).toEqual([]);
 expect(incomplete.devices).toEqual([]);
 expect(incomplete.pages).toEqual([]);
 for(let i=0;i<3;i++)expect((await ga4.tick()).status).toBe('complete');
 const verified:any=await ga4.report(first.month);
 expect(verified.available).toBe(true);
 expect(verified.period_consistent).toBe(true);
 expect(verified.totals.sessions).toBe(12);
 expect(verified.cities[0].sessions).toBe(12);
});

it('accepts a fully archived zero-row month without inventing traffic',async()=>{
 const f=fixture(),base=provider(),transport=vi.fn(async(url:RequestInfo|URL,init?:RequestInit)=>{
  if(!String(url).endsWith(':runReport'))return base(url,init);
  const req=JSON.parse(String(init?.body));
  return Response.json({dimensionHeaders:req.dimensions,metricHeaders:['activeUsers','sessions','engagedSessions'].map(name=>({name})),rowCount:0,rows:[]});
 });
 const ga4=new IndependentGa4(f.store,KEY,f.broker,transport as typeof fetch);await authorize(f,ga4);
 let month='';
 for(let i=0;i<4;i++){const result:any=await ga4.tick();expect(result.status).toBe('complete');month=result.month;}
 const report:any=await ga4.report(month);
 expect(report.available).toBe(true);
 expect(report.period_consistent).toBe(true);
 expect(report.totals).toBeNull();
 expect(report.cities).toEqual([]);
 expect(report.message).toContain('şehir raporunda satır bulunmuyor');
});

it('a low shared storage budget and provider quota preserve all existing reports',async()=>{
 const f=fixture(),transport=provider(),ga4=new IndependentGa4(f.store,KEY,f.broker,transport as typeof fetch);await authorize(f,ga4);
 f.values.set('gsc:storage-budget:v1',{version:1,measured_since:new Date().toISOString(),day:new Date().toISOString().slice(0,10),reserved_bytes:128*1024*1024,day_reserved_bytes:0});
 expect(await ga4.tick()).toMatchObject({status:'held',code:'GA4_STORAGE_TOTAL_LIMIT'});expect([...f.values.keys()].some(k=>k.startsWith('ga4:report:'))).toBe(false);
});
it('publication retries use stored pages and never recollect a finished report',async()=>{
 const f=fixture(),transport=provider(),ga4=new IndependentGa4(f.store,KEY,f.broker,transport as typeof fetch);await authorize(f,ga4);
 const put=f.store.put;let reject=true;f.store.put=async(key:string,value:unknown)=>{if(key.startsWith('ga4:report:')&&reject){reject=false;throw Error('fixture write failure');}return put(key,value);};
 expect((await ga4.tick()).status).toBe('held');const count=transport.mock.calls.length;f.values.set('ga4:retry',null);
 expect((await ga4.tick()).status).toBe('complete');expect(transport.mock.calls).toHaveLength(count);
});
