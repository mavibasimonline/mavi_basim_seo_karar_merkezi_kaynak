// Account-only guarded history copy and live read acceptance. No source mutations or credential output.
import {syncPlanner} from '../src/planner-bridge';
import historyAudit from './gsc_history_probe';
import {syncSeoHistory} from '../src/seo-history-bridge';
import type {Env} from '../src/types';
interface Probe {ADMIN_TOKEN?:string;PROBE_KEY:string;LIVE_APP:Fetcher;DB:D1Database;DRIVE_ARCHIVE_SERVICE:Fetcher;D1_READ_GUARD_ENABLED:string}
const ORIGIN='https://mavi-basim-seo-prod.mavibasimonline.workers.dev';
function need(ok:unknown,code:string):asserts ok{if(!ok)throw Error(code);}
export default {async fetch(request:Request,env:Probe){
 if(!env.PROBE_KEY||request.headers.get('Authorization')!=='Bearer '+env.PROBE_KEY)return new Response(null,{status:404});
 const mode=new URL(request.url).pathname;
 if(mode==='/health')return Response.json({ready:true,admin_configured:!!env.ADMIN_TOKEN});
 if(['/completion-step','/completion-status','/totals-step','/planner-bootstrap','/audit-read'].includes(mode)&&request.method==='POST'){
  const read=async(path:string,method='GET')=>{const r=await env.DRIVE_ARCHIVE_SERVICE.fetch('https://archive.private/api/'+path,{method,...(method==='POST'?{body:'{}',headers:{'Content-Type':'application/json'}}:{})});if(!r.ok)throw Error('SEO_ANSWER_COMPLETION_SOURCE_UNAVAILABLE');return r.json<any>();};
  if(mode==='/completion-step')return Response.json(await read('internal/data-completion/tick','POST'));
  if(mode==='/totals-step')return Response.json(await read('internal/property-totals/tick','POST'));
  if(mode==='/planner-bootstrap'){const result=await syncPlanner(env as unknown as Env);return Response.json({status:result.status,code:result.code||null,reason:result.reason||null,...await read('independent/planner-status')});}
  if(mode==='/audit-read')return historyAudit.fetch(new Request('https://audit.private/?mode=analysis&month=2026-10',{method:'POST',headers:{Authorization:'Bearer '+env.PROBE_KEY}}),{PROBE_KEY:env.PROBE_KEY,ARCHIVE:env.DRIVE_ARCHIVE_SERVICE});
  const months=[];for(const month of ['2026-06','2026-07','2026-08']){const m=await read('internal/gsc-month?month='+month);months.push({month,page_days:m.days_verified,query_days:m.query_days_verified,expected_days:m.expected_days,verified:m.available===true,read_budget_limited:m.read_budget.budget_limited});}
  const totals=await read('internal/property-totals/status'),properties=totals.months.map((m:any)=>({month:m.month,verified:!!m.total,days_verified:m.daily.days_verified,expected_days:m.daily.expected_days,daily_sums_match:!!m.total&&m.daily.days_verified===m.daily.expected_days&&m.daily.rows.reduce((n:number,r:any)=>n+r.clicks,0)===m.total.clicks&&m.daily.rows.reduce((n:number,r:any)=>n+r.impressions,0)===m.total.impressions}));
  return Response.json({months,properties,planner:await read('independent/planner-status'),catchup:(await read('internal/data-completion/status')).catchup});
 }
 if(mode==='/history-bootstrap'&&request.method==='POST'){
  const receipts=[await syncSeoHistory(env as unknown as Env)];
  const r=await env.DRIVE_ARCHIVE_SERVICE.fetch('https://archive.private/api/internal/seo-history/status');
  if(!r.ok)return Response.json({code:'SEO_ANSWER_HISTORY_STATUS_UNAVAILABLE'},{status:503});
  const status=await r.json<any>();
  return Response.json({verified:status.caught_up===true&&status.events>0&&status.snapshots>0,events:status.events,snapshots:status.snapshots,caught_up:status.caught_up===true,receipts,held:status.held||null,source_mutations:0});
 }

 // Account-only browser acceptance of the actual published assets and read APIs.
 // The real admin key remains in Workers; the temporary preview key is local.
 if(!['/before','/accept'].includes(mode)){
  const assets=['/','/index.html','/app.js','/app.css','/ui.js','/chart.js','/evidence.js','/modules.js','/gsc-review.js','/period.js','/icons.svg','/unified-seo.js','/seo/workspace.js','/seo/workspace.css','/seo/tables.js','/seo/tables.css','/seo/catalog-sync.js','/seo/history.js','/seo/history.css'];
  const allowed=request.method==='GET'&&(assets.includes(mode)||/^\/fonts\/[a-zA-Z0-9._-]+\.woff2$/.test(mode)||mode==='/api/session'||/^\/api\/independent\/seo-history(?:\/(status|detail|impact))?$/.test(mode)||/^\/api\/independent\/(planner|planner-status|gsc-month|gsc-series|gsc-status|ga4-status|ga4-report|change-history|report|catalog)$/.test(mode))||request.method==='POST'&&/^\/api\/independent\/(questions|gsc-questions)$/.test(mode)||request.method==='DELETE'&&mode==='/api/session';
  if(!allowed||!env.ADMIN_TOKEN)return new Response(null,{status:404});
  const url=new URL(request.url),headers=new Headers({'Authorization':'Bearer '+env.ADMIN_TOKEN,Origin:ORIGIN,'Content-Type':'application/json'});
  return env.LIVE_APP.fetch(new Request(ORIGIN+mode+url.search,{method:request.method,headers,...(request.method==='POST'?{body:await request.text()}:{})}));
 }
 try{
  need(request.method==='POST'&&!!env.ADMIN_TOKEN&&['/before','/accept'].includes(mode),'SEO_ANSWER_REQUEST_INVALID');
  const call=async(question:string,source?:string,route='questions',selectedMonth='2026-10')=>{
   const r=await env.LIVE_APP.fetch(ORIGIN+'/api/independent/'+route,{method:'POST',headers:{Authorization:'Bearer '+env.ADMIN_TOKEN,Origin:ORIGIN,'Content-Type':'application/json'},body:JSON.stringify({month:selectedMonth,question,include_source_context:true,...(source?{source}:{})})});
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
  need(catalog.available===true&&catalog.read_only===false&&Array.isArray(catalog.products)&&catalog.products.length>0&&catalog.source_hash&&catalog.d1_requests===0,'SEO_ANSWER_CATALOG_INVALID');
  const globals=[['Hangi kelimeleri korumalıyım?','protect-queries','GSC Search Analytics API'],['Bu ay hangi ürünleri korumalıyım?','protect-products','GSC Search Analytics API'],['Hangi sayfalar eşlenmemiş?','unmapped','GSC Search Analytics API'],['Yerel matbaa sorgularında fırsat var mı?','opportunities','GSC Search Analytics API'],['GSC’ye göre hangi ürünlerde belirgin düşüş var?','declining-products','GSC Search Analytics API'],['Hangi şehirlerde gerileme var?','city-decline','Google Analytics 4 Data API'],['GA4’e göre hangi şehirlerde organik ziyaret arttı?','city-growth','Google Analytics 4 Data API']];
  for(const [question,intent,source] of globals){const r=await call(question);need(r.intent===intent&&r.source===source&&Array.isArray(r.items)&&r.content_change_recommended===false&&r.d1_requests===0,'SEO_ANSWER_GLOBAL_ROUTING_INVALID');}
  const history=await read('/api/independent/seo-history?kind=event');
  need(history.coverage?.caught_up===true&&history.items?.length>0&&history.d1_requests===0,'SEO_ANSWER_HISTORY_INCOMPLETE');
  const sample=await read('/api/independent/seo-history/detail?kind=event&id='+encodeURIComponent(history.items[0].id));
  need(sample.details_available===true&&sample.before?.record_hash&&sample.after?.record_hash&&sample.diffs&&sample.record_hash,'SEO_ANSWER_HISTORY_DETAILS_MISSING');
  if(history.next_cursor){const next=await read('/api/independent/seo-history?kind=event&cursor='+encodeURIComponent(history.next_cursor));const seen=new Set(history.items.map((e:any)=>e.id));need(next.items.every((e:any)=>!seen.has(e.id)),'SEO_ANSWER_HISTORY_PAGINATION_DUPLICATE');}
  const historyAnswer=await call('Broşür sayfasında neler değiştirdik ve sonuç ne oldu?');
  need(historyAnswer.source==='Doğrulanmış SEO değişiklik arşivi + GSC Search Analytics API'&&historyAnswer.available===true&&historyAnswer.impact?.url===auto.url&&historyAnswer.cause_confirmed===false&&historyAnswer.content_change_recommended===false&&historyAnswer.evidence_refs.some((r:any)=>r.event_id)&&historyAnswer.evidence_refs.some((r:any)=>r.scope==='page'),'SEO_ANSWER_HISTORY_QA_INVALID');
  return Response.json({verified:true,history_events:history.coverage.events,history_snapshots:history.coverage.snapshots,history_caught_up:true,history_details_verified:true,history_pagination_verified:true,history_qa_verified:true,planner_context_verified:!!auto.product_source_context?.planner,catalog_user_confirmed_mappings:true,global_qa_routing_verified:true,september_mobile_growth_verified:true,dynamic_comparison_period_verified:true,growth_comparison_months:['2026-08','2026-09'],unified_panel:true,daily_chart_days:month.daily.length,product_mappings:month.mappings.length,visible_query_rows:month.queries?.length||0,query_days_verified:month.query_days_verified,query_expected_days:month.expected_days,query_read_budget_limited:month.read_budget?.budget_limited===true,official_property_total_available:!!month.property_total,product_scope:true,periods,decision:auto.decision,decision_consistent:true,gsc_drop_verified:auto.comparison.delta<0,ga4_sessions_compared:true,ga4_drop_verified:ga4.delta<0,cross_source_page_decline:joint,review_priority:priority,content_change_recommended:false,changes_referenced:auto.evaluation.changes.length,change_dates_present:true,cause_confirmed:false,manual_ga4_respected:true,unsupported_ga4_explicit:true,city_misrouting:false,d1_requests:0});
 }catch(error){const code=error instanceof Error&&/^SEO_ANSWER_[A-Z0-9_]+$/.test(error.message)?error.message:'SEO_ANSWER_INVALID';return Response.json({code},{status:503});}
}};
