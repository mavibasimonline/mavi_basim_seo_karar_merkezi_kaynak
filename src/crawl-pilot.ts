// Local operator entry point only. Never mounted in the production application.
import {Env,json} from './types';
import {seedCrawl,crawlOne} from './crawler';
import {calendarMonth} from './periods';
import {performance,performanceQueries} from './performance';
import {validMetrics,Metrics,analyze} from './analysis';
interface PilotEnv extends Env {PILOT_RUN_KEY?:string}
async function state(env:PilotEnv,counts=false){
  const targets=(await env.DB.prepare("SELECT id,canonical_url,url_verified_at FROM products ORDER BY id").all()).results;
  const recent=(await env.DB.prepare('SELECT url,started_at,finished_at,status_code,error_code FROM crawls ORDER BY started_at DESC LIMIT 3').all()).results;
  const evidence=(await env.DB.prepare(`SELECT p.id product,s.observed_at,json_extract(s.snapshot_json,'$.status') status,
    json_extract(s.snapshot_json,'$.canonical[0]') canonical,json_extract(s.snapshot_json,'$.title') title,
    json_extract(s.snapshot_json,'$.body_hash') body_hash,json_extract(s.snapshot_json,'$.rendering') rendering
    FROM products p LEFT JOIN seo_snapshots s ON s.id=(SELECT id FROM seo_snapshots WHERE url=p.canonical_url ORDER BY observed_at DESC,rowid DESC LIMIT 1)
    ORDER BY p.id`).all()).results;
  const sources=counts?await env.DB.prepare('SELECT (SELECT count(*) FROM products) products,(SELECT count(*) FROM keyword_sources) csv_files,(SELECT count(*) FROM keyword_metric_observations) csv_rows').first():undefined;
  return {targets,recent,snapshot_evidence:evidence,source_counts:sources,note:'Gerçek salt okunur site taraması; Google veya canlı site yazma çağrısı yok.'};
}
async function rangeCheck(env:PilotEnv,months:number){
 const data=await performance(env,calendarMonth(),null,new Date(),months),ids=data.series.filter(s=>s.verified).map(s=>s.dataset_id!);
 const raw=ids.length?(await env.DB.prepare(`SELECT COALESCE(p.id,pg.product_id,pc.id) product_id,SUM(d.clicks) clicks,SUM(d.impressions) impressions,SUM(d.position*d.impressions) weighted,COUNT(DISTINCT d.date) days
 FROM gsc_daily_by_page d LEFT JOIN products p ON p.canonical_url=d.page LEFT JOIN pages pg ON pg.url=d.page LEFT JOIN page_aliases a ON a.alias_url=d.page LEFT JOIN products pc ON pc.canonical_url=a.canonical_url
 WHERE d.dataset_id IN (SELECT value FROM json_each(?)) AND d.date BETWEEN ? AND ? GROUP BY COALESCE(p.id,pg.product_id,pc.id)`).bind(JSON.stringify(ids),data.period.start,data.period.end).all<{product_id:string|null;clicks:number;impressions:number;weighted:number;days:number}>()).results:[];
 const matches=data.products.every(p=>{const r=raw.find(r=>r.product_id===p.id);return !p.current?!r:!!r&&p.current.clicks===r.clicks&&p.current.impressions===r.impressions&&p.observed_days===r.days&&(!r.impressions||Math.abs(p.current.position!-r.weighted/r.impressions)<1e-8);});
 const expectedDays=Math.round((Date.parse(data.period.end)-Date.parse(data.period.start))/86400_000)+1;
 return {months,expected_days:expectedDays,verified_days:data.coverage.verified_days,product_groups_checked:raw.filter(r=>r.product_id).length,
 passed:matches&&data.series.length===expectedDays&&data.products.every(p=>p.current===null||validMetrics(p.current))&&data.series.every(s=>s.verified||s.metrics===null)&&(!data.coverage.complete?!data.comparison_available:true)};
}
export default {
  async fetch(request:Request,env:PilotEnv){
    const url=new URL(request.url);
    if(!['127.0.0.1','localhost'].includes(url.hostname))return json({error:'LOCAL_ONLY'},403);
    if(url.pathname==='/health')return json({ok:true});
    if(!env.PILOT_RUN_KEY||request.headers.get('Authorization')!=='Bearer '+env.PILOT_RUN_KEY)return json({error:'UNAUTHORIZED'},401);
    if(env.CRAWL_ENABLED!=='true')return json({error:'CRAWL_DISABLED'},409);
    if(request.method==='GET'&&url.pathname==='/state')return json(await state(env,true));
    if(request.method==='GET'&&url.pathname==='/performance-check'){
      const data=await performance(env),queries=await performanceQueries(env,new URLSearchParams({month:data.period.label}));
      const ids=data.series.filter(s=>s.verified).map(s=>s.dataset_id!);
      const raw=ids.length?await env.DB.prepare(`SELECT sum(clicks) clicks,sum(impressions) impressions,sum(position*impressions) weighted FROM gsc_daily_by_page WHERE dataset_id IN (${ids.map(()=>'?').join(',')}) AND date BETWEEN ? AND ?`).bind(...ids,data.period.start,data.period.end).first<{clicks:number;impressions:number;weighted:number}>():null;
      const independentMatches=data.current?!!raw&&raw.clicks===data.current.clicks&&raw.impressions===data.current.impressions&&(!raw.impressions||Math.abs(raw.weighted/raw.impressions-data.current.position!)<1e-8):raw===null||raw.clicks===null;
      const mobile=await performance(env,data.period.label,'MOBILE');
      const report=await analyze(env,data.period.label);
      const rangeChecks=[];for(const months of [3,6,12])rangeChecks.push(await rangeCheck(env,months));
      const reportSafe=report.products.every(p=>!p.missing.length||p.decision==='Veri bekle');
      // Serialize only booleans and operational counts, never private queries/metrics.
      return json({period:data.period.label,source:data.source,catalog_products:data.catalog.length,has_real_observations:data.series.some(s=>s.metrics!==null),query_groups:queries.rows.length,multi_month_checks:rangeChecks,report_acceptance:{month:report.month,products:report.products.length,missing_requirements:report.missing.length,full_month_accepted:report.missing.length===0&&report.products.every(p=>p.missing.length===0),waiting_products:report.products.filter(p=>p.decision==='Veri bekle').length},
        checks:{multi_month_product_and_date_checks:rangeChecks.every(r=>r.passed),missing_evidence_blocks_report_decisions:reportSafe,independent_metrics_match:independentMatches,metrics_valid:data.current===null||validMetrics(data.current),
          missing_days_are_null:data.series.every(s=>s.verified||s.metrics===null),verified_points_have_source:data.series.every(s=>!s.metrics||!!s.dataset_id&&!!s.fetched_at),
          partial_period_has_no_comparison:data.coverage.complete||!data.comparison_available,mobile_filter_preserved:mobile.device==='MOBILE',
          query_metrics_valid:queries.rows.every(r=>validMetrics({clicks:Number(r.clicks),impressions:Number(r.impressions),ctr:r.ctr===null?null:Number(r.ctr),position:r.position===null?null:Number(r.position)} as Metrics)),
          query_privacy_disclosed:queries.note.includes('Anonimleştirilmiş')},note:'Gerçek D1 kayıtları salt okunur kontrol edildi. Google senkronu veya site taraması tetiklenmedi.'});
    }
    if(request.method!=='POST'||url.pathname!=='/run')return json({error:'NOT_FOUND'},404);
    await seedCrawl(env);await crawlOne(env);
    return json(await state(env));
  },
};
