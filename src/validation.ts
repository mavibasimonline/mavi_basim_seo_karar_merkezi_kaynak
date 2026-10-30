import {AnalysisReport,AnalysisEvidence,Metrics,validMetrics} from './analysis';
import {Env} from './types';
import {isBrand} from './urls';
export interface SumRow extends Metrics {product_id:string|null;period:string;device?:string;query?:string;is_brand?:number}
async function aggregate(env:Env,report:AnalysisReport,scope:'page'|'query',dimension:''|'device'|'query'|'is_brand'=''){
 const table=scope==='page'?'gsc_daily_by_page':'gsc_daily_by_query_device',extra=dimension?`,d.${dimension}`:'';
 const rows=await env.DB.prepare(`SELECT COALESCE(p.id,pg.product_id,pc.id) product_id,CASE WHEN d.date>=? THEN 'current' ELSE 'previous' END period${extra},
 SUM(d.clicks) clicks,SUM(d.impressions) impressions,SUM(d.clicks)*1.0/NULLIF(SUM(d.impressions),0) ctr,SUM(d.position*d.impressions)*1.0/NULLIF(SUM(d.impressions),0) position
 FROM dataset_coverage c INDEXED BY coverage_active CROSS JOIN ${table} d ON c.dataset_id=d.dataset_id AND c.day=d.date AND c.provider='gsc' AND c.scope=? AND c.complete=1
 LEFT JOIN products p ON p.canonical_url=d.page LEFT JOIN pages pg ON pg.url=d.page LEFT JOIN page_aliases a ON a.alias_url=d.page LEFT JOIN products pc ON pc.canonical_url=a.canonical_url
 WHERE ((c.day BETWEEN ? AND ?) OR (c.day BETWEEN ? AND ?)) AND (? IS NULL OR d.device=?)
 GROUP BY COALESCE(p.id,pg.product_id,pc.id),period${extra} LIMIT 50001`).bind(report.period.start,scope,report.previous_period.start,report.previous_period.end,report.period.start,report.period.end,report.filters?.device||null,report.filters?.device||null).all<SumRow>();
 if(rows.results.length>50000)throw new Error('VALIDATION_ROW_LIMIT');return rows.results;
}
export function metricErrors(actual:Metrics|null|undefined,expected:Metrics|null|undefined,ref:string):string[]{
 const errors:string[]=[];
 if(!actual&&expected)return [ref+':MISSING_MEASUREMENTS'];if(actual&&!expected)return [ref+':UNSUPPORTED_MEASUREMENTS'];
 if(actual&&expected){
  if(!validMetrics(actual))errors.push(ref+':INVALID_METRICS');
  for(const key of ['clicks','impressions','ctr','position'] as const){
   if(actual[key]!==null&&!Number.isFinite(actual[key]))errors.push(`${ref}:${key}:NON_FINITE`);
   if((actual[key]===null)!==(expected[key]===null)||Math.abs((actual[key]||0)-(expected[key]||0))>0.000001)errors.push(`${ref}:${key}:CALCULATION_MISMATCH`);
  }
 }
 return errors;
}
export async function validateAnalysis(env:Env,report:AnalysisReport):Promise<string[]> {
 const errors:string[]=[];
 const [rows,devices]=await Promise.all([aggregate(env,report,'page'),aggregate(env,report,'page','device')]);
 const [queries,brands]=await Promise.all([aggregate(env,report,'query','query'),aggregate(env,report,'query','is_brand')]);
 return validateProjection(report,{rows,devices,queries,brands});
}
export function validateProjection(report:AnalysisReport,{rows,devices,queries,brands}:{rows:SumRow[];devices:SumRow[];queries:SumRow[];brands:SumRow[]}):string[]{
 const errors:string[]=[];
 const key=(id:string|null,period:string,value:unknown)=>JSON.stringify([id,period,value]);
 const deviceMap=new Map(devices.map(r=>[key(r.product_id,r.period,r.device),r]));
 const queryMap=new Map(queries.map(r=>[key(r.product_id,r.period,r.query),r]));
 const brandMap=new Map(brands.map(r=>[key(r.product_id,r.period,r.is_brand),r]));
 for(const p of [report.period,report.previous_period])if((Date.parse(p.end)-Date.parse(p.start))/86400_000+1!==p.days)errors.push('PERIOD_DAY_COUNT_MISMATCH');
 for(const product of report.products){
  if(product.decision!=='Veri bekle'&&(product.missing.length||!product.current||!product.previous||!product.evidence.length))errors.push(`${product.id}:MISSING_EVIDENCE_GATE`);
  for(const period of ['current','previous'] as const){
   errors.push(...metricErrors(product[period],rows.find(r=>r.product_id===product.id&&r.period===period),`${product.id}:${period}`));
   for(const d of product.devices)errors.push(...metricErrors(d[period],deviceMap.get(key(product.id,period,d.device)),`${product.id}:${d.device}:${period}`));
   for(const q of product.queries){const expected=queryMap.get(key(product.id,period,q.query));errors.push(...metricErrors(q[period],expected,`${product.id}:${q.query}:${period}`));}
   for(const b of product.brand.segments||[])errors.push(...metricErrors(b[period],brandMap.get(key(product.id,period,b.kind==='brand'?1:0)),`${product.id}:${b.kind}:${period}`));
  }
  for(const q of product.queries){
   if(q.missing_current&&q.clicks!==null)errors.push(`${product.id}:MISSING_QUERY_IS_NOT_ZERO`);
   const c=queryMap.get(key(product.id,'current',q.query)),p=queryMap.get(key(product.id,'previous',q.query));
   if(q.clicks!==(c?.clicks??null)||q.impressions!==(c?.impressions??null)||q.previous_clicks!==(p?.clicks??null)||q.missing_current!==!c)errors.push(`${product.id}:QUERY_PROJECTION_MISMATCH`);
   if(q.is_brand!==isBrand(q.query))errors.push(`${product.id}:BRAND_CLASSIFICATION_MISMATCH`);
   if((!!c&&c.clicks>=10&&c.impressions>=100||!!p&&p.clicks>=10&&p.impressions>=100)&&!q.protect)errors.push(`${product.id}:PROTECTION_FLAG_MISSING`);
   if(q.protect&&!product.risk.includes('korunmalı'))errors.push(`${product.id}:PROTECTION_WARNING_MISSING`);
  }
  errors.push(...metricErrors(product.brand.brand,brandMap.get(key(product.id,'current',1)),`${product.id}:brand:current`));
  errors.push(...metricErrors(product.brand.non_brand,brandMap.get(key(product.id,'current',0)),`${product.id}:non_brand:current`));
  if(product.current&&product.previous){const calc=product.calculation as Record<string,unknown>;const expected=product.current.clicks-product.previous.clicks;if(calc.click_delta!==expected)errors.push(`${product.id}:CLICK_DELTA_MISMATCH`);const ratio=product.previous.clicks?expected/product.previous.clicks:null;if(calc.click_change!==ratio)errors.push(`${product.id}:CLICK_RATIO_MISMATCH`);const idelta=product.current.impressions-product.previous.impressions;if(calc.impression_delta!==idelta||calc.impression_change!==(product.previous.impressions?idelta/product.previous.impressions:null))errors.push(`${product.id}:IMPRESSION_CHANGE_MISMATCH`);}
  if(!['Koru','İncele','İyileştir','Veri bekle'].includes(product.decision))errors.push(`${product.id}:UNKNOWN_DECISION`);
  if(product.decision==='İyileştir')errors.push(`${product.id}:UNSUPPORTED_IMPROVEMENT`);
 }
 return errors;
}

// Independently recompute the report projections from the bounded, generation-
// checked source bundle. No database call and no reliance on report calculations.
export function validateEvidence(report:AnalysisReport,input:AnalysisEvidence){
 const resolve=(url:string)=>input.products.find(p=>p.canonical_url===url)?.id||input.mappedPages.find(p=>p.url===url)?.product_id||input.products.find(p=>p.canonical_url===input.aliases.find(a=>a.alias_url===url)?.canonical_url)?.id||null;
 const aggregate=(scope:'page'|'query',dimension:''|'device'|'query'|'is_brand'='')=>{
  const groups=new Map<string,any>();
  for(const row of scope==='page'?input.pages:input.queries){
   const period=row.date>=report.period.start&&row.date<=report.period.end?'current':row.date>=report.previous_period.start&&row.date<=report.previous_period.end?'previous':null;
   if(!period||report.filters?.device&&row.device!==report.filters.device)continue;
   const product_id=resolve(row.page),value=dimension?(row as any)[dimension]:undefined,key=JSON.stringify([product_id,period,value]);
   let g=groups.get(key);if(!g){g={product_id,period,clicks:0,impressions:0,weighted:0,...dimension?{[dimension]:value}:{}};groups.set(key,g);}
   g.clicks+=row.clicks;g.impressions+=row.impressions;g.weighted+=row.position*row.impressions;
  }
  return [...groups.values()].map(g=>({...g,ctr:g.impressions?g.clicks/g.impressions:null,position:g.impressions?g.weighted/g.impressions:null})) as SumRow[];
 };
 return validateProjection(report,{rows:aggregate('page'),devices:aggregate('page','device'),queries:aggregate('query','query'),brands:aggregate('query','is_brand')});
}
