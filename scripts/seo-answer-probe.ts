// Account-only read acceptance. Never collects data or returns credentials/traffic values.
interface Probe {ADMIN_TOKEN?:string;PROBE_KEY:string;LIVE_APP:Fetcher}
const ORIGIN='https://mavi-basim-seo-prod.mavibasimonline.workers.dev';
function need(ok:unknown,code:string):asserts ok{if(!ok)throw Error(code);}
export default {async fetch(request:Request,env:Probe){
 if(!env.PROBE_KEY||request.headers.get('Authorization')!=='Bearer '+env.PROBE_KEY)return new Response(null,{status:404});
 const mode=new URL(request.url).pathname;
 if(mode==='/health')return Response.json({ready:true,admin_configured:!!env.ADMIN_TOKEN});
 try{
  need(request.method==='POST'&&!!env.ADMIN_TOKEN&&['/before','/accept'].includes(mode),'SEO_ANSWER_REQUEST_INVALID');
  const call=async(question:string,source?:string,route='questions')=>{
   const r=await env.LIVE_APP.fetch(ORIGIN+'/api/independent/'+route,{method:'POST',headers:{Authorization:'Bearer '+env.ADMIN_TOKEN,Origin:ORIGIN,'Content-Type':'application/json'},body:JSON.stringify({month:'2026-10',question,...(source?{source}:{})})});
   need(r.ok,'SEO_ANSWER_UNAVAILABLE');return r.json<any>();
  };
  const auto=await call('Broşür neden düşüyor?'),direct=await call('Broşür neden düşüyor?',undefined,'gsc-questions'),manual=await call('Broşür neden düşüyor?','ga4');
  if(mode==='/before')return Response.json({auto_source:auto.source,auto_decision:auto.decision,gsc_decision:direct.decision,manual_ga4_source:manual.source,combined_evidence:!!auto.evaluation,d1_requests:0});
  const visitor=await call('Broşür organik ziyaretçileri neden düşüyor?'),unsupported=await call('Broşür anahtar kelimeleri neden düşüyor?','ga4');
  need(auto.source==='GSC Search Analytics API'&&typeof auto.product_id==='string'&&!!auto.product_id&&auto.filters.product===auto.product_id,'SEO_ANSWER_PRODUCT_SCOPE_INVALID');
  need(auto.month==='2026-10'&&auto.previous_month==='2026-09'&&auto.comparison&&auto.evaluation?.gsc,'SEO_ANSWER_GSC_COMPARISON_MISSING');
  need(auto.decision===direct.decision&&auto.decision===visitor.decision&&JSON.stringify(auto.comparison)===JSON.stringify(direct.comparison)&&JSON.stringify(auto.comparison)===JSON.stringify(visitor.comparison),'SEO_ANSWER_DECISION_CONFLICT');
  need(auto.evaluation.cause_confirmed===false&&auto.evaluation.content_change_recommended===false&&auto.answer.includes('nedeni kesinleştirilemedi')&&(auto.decision!=='İncele'||auto.answer.includes('İncele, sayfayı değiştir kararı değildir.')),'SEO_ANSWER_UNPROVEN_CAUSE');
  const ga4=auto.evaluation.ga4;
  need(ga4.source==='Google Analytics 4 Data API'&&ga4.comparable===true&&typeof ga4.current_sessions==='number'&&typeof ga4.previous_sessions==='number'&&ga4.evidence.length===2&&ga4.evidence.every((e:any)=>e.kind==='pages'),'SEO_ANSWER_GA4_PAGES_MISSING');
  need(Array.isArray(auto.evaluation.changes)&&auto.evaluation.changes.every((e:any)=>e.observed_interval?.from&&e.observed_interval?.to&&e.source_hash),'SEO_ANSWER_CHANGE_EVIDENCE_MISSING');
  need(manual.source==='Google Analytics 4 Data API'&&manual.product_id===auto.product_id&&manual.evaluation?.ga4?.comparable===true&&manual.decision==='Veri bekle','SEO_ANSWER_MANUAL_SCOPE_INVALID');
  need(unsupported.source==='Google Analytics 4 Data API'&&unsupported.decision==='Veri bekle'&&unsupported.evaluation?.ga4?.unsupported_query===true&&unsupported.evidence_refs.length===0,'SEO_ANSWER_MANUAL_FALLBACK_INVALID');
  need([auto,direct,visitor,manual,unsupported].every(r=>r.d1_requests===0),'SEO_ANSWER_D1_UNEXPECTED');
  const refs=auto.evidence_refs,periods=[...new Set(refs.filter((r:any)=>r.scope==='page').map((r:any)=>r.day.slice(0,7)))].sort();
  need(JSON.stringify(periods)===JSON.stringify(['2026-09','2026-10'])&&refs.filter((r:any)=>r.source==='Google Analytics 4 Data API').length===2,'SEO_ANSWER_REFERENCES_INVALID');
  const joint=auto.evaluation.cross_source_page_decline,priority=auto.evaluation.review_priority;
  need(typeof joint==='boolean'&&['Öncelikli','Normal','Yok','Veri bekle'].includes(priority)&&auto.answer.includes('Ürün grubu toplamı tek URL performansı değildir.')&&(priority!=='Öncelikli'||joint&&ga4.delta<0&&auto.decision==='İncele'&&auto.answer.includes('İnceleme önceliği yüksek')),'SEO_ANSWER_REVIEW_SCOPE_INVALID');
  return Response.json({verified:true,product_scope:true,periods,decision:auto.decision,decision_consistent:true,gsc_drop_verified:auto.comparison.delta<0,ga4_sessions_compared:true,ga4_drop_verified:ga4.delta<0,cross_source_page_decline:joint,review_priority:priority,content_change_recommended:false,changes_referenced:auto.evaluation.changes.length,change_dates_present:true,cause_confirmed:false,manual_ga4_respected:true,unsupported_ga4_explicit:true,city_misrouting:false,d1_requests:0});
 }catch(error){const code=error instanceof Error&&/^SEO_ANSWER_[A-Z0-9_]+$/.test(error.message)?error.message:'SEO_ANSWER_INVALID';return Response.json({code},{status:503});}
}};
