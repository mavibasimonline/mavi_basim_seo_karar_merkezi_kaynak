// Named account-only source. Every D1 statement remains metered and read-only.
import {WorkerEntrypoint} from 'cloudflare:workers';
import {Env,json} from './types';
import {withReadBudget,D1BudgetError} from './d1-read-budget';
import {monthPeriod} from './analysis';
import {calendarMonth} from './periods';
import {GSC_PAGE_SQL_VALID} from './urls';
export function snapshotWindow(time=new Date()){
 const current=calendarMonth(time),last=monthPeriod(current,-1).label,first=monthPeriod(last,-2).label;
 return {months:[first,monthPeriod(first,1).label,last,current],start:monthPeriod(first,-1).start,end:monthPeriod(current).end};
}
export async function monthlySource(request:Request,env:Env){
 const url=new URL(request.url),part=url.searchParams.get('part')||'meta',window=snapshotWindow();
 if(part==='health')return json({ok:true,read_only:true});
 try{return await withReadBudget(env,request.headers.get('X-Snapshot-Background')==='true'?'/internal/report-source-background':'/internal/report-source-read',async safe=>{
  let reads=0,statements=0;
  async function all(sql:string,params:unknown[]=[]){const r=await safe.DB.prepare(sql).bind(...params).all<any>();if(!Number.isSafeInteger(r.meta?.rows_read)||r.meta.rows_written!==0)throw Error('SNAPSHOT_SOURCE_COST_UNKNOWN');reads+=r.meta.rows_read;statements++;return r.results;}
  async function sourceRows(part:string,range:{start:string;end:string}){
   const table=part==='page'?'gsc_daily_by_page':'gsc_daily_by_query_device',query=part==='query';
   return all(`SELECT c.dataset_id,d.date,d.page,d.device,'ALL' country${query?',d.query,d.is_brand':''},sum(d.clicks) clicks,sum(d.impressions) impressions,COALESCE(sum(d.position*d.impressions)/NULLIF(sum(d.impressions),0),0) position,count(*) source_rows,
    sum(CASE WHEN d.clicks<0 OR d.impressions<d.clicks OR d.clicks!=CAST(d.clicks AS INTEGER) OR d.impressions!=CAST(d.impressions AS INTEGER) OR d.position<0 OR d.device NOT IN ('MOBILE','DESKTOP','TABLET') OR length(d.country)!=3 OR d.country GLOB '*[^A-Za-z]*' OR NOT ${GSC_PAGE_SQL_VALID} OR (d.impressions=0 AND d.ctr!=0) OR (d.impressions>0 AND abs(d.ctr-d.clicks/d.impressions)>0.000001)${query?" OR trim(d.query)='' OR length(d.query)>2000 OR d.is_brand NOT IN (0,1)":''} THEN 1 ELSE 0 END) invalid_rows
    FROM dataset_coverage c INDEXED BY coverage_active CROSS JOIN ${table} d ON d.dataset_id=c.dataset_id AND d.date=c.day WHERE c.provider='gsc' AND c.scope=? AND c.complete=1 AND c.day BETWEEN ? AND ? GROUP BY c.dataset_id,d.date,d.page,d.device${query?',d.query,d.is_brand':''} ORDER BY d.date,d.page,d.device LIMIT 20001`,[part,range.start,range.end]);
  }
  let data:any;
  if(part==='header'){
   // One read-only statement; country is collapsed only in measured fact rows.
   const arrays:Record<string,{sql:string;keys:string[]}>= {
    products:{sql:`SELECT p.*,g.name group_name,COALESCE(s.sources,0) keyword_sources,COALESCE(s.rows,0) keyword_rows FROM products p JOIN product_groups g ON g.id=p.group_id LEFT JOIN (SELECT product_id,count(*) sources,sum(row_count) rows FROM keyword_sources GROUP BY product_id) s ON s.product_id=p.id ORDER BY p.id`,keys:['id','name','group_id','source_folder','canonical_url','url_verified_at','group_name','keyword_sources','keyword_rows']},
    coverage:{sql:`SELECT * FROM dataset_coverage WHERE provider='gsc' AND scope IN ('page','query') AND complete=1 AND day BETWEEN ? AND ? ORDER BY day,scope`,keys:['provider','day','scope','dataset_id','complete','query_partial','row_count','fetched_at','notes']},
    aliases:{sql:'SELECT alias_url,canonical_url FROM page_aliases ORDER BY alias_url',keys:['alias_url','canonical_url']},
    mappedPages:{sql:'SELECT url,product_id FROM pages WHERE product_id IS NOT NULL ORDER BY url',keys:['url','product_id']},
    health:{sql:`SELECT provider,status,code,checked_at FROM health_checks WHERE provider IN ('gsc','ga4') ORDER BY day DESC,checked_at DESC LIMIT 30`,keys:['provider','status','code','checked_at']}
   };
   const select=Object.entries(arrays).map(([name,a])=>`(SELECT json_group_array(json_object(${a.keys.map(k=>`'${k}',${k}`).join(',')})) FROM (${a.sql})) ${name}`).join(',');
   const row=(await all(`SELECT ${select},EXISTS(SELECT 1 FROM oauth_credentials WHERE provider='google') connected,(SELECT json_group_array(json_object('id',id,'context',json_extract(answer_json,'$.context'))) FROM (SELECT id,answer_json FROM user_questions ORDER BY asked_at DESC LIMIT 100)) contexts`,[window.start,window.end]))[0];
   const parsed=Object.fromEntries(Object.keys(arrays).map(k=>[k,JSON.parse(row[k]) ]));
   data={meta:{window,products:parsed.products,coverage:parsed.coverage,site:env.SITE_ORIGIN,captured_at:new Date().toISOString()},mapping:{aliases:parsed.aliases,mappedPages:parsed.mappedPages},connection:{credential:row.connected?{present:1}:null,contexts:JSON.parse(row.contexts||'[]'),health:parsed.health,automation_enabled:env.AUTOMATION_ENABLED==='true',catchup_enabled:env.CATCHUP_ENABLED==='true',crawl_enabled:env.CRAWL_ENABLED==='true'}};
  }else if(part==='month'){
   const month=url.searchParams.get('month')||'',range=monthPeriod(month);if(range.start<window.start||range.end>window.end)throw Error('SNAPSHOT_MONTH_SCOPE');
   data={};for(const scope of ['page','query']){const rows=await sourceRows(scope,range);if(rows.length>20000||rows.some(r=>r.invalid_rows!==0)||rows.reduce((n,r)=>n+r.source_rows,0)>20000)throw Error('SNAPSHOT_SOURCE_ROWS_UNVERIFIED');data[scope]={rows};}
  }else if(part==='meta'){
   const products=await all(`SELECT p.*,g.name group_name,COALESCE(s.sources,0) keyword_sources,COALESCE(s.rows,0) keyword_rows FROM products p JOIN product_groups g ON g.id=p.group_id LEFT JOIN (SELECT product_id,count(*) sources,sum(row_count) rows FROM keyword_sources GROUP BY product_id) s ON s.product_id=p.id ORDER BY p.id`);
   const coverage=await all("SELECT * FROM dataset_coverage WHERE provider='gsc' AND scope IN ('page','query') AND complete=1 AND day BETWEEN ? AND ? ORDER BY day,scope",[window.start,window.end]);
   data={window,products,coverage,site:env.SITE_ORIGIN,captured_at:new Date().toISOString()};
  }else if(part==='mapping')data={aliases:await all('SELECT alias_url,canonical_url FROM page_aliases ORDER BY alias_url'),mappedPages:await all('SELECT url,product_id FROM pages WHERE product_id IS NOT NULL ORDER BY url')};
  else if(part==='health')data={};
  else if(part==='connection'){
   const credential=await all(`SELECT EXISTS(SELECT 1 FROM oauth_credentials WHERE provider='google') connected,(SELECT json_group_array(json_object('id',id,'context',json_extract(answer_json,'$.context'))) FROM (SELECT id,answer_json FROM user_questions ORDER BY asked_at DESC LIMIT 100)) contexts`);
   data={credential:credential[0]?.connected?{present:1}:null,contexts:JSON.parse(credential[0]?.contexts||'[]'),health:await all("SELECT provider,status,code,checked_at FROM health_checks WHERE provider IN ('gsc','ga4') ORDER BY day DESC,checked_at DESC LIMIT 30"),automation_enabled:env.AUTOMATION_ENABLED==='true',catchup_enabled:env.CATCHUP_ENABLED==='true',crawl_enabled:env.CRAWL_ENABLED==='true'};
  }else if(part==='costs')data={costs:await all(`SELECT day,fingerprint,executions,rows_read,rows_written,max_rows_read FROM d1_query_costs WHERE day>=date('now','-1 day') ORDER BY day DESC,rows_read DESC LIMIT 16`)};
  else if(part==='page'||part==='query'){
   const month=url.searchParams.get('month')||'',range=monthPeriod(month);if(range.start<window.start||range.end>window.end)throw Error('SNAPSHOT_MONTH_SCOPE');
   const count=await all("SELECT COALESCE(sum(row_count),0) n FROM dataset_coverage WHERE provider='gsc' AND scope=? AND complete=1 AND day BETWEEN ? AND ?",[part,range.start,range.end]);
   if(!Number.isSafeInteger(count[0]?.n)||count[0].n<0||count[0].n>20000)throw Error('SNAPSHOT_INPUT_SCOPE_LIMIT');
   const table=part==='page'?'gsc_daily_by_page':'gsc_daily_by_query_device',query=part==='query';
   const rows=await sourceRows(part,range);
   if(rows.length>20000||rows.some(r=>r.invalid_rows!==0)||rows.reduce((n,r)=>n+r.source_rows,0)!==count[0].n)throw Error('SNAPSHOT_SOURCE_ROWS_UNVERIFIED');
   data={scope:part,month,rows,source_rows:count[0].n};
  }else throw Error('SNAPSHOT_SOURCE_PART');
  return json({data,cost:{rows_read:reads,rows_written:0,statements}});
 });}catch(error){if(error instanceof D1BudgetError)return json({held:true,code:error.code,reason:error.reason},429);return json({held:true,code:error instanceof Error&&/^[A-Z0-9_]+$/.test(error.message)?error.message:'SNAPSHOT_SOURCE_UNAVAILABLE'},503);}
}
export class MonthlyReportSource extends WorkerEntrypoint<Env>{async fetch(request:Request){return monthlySource(request,this.env);}}
