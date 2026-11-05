// Account-only GA4 repair/collection. Secrets and source metrics never leave this preview.
interface Probe {ADMIN_TOKEN?:string;PROBE_KEY:string;LIVE_APP:Fetcher;ARCHIVE:Fetcher}
const ORIGIN='https://mavi-basim-seo-prod.mavibasimonline.workers.dev',ID='532525867';
const requireValue=(ok:unknown,code:string)=>{if(!ok)throw Error(code);};
export default {async fetch(request:Request,env:Probe){
 if(!env.PROBE_KEY||request.headers.get('Authorization')!=='Bearer '+env.PROBE_KEY)return new Response(null,{status:404});
 const url=new URL(request.url),mode=url.pathname;
 if(mode==='/health')return Response.json({ready:true,admin_configured:!!env.ADMIN_TOKEN});
 try{
  requireValue(request.method==='POST'&&!!env.ADMIN_TOKEN,'GA4_REPAIR_REQUEST_INVALID');
  const call=async(path:string,body?:unknown)=>{const r=await env.LIVE_APP.fetch(ORIGIN+'/api/independent/'+path,{method:body===undefined?'GET':'POST',headers:{Authorization:'Bearer '+env.ADMIN_TOKEN,Origin:ORIGIN,'Content-Type':'application/json'},body:body===undefined?undefined:JSON.stringify(body)});const data=await r.json<any>();return {status:r.status,data};};
  if(mode==='/before'){
   const status=await call('ga4-status'),list=await call('ga4-properties');
   requireValue(status.status===200&&status.data.connected===true&&list.status===200&&list.data.properties?.some((p:any)=>p.id===ID),'GA4_REPAIR_TARGET_ACCESS_MISSING');
   const selected=await call('ga4-property',{property_id:ID}),code=selected.data.code??null;
   requireValue(code===null||/^GA4_[A-Z0-9_]+$/.test(code),'GA4_REPAIR_UNEXPECTED_ERROR');
   return Response.json({connected:true,property_listed:true,property_id:ID,selected:selected.status===200,code});
  }
  if(mode==='/select'){
   const r=await call('ga4-property',{property_id:ID}),p=r.data.property;
   requireValue(r.status===200&&p?.id===ID&&p.web_stream?.source==='Google Analytics Admin API'&&['https://mavibasim.com','https://www.mavibasim.com','http://mavibasim.com','http://www.mavibasim.com'].includes(p.web_stream.origin)&&['absolute','scheme-less'].includes(p.web_stream.address_format),'GA4_REPAIR_SCOPE_NOT_VERIFIED');
   return Response.json({verified:true,property_id:ID,origin:p.web_stream.origin,address_format:p.web_stream.address_format,time_zone:p.time_zone,d1_requests:0});
  }
  if(mode==='/tick'){
   const r=await env.ARCHIVE.fetch('https://archive.private/api/internal/ga4-tick',{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'}),v=await r.json<any>();
   requireValue(r.ok&&v.d1_requests===0&&['complete','partial','idle','held','unavailable'].includes(v.status),'GA4_REPAIR_TICK_INVALID');
   const result:Record<string,unknown>={status:v.status,d1_requests:0};for(const k of ['month','kind','rows','cursor','code'])if(v[k]!==undefined)result[k]=v[k];return Response.json(result);
  }
  if(mode==='/report'){
   const month=url.searchParams.get('month');requireValue(/^20\d\d-(0[1-9]|1[0-2])$/.test(month||''),'GA4_REPAIR_MONTH_INVALID');
   const r=await call('ga4-report?month='+month),p=r.data;
   requireValue(r.status===200&&p.property?.id===ID&&p.source==='Google Analytics 4 Data API'&&p.channel==='Organic Search'&&JSON.stringify(p.hostnames)===JSON.stringify(['mavibasim.com','www.mavibasim.com'])&&p.d1_requests===0,'GA4_REPAIR_REPORT_INVALID');
   const counts:Record<string,number>={};for(const k of ['cities','devices','pages']){requireValue(Array.isArray(p[k])&&p[k].length<=4000,'GA4_REPAIR_REPORT_INVALID');counts[k]=p[k].length;}
   requireValue(Array.isArray(p.evidence)&&p.evidence.every((e:any)=>e.property===ID&&e.hashes.every((h:unknown)=>typeof h==='string'&&/^[a-f0-9]{64}$/.test(h))),'GA4_REPAIR_EVIDENCE_INVALID');
   return Response.json({property_id:ID,month,available:p.available===true,closed:p.closed===true,from:p.from,to:p.to,totals_verified:!!p.totals,...counts,evidence_refs:p.evidence.length,verified_hashes:p.evidence.reduce((n:number,e:any)=>n+e.hashes.length,0),thresholded:!!p.thresholded,other_rows:!!p.other_rows,d1_requests:0});
  }
  return new Response(null,{status:404});
 }catch(error){const code=error instanceof Error&&/^GA4_REPAIR_[A-Z0-9_]+$/.test(error.message)?error.message:'GA4_REPAIR_UNAVAILABLE';return Response.json({code},{status:503});}
}};
