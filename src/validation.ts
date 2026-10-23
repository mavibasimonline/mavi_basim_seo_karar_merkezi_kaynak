import { AnalysisReport, Metrics } from './analysis';
import { Env } from './types';

export async function validateAnalysis(env:Env,report:AnalysisReport):Promise<string[]> {
  const errors:string[]=[];
  // Independent SQL aggregation checks the TypeScript calculations against active datasets.
  const rows=await env.DB.prepare(`SELECT COALESCE(p.id,pg.product_id,pc.id) AS product_id,
    CASE WHEN d.date>=? THEN 'current' ELSE 'previous' END AS period,
    SUM(d.clicks) AS clicks,SUM(d.impressions) AS impressions,
    SUM(d.clicks)*1.0/NULLIF(SUM(d.impressions),0) AS ctr,
    SUM(d.position*d.impressions)*1.0/NULLIF(SUM(d.impressions),0) AS position
    FROM gsc_daily_by_page d JOIN dataset_coverage c ON c.dataset_id=d.dataset_id AND c.day=d.date AND c.provider='gsc' AND c.scope='page' AND c.complete=1
    LEFT JOIN products p ON p.canonical_url=d.page LEFT JOIN pages pg ON pg.url=d.page
    LEFT JOIN page_aliases a ON a.alias_url=d.page LEFT JOIN products pc ON pc.canonical_url=a.canonical_url
    WHERE d.date BETWEEN ? AND ? GROUP BY product_id,period`).bind(report.period.start,report.previous_period.start,report.period.end)
    .all<Metrics&{product_id:string|null;period:string}>();
  for(const product of report.products){
    if(product.decision!=='Veri bekle'&&(product.missing.length||!product.current||!product.previous||!product.evidence.length))errors.push(`${product.id}:MISSING_EVIDENCE_GATE`);
    for(const period of ['current','previous'] as const){
      const actual=product[period],expected=rows.results.find(r=>r.product_id===product.id&&r.period===period);
      if(!actual&&expected)errors.push(`${product.id}:${period}:MISSING_MEASUREMENTS`);
      if(actual&&!expected)errors.push(`${product.id}:${period}:UNSUPPORTED_MEASUREMENTS`);
      if(actual&&expected)for(const key of ['clicks','impressions','ctr','position'] as const){
        if((actual[key]===null)!==(expected[key]===null)||Math.abs((actual[key]||0)-(expected[key]||0))>0.000001)errors.push(`${product.id}:${period}:${key}:CALCULATION_MISMATCH`);
      }
    }
    for(const query of product.queries){
      if(query.missing_current&&query.clicks!==null)errors.push(`${product.id}:MISSING_QUERY_IS_NOT_ZERO`);
      if(query.protect&&!product.risk.includes('korunmalı'))errors.push(`${product.id}:PROTECTION_WARNING_MISSING`);
    }
    if(!['Koru','İncele','İyileştir','Veri bekle'].includes(product.decision))errors.push(`${product.id}:UNKNOWN_DECISION`);
  }
  return errors;
}
