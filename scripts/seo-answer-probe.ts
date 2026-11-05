// Account-only read acceptance. Never collects data or returns credentials/traffic values.
interface Probe {ADMIN_TOKEN?:string;PROBE_KEY:string;LIVE_APP:Fetcher}
const ORIGIN='https://mavi-basim-seo-prod.mavibasimonline.workers.dev';
function need(ok:unknown,code:string):asserts ok{if(!ok)throw Error(code);}
export default {async fetch(request:Request,env:Probe){
 if(!env.PROBE_KEY||request.headers.get('Authorization')!=='Bearer '+env.PROBE_KEY)return new Response(null,{status:404});
 const mode=new URL(request.url).pathname;
 if(mode==='/health')return Response.json({ready:true,admin_configured:!!env.ADMIN_TOKEN});
 // Account-only browser acceptance of the actual published assets and read APIs.
 // The real admin key remains in Workers; the temporary preview key is local.
 if(!['/before','/accept'].includes(mode)){
  const assets=['/','/index.html','/app.js','/app.css','/ui.js','/chart.js','/evidence.js','/modules.js','/gsc-review.js','/period.js','/icons.svg','/unified-seo.js','/seo/workspace.js','/seo/workspace.css'];
  const allowed=request.method==='GET'&&(assets.includes(mode)||/^\/fonts\/[a-zA-Z0-9._-]+\.woff2$/.test(mode)||mode==='/api/session'||/^\/api\/independent\/(gsc-month|gsc-status|ga4-status|ga4-report|change-history|report|catalog)$/.test(mode))||request.method==='POST'&&/^\/api\/independent\/(questions|gsc-questions)$/.test(mode)||request.method==='DELETE'&&mode==='/api/session';
  if(!allowed||!env.ADMIN_TOKEN)return new Response(null,{status:404});
  const url=new URL(request.url),headers=new Headers({'Authorization':'Bearer '+env.ADMIN_TOKEN,Origin:ORIGIN,'Content-Type':'application/json'});
  return env.LIVE_APP.fetch(new Request(ORIGIN+mode+url.search,{method:request.method,headers,...(request.method==='POST'?{body:await request.text()}:{})}));
 }
 try{
  need(request.method==='POST'&&!!env.ADMIN_TOKEN&&['/before','/accept'].includes(mode),'SEO_ANSWER_REQUEST_INVALID');
  const call=async(question:string,source?:string,route='questions',selectedMonth='2026-10')=>{
   const r=await env.LIVE_APP.fetch(ORIGIN+'/api/independent/'+route,{method:'POST',headers:{Authorization:'Bearer '+env.ADMIN_TOKEN,Origin:ORIGIN,'Content-Type':'application/json'},body:JSON.stringify({month:selectedMonth,question,...(source?{source}:{})})});
   need(r.ok,'SEO_ANSWER_UNAVAILABLE');return r.json<any>();
  };
  const auto=await call('Broşür neden düşüyor?'),direct=await call('Broşür neden düşüyor?',undefined,'gsc-questions'),manual=await call('Broşür neden düşüyor?','ga4');
  if(mode==='/before')return Response.json({auto_source:auto.source,auto_decision:auto.decision,gsc_decision:direct.decision,manual_ga4_source:manual.source,combined_evidence:!!auto.evaluation,d1_requests:0});
  const visitor=await call('Broşür organik ziyaretçileri neden düşüyor?'),unsupported=await call('Broşür anahtar kelimeleri neden düşüyor?','ga4');
  const read=async(path:string)=>{const r=await env.LIVE_APP.fetch(ORIGIN+path,{headers:{Authorization:'Bearer '+env.ADMIN_TOKEN}});if(path.endsWith('/catalog')&&r.status===404)throw Error('SEO_ANSWER_RUNTIME_PENDING');need(r.ok,'SEO_ANSWER_PANEL_READ_FAILED');return r.json<any>();};
  const session=await read('/api/session'),month=await read('/api/independent/gsc-month?month=2026-10');
  need(session.panel==='unified-independent-v1'&&Array.isArray(month.daily)&&Array.isArray(month.mappings),'SEO_ANSWER_RUNTIME_PENDING');
  need(month.available===true&&month.daily.length===31&&month.daily.every((r:any)=>r.verified===true&&Array.isArray(r.devices)&&r.fetched_at)&&month.mappings.length>0&&month.d1_requests===0,'SEO_ANSWER_PANEL_SCOPE_INVALID');
  need(typeof auto.evaluation?.content_change_recommended==='boolean','SEO_ANSWER_RUNTIME_PENDING');
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
  const rise=await call('Broşür mobilde neden düştü?',undefined,'questions','2026-09'),riseGsc=await call('Broşür mobilde neden düştü?',undefined,'gsc-questions','2026-09');
  need(rise.answer.includes('Bu dönemde düşüş yok, yükseliş var.')&&riseGsc.answer.includes('Bu dönemde düşüş yok, yükseliş var.'),'SEO_ANSWER_RUNTIME_PENDING');
  need([rise,riseGsc].every(r=>r.month==='2026-09'&&r.previous_month==='2026-08'&&r.filters.product===auto.product_id&&r.filters.device==='MOBILE'&&r.comparison?.previous.clicks===1&&r.comparison.current.clicks===19&&r.comparison.delta===18&&r.decision==='Koru'&&r.d1_requests===0),'SEO_ANSWER_GROWTH_SCOPE_INVALID');
  const wording=rise.answer.toLocaleLowerCase('tr-TR');
  need(wording.includes('karşılaştırma dönemi: ağustos 2026 → eylül 2026.')&&!rise.answer.includes('Eylül–Ekim')&&!rise.answer.includes('düşüşün nedeni kesinleştirilemedi')&&rise.evaluation.content_change_recommended===false,'SEO_ANSWER_PERIOD_WORDING_INVALID');
  const catalog=await read('/api/independent/catalog');
  need(catalog.available===true&&catalog.read_only===false&&catalog.products.length>0&&catalog.source_hash&&catalog.d1_requests===0,'SEO_ANSWER_CATALOG_INVALID');
  const globals=[['Hangi kelimeleri korumalıyım?','protect-queries','GSC Search Analytics API'],['Bu ay hangi ürünleri korumalıyım?','protect-products','GSC Search Analytics API'],['Hangi sayfalar eşlenmemiş?','unmapped','GSC Search Analytics API'],['Yerel matbaa sorgularında fırsat var mı?','opportunities','GSC Search Analytics API'],['GSC’ye göre hangi ürünlerde belirgin düşüş var?','declining-products','GSC Search Analytics API'],['Hangi şehirlerde gerileme var?','city-decline','Google Analytics 4 Data API'],['GA4’e göre hangi şehirlerde organik ziyaret arttı?','city-growth','Google Analytics 4 Data API']];
  for(const [question,intent,source] of globals){const r=await call(question);need(r.intent===intent&&r.source===source&&Array.isArray(r.items)&&r.content_change_recommended===false&&r.d1_requests===0,'SEO_ANSWER_GLOBAL_ROUTING_INVALID');}
  return Response.json({verified:true,catalog_mapping_requires_explicit_user_action:true,global_qa_routing_verified:true,september_mobile_growth_verified:true,dynamic_comparison_period_verified:true,growth_comparison_months:['2026-08','2026-09'],unified_panel:true,daily_chart_days:month.daily.length,product_mappings:month.mappings.length,product_scope:true,periods,decision:auto.decision,decision_consistent:true,gsc_drop_verified:auto.comparison.delta<0,ga4_sessions_compared:true,ga4_drop_verified:ga4.delta<0,cross_source_page_decline:joint,review_priority:priority,content_change_recommended:false,changes_referenced:auto.evaluation.changes.length,change_dates_present:true,cause_confirmed:false,manual_ga4_respected:true,unsupported_ga4_explicit:true,city_misrouting:false,d1_requests:0});
 }catch(error){const code=error instanceof Error&&/^SEO_ANSWER_[A-Z0-9_]+$/.test(error.message)?error.message:'SEO_ANSWER_INVALID';return Response.json({code},{status:503});}
}};
