// Ephemeral account-only GA4 archive probe, restricted to the local GitHub runner.
// No API credentials, source metrics, or session-level records are returned.
interface Probe {PROBE_KEY:string; ARCHIVE:Fetcher}
const months=['2026-06','2026-07','2026-08'];
async function archive(env:Probe,path:string,method='GET',body?:unknown){
 const response=await env.ARCHIVE.fetch('https://archive.private'+path,{method,headers:{'Content-Type':'application/json'},body:body===undefined?undefined:JSON.stringify(body)});
 const data=await response.json<any>();
 if(!response.ok||data.d1_requests!==0)throw Error('GA4_ARCHIVE_SOURCE_UNAVAILABLE');
 return data;
}
export default {async fetch(request:Request,env:Probe){
 if(!env.PROBE_KEY||request.headers.get('Authorization')!=='Bearer '+env.PROBE_KEY)return new Response(null,{status:404});
 const url=new URL(request.url);
 try{
  if(url.pathname==='/ready')return Response.json({ready:true});
  if(url.pathname==='/status'){
   const data=await archive(env,'/api/internal/ga4-status');
   return Response.json({connected:data.connected===true,reconnect:data.reauthorization_required===true,property_verified:data.property?.id==='532525867',property_timezone:typeof data.property?.time_zone==='string',d1_requests:0});
  }
  if(url.pathname==='/tick'&&request.method==='POST'){
   const data=await archive(env,'/api/internal/ga4-tick','POST',{source:'ga4-historical-reconcile'});
   if(!['complete','partial','idle','held','unavailable'].includes(data.status))throw Error('GA4_ARCHIVE_TICK_INVALID');
   return Response.json({status:data.status,month:typeof data.month==='string'?data.month:null,kind:typeof data.kind==='string'?data.kind:null,code:typeof data.code==='string'?data.code:null,d1_requests:0});
  }
  if(url.pathname==='/report'&&months.includes(url.searchParams.get('month')||'')){
   const month=url.searchParams.get('month')!;
   const data=await archive(env,'/api/independent/ga4-report?month='+month);
   if(data.property?.id!=='532525867'||data.month!==month||data.source!=='Google Analytics 4 Data API'||data.channel!=='Organic Search'||JSON.stringify(data.hostnames)!==JSON.stringify(['mavibasim.com','www.mavibasim.com']))throw Error('GA4_ARCHIVE_SCOPE_INVALID');
   const evidence=Array.isArray(data.evidence)?data.evidence:[];
   if(!evidence.every((v:any)=>v.property==='532525867'&&v.month===month&&Array.isArray(v.hashes)&&v.hashes.every((h:any)=>typeof h==='string'&&/^[a-f0-9]{64}$/.test(h))))throw Error('GA4_ARCHIVE_HASH_INVALID');
   return Response.json({month,available:data.available===true,closed:data.closed===true,has_total:!!data.totals,has_cities:Array.isArray(data.cities)&&data.cities.length>0,has_devices:Array.isArray(data.devices)&&data.devices.length>0,has_pages:Array.isArray(data.pages)&&data.pages.length>0,evidence_types:evidence.map((v:any)=>v.kind).sort(),thresholded:data.thresholded===true,other_rows:data.other_rows===true,d1_requests:0});
  }
  return new Response(null,{status:404});
 }catch(error){const code=error instanceof Error&&/^GA4_ARCHIVE_[A-Z0-9_]+$/.test(error.message)?error.message:'GA4_ARCHIVE_SOURCE_UNAVAILABLE';return Response.json({code},{status:503});}
}};
